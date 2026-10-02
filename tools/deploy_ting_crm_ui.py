#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting CRM UI 100% (shell 20.28.62) — module #/ting + guest + host APIs."""
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

VER = "20.28.62"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/css/ting.css",
    "public/assets/js/ting_page.js",
    "public/assets/js/app.js",
    "public/assets/js/meetings_page.js",
    "public/assets/js/chat_groups.js",
    "public/ting/index.html",
    "src/routes/thing.js",
    "src/services/thing-livekit.js",
]


def main() -> int:
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)
    for rel in FILES:
        p = ROOT / rel
        if not p.is_file():
            raise SystemExit(f"missing: {rel}")

    key = paramiko.RSAKey.from_private_key_file(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=30)

    def run(cmd: str, check: bool = True) -> str:
        print(f"$ {cmd}")
        _i, o, e = ssh.exec_command(cmd, timeout=180)
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

    snap = f"/root/snapshots/asgard-crm-pre-deploy-ting-ui-{STAMP}.tgz"
    run(
        f"mkdir -p /root/snapshots && tar -czf {snap} "
        f"-C {REMOTE} public/index.html public/sw.js public/assets/js/app.js "
        f"public/assets/js/meetings_page.js public/assets/js/chat_groups.js "
        f"public/ting src/routes/thing.js src/services/thing-livekit.js "
        f"2>/dev/null || tar -czf {snap} -C {REMOTE} public/index.html public/sw.js"
    )
    print(f"snapshot: {snap}")

    with tempfile.TemporaryDirectory() as td:
        tar_path = Path(td) / "ting_ui.tar"
        with tarfile.open(tar_path, "w") as tar:
            for rel in FILES:
                tar.add(ROOT / rel, arcname=rel)
        sftp = ssh.open_sftp()
        remote_tar = f"/tmp/ting_ui_{STAMP}.tar"
        sftp.put(str(tar_path), remote_tar)
        sftp.close()

    run(f"tar -xf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run(f"grep -E \"SHELL_VERSION|ASGARD_SHELL_VERSION\" {REMOTE}/public/sw.js {REMOTE}/public/index.html | head -4")
    run(f"test -f {REMOTE}/public/assets/js/ting_page.js && test -f {REMOTE}/public/assets/css/ting.css")
    run(f"grep -n 'r:\"/ting\"' {REMOTE}/public/assets/js/app.js | head -2")
    run(f"node --check {REMOTE}/src/routes/thing.js")
    run("systemctl restart asgard-crm")
    run("sleep 4; systemctl is-active asgard-crm")
    run(
        "for i in 1 2 3 4 5 6 7 8; do "
        "c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo try=$i code=$c; [ \"$c\" = 200 ] && break; sleep 2; done"
    )
    run("curl -sS http://127.0.0.1:3000/api/thing/health; echo")
    run("curl -sS -o /dev/null -w 'ting_css:%{http_code}\\n' http://127.0.0.1:3000/assets/css/ting.css")
    run("curl -sS -o /dev/null -w 'ting_js:%{http_code}\\n' http://127.0.0.1:3000/assets/js/ting_page.js")
    run("curl -sS -o /dev/null -w 'ting_guest:%{http_code}\\n' http://127.0.0.1:3000/ting/")
    ssh.close()
    print("DEPLOY_DONE ting CRM UI", VER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
