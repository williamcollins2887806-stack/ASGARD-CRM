#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy rebuilt Ting APK with premium launcher icons."""
from __future__ import annotations

import hashlib
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko

SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = ["public/asgard-ting-tv.apk"]


def load_pkey(path: str):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def norm(b: bytes) -> str:
    return hashlib.md5(b.replace(b"\r\n", b"\n")).hexdigest()


def main() -> int:
    apk = ROOT / "public/asgard-ting-tv.apk"
    if not apk.exists():
        raise SystemExit("APK missing")
    local_md5 = hashlib.md5(apk.read_bytes()).hexdigest()
    print(f"local md5: {local_md5} size: {apk.stat().st_size}")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 600) -> str:
        print(f"$ {cmd[:170]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print(err.rstrip(), file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd}")
        return out

    run(f"cp {REMOTE}/public/asgard-ting-tv.apk /root/snapshots/ting-apk-pre-{STAMP}.apk 2>/dev/null || true")

    with tempfile.NamedTemporaryFile(suffix=".apk", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        tar.add(apk, arcname="public/asgard-ting-tv.apk")

    sftp = ssh.open_sftp()
    remote = f"/tmp/ting-apk-{STAMP}.tgz"
    sftp.put(str(tar_path), remote)
    tar_path.unlink(missing_ok=True)
    run(f"tar -xzf {remote} -C {REMOTE} && rm -f {remote}")

    with sftp.open(f"{REMOTE}/public/asgard-ting-tv.apk", "rb") as f:
        rb = f.read()
    same = norm(rb) == norm(apk.read_bytes())
    print(("SAME  " if same else "DIFF  ") + "public/asgard-ting-tv.apk")
    sftp.close()

    run(f"md5sum {REMOTE}/public/asgard-ting-tv.apk")
    run("ls -l /var/www/asgard-crm/public/asgard-ting-tv.apk")
    run("curl -sI https://asgard-crm.ru/asgard-ting-tv.apk | head -6")
    ssh.close()
    if not same:
        raise SystemExit("MD5 mismatch")
    print("OK apk deployed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
