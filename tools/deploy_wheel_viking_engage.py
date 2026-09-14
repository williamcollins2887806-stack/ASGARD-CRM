#!/usr/bin/env python3
"""Hotfix: wheel viking engagement animations (mobile /m only)."""
import io, os, sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]


def ensure_remote_dir(sftp, remote_dir: str):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def upload_dir(sftp, local_dir: Path, remote_dir: str):
    ensure_remote_dir(sftp, remote_dir)
    for entry in os.listdir(local_dir):
        lp = local_dir / entry
        rp = f"{remote_dir}/{entry}"
        if lp.is_dir():
            upload_dir(sftp, lp, rp)
        else:
            # Skip huge unchanged glbs if identical size? Always upload for safety of index/js
            sftp.put(str(lp), rp)
            print(f"  OK {rp}")


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()
    print("=== Upload /m ===")
    # Faster: upload only index + new hashed assets, not full avatar tree if present
    m_local = ROOT / "public" / "m"
    # Always put index.html
    sftp.put(str(m_local / "index.html"), f"{PROJECT}/public/m/index.html")
    print("  OK index.html")
    assets = m_local / "assets"
    for name in os.listdir(assets):
        lp = assets / name
        if lp.is_file():
            sftp.put(str(lp), f"{PROJECT}/public/m/assets/{name}")
            print(f"  OK assets/{name}")
        # skip nested dirs (avatars) — already on server
    _, o, e = c.exec_command(
        f"grep -oE 'index-[^\"]+\\.js' {PROJECT}/public/m/index.html | head -1; "
        f"curl -sI http://127.0.0.1:3000/m/ | head -1",
        timeout=20,
    )
    print(o.read().decode())
    print(e.read().decode())
    sftp.close()
    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
