#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: shell bump 20.28.189 (sw.js/index.html/h) + refreshed /m bundle (safe-area fixes).
Snapshot first; verify after; rollback инструкция печатается.
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

VER = "20.28.189"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/sw.js",
    "public/index.html",
    "public/h/sw.js",
    "public/h/index.html",
]


def load_pkey(path: str):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    print("shell_guard: OK")
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")
    m_dir = ROOT / "public" / "m"
    if not (m_dir / "index.html").is_file():
        raise SystemExit("missing public/m")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd, check=True, timeout=600):
        print(f"$ {cmd[:200]}")
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

    snap = f"/root/snapshots/asgard-layout-{VER}-{STAMP}.tgz"
    run("mkdir -p /root/snapshots && tar -czf {snap} -C {remote} {files} public/m 2>/dev/null || true".format(
        snap=snap, remote=REMOTE, files=" ".join(FILES)))
    print(f"snapshot: {snap}")

    tar_path = Path(tempfile.gettempdir()) / f"asgard-layout-{VER}-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(str(ROOT / rel), arcname=rel)
        tar.add(str(m_dir), arcname="public/m")
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-layout-{VER}-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run(f"find {REMOTE}/public/m -type f -exec chmod 644 {{}} \\; ; find {REMOTE}/public/m -type d -exec chmod 755 {{}} \\;")
    run(f"chmod 644 {REMOTE}/public/sw.js {REMOTE}/public/index.html {REMOTE}/public/h/sw.js {REMOTE}/public/h/index.html")

    run("systemctl restart asgard-crm")
    run("sleep 3; systemctl is-active asgard-crm")

    print("=== POST CHECKS ===")
    run("grep -o \"SHELL_VERSION = '[0-9.]*'\" {r}/public/sw.js | head -1; "
        "grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {r}/public/index.html | head -1; "
        "grep -o \"SHELL_VERSION = '[0-9.]*'\" {r}/public/h/sw.js | head -1".format(r=REMOTE))
    run("grep -o 'index-[A-Za-z0-9_-]*\\.js' {r}/public/m/index.html | head -1".format(r=REMOTE))
    run(f"grep -c 'wn-bottom' {REMOTE}/public/m/assets/index-*.js")
    run("for u in / /h/ /v2/index.html /m/index.html /api/version; do printf '%-16s ' \"$u\"; "
        "curl -s -o /dev/null -w '%{http_code}' \"http://127.0.0.1:3000$u\"; echo; done")

    print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
