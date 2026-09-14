#!/usr/bin/env python3
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"

cmds = [
    "sudo -u postgres psql -d asgard_crm -t -c \"SELECT column_name FROM information_schema.columns WHERE table_name='documents' ORDER BY ordinal_position;\"",
    "sudo -u postgres psql -d asgard_crm -t -c \"SELECT column_name FROM information_schema.columns WHERE table_name='correspondence' AND column_name LIKE '%file%';\"",
]

key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", pkey=key, timeout=30)

for cmd in cmds:
    print("---", cmd, "---")
    _, o, e = c.exec_command(cmd, timeout=60)
    print(o.read().decode("utf-8", "replace").strip())
    err = e.read().decode("utf-8", "replace").strip()
    if err:
        print("STDERR:", err)
    print()

c.close()
