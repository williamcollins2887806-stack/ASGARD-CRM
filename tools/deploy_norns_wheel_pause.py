#!/usr/bin/env python3
"""Deploy Norns pause + Wheel 3D viking to prod via SFTP."""
import io
import os
import sys
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

BACKEND = [
    "migrations/V305__pause_physical_and_privilege_prizes.sql",
    "src/routes/field-gamification.js",
]

# desktop-v2 source note for PM (prod may serve built /v2 — also upload source for sync)
EXTRA = [
    "public/desktop-v2-src/src/pages/PmPrizes/index.jsx",
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
    if not local.exists():
        print(f"  SKIP missing {local}")
        return
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

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    print(f"=== Snapshot {stamp} ===")
    _, o, e = c.exec_command(
        f"mkdir -p /root/snapshots && tar -C /var/www -czf /root/snapshots/asgard-crm-pre-deploy-norns-{stamp}.tar.gz "
        f"asgard-crm/src/routes/field-gamification.js asgard-crm/public/m/index.html "
        f"asgard-crm/public/m/assets/index-*.js 2>/dev/null; ls -lh /root/snapshots/asgard-crm-pre-deploy-norns-{stamp}.tar.gz",
        timeout=120,
    )
    print(o.read().decode() + e.read().decode())

    print("=== Backend ===")
    for rel in BACKEND + EXTRA:
        upload_file(sftp, ROOT / rel, f"{PROJECT}/{rel}")

    print("=== Mobile /m (full tree) ===")
    upload_dir(sftp, ROOT / "public" / "m", f"{PROJECT}/public/m")

    print("=== Migration V305 ===")
    _, o, e = c.exec_command(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V305__pause_physical_and_privilege_prizes.sql",
        timeout=60,
    )
    print(o.read().decode())
    err = e.read().decode()
    if err:
        print("stderr:", err)

    print("=== Sanity: active physical prizes should be 0 ===")
    _, o, e = c.exec_command(
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -c "
        SELECT 'prizes_merch='||COUNT(*) FROM gamification_prizes WHERE is_active AND (prize_type='merch' OR requires_delivery);
        SELECT 'shop_merch='||COUNT(*) FROM gamification_shop_items WHERE is_active AND (category IN ('merch','privilege') OR requires_delivery);
        SELECT 'active_prizes='||COUNT(*) FROM gamification_prizes WHERE is_active AND weight>0;
        " """,
        timeout=30,
    )
    print(o.read().decode())
    print(e.read().decode())

    print("=== Restart ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print(o.read().decode().strip())
    print(e.read().decode())

    print("=== Smoke: module load + pause constants ===")
    _, o, e = c.exec_command(
        f"cd {PROJECT} && node -e \""
        "const fs=require('fs');"
        "const s=fs.readFileSync('./src/routes/field-gamification.js','utf8');"
        "if(!s.includes('PHYSICAL_PAUSED')) throw new Error('no PHYSICAL_PAUSED');"
        "if(!s.includes('pausePayload')) throw new Error('no pausePayload');"
        "console.log('backend_ok');"
        "\"",
        timeout=30,
    )
    print(o.read().decode())
    print(e.read().decode())

    print("=== Smoke: mobile index hash ===")
    _, o, e = c.exec_command(
        f"grep -o 'index-[^\"]*\\.js' {PROJECT}/public/m/index.html | head -1",
        timeout=15,
    )
    print(o.read().decode().strip())

    sftp.close()
    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
