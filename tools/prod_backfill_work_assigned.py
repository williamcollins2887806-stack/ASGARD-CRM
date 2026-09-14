#!/usr/bin/env python3
"""Backfill work_assigned_pm_id for tenders that already have works."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"

SQL = """
UPDATE tenders t
SET work_assigned_pm_id = w.pm_id,
    work_assigned_at = COALESCE(t.work_assigned_at, w.created_at, NOW()),
    updated_at = NOW()
FROM works w
WHERE w.tender_id = t.id
  AND w.deleted_at IS NULL
  AND t.deleted_at IS NULL
  AND t.work_assigned_pm_id IS NULL;
SELECT COUNT(*)::int FROM tenders t
JOIN works w ON w.tender_id = t.id AND w.deleted_at IS NULL
WHERE t.deleted_at IS NULL AND t.registry_status = 'выиграли';
"""


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    remote = "/tmp/asgard_backfill_work.sql"
    sftp = c.open_sftp()
    with sftp.file(remote, "w") as f:
        f.write(SQL)
    sftp.close()
    _, o, e = c.exec_command(f"sudo -u postgres psql -d asgard_crm -f {remote}", timeout=120)
    print(o.read().decode())
    err = e.read().decode().strip()
    if err:
        print("stderr:", err[:500])
    c.close()


if __name__ == "__main__":
    main()
