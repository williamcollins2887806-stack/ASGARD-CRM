#!/usr/bin/env python3
"""Deploy clearer busy/on-site messaging for Jose/Gorshkov case."""
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
    "public/assets/js/employee.js",
    "public/assets/js/field-tab.js",
    "src/routes/planned-engagements.js",
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
    print("=== Upload ===")
    for rel in UPLOAD:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print("  ok", rel)
    sftp.close()

    print("\n=== Restart ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print((o.read() + e.read()).decode().strip())

    print("\n=== Verify ===")
    cmds = [
        "grep -c 'already_on_site\\|уже на объекте' /var/www/asgard-crm/src/routes/planned-engagements.js",
        "grep -c 'уже на объекте' /var/www/asgard-crm/public/assets/js/employee.js",
        "grep -c 'уже на объекте' /var/www/asgard-crm/public/assets/js/field-tab.js",
        "grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/index.html",
        """sudo -u postgres psql -d asgard_crm -t -A -c "SELECT e.full_name||' | on_site='||COALESCE(w.work_title,'—')||' | plan='||COALESCE(wp.work_title,'—') FROM employees e LEFT JOIN employee_assignments ea ON ea.employee_id=e.id AND COALESCE(ea.is_active,true)=true AND ea.departure_date IS NULL LEFT JOIN works w ON w.id=ea.work_id LEFT JOIN employee_planned_engagements pe ON pe.employee_id=e.id AND pe.status='active' LEFT JOIN works wp ON wp.id=pe.work_id WHERE e.id=63;" """,
    ]
    for cmd in cmds:
        _, o, e = c.exec_command(cmd, timeout=30)
        print((o.read() + e.read()).decode("utf-8", errors="replace").strip())

    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
