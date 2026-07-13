#!/usr/bin/env python3
import io
import sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", pkey=key, timeout=30)
sftp = c.open_sftp()
for rel in ["public/sw.js", "migrations/V282b__app_updates_hide_test_users.sql"]:
    sftp.put(str(ROOT / rel), f"{PROJECT}/{rel}")
    print("uploaded", rel)
sftp.close()

_, o, e = c.exec_command(
    f"PGPASSWORD=123456789 psql -U asgard -h 127.0.0.1 -d asgard_crm -v ON_ERROR_STOP=1 "
    f"-f {PROJECT}/migrations/V282b__app_updates_hide_test_users.sql",
    timeout=30,
)
print(o.read().decode().strip())
print(e.read().decode().strip())

_, o, e = c.exec_command(
    "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm",
    timeout=60,
)
print("service:", o.read().decode().strip())

_, o, _ = c.exec_command("curl -s http://localhost:3000/api/version", timeout=30)
print("api/version:", o.read().decode().strip())

_, o, _ = c.exec_command(
    "PGPASSWORD=123456789 psql -U asgard -h 127.0.0.1 -d asgard_crm -t -c "
    "\"SELECT COUNT(*) FROM users WHERE login ~ '^test_' AND is_active\"",
    timeout=30,
)
print("active test users (still exist for QA):", o.read().decode().strip())

_, o, _ = c.exec_command(
    "PGPASSWORD=123456789 psql -U asgard -h 127.0.0.1 -d asgard_crm -t -c "
    "\"SELECT COUNT(*) FROM staff s JOIN users u ON u.id=s.user_id WHERE u.login ~ '^test_'\"",
    timeout=30,
)
print("test users in staff:", o.read().decode().strip())

c.close()
print("done")
