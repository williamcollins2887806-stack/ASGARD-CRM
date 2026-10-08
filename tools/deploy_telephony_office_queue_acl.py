#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Patch telephony.js office-queue ACL on prod (after 20.28.88 shell)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm/src/routes/telephony.js"
LOCAL = ROOT / "src/routes/telephony.js"


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
    text = LOCAL.read_text(encoding="utf-8")
    if "Очередь непрочитанных офисных" not in text:
        raise SystemExit("local telephony.js missing office-queue ACL comment")
    if "can_see_office: TEL_ROLES.includes(request.user.role)" not in text:
        raise SystemExit("local telephony.js missing can_see_office for TEL_ROLES")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str) -> str:
        print(f"$ {cmd[:220]}")
        _i, o, e = ssh.exec_command(cmd, timeout=120)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print(err.rstrip(), file=sys.stderr)
        if code != 0:
            raise SystemExit(f"exit {code}: {cmd}")
        return out

    sftp = ssh.open_sftp()
    sftp.put(str(LOCAL), REMOTE)
    sftp.close()
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")
    run(f"grep -n 'Очередь непрочитанных офисных' {REMOTE}")
    run(f"grep -n 'can_see_office: TEL_ROLES' {REMOTE}")
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A "
        "-c \"SELECT id, role, name FROM users WHERE id=3474\""
    )
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A "
        "-c \"SELECT id, from_number, created_at::text FROM call_history "
        "WHERE call_type='missed' AND user_id IS NULL "
        "AND COALESCE(missed_acknowledged,false)=false "
        "ORDER BY created_at DESC LIMIT 5\""
    )
    print("=== telephony office-queue ACL patched ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
