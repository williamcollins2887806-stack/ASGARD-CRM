#!/usr/bin/env python3
"""Deploy reject-flow fix + chat notify + kanban premium polish."""
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
    "public/assets/js/components/doc-preview-modal.js",
    "public/assets/js/registry_tab.js",
    "public/assets/js/registry_api.js",
    "public/assets/js/rp_review_modal.js",
    "public/assets/css/light-theme.css",
    "public/assets/css/app.css",
    "src/routes/pre_tenders.js",
    "src/routes/pm-duty.js",
    "src/services/rp-review-thread-notify.js",
    "src/services/rp-review-notify.js",
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

    print("\n=== Restore tender 1920 to active registry ===")
    sql = (
        "UPDATE tenders SET registry_status='рассмотрение', tender_status='Новый', "
        "archived_at=NULL, archived_by=NULL, archive_reason=NULL, updated_at=NOW() "
        "WHERE id=1920 AND registry_status='отмена';"
    )
    _, o, e = c.exec_command(
        f"sudo -u postgres psql -d asgard_crm -c \"{sql}\"",
        timeout=30,
    )
    print(o.read().decode("utf-8", errors="replace"))
    err = e.read().decode("utf-8", errors="replace").strip()
    if err:
        print(err)

    print("\n=== Restart ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print((o.read() + e.read()).decode().strip())
    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
