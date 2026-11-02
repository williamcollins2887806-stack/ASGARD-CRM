#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting Telemost-parity wave (shell 20.28.335).

Does NOT upload ops/livekit/livekit.yaml (prod has real TURN secret).
Uploads CRM assets + thing/meetings routes + guest ting + v2 build tar.
"""
from __future__ import annotations

import hashlib
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import shell_guard  # noqa: E402
import paramiko

VER = "20.28.349"
SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/assets/css/ting.css",
    "public/assets/css/huginn_dock.css",
    "public/assets/js/ting_page.js",
    "public/assets/js/ting_room_core.js",
    "public/assets/js/calendar.js",
    "public/assets/img/ting-bg/office-dusk.svg",
    "public/assets/img/ting-bg/soft-sky.svg",
    "public/assets/img/ting-bg/warm-studio.svg",
    "public/ting/index.html",
    "src/routes/thing.js",
    "src/routes/meetings.js",
]


def load_pkey(path: str):
    for loader in (
        getattr(paramiko, "Ed25519Key", None),
        getattr(paramiko, "ECDSAKey", None),
        paramiko.RSAKey,
    ):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def norm(b: bytes) -> str:
    return hashlib.md5(b.replace(b"\r\n", b"\n")).hexdigest()


def main() -> int:
    print("=== 0. shell_guard (deploy-gate) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print(f"shell_guard: OK (HEAD == .last-verified, shell {VER})")

    js = (ROOT / "public/assets/js/ting_page.js").read_text(encoding="utf-8")
    if "TING_BG_PRESETS" not in js or "switchTingDevice" not in js:
        raise SystemExit("ting_page.js: РЅРµС‚ device/bg wiring")
    thing = (ROOT / "src/routes/thing.js").read_text(encoding="utf-8")
    if "status = 'live'" not in thing or "status = 'active'" in thing:
        raise SystemExit("thing.js: /start РґРѕР»Р¶РµРЅ РїРёСЃР°С‚СЊ live")
    guest = (ROOT / "public/ting/index.html").read_text(encoding="utf-8")
    if "guestBgGrid" not in guest or "guestMicSelect" not in guest:
        raise SystemExit("guest ting: РЅРµС‚ device/bg more-sheet")

    v2_index = ROOT / "public/v2/index.html"
    if not v2_index.exists():
        raise SystemExit("public/v2/index.html РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ вЂ” РЅСѓР¶РµРЅ npm run build")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 600) -> str:
        print(f"$ {cmd[:160]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print(err.rstrip(), file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd}")
        return out

    snap = f"/root/snapshots/asgard-crm-pre-ting-telemost-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} {' '.join(FILES)} public/v2 2>/dev/null || true")
    print(f"snapshot: {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
        # v2 build tree
        v2_root = ROOT / "public" / "v2"
        for p in v2_root.rglob("*"):
            if p.is_file():
                tar.add(p, arcname=str(p.relative_to(ROOT)).replace("\\", "/"))

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-ting-telemost-{STAMP}.tgz"
    print(f"upload {tar_path} в†’ {remote_tar}")
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    run("systemctl restart asgard-crm && sleep 6 && systemctl is-active asgard-crm")

    print("=== post-upload byte compare (CRM files) ===")
    all_same = True
    for rel in FILES:
        with sftp.open(f"{REMOTE}/{rel}", "rb") as f:
            rb = f.read()
        same = norm(rb) == norm((ROOT / rel).read_bytes())
        all_same = all_same and same
        print(("SAME  " if same else "DIFF  ") + rel)
    sftp.close()

    run(f"grep -c 'TING_BG_PRESETS' {REMOTE}/public/assets/js/ting_page.js")
    run(f"grep -c \"status = 'live'\" {REMOTE}/src/routes/thing.js")
    run(f"grep -c 'guestBgGrid' {REMOTE}/public/ting/index.html")
    run(f"grep -c 'loadRoom' {REMOTE}/src/routes/thing.js")
    run("curl -s http://127.0.0.1:3000/api/thing/health || true", check=False)
    run("docker ps --filter name=coturn --format '{{.Names}} {{.Status}}' || true", check=False)
    ssh.close()
    if not all_same:
        raise SystemExit("POST-UPLOAD: С„Р°Р№Р»С‹ СЂР°Р·РѕС€Р»РёСЃСЊ")
    print(f"=== DONE shell {VER} ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
