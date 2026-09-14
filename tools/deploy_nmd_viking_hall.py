#!/usr/bin/env python3
"""Deploy NMD RAG + 3D viking + hall + trade scaffold to prod via SFTP."""
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

BACKEND = [
    "migrations/V294__nmd_rag_3d_hall_trade.sql",
    "src/index.js",
    "src/services/academy-nmd.js",
    "src/services/academy-cron.js",
    "src/routes/academy-nmd.js",
    "src/routes/field-hall.js",
    "src/routes/field-trade.js",
    "src/routes/field-gamification.js",
    "src/routes/field-worker.js",
]


def ensure_remote_dir(sftp, remote_dir: str):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def upload_file(sftp, local: Path, remote: str):
    ensure_remote_dir(sftp, str(Path(remote).parent).replace("\\", "/"))
    sftp.put(str(local), remote)
    print(f"  OK {remote}")


def upload_dir(sftp, local_dir: Path, remote_dir: str):
    ensure_remote_dir(sftp, remote_dir)
    for entry in os.listdir(local_dir):
        lp = local_dir / entry
        rp = f"{remote_dir}/{entry}"
        if lp.is_dir():
            upload_dir(sftp, lp, rp)
        else:
            sftp.put(str(lp), rp)
            print(f"  OK {rp}")


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== Backend files ===")
    for rel in BACKEND:
        upload_file(sftp, ROOT / rel, f"{PROJECT}/{rel}")

    print("=== Mobile /m ===")
    upload_dir(sftp, ROOT / "public" / "m", f"{PROJECT}/public/m")

    print("=== Ensure NMD upload dir ===")
    _, o, e = c.exec_command(
        f"mkdir -p {PROJECT}/uploads/nmd && chown -R www-data:www-data {PROJECT}/uploads/nmd || true",
        timeout=30,
    )
    print(o.read().decode() + e.read().decode())

    print("=== Migration V294 ===")
    _, o, e = c.exec_command(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {PROJECT}/migrations/V294__nmd_rag_3d_hall_trade.sql",
        timeout=60,
    )
    print(o.read().decode())
    err = e.read().decode()
    if err:
        print("stderr:", err)

    print("=== Restart ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print(o.read().decode().strip())
    print(e.read().decode())

    print("=== Smoke: require modules ===")
    _, o, e = c.exec_command(
        f"cd {PROJECT} && node -e \"require('./src/services/academy-nmd'); require('./src/routes/field-hall'); require('./src/routes/field-trade'); console.log('modules_ok')\"",
        timeout=30,
    )
    print(o.read().decode())
    print(e.read().decode())

    sftp.close()
    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
