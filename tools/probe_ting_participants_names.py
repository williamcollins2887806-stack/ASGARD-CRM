#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Evidence: thing_participants.display_name placeholders on prod."""
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


SQL = """
\\pset pager off
SELECT 'placeholder_rows='||COUNT(*) FROM thing_participants
  WHERE display_name ~* '^участник( [0-9]+)?$' OR display_name ~* '^user_[0-9]+$';
SELECT 'total_rows='||COUNT(*) FROM thing_participants;
SELECT id, room_id, user_id, display_name, identity, joined_at::text
  FROM thing_participants
  WHERE display_name ~* '^участник( [0-9]+)?$' OR display_name ~* '^user_[0-9]+$'
  ORDER BY id DESC LIMIT 10;
SELECT id, room_id, user_id, display_name, identity, joined_at::text
  FROM thing_participants WHERE user_id = 3474 ORDER BY id DESC LIMIT 10;
"""


def main() -> int:
    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)
    sftp = ssh.open_sftp()
    with sftp.open("/tmp/probe_names.sql", "w") as f:
        f.write(SQL)
    sftp.close()
    cmd = (
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/probe_names.sql"
    )
    _i, o, e = ssh.exec_command(cmd, timeout=120)
    print(o.read().decode("utf-8", "replace").rstrip())
    err = e.read().decode("utf-8", "replace").rstrip()
    if err:
        print("[stderr]", err, file=sys.stderr)
    ssh.exec_command("rm -f /tmp/probe_names.sql")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
