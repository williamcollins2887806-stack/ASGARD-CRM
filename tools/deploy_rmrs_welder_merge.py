#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy RMRS permit + role_tag normalize + personnel/permits UI."""
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
    "public/sw.js",
    "public/index.html",
    "public/assets/js/personnel.js",
    "src/routes/permits_import.js",
    "migrations/V297__rmrs_permit_and_role_tag_normalize.sql",
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

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=str(KEY), timeout=30)
    sftp = client.open_sftp()

    print("== snapshot ==")
    _, stdout, _ = client.exec_command(
        f"mkdir -p /root/snapshots && tar czf "
        f"/root/snapshots/asgard-crm-pre-rmrs-$(date +%Y%m%d-%H%M%S).tgz "
        f"-C {PROJECT} public/sw.js public/index.html public/assets/js/personnel.js "
        f"src/routes/permits_import.js public/v2/index.html 2>/dev/null || true",
        timeout=180,
    )
    stdout.channel.recv_exit_status()

    print("== files ==")
    for rel in FILES:
        upload_file(sftp, ROOT / rel, f"{PROJECT}/{rel}")

    print("== migration V297 ==")
    _, stdout, stderr = client.exec_command(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V297__rmrs_permit_and_role_tag_normalize.sql",
        timeout=60,
    )
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    print(out or err)
    if stdout.channel.recv_exit_status() != 0:
        print("MIGRATION FAILED", err)
        sys.exit(1)

    print("== v2 tar ==")
    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = tmp.name
    try:
        with tarfile.open(tar_path, "w:gz") as tar:
            for item in V2_DIR.rglob("*"):
                if item.is_file() and item.suffix.lower() != ".map":
                    tar.add(str(item), arcname=item.relative_to(V2_DIR).as_posix())
        remote_tar = f"/tmp/asgard-v2-rmrs-{os.getpid()}.tgz"
        sftp.put(tar_path, remote_tar)
        _, stdout, stderr = client.exec_command(
            f"rm -rf {PROJECT}/public/v2/assets && mkdir -p {PROJECT}/public/v2 && "
            f"tar xzf {remote_tar} -C {PROJECT}/public/v2 && rm -f {remote_tar}",
            timeout=180,
        )
        code = stdout.channel.recv_exit_status()
        if code != 0:
            print("v2 extract fail", stderr.read().decode("utf-8", errors="replace"))
            sys.exit(1)
        print("  v2 ok")
    finally:
        os.unlink(tar_path)

    print("== restart backend (permits_import) ==")
    _, stdout, _ = client.exec_command("systemctl restart asgard-crm", timeout=60)
    stdout.channel.recv_exit_status()

    print("== smoke ==")
    cmds = [
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc \"SELECT code,name,category,sort_order FROM permit_types WHERE code IN ('NAKS','RMRS') ORDER BY sort_order;\"",
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc \"SELECT role_tag, count(*) FROM employees WHERE lower(trim(role_tag))='сварщик' GROUP BY 1 ORDER BY 1;\"",
        f"grep -n \"20.27.21\" {PROJECT}/public/sw.js | head -1",
        f"grep -n RMRS {PROJECT}/src/routes/permits_import.js | head -1",
    ]
    for c in cmds:
        _, stdout, stderr = client.exec_command(c, timeout=30)
        print(" ", stdout.read().decode("utf-8", errors="replace").strip() or stderr.read().decode("utf-8", errors="replace").strip())

    sftp.close()
    client.close()
    print("DONE")


if __name__ == "__main__":
    main()
