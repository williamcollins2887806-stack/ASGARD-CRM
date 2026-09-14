#!/usr/bin/env python3
import io, re, sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)
_, o, _ = c.exec_command(
    "sudo -u postgres psql -d asgard_crm -t -A -F'\\t' -c "
    "\"SELECT body_text, body_html FROM emails WHERE id=3140\"",
    timeout=30,
)
raw = o.read().decode("utf-8", errors="replace")
parts = raw.split("\t", 1)
print("TEXT link line:")
for line in parts[0].splitlines():
    if "CRM" in line or "asgard" in line.lower():
        print(" ", line)
if len(parts) > 1:
    hrefs = re.findall(r'href="([^"]+)"', parts[1])
    print("HTML hrefs:", hrefs)
c.close()
