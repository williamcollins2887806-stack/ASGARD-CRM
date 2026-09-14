#!/usr/bin/env python3
"""Deploy site-crew accordion UX (shell + v2)."""
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
    "public/assets/js/site_crew.js",
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
        print("ERROR: public/v2 missing")
        sys.exit(1)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=str(KEY), timeout=30)
    sftp = client.open_sftp()

    print("== snapshot ==")
    _, stdout, _ = client.exec_command(
        f"mkdir -p /root/snapshots && tar czf "
        f"/root/snapshots/asgard-crm-pre-sitecrew-ux-$(date +%Y%m%d-%H%M%S).tgz "
        f"-C {PROJECT} public/sw.js public/index.html public/assets/js/site_crew.js "
        f"public/v2/index.html 2>/dev/null || true",
        timeout=120,
    )
    stdout.channel.recv_exit_status()

    print("== shell ==")
    for rel in FILES:
        upload_file(sftp, ROOT / rel, f"{PROJECT}/{rel}")

    print("== v2 tar ==")
    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = tmp.name
    try:
        with tarfile.open(tar_path, "w:gz") as tar:
            for item in V2_DIR.rglob("*"):
                if item.is_file():
                    tar.add(str(item), arcname=item.relative_to(V2_DIR).as_posix())
        remote_tar = f"/tmp/asgard-v2-{os.getpid()}.tgz"
        sftp.put(tar_path, remote_tar)
        _, stdout, stderr = client.exec_command(
            f"mkdir -p {PROJECT}/public/v2 && tar xzf {remote_tar} -C {PROJECT}/public/v2 "
            f"&& rm -f {remote_tar} && grep -n \"20.27.19\" {PROJECT}/public/sw.js | head -1",
            timeout=180,
        )
        print(stdout.read().decode("utf-8", "replace"))
        err = stderr.read().decode("utf-8", "replace").strip()
        if err:
            print(err)
    finally:
        try:
            os.unlink(tar_path)
        except OSError:
            pass

    # No backend restart needed — static only. Still bump version endpoint via shell read.
    print("== smoke ==")
    cmds = [
        f"grep -n site_crew.js {PROJECT}/public/index.html",
        f"head -c 200 {PROJECT}/public/assets/js/site_crew.js",
        f"grep -n sc-block-head {PROJECT}/public/assets/js/site_crew.js | head -3",
        "curl -s http://127.0.0.1:3000/api/version",
        "systemctl is-active asgard-crm",
    ]
    for cmd in cmds:
        print("====", cmd)
        _, out, err = client.exec_command(cmd, timeout=30)
        print(out.read().decode("utf-8", "replace").strip())
        e = err.read().decode("utf-8", "replace").strip()
        if e:
            print(e)

    sftp.close()
    client.close()
    print("DONE")


if __name__ == "__main__":
    main()
