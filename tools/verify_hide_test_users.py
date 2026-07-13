#!/usr/bin/env python3
import io
import json
import sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"

key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", pkey=key, timeout=30)

def run(cmd):
    _, o, e = c.exec_command(cmd, timeout=60)
    return o.read().decode().strip(), e.read().decode().strip()

for pin in ("1234", "0000"):
    out, _ = run(
        '''curl -s http://localhost:3000/api/auth/login -H "Content-Type: application/json" '''
        '''-d '{"login":"test_admin","password":"Test123!"}' '''
    )
    try:
        d = json.loads(out)
    except Exception:
        print("login parse fail", out[:200])
        continue
    token = d.get("token", "")
    if d.get("status") == "need_pin":
        out2, _ = run(
            f'''curl -s http://localhost:3000/api/auth/verify-pin '''
            f'''-H "Content-Type: application/json" -H "Authorization: Bearer {token}" '''
            f'''-d '{{"pin":"{pin}"}}' '''
        )
        d2 = json.loads(out2)
        token = d2.get("token", token)
    out3, _ = run(
        f'curl -s "http://localhost:3000/api/users?limit=500" -H "Authorization: Bearer {token}"'
    )
    try:
        data = json.loads(out3)
    except Exception:
        print("pin", pin, "bad response", out3[:200])
        continue
    users = data.get("users", [])
    test_in_list = [u for u in users if str(u.get("login", "")).startswith("test_")]
    print(f"pin={pin}: total={len(users)}, test_in_list={len(test_in_list)}")
    if users:
        break

out, _ = run(
    f'curl -s "http://localhost:3000/api/users?limit=500&include_test=1" -H "Authorization: Bearer {token}"'
)
data2 = json.loads(out)
users2 = data2.get("users", [])
test2 = [u for u in users2 if str(u.get("login", "")).startswith("test_")]
print(f"include_test=1: total={len(users2)}, test_in_list={len(test2)}")

out, _ = run(
    f'curl -s "http://localhost:3000/api/data/staff?limit=500" -H "Authorization: Bearer {token}"'
)
staff = json.loads(out).get("staff", [])
test_names = [s for s in staff if str(s.get("name", "")).startswith("Test ")]
print(f"/api/data/staff: total={len(staff)}, Test* names={len(test_names)}")

c.close()
