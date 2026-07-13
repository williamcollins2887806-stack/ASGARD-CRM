#!/usr/bin/env python3
"""Deploy: hide test users from prod lists + office schedule cleanup."""
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

UPLOAD = [
    "src/lib/user-filters.js",
    "src/routes/users.js",
    "src/routes/data.js",
    "public/index.html",
    "public/assets/js/office_schedule.js",
    "migrations/V282__purge_test_users_from_staff.sql",
]

V2_DIR = "public/v2"


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
    ensure_dir(sftp, remote_dir)
    count = 0
    for item in local_dir.rglob("*"):
        rel = item.relative_to(local_dir).as_posix()
        remote = f"{remote_dir}/{rel}"
        if item.is_dir():
            ensure_dir(sftp, remote)
        else:
            ensure_dir(sftp, os.path.dirname(remote))
            sftp.put(str(item), remote)
            count += 1
    return count


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    for rel in UPLOAD:
        local = ROOT / rel
        if not local.exists():
            print("SKIP", rel)
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print("  uploaded", rel)

    v2_local = ROOT / V2_DIR
    if v2_local.is_dir():
        n = upload_tree(sftp, v2_local, f"{PROJECT}/{V2_DIR}")
        print(f"  uploaded public/v2 ({n} files)")
    else:
        print("WARN: public/v2 missing")

    sftp.close()

    print("\n=== Migration V282 ===")
    mig = f"{PROJECT}/migrations/V282__purge_test_users_from_staff.sql"
    _, o, e = c.exec_command(
        f"PGPASSWORD=123456789 psql -U asgard -h 127.0.0.1 -d asgard_crm -v ON_ERROR_STOP=1 -f {mig}",
        timeout=60,
    )
    out = o.read().decode().strip()
    err = e.read().decode().strip()
    if out:
        print(out)
    if err:
        print(err)
    if err and "ERROR" in err.upper():
        print("migration FAILED")
        c.close()
        sys.exit(1)
    print("migration V282: ok")

    print("\n=== app_updates ===")
    changelog = (
        "Тестовые пользователи (test_*) скрыты из графика офиса и выпадающих списков. "
        "Очистка staff/staff_plan на проде."
    )
    sql = (
        "INSERT INTO app_updates (version, title, changes, target) VALUES ("
        "'20.26.77', 'Скрытие тестовых пользователей', "
        f"'{changelog}', 'all')"
    )
    _, o, e = c.exec_command(
        f"PGPASSWORD=123456789 psql -U asgard -h 127.0.0.1 -d asgard_crm -c \"{sql}\"",
        timeout=30,
    )
    print(o.read().decode().strip() or e.read().decode().strip())

    print("\n=== Restart asgard-crm ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print("service:", o.read().decode().strip() or e.read().decode().strip())

    print("\n=== Verify ===")
    _, o, _ = c.exec_command("curl -s http://localhost:3000/api/version", timeout=30)
    print("api/version:", o.read().decode().strip())

    _, o, _ = c.exec_command(
        "grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/index.html | head -1",
        timeout=30,
    )
    print("prod SHELL_VERSION:", o.read().decode().strip())

    _, o, _ = c.exec_command(
        "PGPASSWORD=123456789 psql -U asgard -h 127.0.0.1 -d asgard_crm -t -c "
        "\"SELECT COUNT(*) FROM staff s JOIN users u ON u.id=s.user_id WHERE u.login ~ '^test_'\"",
        timeout=30,
    )
    print("test users in staff (expect 0):", o.read().decode().strip())

    c.close()
    print("\ndone")


if __name__ == "__main__":
    main()
