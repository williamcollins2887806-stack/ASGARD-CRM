#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PBX cutover deploy — Asterisk configs + asgard-pbx + backend routes.

Запуск:
  python tools/deploy_pbx_cutover.py
  python tools/deploy_pbx_cutover.py --dry-run

Не выполняет SSH без явного снятия --dry-run (печатает план).
"""

from __future__ import annotations

import argparse
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))

import shell_guard  # noqa: E402

VER = "20.28.53"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
ASTERISK_SNAP = f"/root/snapshots/asterisk-pre-pbx-{STAMP}.tgz"
CRM_SNAP = f"/root/snapshots/asgard-crm-pre-pbx-{STAMP}.tgz"

BACKEND_FILES = [
    "migrations/V359__pbx_core.sql",
    "migrations/V359__pbx_core_down.sql",
    "src/services/caller-lookup.js",
    "src/pbx/index.js",
    "src/pbx/config.js",
    "src/pbx/ami-client.js",
    "src/pbx/agi-server.js",
    "src/pbx/dial-engine.js",
    "src/pbx/ast-db-fallback.js",
    "src/pbx/recording.js",
    "src/pbx/tts-cache.js",
    "src/pbx/notify-bridge.js",
    "src/pbx/package.json",
    "src/routes/telephony-pbx.js",
]

OPS_FILES = [
    "ops/asterisk/pjsip_webrtc.conf.snippet",
    "ops/asterisk/extensions_asgard.conf",
    "ops/asterisk/manager_asgard.conf.snippet",
    "ops/asterisk/rtp.conf.snippet",
    "ops/asterisk/nginx_pbx_ws.conf.snippet",
    "ops/asterisk/asgard-pbx.service",
    "ops/asterisk/README.md",
]

MARKERS = {
    "src/pbx/dial-engine.js": ["buildRingPlan", "advanceAfterMiss"],
    "src/routes/telephony-pbx.js": ["/operator/status", "PBX_CMD_SECRET"],
    "migrations/V359__pbx_core.sql": ["pbx_operators", "pbx_config"],
}


def ssh_cmd(cmd: str) -> str:
    return f'ssh -i "{SSH_KEY}" -o StrictHostKeyChecking=no {SSH_HOST} "{cmd}"'


def scp_cmd(local: str, remote: str) -> str:
    return f'scp -i "{SSH_KEY}" -o StrictHostKeyChecking=no "{local}" {SSH_HOST}:{remote}'


def preflight() -> None:
    print("\n=== PRE-FLIGHT (shell_guard + markers) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")
    missing = [f for f in BACKEND_FILES if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit(f"Missing files: {missing}")
    for rel, needles in MARKERS.items():
        text = (ROOT / rel).read_text(encoding="utf-8")
        for n in needles:
            if n not in text:
                raise SystemExit(f"Marker missing: {rel} :: {n}")
    print(f"markers OK; backend files: {len(BACKEND_FILES)}")


def plan_steps(dry_run: bool) -> None:
    print("\n=== DEPLOY PLAN ===")
    steps = [
        f"Snapshot Asterisk: tar czf {ASTERISK_SNAP} /etc/asterisk",
        f"Snapshot CRM tree: tar czf {CRM_SNAP} -C {PROJECT} {' '.join(BACKEND_FILES[:8])} ...",
        "Upload backend tar → extract under " + PROJECT,
        "Run migration V359 on prod DB (psql)",
        "Rsync ops/asterisk snippets → /etc/asterisk/asgard/ + includes",
        "Install /etc/systemd/system/asgard-pbx.service + /etc/asgard-crm/pbx.env",
        "nginx -t && reload (pbx ws snippet)",
        "systemctl restart asterisk",
        "systemctl enable --now asgard-pbx",
        "Register telephony-pbx route in src/index.js if not yet wired",
        "systemctl restart asgard-crm",
        "Smoke: curl 127.0.0.1:4575/health with X-PBX-Secret",
    ]
    for i, s in enumerate(steps, 1):
        print(f"  {i}. {s}")

    if dry_run:
        print("\n--dry-run: SSH/scp not executed.")
        return

    print("\n=== EXECUTE (manual gate — enable in script when approved) ===")
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / f"pbx-cutover-{STAMP}.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in BACKEND_FILES:
                tar.add(ROOT / rel, arcname=rel)
            for rel in OPS_FILES:
                tar.add(ROOT / rel, arcname=rel)
        print(f"Local tar ready: {tar_path} ({tar_path.stat().st_size} bytes)")
        print("Upload command:")
        print(scp_cmd(str(tar_path), f"/tmp/pbx-cutover-{STAMP}.tgz"))
        print("Remote extract:")
        print(ssh_cmd(f"cd {PROJECT} && tar xzf /tmp/pbx-cutover-{STAMP}.tgz && rm -f /tmp/pbx-cutover-{STAMP}.tgz"))
        print("Asterisk backup:")
        print(ssh_cmd(f"mkdir -p /root/snapshots && tar czf {ASTERISK_SNAP} /etc/asterisk"))
        print("Restart:")
        print(ssh_cmd("systemctl restart asterisk && systemctl restart asgard-pbx && systemctl restart asgard-crm"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Deploy PBX cutover artifacts")
    parser.add_argument("--dry-run", action="store_true", help="Plan only, no remote commands")
    args = parser.parse_args()

    print("=" * 72)
    print(f"ASGARD PBX CUTOVER DEPLOY (shell {VER})")
    print("=" * 72)

    preflight()
    plan_steps(args.dry_run)
    print("\n=== DONE (plan) ===")
    print("Post-deploy: python tools/restore_asset_sync.py plan")
    print("             node tools/audit_silent_reverts.js --post-deploy")


if __name__ == "__main__":
    main()
