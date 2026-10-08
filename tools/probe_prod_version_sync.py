#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check prod version + whether prod matches local (parallel session finished?)."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"

FILES = [
    "public/index.html",
    "public/assets/js/ting_page.js",
    "public/assets/js/huginn_ting.js",
    "src/routes/thing.js",
    "public/assets/css/ting.css",
    "public/assets/css/huginn_dock.css",
    "public/assets/js/huginn_dock.js",
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
    raise SystemExit("cannot load SSH key")


def norm(b: bytes) -> str:
    # ignore CRLF/LF differences
    return hashlib.md5(b.replace(b"\r\n", b"\n")).hexdigest()


def main() -> int:
    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)
    sftp = ssh.open_sftp()

    _i, o, _e = ssh.exec_command(
        f"grep -n 'ASGARD_SHELL_VERSION' {REMOTE}/public/index.html | head -1", timeout=60
    )
    print("prod version:", o.read().decode("utf-8", "replace").strip())

    print(f"\n{'file':<44} {'prod==local':<12} prod_mtime")
    import datetime as dt

    for rel in FILES:
        local = ROOT / rel
        if not local.is_file():
            print(f"{rel:<44} (local missing)")
            continue
        lh = norm(local.read_bytes())
        try:
            with sftp.open(f"{REMOTE}/{rel}", "rb") as f:
                rb = f.read()
            st = sftp.stat(f"{REMOTE}/{rel}")
            mt = f"{dt.datetime.fromtimestamp(st.st_mtime):%d.%m %H:%M:%S}"
            same = "SAME" if norm(rb) == lh else "DIFFERS"
            print(f"{rel:<44} {same:<12} {mt}")
        except Exception as exc:
            print(f"{rel:<44} ERR {exc}")
    sftp.close()
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
