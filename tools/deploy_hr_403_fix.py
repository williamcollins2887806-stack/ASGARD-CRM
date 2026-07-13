#!/usr/bin/env python3
"""Deploy HR employee card 403 fix (staff API assignments)."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

UPLOAD = [
    "src/routes/staff.js",
    "public/assets/js/employee.js",
    "public/assets/js/worker_profile_desktop.js",
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
    ensure_dir(sftp, remote_dir)
    count = 0
    for item in local_dir.rglob("*"):
        rel = item.relative_to(local_dir).as_posix()
        remote = f"{remote_dir}/{rel}"
        if item.is_dir():
            ensure_dir(sftp, remote)
            continue
        ensure_dir(sftp, str(Path(remote).parent).replace("\\", "/"))
        sftp.put(str(item), remote)
        count += 1
    return count


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username="root", pkey=key)
    sftp = ssh.open_sftp()

    for rel in UPLOAD:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel.replace(chr(92), '/')}"
        ensure_dir(sftp, str(Path(remote).parent).replace("\\", "/"))
        sftp.put(str(local), remote)
        print(f"  uploaded {rel}")

    v2_local = ROOT / "public" / "v2"
    if v2_local.is_dir():
        n = upload_tree(sftp, v2_local, f"{PROJECT}/public/v2")
        print(f"  uploaded public/v2 ({n} files)")

    sftp.close()
    _, stdout, stderr = ssh.exec_command(f"systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    print("service:", out or err or "ok")
    ssh.close()
    print("done")


if __name__ == "__main__":
    main()
