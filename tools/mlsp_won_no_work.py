#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SQL = """
-- Выиграли без работы (кнопка «Создать работу» видна)
SELECT t.id, t.registry_no, LEFT(t.tender_title,50) title,
       t.work_assigned_pm_id,
       EXISTS(SELECT 1 FROM works w WHERE w.tender_id=t.id AND w.deleted_at IS NULL) has_work
FROM tenders t
WHERE t.deleted_at IS NULL AND t.registry_status='выиграли'
  AND NOT EXISTS(SELECT 1 FROM works w WHERE w.tender_id=t.id AND w.deleted_at IS NULL)
  AND t.work_assigned_pm_id IS NULL
ORDER BY t.id DESC LIMIT 15;
"""

def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
    c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)
    cmd = 'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "' + SQL.strip() + '"'
    _, o, _ = c.exec_command(cmd, timeout=60)
    print(o.read().decode("utf-8", errors="replace"))
    c.close()

if __name__ == "__main__":
    main()
