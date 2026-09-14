#!/usr/bin/env python3
"""Deploy HEAD_TO cash/timesheet/site-crew matrix (backend + shell + v2)."""
import io
import os
import sys
import tarfile
import tempfile
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

FILES = [
    "src/routes/cash.js",
    "src/routes/timesheet-v2.js",
    "src/routes/field-manage.js",
    "src/routes/site-crew.js",
    "src/routes/staff.js",
    "src/routes/global-timesheet.js",
    "src/index.js",
    "migrations/V296__trip_direction_site_crew_removal.sql",
    "public/sw.js",
    "public/index.html",
    "public/assets/js/timesheet-v2.js",
    "public/assets/js/site_crew.js",
    "public/assets/js/app.js",
]

V2_DIR = ROOT / "public" / "v2"


def ensure_dir(sftp, remote_dir):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def upload_file(sftp, local: Path, remote: str):
    ensure_dir(sftp, str(Path(remote).parent).replace("\\", "/"))
    sftp.put(str(local), remote)
    print(f"  OK {remote}")


def main():
    if not KEY.exists():
        print(f"ERROR: missing key {KEY}")
        sys.exit(1)
    if not (V2_DIR / "index.html").exists():
        print("ERROR: public/v2 missing — build v2 first")
        sys.exit(1)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=str(KEY), timeout=30)
    sftp = client.open_sftp()

    print("== snapshot ==")
    snap = (
        f"mkdir -p /root/snapshots && tar czf "
        f"/root/snapshots/asgard-crm-pre-deploy-headto-$(date +%Y%m%d-%H%M%S).tgz "
        f"-C {PROJECT} src/routes/cash.js src/routes/timesheet-v2.js src/routes/field-manage.js "
        f"src/index.js public/sw.js public/index.html public/assets/js/timesheet-v2.js "
        f"public/assets/js/app.js public/v2/index.html 2>/dev/null || true"
    )
    _, stdout, _ = client.exec_command(snap, timeout=180)
    stdout.channel.recv_exit_status()

    print("== backend + shell ==")
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            print(f"  SKIP missing {rel}")
            continue
        upload_file(sftp, local, f"{PROJECT}/{rel}")

    print("== v2 via tar ==")
    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = tmp.name
    try:
        with tarfile.open(tar_path, "w:gz") as tar:
            for item in V2_DIR.rglob("*"):
                if item.is_file():
                    tar.add(str(item), arcname=item.relative_to(V2_DIR).as_posix())
        remote_tar = f"/tmp/asgard-v2-{os.getpid()}.tgz"
        sftp.put(tar_path, remote_tar)
        cmd = (
            f"mkdir -p {PROJECT}/public/v2 && tar xzf {remote_tar} -C {PROJECT}/public/v2 "
            f"&& rm -f {remote_tar} && ls {PROJECT}/public/v2/assets/*.js | head -5"
        )
        _, stdout, stderr = client.exec_command(cmd, timeout=180)
        code = stdout.channel.recv_exit_status()
        print(stdout.read().decode("utf-8", errors="replace"))
        err = stderr.read().decode("utf-8", errors="replace")
        if err.strip():
            print(err)
        if code != 0:
            print(f"ERROR: v2 extract exit {code}")
            sys.exit(1)
    finally:
        try:
            os.unlink(tar_path)
        except OSError:
            pass

    print("== migration V296 ==")
    mig = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f {PROJECT}/migrations/V296__trip_direction_site_crew_removal.sql"
    _, stdout, stderr = client.exec_command(mig, timeout=60)
    print(stdout.read().decode("utf-8", errors="replace").strip())
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if err:
        print(err)

    print("== soft-deactivate garbage workers ==")
    cleanup_sql = r"""
-- report candidates first
SELECT id, COALESCE(fio, full_name) AS fio, is_active
FROM employees
WHERE COALESCE(is_active,true)=true
  AND (
    TRIM(COALESCE(fio, full_name, '')) = ''
    OR LOWER(COALESCE(fio, full_name, '')) LIKE '%тест%'
    OR LOWER(COALESCE(fio, full_name, '')) LIKE '%test%'
    OR LOWER(COALESCE(fio, full_name, '')) LIKE '%hr создал%'
  )
ORDER BY id;

UPDATE employees SET is_active=false, updated_at=NOW()
WHERE COALESCE(is_active,true)=true
  AND (
    TRIM(COALESCE(fio, full_name, '')) = ''
    OR LOWER(COALESCE(fio, full_name, '')) LIKE '%тест%'
    OR LOWER(COALESCE(fio, full_name, '')) LIKE '%test%'
    OR LOWER(COALESCE(fio, full_name, '')) LIKE '%hr создал%'
  );

-- seed-like high ids still active (report only, do not auto-kill)
SELECT id, COALESCE(fio, full_name) AS fio
FROM employees
WHERE COALESCE(is_active,true)=true AND id >= 9000
ORDER BY id
LIMIT 50;
"""
    # write temp sql on server
    remote_sql = "/tmp/cleanup_garbage_workers.sql"
    with sftp.file(remote_sql, "w") as f:
        f.write(cleanup_sql)
    _, stdout, stderr = client.exec_command(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f {remote_sql}",
        timeout=60,
    )
    print(stdout.read().decode("utf-8", errors="replace").strip())
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if err:
        print(err)

    print("== restart ==")
    _, stdout, stderr = client.exec_command(
        "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print(stdout.read().decode("utf-8", errors="replace").strip())
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if err:
        print(err)

    print("== smoke ==")
    smokes = [
        "curl -s http://127.0.0.1:3000/api/version",
        "grep -n \"SHELL_VERSION\\|ASGARD_SHELL_VERSION\" /var/www/asgard-crm/public/sw.js /var/www/asgard-crm/public/index.html | head -5",
        "test -f /var/www/asgard-crm/src/routes/site-crew.js && echo site-crew:OK",
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc \"SELECT column_name FROM information_schema.columns WHERE table_name='field_trip_stages' AND column_name='direction'\"",
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc \"SELECT to_regclass('public.site_crew_removal_requests')\"",
        "grep -n \"HEAD_TO\" /var/www/asgard-crm/src/routes/cash.js | head -3",
        "grep -n \"works-options\" /var/www/asgard-crm/src/routes/timesheet-v2.js | head -2",
        "grep -n \"site-crew\" /var/www/asgard-crm/src/index.js | head -2",
        "grep -n \"AsgardSiteCrewPage\" /var/www/asgard-crm/public/assets/js/app.js | head -2",
        "ls /var/www/asgard-crm/public/v2/assets/*.js | wc -l",
    ]
    for cmd in smokes:
        _, stdout, stderr = client.exec_command(cmd, timeout=30)
        out = stdout.read().decode("utf-8", errors="replace").strip()
        err = stderr.read().decode("utf-8", errors="replace").strip()
        print(f"$ {cmd}")
        if out:
            print(out)
        if err:
            print(err)

    sftp.close()
    client.close()
    print("DONE")


if __name__ == "__main__":
    main()
