#!/usr/bin/env python3
"""Deploy catalog expansion + 3D polish + academy trophy + NMD tools."""
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

FILES = [
    "migrations/V295__expand_cosmetic_catalog.sql",
    "src/routes/field-academy.js",
    "src/services/academy-cron.js",
    "src/services/academy-nmd.js",
    "src/routes/academy-nmd.js",
]


def ensure_dir(sftp, remote_dir: str):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def upload_dir(sftp, local_dir: Path, remote_dir: str):
    ensure_dir(sftp, remote_dir)
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

    print("=== Backend ===")
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        ensure_dir(sftp, str(Path(remote).parent).replace("\\", "/"))
        sftp.put(str(local), remote)
        print(f"  OK {remote}")

    print("=== Mobile /m ===")
    upload_dir(sftp, ROOT / "public" / "m", f"{PROJECT}/public/m")

    print("=== Migration V295 ===")
    _, o, e = c.exec_command(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V295__expand_cosmetic_catalog.sql",
        timeout=120,
    )
    print(o.read().decode())
    err = e.read().decode()
    if err:
        print("stderr:", err)

    print("=== Counts ===")
    _, o, e = c.exec_command(
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        SELECT count(*) AS cosmetic_digital FROM gamification_shop_items
        WHERE category IN ('digital','cosmetic') AND COALESCE(is_active,true);
        SELECT COALESCE(equip_slot,'(none)') AS slot, count(*) FROM gamification_shop_items
        WHERE COALESCE(is_active,true) AND equip_slot IS NOT NULL GROUP BY 1 ORDER BY 1;
        SELECT count(*) AS wheel_cosmetic FROM gamification_prizes
        WHERE prize_type IN ('cosmetic_item','avatar_frame') AND COALESCE(is_active,true);
        "
        """,
        timeout=60,
    )
    print(o.read().decode())
    print(e.read().decode())

    print("=== Restart ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print(o.read().decode().strip())

    sftp.close()
    c.close()
    print("DEPLOY_DONE")


if __name__ == "__main__":
    main()
