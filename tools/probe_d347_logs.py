#!/usr/bin/env python3
"""Read-only: что в прод-логах по тендеру 2101 (400 на rp-review)."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root",
          pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)


def run(cmd, limit=9000):
    print("====", cmd[:120], "====")
    _, o, e = c.exec_command(cmd, timeout=180)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    print(out[:limit] if out else "(пусто)")
    if err.strip():
        print("STDERR:", err[:1500])


run('journalctl -u asgard-crm --since "3 hours ago" --no-pager | grep -i "rp-review" | tail -50')
print()
run('journalctl -u asgard-crm --since "3 hours ago" --no-pager | grep -iE "2101" | tail -30')
c.close()
