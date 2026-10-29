#!/usr/bin/env python3
"""Read-only: какие переменные окружения заданы на проде (только имена)."""
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

cmd = (
    "grep -oE '^[A-Z][A-Z0-9_]*' /var/www/asgard-crm/.env | sort -u; "
    "echo '--- env of service ---'; "
    "systemctl show asgard-crm -p Environment | tr ' ' '\\n' | grep -oE '^[A-Z][A-Z0-9_]*' | sort -u"
)
_, o, e = c.exec_command(cmd, timeout=60)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("STDERR:", err[:400])
c.close()
