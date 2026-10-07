#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Enable the LiveKit webhook for Huginn call hygiene (idempotent).

Adds a `webhook:` block to the LiveKit server config so the SFU reports
room_started / room_finished / participant_left to the CRM. The CRM uses it to
close a call row when a client dies, so nobody stays "busy" (backstop: 4h
expiry + 5-min sweeper in src/routes/huginn_ext.js).

Applied on prod 2026-10-07 to /opt/asgard-livekit/livekit.yaml and verified via
LiveKit logs ("sent webhook" ... 200 OK). Re-running is safe: the previous
webhook block is replaced.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko  # noqa: E402

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
LIVEKIT_DIR = "/opt/asgard-livekit"
CONFIG = f"{LIVEKIT_DIR}/livekit.yaml"
WEBHOOK_URL = "https://asgard-crm.ru/api/chat-groups/calls/webhook"


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


REMOTE_SCRIPT = r'''
set -e
CFG="%(cfg)s"
BAK="$CFG.bak-$(date +%%Y%%m%%d-%%H%%M%%S)"
cp "$CFG" "$BAK"
echo "backup: $BAK"
python3 - "$CFG" "%(url)s" <<'PY'
import re, sys
p, url = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
s = re.sub(r'\nwebhook:\n(?:[ \t]+.*\n?)*', '\n', s)
if not s.endswith('\n'):
    s += '\n'
m = re.search(r'\n  (API[0-9a-fA-F]+):', s)
if not m:
    sys.exit('api key not found in config')
s += '\nwebhook:\n  api_key: %%s\n  urls:\n    - %%s\n' %% (m.group(1), url)
open(p, 'w', encoding='utf-8').write(s)
print('webhook block written for api_key', m.group(1))
PY
tail -5 "$CFG"
cd "%(dir)s" && docker compose restart livekit
sleep 6
docker ps --format '{{.Names}}\t{{.Status}}' | grep -i 'livekit-livekit-1'
docker exec asgard-livekit-livekit-1 tail -5 /etc/livekit.yaml
''' % {"cfg": CONFIG, "url": WEBHOOK_URL, "dir": LIVEKIT_DIR}


def main() -> int:
    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)
    _i, o, e = ssh.exec_command("sh -s", timeout=300)
    o.channel.sendall(REMOTE_SCRIPT.encode("utf-8"))
    o.channel.shutdown_write()
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    code = o.channel.recv_exit_status()
    ssh.close()
    print("=== ENABLE WEBHOOK", "OK" if code == 0 else f"FAILED ({code})", "===")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
