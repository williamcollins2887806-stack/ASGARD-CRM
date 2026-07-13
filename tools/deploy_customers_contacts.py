#!/usr/bin/env python3
"""Deploy vanilla customer contact edit fix to prod."""
import io
import os
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

UPLOAD = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/customers.js",
]


def ensure_dir(sftp, remote_dir):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()
    for rel in UPLOAD:
        local = ROOT / rel
        if not local.exists():
            print("SKIP", rel)
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print("  uploaded", rel)
    sftp.close()
    print("\n=== Restart asgard-crm ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print("service:", o.read().decode().strip() or e.read().decode().strip())
    _, o, _ = c.exec_command("curl -s http://localhost:3000/api/version", timeout=30)
    print("api/version:", o.read().decode().strip())
    _, o, _ = c.exec_command(
        "grep -o 'data-edit-contact' /var/www/asgard-crm/public/assets/js/customers.js | head -1",
        timeout=30,
    )
    print("prod customers.js edit marker:", o.read().decode().strip() or "(missing)")
    c.close()
    print("done")


if __name__ == "__main__":
    main()
