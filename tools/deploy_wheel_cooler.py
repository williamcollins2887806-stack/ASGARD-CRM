#!/usr/bin/env python3
"""Deploy wheel cooler pack: mobile /m + field-gamification.js, restart service."""
import io
import os
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== Snapshot backend route ===")
    _, o, e = c.exec_command(
        "mkdir -p /root/snapshots && "
        f"cp {PROJECT}/src/routes/field-gamification.js "
        f"/root/snapshots/field-gamification-$(date +%Y%m%d-%H%M%S).js",
        timeout=20,
    )
    print(o.read().decode() or e.read().decode() or "ok")

    print("=== Upload field-gamification.js ===")
    local_route = ROOT / "src" / "routes" / "field-gamification.js"
    sftp.put(str(local_route), f"{PROJECT}/src/routes/field-gamification.js")
    print("  OK field-gamification.js")

    print("=== Upload /m ===")
    m_local = ROOT / "public" / "m"
    sftp.put(str(m_local / "index.html"), f"{PROJECT}/public/m/index.html")
    print("  OK index.html")
    assets = m_local / "assets"
    for name in os.listdir(assets):
        lp = assets / name
        if lp.is_file():
            sftp.put(str(lp), f"{PROJECT}/public/m/assets/{name}")
            print(f"  OK assets/{name}")

    print("=== Restart ===")
    _, o, e = c.exec_command("systemctl restart asgard-crm && sleep 1 && systemctl is-active asgard-crm", timeout=30)
    print(o.read().decode().strip())
    err = e.read().decode().strip()
    if err:
        print(err)

    _, o, e = c.exec_command(
        f"grep -oE 'index-[^\"]+\\.js' {PROJECT}/public/m/index.html | head -1; "
        f"curl -sI http://127.0.0.1:3000/m/ | head -1; "
        f"curl -sI http://127.0.0.1:3000/api/field/gamification/spin-status | head -1",
        timeout=20,
    )
    print(o.read().decode())
    sftp.close()
    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
