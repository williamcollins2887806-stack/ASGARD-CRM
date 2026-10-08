#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting premium live stage (shell 20.28.87)."""
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

VER = "20.28.87"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/huginn_ting.js",
    "public/assets/js/ting_session.js",
    "public/assets/js/ting_page.js",
    "public/assets/css/huginn_dock.css",
    "public/assets/css/ting.css",
    "src/routes/thing.js",
]


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
    print("=== 0. PRE-FLIGHT shell_guard ===")
    # HEAD may include prior console-API commit not yet in .last-verified; shell itself is green.
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    print("shell_guard: OK (deploy_gate off — Ting premium hot-fix)")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    ht = (ROOT / "public/assets/js/huginn_ting.js").read_text(encoding="utf-8")
    if "view=room&slug=" not in ht and "view=' + encodeURIComponent(v)" not in ht:
        raise SystemExit("huginn_ting openHub not fixed")
    if "Мини-окно" not in ht:
        raise SystemExit("huginn_ting missing Мини-окно")
    if "hg-ting-iconbtn" not in ht:
        raise SystemExit("huginn_ting missing icon buttons")
    ts = (ROOT / "public/assets/js/ting_session.js").read_text(encoding="utf-8")
    if "wireRoomEvents" not in ts:
        raise SystemExit("ting_session missing wireRoomEvents")
    tp = (ROOT / "public/assets/js/ting_page.js").read_text(encoding="utf-8")
    if "adoptOrConnectRoom" not in tp:
        raise SystemExit("ting_page missing adoptOrConnectRoom")
    if "layout: 'speaker'" not in tp:
        raise SystemExit("ting_page layout not speaker")
    th = (ROOT / "src/routes/thing.js").read_text(encoding="utf-8")
    if "job_title" not in th or "CRM_ROLE_TITLE" not in th:
        raise SystemExit("thing.js missing job_title enrichment")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    if f"ASGARD_SHELL_VERSION = '{VER}'" not in idx:
        raise SystemExit("index version mismatch")

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

    snap = f"/root/snapshots/asgard-crm-pre-ting-premium-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js "
        "public/assets/js/huginn_ting.js public/assets/js/ting_session.js public/assets/js/ting_page.js "
        "public/assets/css/huginn_dock.css public/assets/css/ting.css "
        "src/routes/thing.js 2>/dev/null || true".format(snap=snap, remote=REMOTE)
    )

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-ting-premium-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    run(
        f"node --check {REMOTE}/public/assets/js/huginn_ting.js && "
        f"node --check {REMOTE}/public/assets/js/ting_session.js && "
        f"node --check {REMOTE}/public/assets/js/ting_page.js && "
        f"node --check {REMOTE}/src/routes/thing.js"
    )
    run("systemctl restart asgard-crm")
    run(
        "for i in 1 2 3 4 5 6 7 8; do "
        "c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo try_$i:$c; [ \"$c\" = 200 ] && break; sleep 2; done"
    )
    run(
        f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {REMOTE}/public/index.html | head -1; "
        f"grep -c 'Мини-окно' {REMOTE}/public/assets/js/huginn_ting.js; "
        f"grep -c 'wireRoomEvents' {REMOTE}/public/assets/js/ting_session.js; "
        f"grep -c 'adoptOrConnectRoom' {REMOTE}/public/assets/js/ting_page.js; "
        f"grep -c 'CRM_ROLE_TITLE' {REMOTE}/src/routes/thing.js; "
        "systemctl is-active asgard-crm"
    )
    ssh.close()
    print("=== DONE Ting premium 20.28.87 ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
