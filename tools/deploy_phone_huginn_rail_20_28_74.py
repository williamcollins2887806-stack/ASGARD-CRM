#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy phone-in-Huginn-rail (shell 20.28.74). Explicit file list only.

Run when SSH :22 to prod is reachable:
  python tools/deploy_phone_huginn_rail_20_28_74.py
"""
from __future__ import annotations

import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import shell_guard  # noqa: E402

import paramiko

VER = "20.28.74"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/css/huginn_dock.css",
    "public/assets/css/phone.css",
    "public/assets/js/huginn_dock.js",
    "public/assets/js/phone_ui.js",
    "public/assets/js/telephony.js",
]


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    for marker in (
        "huginn_dock.js",
        "phone_ui.js",
        "phone.css",
        f"ASGARD_SHELL_VERSION = '{VER}'",
        "billing.js",
        "nd-permits.js",
    ):
        if marker not in idx:
            raise SystemExit(f"index.html missing marker: {marker}")

    key = paramiko.RSAKey.from_private_key_file(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=30)

    def run(cmd: str, check: bool = True) -> str:
        print(f"$ {cmd}")
        _i, o, e = ssh.exec_command(cmd, timeout=240)
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

    snap = f"/root/snapshots/asgard-crm-pre-deploy-phone-rail-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js "
        "public/assets/css/huginn_dock.css public/assets/css/phone.css "
        "public/assets/js/huginn_dock.js public/assets/js/phone_ui.js "
        "public/assets/js/telephony.js".format(snap=snap, remote=REMOTE)
    )
    print(f"snapshot: {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-phone-rail-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    # static front only — restart not required, but refresh SW clients via version bump
    run("systemctl restart asgard-crm")
    run(
        "for i in 1 2 3 4 5 6; do "
        "code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo try_$i:$code; [ \"$code\" = 200 ] && break; sleep 2; done"
    )
    run(
        f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {REMOTE}/public/index.html | head -1; "
        f"grep -o \"SHELL_VERSION = '[^']*'\" {REMOTE}/public/sw.js | head -1; "
        f"grep -c 'data-tab=\"phone\"' {REMOTE}/public/assets/js/huginn_dock.js; "
        f"grep -c 'renderPanel' {REMOTE}/public/assets/js/phone_ui.js"
    )
    ssh.close()
    print("=== DONE phone huginn-rail 20.28.74 ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
