#!/usr/bin/env python3
"""Verify SHELL_VERSION consistency on prod."""
import re
import sys
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"

key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", pkey=key, timeout=30)

def run(cmd):
    _, o, e = c.exec_command(cmd, timeout=60)
    return (o.read() + e.read()).decode("utf-8", errors="replace").strip()

local_sw = (Path(__file__).resolve().parents[1] / "public" / "sw.js").read_text(encoding="utf-8")
local_ver = re.search(r"SHELL_VERSION\s*=\s*'([^']+)'", local_sw).group(1)

sw_line = run(f"grep SHELL_VERSION {PROJECT}/public/sw.js")
sw_ver = re.search(r"'([^']+)'", sw_line)
sw_ver = sw_ver.group(1) if sw_ver else "?"

idx = run(f"cat {PROJECT}/public/index.html")
idx_vers = set(re.findall(r"\?v=([0-9.]+)", idx))
shell_ver = re.search(r"ASGARD_SHELL_VERSION\s*=\s*'([^']+)'", idx)
shell_ver = shell_ver.group(1) if shell_ver else "?"

api = run("curl -s http://localhost:3000/api/version")
api_ver = re.search(r'"version":"([^"]+)"', api)
api_ver = api_ver.group(1) if api_ver else "?"

v2_code = run("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/v2/")
v2_assets = run(f"ls {PROJECT}/public/v2/assets/*.js 2>/dev/null | wc -l")

print(f"local SHELL_VERSION:     {local_ver}")
print(f"prod sw.js:              {sw_ver}")
print(f"prod ASGARD_SHELL_VERSION: {shell_ver}")
print(f"prod api/version:        {api_ver}")
print(f"prod index ?v= unique:   {sorted(idx_vers)}")
print(f"/v2/ HTTP:               {v2_code}")
print(f"/v2/assets/*.js count:   {v2_assets}")

ok = (
    local_ver == sw_ver == shell_ver == api_ver
    and len(idx_vers) == 1
    and local_ver in idx_vers
    and v2_code == "200"
)
print("OK" if ok else "MISMATCH")
c.close()
sys.exit(0 if ok else 1)
