#!/usr/bin/env python3
"""Deploy Jose timesheet + bug fixes to prod."""
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
    "public/robots.txt",
    "public/assets/js/timesheet-v2.js",
    "public/assets/js/file_download.js",
    "public/assets/js/registry_api.js",
    "public/assets/js/employee.js",
    "src/routes/timesheet-v2.js",
    "src/routes/staff.js",
    "public/assets/js/pm_works.js",
    "src/routes/works.js",
    "src/services/log-monitor-cron.js",
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


def upload_tree(sftp, local_dir: Path, remote_dir: str):
    ensure_dir(sftp, remote_dir)
    count = 0
    for item in local_dir.rglob("*"):
        if item.is_dir():
            continue
        rel = item.relative_to(local_dir).as_posix()
        remote = f"{remote_dir}/{rel}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(item), remote)
        count += 1
    return count


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

    for sub in ("public/v2", "public/m"):
        local = ROOT / sub
        if local.is_dir():
            n = upload_tree(sftp, local, f"{PROJECT}/{sub}")
            print(f"  uploaded {sub} ({n} files)")

    sftp.close()
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print("service:", o.read().decode().strip() or e.read().decode().strip())
    c.close()
    print("Deploy complete")


if __name__ == "__main__":
    main()
