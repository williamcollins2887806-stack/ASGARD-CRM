#!/usr/bin/env python3
"""Deploy RP close-confirm + TO chat email context + shell bump."""
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
    "public/assets/js/rp_review_modal.js",
    "src/services/rp-review-thread-notify.js",
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
        if not local.exists():
            print("SKIP", rel)
            continue
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

    print("\n=== Verify #1930 + markers ===")
    cmds = [
        """sudo -u postgres psql -d asgard_crm -t -A -c "SELECT t.id||'|'||t.registry_status||'|'||COALESCE(r.report_json->>'mode','')||'|'||COALESCE(r.analysis_finalized_at::text,'NULL') FROM tenders t JOIN tender_rp_reviews r ON r.tender_id=t.id WHERE t.id=1930;" """,
        "grep -c 'Закрыть анализ?' /var/www/asgard-crm/public/assets/js/rp_review_modal.js",
        "grep -c 'Предмет' /var/www/asgard-crm/src/services/rp-review-thread-notify.js",
        "grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/index.html",
        "grep -o \"SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/sw.js",
    ]
    for cmd in cmds:
        _, o, e = c.exec_command(cmd, timeout=20)
        out = (o.read() + e.read()).decode("utf-8", errors="replace").strip()
        print(out)

    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
