#!/usr/bin/env python3
"""Deploy Personal Kanban v3 UX overhaul + V292 migration."""
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
    "public/assets/js/personal_kanban.js",
    "public/assets/css/light-theme.css",
    "src/routes/pre_tenders.js",
    "src/routes/personal-kanban.js",
    "src/services/pre-tender-doc-folders.js",
    "migrations/V292__pre_tender_work_fields.sql",
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

    print("=== Upload kanban v3 overhaul ===")
    for rel in UPLOAD:
        local = ROOT / rel
        if not local.exists():
            print("SKIP (missing)", rel)
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print("  uploaded", rel)
    sftp.close()

    print("\n=== Migration V292 ===")
    mig = f"{PROJECT}/migrations/V292__pre_tender_work_fields.sql"
    _, o, e = c.exec_command(
        f"sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 -f {mig}",
        timeout=60,
    )
    out = o.read().decode().strip()
    err = e.read().decode().strip()
    if out:
        print(out)
    if err and "ERROR" in err.upper() and "already exists" not in err.lower():
        print("migration err:", err)
    else:
        print("migration V292: ok")

    print("\n=== Restart asgard-crm ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print("service:", (o.read() + e.read()).decode().strip())

    print("\n=== Verify ===")
    _, o, _ = c.exec_command(
        "grep -c '_injectPk3DrawerStyles\\|PK3_WORK_TYPES\\|customer-open-card' "
        "/var/www/asgard-crm/public/assets/js/personal_kanban.js; "
        "curl -s http://localhost:3000/api/version",
        timeout=30,
    )
    print(o.read().decode().strip())

    c.close()
    print("\ndone")


if __name__ == "__main__":
    main()
