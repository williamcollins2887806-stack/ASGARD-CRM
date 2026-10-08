#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting video layout + name fix (shell 20.28.100)."""
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

VER = "20.28.100"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/css/ting.css",
    "public/assets/js/ting_page.js",
    "public/assets/js/huginn_ting.js",
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
    print("=== 0. PRE-FLIGHT shell_guard (deploy-gate) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print(f"shell_guard: OK (deploy-gate: HEAD == .last-verified, shell {VER})")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    css = (ROOT / "public/assets/css/ting.css").read_text(encoding="utf-8")
    if "container-type: size" not in css or "aspect-ratio: 16 / 9" not in css:
        raise SystemExit("ting.css missing aspect-ratio / container query")
    if ".ting-room-shell .ting-room-top" not in css:
        raise SystemExit("ting.css missing mobile top-bar fix")
    tp = (ROOT / "public/assets/js/ting_page.js").read_text(encoding="utf-8")
    if "pinnedId" not in tp or "is-contain" not in tp:
        raise SystemExit("ting_page.js missing pin/contain logic")
    ht = (ROOT / "public/assets/js/huginn_ting.js").read_text(encoding="utf-8")
    if "u.full_name || u.name" not in ht:
        raise SystemExit("huginn_ting.js missing profile-name logic")
    th = (ROOT / "src/routes/thing.js").read_text(encoding="utf-8")
    if "isPlaceholderDisplayName" not in th:
        raise SystemExit("thing.js missing placeholder guard")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    if f"ASGARD_SHELL_VERSION = '{VER}'" not in idx:
        raise SystemExit("index version mismatch")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 300) -> str:
        print(f"$ {cmd[:220]}")
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

    snap = f"/root/snapshots/asgard-crm-pre-ting-layout-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} {files} 2>/dev/null || true".format(
            snap=snap, remote=REMOTE, files=" ".join(FILES)
        )
    )
    print(f"snapshot: {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-ting-layout-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")

    print("=== post-upload byte compare (local vs prod) ===")
    all_same = True
    for rel in FILES:
        with sftp.open(f"{REMOTE}/{rel}", "rb") as f:
            rb = f.read()
        same = norm(rb) == norm((ROOT / rel).read_bytes())
        all_same = all_same and same
        print(("SAME  " if same else "DIFF  ") + rel)
    sftp.close()

    run(f"grep -n ASGARD_SHELL_VERSION {REMOTE}/public/index.html | head -1")
    run(f"grep -c 'container-type: size' {REMOTE}/public/assets/css/ting.css")
    run(f"grep -c 'pinnedId' {REMOTE}/public/assets/js/ting_page.js")
    run(f"grep -c 'isPlaceholderDisplayName' {REMOTE}/src/routes/thing.js")

    # smoke: приложение отвечает
    run("curl -s -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/health || true", check=False)

    ssh.close()
    if not all_same:
        raise SystemExit("POST-UPLOAD: локальные и прод-файлы разошлись")
    print(f"=== DONE shell {VER} — все файлы совпали ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
