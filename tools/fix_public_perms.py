#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fix permissions of runtime-served static dirs (public/h was drwx------ -> EACCES -> 500).

The app runs as `ubuntu`, but public/h was left root-only (drwx------), so every
/h/ and /h/?invite=... request died with EACCES -> 500 (invite links broken).
Idempotent: dirs 755 (a+rX), files 644.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko  # noqa: E402

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"

REMOTE_SCRIPT = r'''
set -e
cd %(remote)s
echo "--- before ---"
find public -maxdepth 2 -type d ! -perm -o+rx -printf '%%M %%u:%%g %%p\n' 2>/dev/null | head -20
echo "--- fixing ---"
find public -maxdepth 3 -type d -exec chmod 755 {} \;
find public -maxdepth 3 -type f -exec chmod 644 {} \;
echo "--- after (should be empty) ---"
find public -maxdepth 3 -type d ! -perm -o+rx -printf '%%M %%u:%%g %%p\n' 2>/dev/null | head -20
echo "--- verify ---"
curl -s -o /dev/null -w 'h-root:%%{http_code}\n' http://127.0.0.1:3000/h/
''' % {"remote": REMOTE}


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


def main() -> int:
    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)
    _i, o, e = ssh.exec_command("sh -s", timeout=180)
    o.channel.sendall(REMOTE_SCRIPT.encode("utf-8"))
    o.channel.shutdown_write()
    print(o.read().decode("utf-8", "replace").rstrip())
    err = e.read().decode("utf-8", "replace")
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    code = o.channel.recv_exit_status()
    ssh.close()
    print("=== FIX PERMS", "OK" if code == 0 else f"FAILED ({code})", "===")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
