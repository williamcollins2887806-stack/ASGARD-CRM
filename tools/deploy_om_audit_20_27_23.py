#!/usr/bin/env python3
"""Deploy OM audit fixes (20.27.23): timesheet, correspondence, permits, academy, recording-fetcher."""
import io
import os
import sys
import time
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
VER = "20.27.23"

FILES = [
    "migrations/V299__trip_stages_unique_excl_cancelled.sql",
    "src/routes/timesheet-v2.js",
    "src/routes/office-academy.js",
    "src/routes/permits.js",
    "src/services/recording-fetcher.js",
    "public/assets/js/correspondence.js",
    "public/assets/js/permits.js",
    "public/index.html",
    "public/sw.js",
]


def ensure_dir(sftp, remote_dir):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def run(client, cmd, timeout=180):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    code = stdout.channel.recv_exit_status()
    return code, out, err


def main():
    if not KEY.exists():
        print(f"ERROR: missing key {KEY}", file=sys.stderr)
        sys.exit(1)

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = client.open_sftp()

    print(f"=== Snapshot before deploy {VER} ===")
    code, out, err = run(
        client,
        "mkdir -p /root/snapshots && "
        f"tar -czf /root/snapshots/asgard-crm-pre-deploy-om-audit-{VER}-$(date +%Y%m%d%H%M%S).tgz "
        "-C /var/www asgard-crm/src/routes/timesheet-v2.js "
        "asgard-crm/src/routes/office-academy.js asgard-crm/src/routes/permits.js "
        "asgard-crm/src/services/recording-fetcher.js "
        "asgard-crm/public/assets/js/correspondence.js asgard-crm/public/index.html "
        "asgard-crm/public/sw.js 2>/dev/null; "
        f"ls -lt /root/snapshots/asgard-crm-pre-deploy-om-audit-{VER}-* | head -1",
        timeout=180,
    )
    print(out or "(snapshot done)")
    if err:
        print("stderr:", err)

    print(f"\n=== Upload files {VER} ===")
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            print(f"  SKIP missing {rel}")
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print(f"  OK {rel}")
    sftp.close()

    print("\n=== Migration V299 ===")
    code, out, err = run(
        client,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V299__trip_stages_unique_excl_cancelled.sql && "
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"SELECT indexdef FROM pg_indexes WHERE indexname='idx_trip_stages_unique_day';\"",
        timeout=60,
    )
    print(out or "(no stdout)")
    if err:
        print("stderr:", err)
    if code != 0:
        print(f"ERROR migration exit {code}")
        sys.exit(1)

    print("\n=== Restart asgard-crm ===")
    code, out, err = run(
        client,
        "systemctl restart asgard-crm; sleep 4; systemctl is-active asgard-crm; "
        "curl -sS http://127.0.0.1:3000/api/version",
        timeout=90,
    )
    print(out)
    if err:
        print("stderr:", err)
    if code != 0:
        print(f"ERROR restart exit {code}")
        sys.exit(1)

    print("\n=== app_updates banner ===")
    sql = (
        "INSERT INTO app_updates (version, title, changes, target) "
        f"SELECT 'v{VER}', 'Табель/корреспонденция/допуски', "
        "'[\"Табель: фикс 500 при отметке дороги\",\"Корреспонденция: стабильные модалки\",\"Допуски: даты DD.MM.YYYY\","
        "\"Академия: алерты менеджерам\",\"Записи звонков: матч entry_id\"]'::jsonb, 'all' "
        f"WHERE NOT EXISTS (SELECT 1 FROM app_updates WHERE version = 'v{VER}');"
    )
    sftp = client.open_sftp()
    with sftp.file("/tmp/asgard_banner_om.sql", "w") as fh:
        fh.write(sql)
    sftp.close()
    code, out, err = run(
        client,
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f /tmp/asgard_banner_om.sql",
        timeout=30,
    )
    print(out or "(banner ok)")
    if err:
        print("stderr:", err)

    ts = int(time.time())
    smoke = f"""#!/bin/bash
set -e
echo '-- shell --'
grep -o "ASGARD_SHELL_VERSION = '[^']*'" {PROJECT}/public/index.html | head -1
grep -o "SHELL_VERSION = '[^']*'" {PROJECT}/public/sw.js | head -1
curl -sS "https://asgard-crm.ru/?_v={ts}" | grep -o "ASGARD_SHELL_VERSION = '[^']*'" | head -1
curl -sS "https://asgard-crm.ru/sw.js?_v={ts}" | grep -o "SHELL_VERSION = '[^']*'" | head -1
echo '-- markers --'
grep -n "__corrPageApi\\|innerHTML = ''" {PROJECT}/public/assets/js/correspondence.js | head -5
grep -n "direction: raw.direction\\|23505\\|work_id IS NOT DISTINCT" {PROJECT}/src/routes/timesheet-v2.js | head -10
grep -n "dedup_key\\|office_struggle" {PROJECT}/src/routes/office-academy.js | head -8
grep -n "DD.MM\\|recording_fetch\\|entryIdAliases" {PROJECT}/src/routes/permits.js {PROJECT}/src/services/recording-fetcher.js | head -15
echo '-- index --'
PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "SELECT indexdef FROM pg_indexes WHERE indexname='idx_trip_stages_unique_day'"
echo '-- API --'
curl -sS http://127.0.0.1:3000/api/version; echo
echo DONE
"""
    sftp = client.open_sftp()
    with sftp.file(f"/tmp/asgard_smoke_{VER}.sh", "w") as fh:
        fh.write(smoke.replace("\r\n", "\n"))
    sftp.chmod(f"/tmp/asgard_smoke_{VER}.sh", 0o755)
    sftp.close()

    print("\n=== Smoke ===")
    code, out, err = run(client, f"bash /tmp/asgard_smoke_{VER}.sh", timeout=120)
    print(out)
    if err:
        print("stderr:", err)
    if code != 0:
        print(f"ERROR smoke exit {code}")
        sys.exit(1)

    print(f"\n=== DONE deploy {VER} ===")
    client.close()


if __name__ == "__main__":
    main()
