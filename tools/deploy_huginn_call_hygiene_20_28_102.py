#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Huginn call hygiene (backend only): webhook + stale-active expiry.

Ships ONLY src/routes/huginn_ext.js — no shell bump, no index/sw touch, so it
stays file-disjoint from any concurrent front-end batch.
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

VER = "20.28.103"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = ["src/routes/huginn_ext.js"]
NEEDLES = ["calls/webhook", "sweepStaleCalls", "finalizeCall", "INTERVAL '4 hours'"]


def load_pkey(path: str):
    for loader in (
        getattr(paramiko, "Ed25519Key", None),
        getattr(paramiko, "ECDSAKey", None),
        paramiko.RSAKey,
    ):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard (shell only) ===")
    # deploy_gate off by design: git/.last-verified stale (owner decision); snapshot = rollback.
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    print("shell_guard: OK")

    ext = (ROOT / "src/routes/huginn_ext.js").read_text(encoding="utf-8")
    for n in NEEDLES:
        if n not in ext:
            raise SystemExit(f"huginn_ext.js missing: {n}")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 300) -> str:
        print(f"$ {cmd[:240]}")
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

    snap = f"/root/snapshots/asgard-crm-pre-huginn-callhyg-{STAMP}.tgz"
    run(
        f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} src/routes/huginn_ext.js 2>/dev/null || true"
    )
    print(f"snapshot: {snap}")

    stage = Path(tempfile.mkdtemp(prefix="huginn-callhyg-"))
    for rel in FILES:
        dest = stage / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes((ROOT / rel).read_bytes())
        print(f"  staged {rel}")

    tar_path = Path(tempfile.gettempdir()) / f"huginn-callhyg-{VER}-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(stage / rel, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/huginn-callhyg-{VER}-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")
    run(f"grep -c 'calls/webhook' {REMOTE}/src/routes/huginn_ext.js")
    run(f"grep -c 'sweepStaleCalls' {REMOTE}/src/routes/huginn_ext.js")
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc \""
        "select count(*) from huginn_calls where status='active'\""
    )
    run(
        "curl -s -o /dev/null -w 'webhook:%{http_code}\\n' -X POST "
        "http://127.0.0.1:3000/api/chat-groups/calls/webhook"
    )

    ssh.close()
    print("=== DEPLOY OK ===", VER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
