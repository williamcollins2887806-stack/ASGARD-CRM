#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy PBX scenario hardening (shell 20.28.85).

CRM shell + phone/session/PWA + telephony-pbx + asgard-pbx sources.
Does NOT switch Mango trunk / Bitrix cutover.
Optional: refresh Asterisk dialplan snippet if already installed.

  python tools/deploy_pbx_hardening_20_28_85.py
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

VER = "20.28.85"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/manifest.json",
    "public/assets/css/phone.css",
    "public/assets/js/phone_core.js",
    "public/assets/js/phone_ui.js",
    "public/assets/js/push-notifications.js",
    "public/assets/js/session-guard.js",
    "public/assets/js/telephony_admin.js",
    "src/routes/telephony-pbx.js",
    "src/pbx/call-lifecycle.js",
    "src/pbx/dial-engine.js",
    "src/pbx/index.js",
    "src/pbx/operator-lifecycle.js",
    "ops/asterisk/extensions_asgard.conf",
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
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    for marker in (
        f"ASGARD_SHELL_VERSION = '{VER}'",
        "session-guard.js",
        "phone_core.js",
        "phone_ui.js",
        "push-notifications.js",
        "billing.js",
        "nd-permits.js",
    ):
        if marker not in idx:
            raise SystemExit(f"index.html missing marker: {marker}")

    pc = (ROOT / "public/assets/js/phone_core.js").read_text(encoding="utf-8")
    if "/operator/heartbeat" not in pc:
        raise SystemExit("phone_core missing heartbeat")
    sg = (ROOT / "public/assets/js/session-guard.js").read_text(encoding="utf-8")
    if "lockAway" not in sg:
        raise SystemExit("session-guard missing lockAway")
    de = (ROOT / "src/pbx/dial-engine.js").read_text(encoding="utf-8")
    if "isHeartbeatFresh" not in de:
        raise SystemExit("dial-engine missing heartbeat gate")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 300) -> str:
        print(f"$ {cmd[:220]}")
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

    snap = f"/root/snapshots/asgard-crm-pre-pbx-hardening-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js public/manifest.json "
        "public/assets/css/phone.css "
        "public/assets/js/phone_core.js public/assets/js/phone_ui.js "
        "public/assets/js/session-guard.js public/assets/js/push-notifications.js "
        "public/assets/js/telephony_admin.js "
        "src/routes/telephony-pbx.js src/pbx "
        "ops/asterisk/extensions_asgard.conf 2>/dev/null || true".format(
            snap=snap, remote=REMOTE
        )
    )
    print(f"snapshot: {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-pbx-hardening-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)

    run(f"mkdir -p {REMOTE}/src/pbx {REMOTE}/ops/asterisk")
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")

    # If Asterisk already uses our snippet path — refresh + dialplan reload (no trunk switch)
    run(
        "if [ -f /etc/asterisk/extensions_asgard.conf ]; then "
        f"cp -a {REMOTE}/ops/asterisk/extensions_asgard.conf /etc/asterisk/extensions_asgard.conf; "
        "asterisk -rx 'dialplan reload' || true; "
        "echo dialplan_refreshed; "
        "else echo dialplan_skip_no_etc_snippet; fi",
        check=False,
    )

    run("systemctl restart asgard-crm")
    run("systemctl restart asgard-pbx || systemctl try-restart asgard-pbx || true", check=False)
    run(
        "for i in 1 2 3 4 5 6 7 8; do "
        "c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo try_$i:$c; [ \"$c\" = 200 ] && break; sleep 2; done"
    )
    run(
        f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {REMOTE}/public/index.html | head -1; "
        f"grep -o \"SHELL_VERSION = '[^']*'\" {REMOTE}/public/sw.js | head -1; "
        f"grep -c 'lockAway' {REMOTE}/public/assets/js/session-guard.js; "
        f"grep -c '/operator/heartbeat' {REMOTE}/public/assets/js/phone_core.js; "
        f"grep -c 'isHeartbeatFresh' {REMOTE}/src/pbx/dial-engine.js; "
        f"test -f {REMOTE}/src/pbx/operator-lifecycle.js && echo operator_lifecycle:ok; "
        "systemctl is-active asgard-crm; "
        "systemctl is-active asgard-pbx || echo asgard-pbx:inactive"
    )
    ssh.close()
    print("=== DONE PBX hardening 20.28.85 (Mango cutover NOT applied) ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
