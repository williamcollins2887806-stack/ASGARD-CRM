#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SQL = """
SELECT w.id, w.tender_id, w.max_chat_id IS NOT NULL AS has_chat,
       w.site_id, w.object_name, w.work_status, t.work_assigned_pm_id
FROM works w JOIN tenders t ON t.id=w.tender_id
WHERE w.id IN (354,402,403,404,405,406,407) AND w.deleted_at IS NULL ORDER BY w.id;
"""

def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
    c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)
    cmd = 'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "' + SQL.strip() + '"'
    _, o, e = c.exec_command(cmd, timeout=60)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    print(out or err or "(empty)")
    c.close()

if __name__ == "__main__":
    main()
