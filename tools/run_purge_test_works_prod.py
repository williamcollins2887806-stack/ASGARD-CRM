#!/usr/bin/env python3
"""Upload purge_test_works.js and run on prod."""
import io, sys
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
local = ROOT / "tools" / "purge_test_works.js"
remote = f"{PROJECT}/tools/purge_test_works.js"
sftp.put(str(local), remote)
sftp.close()
print("uploaded purge_test_works.js")

_, o, e = c.exec_command(
    f"cd {PROJECT} && DATABASE_URL=postgresql://asgard:123456789@localhost/asgard_crm node tools/purge_test_works.js",
    timeout=120,
)
print(o.read().decode("utf-8", errors="replace"))
err = e.read().decode("utf-8", errors="replace")
if err.strip():
    print("stderr:", err)

_, o, _ = c.exec_command(
    "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -c "
    "\"SELECT COUNT(*) FROM works WHERE deleted_at IS NULL AND work_title LIKE 'CASH-STMT-%'\"",
    timeout=30,
)
print("CASH-STMT remaining:", o.read().decode().strip())
c.close()
