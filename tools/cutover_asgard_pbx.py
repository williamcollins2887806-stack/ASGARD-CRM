#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cutover asgard-pbx sidecar + Asterisk dialplan on prod (LIVE telephony).

Steps (all with snapshots + rollback file):
  1. snapshot /etc/asterisk + asgard-crm pbx sources
  2. write /etc/asgard-crm/pbx.env (AMI_USER/AMI_SECRET from .env, PBX_CMD_SECRET)
  3. sync src/pbx + ops/asterisk/extensions_asgard.conf to the tree
  4. install asgard-pbx.service + fix ownership/perms (pbx.env 600 www-data)
  5. ensure Asterisk #include for extensions_asgard.conf
  6. enable+start asgard-pbx; verify :4573/:4575 + /health
No Mango trunk / Bitrix changes.

  python tools/cutover_asgard_pbx.py --dry-run
  python tools/cutover_asgard_pbx.py
"""
from __future__ import annotations

import argparse
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

PBX_FILES = [
    "src/pbx/agi-server.js",
    "src/pbx/ami-client.js",
    "src/pbx/ast-db-fallback.js",
    "src/pbx/call-lifecycle.js",
    "src/pbx/config.js",
    "src/pbx/dial-engine.js",
    "src/pbx/index.js",
    "src/pbx/notify-bridge.js",
    "src/pbx/operator-lifecycle.js",
    "src/pbx/recording.js",
    "src/pbx/tts-cache.js",
    "src/pbx/package.json",
    "src/routes/telephony-pbx.js",
    "ops/asterisk/extensions_asgard.conf",
    "ops/asterisk/asgard-pbx.service",
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print("=== 0. PRE-FLIGHT shell_guard ===")
    # Shell на проде не трогаем: проверяем только целостность оболочки
    # (без expect_version / deploy-gate — репо может опережать подписанный коммит).
    shell_guard.assert_ok(base_dir=str(ROOT))
    print("shell_guard: OK (integrity only)")
    missing = [f for f in PBX_FILES if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit("missing local files: " + ", ".join(missing))

    if args.dry_run:
        print("--dry-run: no remote changes. Files:", len(PBX_FILES))
        return 0

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in PBX_FILES:
            tar.add(ROOT / rel, arcname=rel)

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

    # 1. snapshots
    run(
        "mkdir -p /root/snapshots && "
        f"tar -czf /root/snapshots/asterisk-pre-pbx-cutover-{STAMP}.tgz -C /etc asterisk 2>/dev/null || true"
    )
    run(
        f"mkdir -p /root/snapshots && tar -czf /root/snapshots/asgard-crm-pre-pbx-cutover-{STAMP}.tgz "
        f"-C {REMOTE} src/pbx src/routes/telephony-pbx.js ops/asterisk/extensions_asgard.conf 2>/dev/null || true"
    )
    print(f"snapshots stamped {STAMP}")

    # 2. pbx.env
    run(
        "cd {remote} && "
        "AMI_U=$(grep -E '^AMI_USERNAME=' .env | cut -d= -f2-); "
        "AMI_P=$(grep -E '^AMI_SECRET=' .env | cut -d= -f2-); "
        "CMD_S=$(openssl rand -hex 24); "
        "mkdir -p /etc/asgard-crm; "
        "umask 077; "
        "printf 'DATABASE_URL=postgresql://asgard:123456789@127.0.0.1:5432/asgard_crm\\n"
        "AMI_HOST=127.0.0.1\\nAMI_PORT=5038\\nAMI_USER=%s\\nAMI_SECRET=%s\\n"
        "PBX_CMD_SECRET=%s\\nAGI_PORT=4573\\nCMD_PORT=4575\\n"
        "PBX_RECORDINGS_ROOT=/var/lib/asgard-crm/recordings\\n"
        "PBX_TTS_CACHE_DIR=/var/lib/asgard-crm/tts-cache\\n' "
        "\"$AMI_U\" \"$AMI_P\" \"$CMD_S\" > /etc/asgard-crm/pbx.env; "
        "chmod 600 /etc/asgard-crm/pbx.env; "
        "echo pbx.env_written; "
        "grep -oE '^[A-Z_]+' /etc/asgard-crm/pbx.env | tr '\\n' ' '".format(remote=REMOTE)
    )

    # 3. sync sources
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-pbx-cutover-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    run(f"mkdir -p /var/lib/asgard-crm/recordings /var/lib/asgard-crm/tts-cache "
        f"/var/spool/asterisk/recordings && chown -R www-data:www-data /var/lib/asgard-crm")

    # 4. service
    run(f"cp {REMOTE}/ops/asterisk/asgard-pbx.service /etc/systemd/system/asgard-pbx.service && systemctl daemon-reload")
    run("systemctl enable asgard-pbx")

    # 5. Asterisk include
    run(
        "if grep -q 'extensions_asgard.conf' /etc/asterisk/extensions.conf; then echo include_present; "
        "else cp -a /etc/asterisk/extensions.conf /etc/asterisk/extensions.conf.pre-pbx-cutover; "
        "printf '\\n#include extensions_asgard.conf\\n' >> /etc/asterisk/extensions.conf; echo include_added; fi"
    )
    run(f"cp -a {REMOTE}/ops/asterisk/extensions_asgard.conf /etc/asterisk/extensions_asgard.conf")

    # 6. start + verify
    run("systemctl restart asgard-pbx")
    run(
        "for i in 1 2 3 4 5; do "
        "ss -lntp | grep -q ':4575' && ss -lntp | grep -q ':4573' && break; sleep 2; done; "
        "ss -lntp | grep -E '4573|4575' || echo NO_PORTS"
    )
    run(
        "S=$(grep -oE '^PBX_CMD_SECRET=.*' /etc/asgard-crm/pbx.env | cut -d= -f2-); "
        "curl -s -H \"X-PBX-Secret: $S\" http://127.0.0.1:4575/health"
    )
    run("systemctl is-active asgard-pbx")
    run(f"grep -c 'SIP/mango-trunk' {REMOTE}/ops/asterisk/extensions_asgard.conf")
    run("asterisk -rx 'dialplan reload' 2>&1 | tail -2; asterisk -rx 'dialplan show from-mango-inbound' 2>&1 | head -8")
    run("journalctl -u asgard-pbx --no-pager -n 15 | tail -15")
    ssh.close()
    print("=== DONE asgard-pbx cutover (Mango trunk UNCHANGED — egress still via SIP/mango-trunk) ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
