#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy telephony CRM package to prod (NO Asterisk cutover / NO Mango trunk switch)."""
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

VER = "20.28.61"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/css/phone.css",
    "public/assets/css/telephony-page.css",
    "public/assets/js/phone_core.js",
    "public/assets/js/phone_ui.js",
    "public/assets/js/telephony.js",
    "public/assets/js/telephony_admin.js",
    "public/assets/js/telephony_popup.js",
    "public/assets/js/call_reports.js",
    "public/assets/js/mango.js",
    "public/assets/js/session-guard.js",
    "public/assets/js/app.js",
    "public/assets/vendor/jssip.min.js",
    "src/index.js",
    "src/lib/telephony-access.js",
    "src/routes/telephony.js",
    "src/routes/telephony-pbx.js",
    "src/services/caller-lookup.js",
    "src/services/call-analyzer.js",
    "src/services/call-pipeline.js",
    "src/services/mango.js",
    "src/services/speechkit.js",
    "migrations/V359__pbx_core.sql",
    "migrations/V359__pbx_core_down.sql",
    "ops/asterisk/README.md",
    "ops/asterisk/asgard-pbx.service",
    "ops/asterisk/extensions_asgard.conf",
    "ops/asterisk/manager_asgard.conf.snippet",
    "ops/asterisk/nginx_pbx_ws.conf.snippet",
    "ops/asterisk/pjsip_webrtc.conf.snippet",
    "ops/asterisk/rtp.conf.snippet",
    "ops/asterisk/asterisk.service.d/asgard-env.conf",
]

PBX_DIR = [
    "src/pbx/agi-server.js",
    "src/pbx/ami-client.js",
    "src/pbx/ast-db-fallback.js",
    "src/pbx/call-lifecycle.js",
    "src/pbx/config.js",
    "src/pbx/dial-engine.js",
    "src/pbx/index.js",
    "src/pbx/notify-bridge.js",
    "src/pbx/package.json",
    "src/pbx/recording.js",
    "src/pbx/tts-cache.js",
]


def connect():
    key = paramiko.Ed25519Key.from_private_key_file(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=30)
    return ssh


def run(ssh, cmd: str, timeout: int = 180) -> str:
    print(">>", cmd[:200])
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode("utf-8", errors="replace")
    e = err.read().decode("utf-8", errors="replace")
    code = out.channel.recv_exit_status()
    if o.strip():
        print(o.rstrip())
    if e.strip():
        print("[stderr]", e.rstrip())
    if code != 0:
        raise RuntimeError(f"cmd exit {code}: {cmd}\n{e}")
    return o


def main():
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)
    missing = [f for f in FILES + PBX_DIR if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit("missing local files: " + ", ".join(missing))

    tar_path = Path(tempfile.gettempdir()) / f"asgard-telephony-{STAMP}.tgz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES + PBX_DIR:
            tar.add(ROOT / rel, arcname=rel)
    print("tar", tar_path, tar_path.stat().st_size, "bytes")

    ssh = connect()
    try:
        run(ssh, f"mkdir -p /root/snapshots && tar -czf /root/snapshots/asgard-crm-pre-telephony-{STAMP}.tgz "
                 f"-C {REMOTE} public/index.html public/sw.js public/assets/js public/assets/css "
                 f"src/index.js src/routes src/services src/lib 2>/dev/null || true")
        sftp = ssh.open_sftp()
        remote_tar = f"/tmp/asgard-telephony-{STAMP}.tgz"
        sftp.put(str(tar_path), remote_tar)
        sftp.close()
        run(ssh, f"mkdir -p {REMOTE}/src/pbx {REMOTE}/public/assets/vendor "
                 f"{REMOTE}/ops/asterisk/asterisk.service.d {REMOTE}/migrations")
        run(ssh, f"tar -xzf {remote_tar} -C {REMOTE}")
        run(ssh, f"chown -R ubuntu:ubuntu {REMOTE}/public/assets/css/phone.css "
                 f"{REMOTE}/public/assets/css/telephony-page.css "
                 f"{REMOTE}/public/assets/js/phone_core.js "
                 f"{REMOTE}/public/assets/js/phone_ui.js "
                 f"{REMOTE}/public/assets/js/telephony_admin.js "
                 f"{REMOTE}/public/assets/vendor "
                 f"{REMOTE}/src/pbx "
                 f"{REMOTE}/src/routes/telephony-pbx.js "
                 f"{REMOTE}/src/lib/telephony-access.js "
                 f"{REMOTE}/migrations/V359__pbx_core.sql || true")
        # Migration (idempotent-ish)
        run(
            ssh,
            f"sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 "
            f"-f {REMOTE}/migrations/V359__pbx_core.sql",
            timeout=300,
        )
        run(ssh, "systemctl restart asgard-crm")
        run(
            ssh,
            "for i in 1 2 3 4 5 6 7 8; do "
            "c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
            "echo try_$i:$c; [ \"$c\" = 200 ] && exit 0; sleep 2; done; exit 1",
            timeout=60,
        )
        run(ssh, "systemctl is-active asgard-crm")
        # Soft smoke: telephony routes exist (auth may 401)
        run(
            ssh,
            "curl -s -o /dev/null -w 'pbx_health:%{http_code}\\n' "
            "http://127.0.0.1:3000/api/telephony/pbx/health; "
            "curl -s -o /dev/null -w 'phone_css:%{http_code}\\n' "
            "http://127.0.0.1:3000/assets/css/phone.css; "
            "curl -s -o /dev/null -w 'phone_core:%{http_code}\\n' "
            "http://127.0.0.1:3000/assets/js/phone_core.js; "
            "grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" "
            f"{REMOTE}/public/index.html | head -1",
        )
        run(ssh, f"rm -f {remote_tar}")
        print("\nDEPLOY OK — CRM telephony package. Asterisk/Mango cutover NOT applied.")
    finally:
        ssh.close()
        try:
            tar_path.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    main()
