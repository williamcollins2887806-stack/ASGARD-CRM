#!/usr/bin/env python3
"""Deploy correspondence OM fixes to prod + restart."""
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
    "src/routes/correspondence.js",
    "src/services/correspondence.js",
    "public/assets/js/correspondence.js",
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
            print("SKIP missing", rel)
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
        print("FATAL: public/v2 missing")
        sys.exit(1)

    sftp.close()

    print("\n=== node --check ===")
    _, o, e = c.exec_command(
        f"cd {PROJECT} && node --check src/routes/correspondence.js && node --check src/services/correspondence.js",
        timeout=60,
    )
    print(o.read().decode().strip() or "ok")
    err = e.read().decode().strip()
    if err:
        print("check err:", err)
        c.close()
        sys.exit(1)

    print("\n=== Restart asgard-crm ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print("service:", o.read().decode().strip() or e.read().decode().strip())

    print("\n=== Smoke endpoints ===")
    for path in [
        "/api/correspondence/outgoing-number-status",
        "/api/correspondence/next-outgoing-number",
    ]:
        _, o, _ = c.exec_command(
            f"""TOKEN=$(curl -s http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{{"login":"test_office_manager","password":"Test123!"}}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
curl -s -o /dev/null -w '%{{http_code}}' http://localhost:3000{path} -H "Authorization: Bearer $TOKEN" """,
            timeout=30,
        )
        print(f"  {path}: HTTP {o.read().decode().strip()}")

    c.close()
    print("deploy done")


if __name__ == "__main__":
    main()
