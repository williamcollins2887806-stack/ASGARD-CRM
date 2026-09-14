#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SQL = r"""
SELECT id, registry_no, period, registry_status, LEFT(tender_title, 120) title
FROM tenders
WHERE deleted_at IS NULL
  AND (
    tender_title ILIKE '%зачистк%танк%'
    OR tender_title ILIKE '%аппарат%технологическ%'
    OR tender_title ILIKE '%каусорб%'
    OR tender_title ILIKE '%Z49002%'
    OR tender_title ILIKE '%V49001%'
    OR tender_title ILIKE '%химическ%промывк%Z44010%'
  )
ORDER BY id;
"""

def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
    c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)
    cmd = f'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "{SQL.strip()}"'
    _, o, e = c.exec_command(cmd, timeout=60)
    print(o.read().decode("utf-8", errors="replace"))
    c.close()

if __name__ == "__main__":
    main()
