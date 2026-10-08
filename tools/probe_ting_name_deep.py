#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deep probe: prod thing.js token block + client name sources + shell drift."""
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

    show(f"sed -n '330,365p' {REMOTE}/src/routes/thing.js", "prod thing.js token 330-365")
    show(f"sed -n '58,84p' {REMOTE}/public/assets/js/huginn_ting.js", "prod huginn_ting localDisplayProfile")
    show(f"sed -n '380,398p' {REMOTE}/public/assets/js/huginn_ting.js", "prod huginn_ting participantLabel")
    show(
        f"grep -n 'AsgardAuth\\|window.ASGARD\\|window.ASGARD_USER' {REMOTE}/public/index.html | head -20",
        "prod index.html globals",
    )
    show(
        f"grep -rn 'window.ASGARD_USER *=' {REMOTE}/public/assets/js/ | head -20; "
        f"grep -rn 'window.ASGARD_USER *=' {REMOTE}/public/v2/ 2>/dev/null | head -5",
        "who sets window.ASGARD_USER",
    )
    show(
        f"ls -la {REMOTE}/public/assets/js/huginn_ting.js {REMOTE}/src/routes/thing.js; "
        f"grep -n 'ASGARD_SHELL_VERSION' {REMOTE}/public/index.html | head -2; "
        f"grep -n 'SHELL_VERSION' {REMOTE}/public/sw.js | head -2",
        "prod mtimes + versions",
    )
    show(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A "
        "-c \"SELECT count(*) FILTER (WHERE name IS NULL OR name='') AS no_name, "
        "count(*) FILTER (WHERE email IS NULL OR email='') AS no_email FROM users WHERE role IN ('PM','ADMIN','DIRECTOR_GEN')\"",
        "users missing name/email (tel roles)",
    )
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
