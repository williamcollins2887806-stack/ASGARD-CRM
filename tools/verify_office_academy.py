#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
ROOT = Path(__file__).resolve().parents[1]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", key_filename=str(KEY), timeout=30)
sftp = c.open_sftp()
sftp.put(str(ROOT / "public/assets/js/office_academy.js"), "/var/www/asgard-crm/public/assets/js/office_academy.js")
sftp.put(str(ROOT / "public/sw.js"), "/var/www/asgard-crm/public/sw.js")
sftp.put(str(ROOT / "public/index.html"), "/var/www/asgard-crm/public/index.html")
sftp.close()
_, so, se = c.exec_command(
    "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
    "\"SELECT status, count(*) FROM office_academy_lessons GROUP BY 1 ORDER BY 1;\" "
    "&& PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
    "\"SELECT id, title FROM office_academy_lessons WHERE id IN (6,7,12) ORDER BY id;\" "
    "&& curl -s http://127.0.0.1:3000/api/version",
    timeout=30,
)
print(so.read().decode("utf-8", "replace"))
print(se.read().decode("utf-8", "replace"))
c.close()
