#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Probe prod thing.js token display-name logic + ting_page/thing name sources."""
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
REMOTE = "/var/www/asgard-crm"


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
    raise SystemExit("cannot load SSH key")


def main() -> int:
    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def show(cmd: str, label: str) -> None:
        print(f"\n===== {label} =====")
        _i, o, e = ssh.exec_command(cmd, timeout=120)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        print(out.rstrip() or "(empty)")
        if err.strip():
            print("[stderr]", err.rstrip(), file=sys.stderr)

    show(
        f"grep -n 'SELECT name, role FROM users' {REMOTE}/src/routes/thing.js; "
        f"grep -n 'isPlaceholderDisplayName' {REMOTE}/src/routes/thing.js | head; "
        f"grep -n 'name: displayName' {REMOTE}/src/routes/thing.js",
        "prod thing.js token name logic",
    )
    show(
        f"grep -n 'ASGARD_USER' {REMOTE}/public/index.html | head -20; "
        f"grep -n 'shell-version\\|SHELL_VERSION' {REMOTE}/public/index.html | head",
        "prod index.html ASGARD_USER",
    )
    show(
        f"grep -n 'localDisplayProfile' {REMOTE}/public/assets/js/huginn_ting.js | head; "
        f"grep -n 'ASGARD_USER' {REMOTE}/public/assets/js/huginn_ting.js | head; "
        f"grep -n \"Участник\" {REMOTE}/public/assets/js/huginn_ting.js | head",
        "prod huginn_ting.js label sources",
    )
    show(
        f"grep -n 'ASGARD_USER' {REMOTE}/public/assets/js/auth.js | head; "
        f"grep -n 'asgard_user' {REMOTE}/public/assets/js/session-guard.js | head",
        "prod auth/session-guard asgard_user",
    )
    show(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A "
        "-c \"SELECT id, login, name, role FROM users WHERE id=3474\"",
        "prod user 3474",
    )
    show(
        f"grep -c 'window.ASGARD_USER' {REMOTE}/public/index.html; "
        f"grep -rn 'ASGARD_USER' {REMOTE}/public/assets/js/huginn_dock.js | head -5",
        "ASGARD_USER global wiring",
    )
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
