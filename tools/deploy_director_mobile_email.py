#!/usr/bin/env python3
"""Deploy director email+archive + mobile tender approvals (backend + /m + shell)."""
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
    "src/services/rp-review-notify.js",
    "src/services/notify.js",
    "src/routes/pm-duty.js",
    "public/sw.js",
    "public/index.html",
]

M_DIR = ROOT / "public" / "m"


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
    if not (M_DIR / "index.html").exists():
        print("ERROR: public/m/index.html missing — build mobile first")
        sys.exit(1)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=str(KEY), timeout=30)
    sftp = client.open_sftp()

    print("== snapshot ==")
    cmd = f"mkdir -p /root/snapshots && tar czf /root/snapshots/asgard-crm-pre-deploy-dir-mobile-$(date +%Y%m%d-%H%M%S).tgz -C {PROJECT} src/services/rp-review-notify.js src/services/notify.js src/routes/pm-duty.js public/sw.js public/index.html public/m/index.html 2>/dev/null || true"
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    stdout.channel.recv_exit_status()

    print("== backend + shell ==")
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            print(f"  SKIP missing {rel}")
            continue
        upload_file(sftp, local, f"{PROJECT}/{rel}")

    print("== mobile /m via tar ==")
    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = tmp.name
    try:
        with tarfile.open(tar_path, "w:gz") as tar:
            for item in M_DIR.rglob("*"):
                if item.is_file():
                    # skip huge/old unused if needed — upload all current m
                    arc = item.relative_to(M_DIR).as_posix()
                    # Prefer fresh index + new hashed assets; still send tree
                    tar.add(str(item), arcname=arc)
        remote_tar = f"/tmp/asgard-m-{os.getpid()}.tgz"
        sftp.put(tar_path, remote_tar)
        cmd = f"mkdir -p {PROJECT}/public/m && tar xzf {remote_tar} -C {PROJECT}/public/m && rm -f {remote_tar} && head -c 500 {PROJECT}/public/m/index.html"
        _, stdout, stderr = client.exec_command(cmd, timeout=180)
        code = stdout.channel.recv_exit_status()
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        print(out)
        if err.strip():
            print(err)
        if code != 0:
            print(f"ERROR: tar extract exit {code}")
            sys.exit(1)
    finally:
        try:
            os.unlink(tar_path)
        except OSError:
            pass

    print("== restart ==")
    _, stdout, stderr = client.exec_command("systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm", timeout=60)
    print(stdout.read().decode("utf-8", errors="replace").strip())
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if err:
        print(err)

    print("== smoke version ==")
    _, stdout, _ = client.exec_command("curl -s http://127.0.0.1:3000/api/version", timeout=30)
    print(stdout.read().decode("utf-8", errors="replace").strip())

    sftp.close()
    client.close()
    print("DONE")


if __name__ == "__main__":
    main()
