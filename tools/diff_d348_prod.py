#!/usr/bin/env python3
"""Read-only: прод vs git HEAD для pm_duty.js перед выкладкой D-348."""
import difflib
import io
import subprocess
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
PROJECT = "/var/www/asgard-crm"
REL = "public/assets/js/pm_duty.js"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root",
          pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)
sftp = c.open_sftp()

prod = sftp.file(f"{PROJECT}/{REL}", "r").read().decode("utf-8", "replace").splitlines()
head = subprocess.check_output(["git", "show", f"HEAD:{REL}"], cwd=".").decode("utf-8", "replace").splitlines()

only = [l for l in difflib.unified_diff(head, prod, "HEAD", "прод", lineterm="", n=0)
        if (l.startswith("+") or l.startswith("-")) and not l.startswith(("+++", "---"))]
print(f"строк: прод={len(prod)} HEAD={len(head)}, отличий={len(only)}")
for l in only[:40]:
    print("  " + l[:150])

sftp.close()
c.close()
