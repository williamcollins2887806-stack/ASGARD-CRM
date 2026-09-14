#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=key, timeout=30)

# fire and forget regen
_, o, e = c.exec_command(
    "pkill -f '_nmd_regen' || true; "
    "cd /var/www/asgard-crm && nohup node scripts/_nmd_regen.js > /tmp/nmd_regen.log 2>&1 & echo STARTED:$!",
    timeout=15,
)
print(o.read().decode())
print(e.read().decode())

_, o, e = c.exec_command(
    """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT count(*) AS docs FROM academy_nmd_docs; SELECT count(*) AS chunks FROM academy_nmd_chunks;"
curl -sS http://127.0.0.1:3000/api/version
echo
systemctl is-active asgard-crm
grep -o "ASGARD_SHELL_VERSION *= *'[^']*'" /var/www/asgard-crm/public/index.html | head -1
ls /var/www/asgard-crm/public/m/assets/index-DOA0itZJ.js >/dev/null && echo mobile_new_ok
PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "SELECT count(*) FROM gamification_shop_items WHERE category IN ('digital','cosmetic') AND COALESCE(is_active,true)"
""",
    timeout=30,
)
print(o.read().decode())
print(e.read().decode())

# peek regen log after 5s
import time
time.sleep(5)
_, o, e = c.exec_command("head -30 /tmp/nmd_regen.log; ps aux | grep -F '_nmd_regen' | grep -v grep | head -2", timeout=20)
print("--- regen log ---")
print(o.read().decode())
c.close()
