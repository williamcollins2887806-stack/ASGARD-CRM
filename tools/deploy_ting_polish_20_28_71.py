#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting polish (shell 20.28.71) — explicit file list only.

Does NOT touch telephony/messenger sources. Preserves prod huginn_* assets.
Applies V363 thing_chat_messages. Restarts asgard-crm.
"""
from __future__ import annotations

import os
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

VER = "20.28.71"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

# Ting-only + shell. Never phone/telephony/huginn sources / src/index.js / chat_groups.
FILES = [
    "public/index.html",  # merged: huginn tags kept + ting_icons/common + v=20.28.71
    "public/sw.js",
    "public/assets/css/ting.css",
    "public/assets/js/ting_page.js",
    "public/assets/js/ting_icons.js",
    "public/assets/js/ting_common.js",
    "public/ting/index.html",
    "src/routes/thing.js",
    "src/services/thing-livekit.js",
    "src/services/thing-pipeline.js",
    "migrations/V363__thing_chat.sql",
]


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    for rel in FILES:
        p = ROOT / rel
        if not p.is_file():
            raise SystemExit(f"missing: {rel}")

    # Local index must keep huginn tags (prod messenger already wired)
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    for marker in (
        "huginn_boot.js",
        "huginn_dock.js",
        "ting_icons.js",
        "ting_common.js",
        "ting_page.js",
        "ting.css",
        "ASGARD_SHELL_VERSION = '20.28.71'",
    ):
        if marker not in idx:
            raise SystemExit(f"index.html missing required merge marker: {marker}")
    print("index merge markers: OK (huginn kept + ting)")

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

    snap = f"/root/snapshots/asgard-crm-pre-deploy-ting-polish-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js "
        "public/assets/css/ting.css "
        "public/assets/js/ting_page.js "
        "public/ting "
        "src/routes/thing.js "
        "src/services/thing-livekit.js "
        "src/services/thing-pipeline.js "
        "2>/dev/null || tar -czf {snap} -C {remote} public/index.html public/sw.js".format(
            snap=snap, remote=REMOTE
        )
    )
    print(f"snapshot: {snap}")

    # Pre-counts: huginn files must survive
    before = run(
        "ls -la {r}/public/assets/js/huginn_*.js {r}/public/assets/css/huginn_dock.css 2>&1; "
        "grep -c huginn_ {r}/public/index.html; "
        "wc -c {r}/public/assets/js/huginn_dock.js".format(r=REMOTE)
    )

    with tempfile.TemporaryDirectory() as td:
        tar_path = Path(td) / "ting_polish.tar"
        with tarfile.open(tar_path, "w") as tar:
            for rel in FILES:
                tar.add(ROOT / rel, arcname=rel)
        sftp = ssh.open_sftp()
        remote_tar = f"/tmp/ting_polish_{STAMP}.tar"
        sftp.put(str(tar_path), remote_tar)
        sftp.close()

    run(f"tar -xf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")

    # Apply V363 if table missing
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -c "
        "\"SELECT to_regclass('public.thing_chat_messages');\" "
        "| tee /tmp/ting_v363_check.txt"
    )
    run(
        "if ! PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        "\"SELECT to_regclass('public.thing_chat_messages');\" | grep -q thing_chat_messages; then "
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {REMOTE}/migrations/V363__thing_chat.sql; "
        "echo V363_APPLIED; else echo V363_ALREADY; fi"
    )

    # Post checks — huginn intact, ting updated, shell matched
    run(
        f"grep -E \"SHELL_VERSION|ASGARD_SHELL_VERSION\" {REMOTE}/public/sw.js {REMOTE}/public/index.html | head -6"
    )
    run(
        f"test -f {REMOTE}/public/assets/js/ting_icons.js && "
        f"test -f {REMOTE}/public/assets/js/ting_common.js && "
        f"test -f {REMOTE}/public/assets/css/ting.css && "
        f"test -f {REMOTE}/public/assets/js/ting_page.js && "
        f"test -f {REMOTE}/public/assets/js/huginn_boot.js && "
        f"test -f {REMOTE}/public/assets/js/huginn_dock.js && "
        f"grep -q ting-chat-send-ico {REMOTE}/public/assets/css/ting.css && "
        f"grep -q 'backdrop-filter: blur(4px)' {REMOTE}/public/assets/css/ting.css && "
        f"grep -q '#2E7D32' {REMOTE}/public/assets/css/ting.css && "
        f"grep -q huginn_boot.js {REMOTE}/public/index.html && "
        f"grep -q ting_icons.js {REMOTE}/public/index.html && "
        f"grep -q thing_chat_messages {REMOTE}/src/routes/thing.js && "
        f"node --check {REMOTE}/src/routes/thing.js"
    )
    run(
        f"wc -c {REMOTE}/public/assets/css/ting.css "
        f"{REMOTE}/public/assets/js/ting_page.js "
        f"{REMOTE}/public/assets/js/huginn_dock.js"
    )

    run("systemctl restart asgard-crm")
    run("sleep 4; systemctl is-active asgard-crm")
    run(
        "for i in 1 2 3 4 5 6 7 8; do "
        "c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo try=$i code=$c; [ \"$c\" = 200 ] && break; sleep 2; done"
    )
    run("curl -sS http://127.0.0.1:3000/api/thing/health; echo")
    for path, label in (
        ("/assets/css/ting.css", "ting_css"),
        ("/assets/js/ting_page.js", "ting_js"),
        ("/assets/js/ting_icons.js", "ting_icons"),
        ("/assets/js/ting_common.js", "ting_common"),
        ("/assets/js/huginn_boot.js", "huginn_boot"),
        ("/assets/js/huginn_dock.js", "huginn_dock"),
        ("/ting/", "ting_guest"),
    ):
        run(f"curl -sS -o /dev/null -w '{label}:%{{http_code}}\\n' http://127.0.0.1:3000{path}")

    # Confirm table exists
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        "\"SELECT to_regclass('public.thing_chat_messages');\""
    )

    ssh.close()
    print("DEPLOY_DONE ting polish", VER, "snapshot", snap)
    print("huginn assets preserved; telephony not deployed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
