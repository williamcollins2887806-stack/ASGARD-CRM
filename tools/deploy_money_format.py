#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy unified money format: shell + assets/js + v2 + /m."""
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

SHELL = [
    "public/sw.js",
    "public/index.html",
]

V2_DIR = ROOT / "public" / "v2"
M_DIR = ROOT / "public" / "m"
JS_DIR = ROOT / "public" / "assets" / "js"


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


def make_tar(src_dir: Path, arc_root: str | None = None) -> str:
    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = tmp.name
    with tarfile.open(tar_path, "w:gz") as tar:
        for item in src_dir.rglob("*"):
            if item.is_file():
                # skip huge/irrelevant
                if "node_modules" in item.parts:
                    continue
                if item.suffix.lower() in {".map"}:
                    continue
                if arc_root is None:
                    arcname = item.relative_to(src_dir).as_posix()
                else:
                    arcname = (Path(arc_root) / item.relative_to(src_dir)).as_posix()
                tar.add(str(item), arcname=arcname)
    return tar_path


def upload_tar(client, sftp, tar_path: str, remote_tar: str, extract_to: str, wipe_assets: bool = False):
    sftp.put(tar_path, remote_tar)
    wipe = f"rm -rf {extract_to}/assets && mkdir -p {extract_to}/assets && " if wipe_assets else f"mkdir -p {extract_to} && "
    cmd = f"{wipe}tar xzf {remote_tar} -C {extract_to} && rm -f {remote_tar}"
    _, stdout, stderr = client.exec_command(cmd, timeout=180)
    code = stdout.channel.recv_exit_status()
    err = stderr.read().decode("utf-8", errors="replace")
    if code != 0:
        print("TAR EXTRACT FAIL", code, err)
        sys.exit(1)
    print(f"  extracted → {extract_to}")


def main():
    if not KEY.exists():
        print(f"ERROR: missing key {KEY}")
        sys.exit(1)
    if not (V2_DIR / "index.html").exists():
        print("ERROR: public/v2 missing")
        sys.exit(1)
    if not (M_DIR / "index.html").exists():
        print("ERROR: public/m missing")
        sys.exit(1)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=str(KEY), timeout=30)
    sftp = client.open_sftp()

    print("== snapshot ==")
    _, stdout, _ = client.exec_command(
        f"mkdir -p /root/snapshots && tar czf "
        f"/root/snapshots/asgard-crm-pre-money-fmt-$(date +%Y%m%d-%H%M%S).tgz "
        f"-C {PROJECT} public/sw.js public/index.html public/assets/js "
        f"public/v2 public/m 2>/dev/null || true",
        timeout=300,
    )
    stdout.channel.recv_exit_status()

    print("== shell ==")
    for rel in SHELL:
        upload_file(sftp, ROOT / rel, f"{PROJECT}/{rel}")

    print("== assets/js tar ==")
    js_tar = make_tar(JS_DIR)
    try:
        remote = f"/tmp/asgard-js-{os.getpid()}.tgz"
        upload_tar(client, sftp, js_tar, remote, f"{PROJECT}/public/assets/js", wipe_assets=False)
    finally:
        os.unlink(js_tar)

    print("== v2 tar ==")
    v2_tar = make_tar(V2_DIR)
    try:
        remote = f"/tmp/asgard-v2-{os.getpid()}.tgz"
        # wipe v2 assets then extract
        _, stdout, _ = client.exec_command(f"rm -rf {PROJECT}/public/v2/assets && mkdir -p {PROJECT}/public/v2", timeout=60)
        stdout.channel.recv_exit_status()
        upload_tar(client, sftp, v2_tar, remote, f"{PROJECT}/public/v2", wipe_assets=False)
    finally:
        os.unlink(v2_tar)

    print("== /m tar ==")
    m_tar = make_tar(M_DIR)
    try:
        remote = f"/tmp/asgard-m-{os.getpid()}.tgz"
        _, stdout, _ = client.exec_command(f"rm -rf {PROJECT}/public/m/assets && mkdir -p {PROJECT}/public/m", timeout=60)
        stdout.channel.recv_exit_status()
        upload_tar(client, sftp, m_tar, remote, f"{PROJECT}/public/m", wipe_assets=False)
    finally:
        os.unlink(m_tar)

    print("== smoke ==")
    checks = [
        f"grep -n \"ASGARD_SHELL_VERSION = '20.27.20'\" {PROJECT}/public/index.html | head -1",
        f"grep -n \"SHELL_VERSION = '20.27.20'\" {PROJECT}/public/sw.js | head -1",
        f"test -f {PROJECT}/public/assets/js/money_fmt.js && echo money_fmt_ok",
        f"grep -n moneyRub {PROJECT}/public/assets/js/ui.js | head -2",
        f"test -f {PROJECT}/public/v2/index.html && echo v2_ok",
        f"grep -o 'index-[A-Za-z0-9_-]*\\.js' {PROJECT}/public/m/index.html | head -1",
        f"node -e \"const m=require('{PROJECT}/public/assets/js/money_fmt.js');\" 2>/dev/null || "
        f"grep -n formatMoneyShort {PROJECT}/public/assets/js/money_fmt.js | head -1",
    ]
    for c in checks:
        _, stdout, stderr = client.exec_command(c, timeout=30)
        out = stdout.read().decode("utf-8", errors="replace").strip()
        err = stderr.read().decode("utf-8", errors="replace").strip()
        print(" ", out or err or "(empty)")

    # No backend restart needed
    sftp.close()
    client.close()
    print("DONE money-format deploy (no backend restart)")


if __name__ == "__main__":
    main()
