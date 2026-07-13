#!/usr/bin/env python3
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"

cmds = [
    "grep ASGARD_SHELL_VERSION /var/www/asgard-crm/public/index.html | head -1",
    "grep SHELL_VERSION /var/www/asgard-crm/public/sw.js | head -1",
    "curl -s http://localhost:3000/api/version",
    "grep -oE '\\?v=20\\.26\\.[0-9]+' /var/www/asgard-crm/public/index.html | sort | uniq -c | sort -rn",
    "journalctl -u asgard-crm --since '36 hours ago' --no-pager -p err | tail -80",
    "journalctl -u asgard-crm --since '36 hours ago' --no-pager | grep -iE 'error|exception|fatal|ECONNREFUSED|Unhandled|stack trace' | grep -v 'level=30' | tail -120",
    "journalctl -u asgard-crm --since '36 hours ago' --no-pager | grep '\"level\":50' | tail -40",
    "journalctl -u asgard-crm --since '36 hours ago' --no-pager | grep -E 'ReferenceError|TypeError|SyntaxError|Sync error|level=50' | grep -v IMAP-AI | tail -50",
]

key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", pkey=key, timeout=30)

for cmd in cmds:
    print("---", cmd, "---")
    _, o, e = c.exec_command(cmd, timeout=120)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out.strip():
        print(out.strip())
    if err.strip():
        print("STDERR:", err.strip())
    print()

c.close()
