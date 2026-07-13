#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
cmds = [
    "journalctl -u asgard-crm --since '30 min ago' --no-pager | grep -E 'req-w|req-6b|req-6r' ",
    "curl -s -o /dev/null -w 'ext:%{http_code}' https://asgard-crm.ru/api/version; echo",
]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=KEY, timeout=30)
for cmd in cmds:
    print('---', cmd[:100])
    _, o, e = c.exec_command(cmd, timeout=90)
    print(o.read().decode('utf-8','replace').strip())
    err = e.read().decode('utf-8','replace').strip()
    if err: print('ERR', err)
    print()
c.close()
