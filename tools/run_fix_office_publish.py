#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
ROOT = Path(__file__).resolve().parents[1]
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("92.242.61.184", username="root", key_filename=str(KEY), timeout=30)
sftp = client.open_sftp()
sftp.put(str(ROOT / "tools/fix_office_academy_publish.js"), "/var/www/asgard-crm/tools/fix_office_academy_publish.js")
sftp.close()
_, so, se = client.exec_command("cd /var/www/asgard-crm && PGPASSWORD=123456789 node tools/fix_office_academy_publish.js", timeout=60)
print(so.read().decode("utf-8", "replace"))
err = se.read().decode("utf-8", "replace")
if err.strip(): print("ERR", err)
client.close()
