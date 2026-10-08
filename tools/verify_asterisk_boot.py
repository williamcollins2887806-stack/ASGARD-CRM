#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Восстановление/проверка WebRTC-контура ASGARD после перезагрузки сервера.

Проверяет, что всё поднимается автоматически, и печатает, что чинить.

  python tools/verify_asterisk_boot.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import paramiko

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")

SERVICES = ["postgresql", "asterisk", "tts", "asgard-pbx", "asgard-crm", "nginx"]


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
    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=30)

    def run(cmd: str) -> str:
        _i, o, e = ssh.exec_command(cmd, timeout=60)
        return (o.read().decode("utf-8", "replace") + e.read().decode("utf-8", "replace")).strip()

    print("=== services (enabled + active) ===")
    for s in SERVICES:
        en = run(f"systemctl is-enabled {s} 2>/dev/null")
        ac = run(f"systemctl is-active {s} 2>/dev/null")
        flag = "OK" if ac == "active" and en in ("enabled", "static") else "!!"
        print(f"  {flag} {s:<12} enabled={en:<8} active={ac}")

    print("\n=== asterisk WebRTC ===")
    print("  ws module:", run("asterisk -rx 'module show like transport_websocket' | sed -n 2p"))
    print("  transports:", run("asterisk -rx 'pjsip show transports' | grep -c transport-"))
    print("  chan_sip:", run("asterisk -rx 'module show like chan_sip' | sed -n 2p"))

    print("\n=== trunks ===")
    print(run("asterisk -rx 'pjsip show aors' | grep -iE 'mango-trunk|livekit' | grep -iE 'Avail|NonQual|Unavail'"))

    print("\n=== ws handshake ===")
    print(run(
        "python3 -c \"import socket,base64,os;"
        "k=base64.b64encode(os.urandom(16)).decode();"
        "r='GET /ws HTTP/1.1\\r\\nHost: l\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n"
        "Sec-WebSocket-Key: '+k+'\\r\\nSec-WebSocket-Version: 13\\r\\nSec-WebSocket-Protocol: sip\\r\\n\\r\\n';"
        "s=socket.create_connection(('127.0.0.1',8088),timeout=5);s.sendall(r.encode());"
        "print(s.recv(80).decode('latin1').splitlines()[0])\""
    ))

    print("\n=== health ===")
    print("  app:", run("curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health"))
    print("  silero:", run("curl -s -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:5500/health"))
    print("  watchdog:", run("systemctl is-active asgard-tts-watchdog.timer"))
    print("  failed units:", run("systemctl --failed --no-pager | wc -l"))

    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
