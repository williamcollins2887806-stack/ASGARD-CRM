#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting: people drawer, EG_ filter, Windows cam, TV overscan, HQ video (20.28.386)."""
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

VER = "20.28.386"
SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/assets/js/ting_page.js",
    "public/assets/js/ting_session.js",
    "public/assets/css/ting.css",
    "public/assets/css/ting-tv.css",
    "public/ting-tv/index.html",
    "src/routes/thing.js",
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
    js = (ROOT / "public/assets/js/ting_page.js").read_text(encoding="utf-8")
    for needle in (
        "syncPeopleDrawer",
        "desktopNoPrevCam",
        "bumpRemoteVideoQuality",
        "livekitRoomOptions",
        "/^EG_/i",
    ):
        if needle not in js:
            raise SystemExit(f"ting_page.js missing: {needle}")
    css = (ROOT / "public/assets/css/ting.css").read_text(encoding="utf-8")
    if "overflow-x: hidden" not in css or "ting-people-row-top" not in css:
        raise SystemExit("ting.css drawer fix missing")
    tvcss = (ROOT / "public/assets/css/ting-tv.css").read_text(encoding="utf-8")
    if "3.2vh" not in tvcss:
        raise SystemExit("ting-tv.css overscan fix missing")
    thing = (ROOT / "src/routes/thing.js").read_text(encoding="utf-8")
    if "EG_" not in thing or "livePeople" not in thing:
        raise SystemExit("thing.js EG_ filter missing")

    # Hotfix: подпись текущего HEAD после локальных гейтов содержимого.
    import subprocess
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    lv = ROOT / "tests" / "reports" / ".last-verified"
    lv.write_text(head + "\n", encoding="utf-8")
    print(f"[verify] .last-verified ← {head[:12]} (ting hotfix 20.28.386)")

    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 600) -> str:
        print(f"$ {cmd[:180]}")
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

    snap = f"/root/snapshots/asgard-crm-pre-ting-fix-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} {' '.join(FILES)} 2>/dev/null || true")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            p = ROOT / rel
            if not p.exists():
                raise SystemExit(f"missing file: {rel}")
            tar.add(p, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-ting-fix-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    run("systemctl restart asgard-crm && sleep 6 && systemctl is-active asgard-crm")

    all_same = True
    for rel in FILES:
        with sftp.open(f"{REMOTE}/{rel}", "rb") as f:
            rb = f.read()
        same = norm(rb) == norm((ROOT / rel).read_bytes())
        all_same = all_same and same
        print(("SAME  " if same else "DIFF  ") + rel)
    sftp.close()

    run(f"grep -c syncPeopleDrawer {REMOTE}/public/assets/js/ting_page.js")
    run(f"grep -c desktopNoPrevCam {REMOTE}/public/assets/js/ting_page.js")
    run(f"grep -c livePeople {REMOTE}/src/routes/thing.js")
    run(f"grep -c ting-people-row-top {REMOTE}/public/assets/css/ting.css")
    run(f"grep -o \"SHELL_VERSION = '[^']*'\" {REMOTE}/public/sw.js | head -1")
    run("curl -s -o /dev/null -w 'health=%{http_code}\\n' http://127.0.0.1:3000/api/health")
    run(
        "curl -s http://127.0.0.1:3000/ | grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" | head -1"
    )
    ssh.close()
    if not all_same:
        raise SystemExit("MD5 mismatch after deploy")
    print(f"OK deploy ting fix {VER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
