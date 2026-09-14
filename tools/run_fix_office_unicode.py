#!/usr/bin/env python3
"""Upload and run office academy unicode fix on prod."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / "tools" / "fix_office_academy_unicode.js"


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=str(KEY), timeout=30)
    sftp = client.open_sftp()
    remote = "/var/www/asgard-crm/tools/fix_office_academy_unicode.js"
    sftp.put(str(LOCAL), remote)
    sftp.close()
    cmd = "cd /var/www/asgard-crm && PGPASSWORD=123456789 node tools/fix_office_academy_unicode.js"
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    print(stdout.read().decode("utf-8", errors="replace"))
    err = stderr.read().decode("utf-8", errors="replace")
    if err.strip():
        print("ERR:", err)
    code = stdout.channel.recv_exit_status()
    client.close()
    sys.exit(code)


if __name__ == "__main__":
    main()
