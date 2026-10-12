#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: refreshed /m bundle only (FieldHome pb-24 fix + dead CSS removal). Shell already 20.28.189."""
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

VER = "20.28.189"
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("92.242.61.184", username="root", pkey=key, timeout=45)


def run(cmd, check=True, timeout=600):
    print(f"$ {cmd[:190]}")
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


print("=== PRE-FLIGHT ===")
shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
print("shell_guard: OK")

snap = f"/root/snapshots/asgard-m-layout2-{STAMP}.tgz"
run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} public/m")
print(f"snapshot: {snap}")

tar_path = Path(tempfile.gettempdir()) / f"asgard-m-layout2-{STAMP}.tar.gz"
with tarfile.open(tar_path, "w:gz") as tar:
    tar.add(str(ROOT / "public" / "m"), arcname="public/m")

sftp = ssh.open_sftp()
remote_tar = f"/tmp/asgard-m-layout2-{STAMP}.tar.gz"
sftp.put(str(tar_path), remote_tar)
sftp.close()

run(f"tar -xzf {remote_tar} -C {REMOTE}")
run(f"rm -f {remote_tar}")
run(f"find {REMOTE}/public/m -type f -exec chmod 644 {{}} \\; ; find {REMOTE}/public/m -type d -exec chmod 755 {{}} \\;")
run("systemctl restart asgard-crm")
run("sleep 3; systemctl is-active asgard-crm")

print("=== POST ===")
run(f"grep -o 'index-[A-Za-z0-9_-]*\\.js' {REMOTE}/public/m/index.html | head -1")
run(f"grep -c 'wn-bottom' {REMOTE}/public/m/assets/index-MWgK43Lo.js")
run("curl -s -o /dev/null -w 'm:%{http_code}\\n' http://127.0.0.1:3000/m/index.html")
print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
ssh.close()
