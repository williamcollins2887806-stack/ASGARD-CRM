#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SQL = """
SELECT t.id, t.registry_status, LEFT(t.tender_title,60) title,
       w.id work_id, u.name pm, t.created_by, cb.name creator
FROM tenders t
LEFT JOIN works w ON w.tender_id=t.id AND w.deleted_at IS NULL
LEFT JOIN users u ON u.id=w.pm_id
LEFT JOIN users cb ON cb.id=t.created_by
WHERE t.deleted_at IS NULL AND (
  t.id IN (776,1579,1439,1237,1750,1733)
  OR t.tender_title ILIKE '%зачистке танков%технологическ%'
  OR t.tender_title ILIKE '%каусорб%'
)
ORDER BY t.id;
"""

def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
    c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)
    cmd = 'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "' + SQL.strip().replace('"', '\\"') + '"'
    _, o, e = c.exec_command(cmd, timeout=60)
    print(o.read().decode("utf-8", errors="replace"))
    c.close()

if __name__ == "__main__":
    main()
