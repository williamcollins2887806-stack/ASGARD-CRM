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
cmds = [
    r"""grep -E '17/Jul/2026' /var/log/nginx/access.log | grep -E ' (4[0-9]{2}|5[0-9]{2}) ' | grep -vE 'favicon|sw\.js|\.map |apple-touch|robots' | awk -F'"' '{print $3,$2}' | awk '{print $1,$3}' | sort | uniq -c | sort -rn | head -40""",
    r"""journalctl -u asgard-crm --since '24 hours ago' --no-pager -o cat | grep -A2 'IMAP] Sync error' | head -40""",
    r"""grep -E '17/Jul/2026' /var/log/nginx/access.log | grep -i hv | grep -E 'staff|field/manage|planned|employees' | tail -n 40""",
    r"""grep -E '17/Jul/2026' /var/log/nginx/access.log | grep '/api/staff/' | head -5; grep -cE '17/Jul/2026.*/api/staff/' /var/log/nginx/access.log""",
]
for cmd in cmds:
    print('====', cmd[:80], '====')
    _, o, e = c.exec_command(cmd, timeout=120)
    print(o.read().decode('utf-8','replace')[:6000])
    err=e.read().decode('utf-8','replace').strip()
    if err: print('STDERR', err[:1000])
c.close()
