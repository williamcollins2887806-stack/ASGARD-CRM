#!/usr/bin/env python3
"""Deploy: role tags UI + permit types dedup migration V291."""
import io
import os
import subprocess
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

UPLOAD = [
    "migrations/V291__dedupe_permit_types.sql",
    "public/assets/js/employee.js",
    "public/assets/js/personnel.js",
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


def upload_tree(sftp, local_dir: Path, remote_dir: str):
    count = 0
    for item in local_dir.rglob("*"):
        if not item.is_file():
            continue
        rel = item.relative_to(local_dir).as_posix()
        remote = f"{remote_dir}/{rel}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(item), remote)
        count += 1
    return count


def main():
    if os.environ.get("SKIP_V2_BUILD") != "1":
        npm = "npm.cmd" if os.name == "nt" else "npm"
        subprocess.run(
            [npm, "run", "build"],
            cwd=str(ROOT / "public" / "desktop-v2-src"),
            check=True,
            shell=(os.name == "nt"),
        )

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    for rel in UPLOAD:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print("uploaded", rel)

    v2 = ROOT / "public" / "v2"
    if v2.is_dir():
        n = upload_tree(sftp, v2, f"{PROJECT}/public/v2")
        print(f"uploaded public/v2 ({n} files)")

    sftp.close()

    mig = f"{PROJECT}/migrations/V291__dedupe_permit_types.sql"
    print("\n=== Migration V291 ===")
    _, o, e = c.exec_command(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {mig}",
        timeout=120,
    )
    out = (o.read() + e.read()).decode("utf-8", "replace")
    print(out or "(ok)")

    print("\n=== Verify EB duplicates ===")
    _, o, _ = c.exec_command(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -c "
        "\"SELECT count(*) FROM permit_types WHERE is_active AND code IN ('EB_2','EB_3','EB_4','EB_5')\"",
        timeout=60,
    )
    print("active legacy EB_*:", o.read().decode().strip())

    _, o, _ = c.exec_command(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -c "
        "\"SELECT code, count(*) FROM employee_permits ep JOIN permit_types pt ON pt.id=ep.type_id "
        "WHERE ep.is_active AND pt.code LIKE 'EB_%' GROUP BY code ORDER BY code\"",
        timeout=60,
    )
    print("active EB permits:\n", o.read().decode())

    print("\n=== Restart ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm",
        timeout=90,
    )
    print((o.read() + e.read()).decode().strip())
    c.close()


if __name__ == "__main__":
    main()
