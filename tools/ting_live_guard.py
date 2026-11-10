#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Не рестартить asgard-crm, пока есть live-комнаты Тинга.

LiveKit SFU живёт отдельно; рестарт Node роняет /api/thing/.../token, SSE и
auth → клиенты уходят с 502 mid-call.

Usage:
  python tools/ting_live_guard.py
  python tools/ting_live_guard.py --dsn 'postgresql://asgard:...@127.0.0.1/asgard_crm'
  python tools/ting_live_guard.py --ssh   # readonly count на проде через deploy-key

Exit:
  0 — live=0, рестарт можно
  1 — live>0 или ошибка БД (блок рестарта)
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

SQL = "SELECT count(*)::int AS n FROM thing_rooms WHERE status = 'live';"
SSH_HOST = os.environ.get("TING_GUARD_SSH_HOST", "92.242.61.184")
SSH_USER = os.environ.get("TING_GUARD_SSH_USER", "root")
SSH_KEY = os.environ.get(
    "TING_GUARD_SSH_KEY",
    str(Path.home() / ".ssh" / "asgard_crm_deploy"),
)


def _count_via_psql(dsn: str | None) -> int:
    env = os.environ.copy()
    if dsn:
        cmd = ["psql", dsn, "-At", "-c", SQL]
    else:
        env.setdefault("PGPASSWORD", os.environ.get("PGPASSWORD", "123456789"))
        cmd = [
            "psql",
            "-U", env.get("PGUSER", "asgard"),
            "-d", env.get("PGDATABASE", "asgard_crm"),
            "-h", env.get("PGHOST", "127.0.0.1"),
            "-At",
            "-c", SQL,
        ]
    out = subprocess.check_output(cmd, env=env, stderr=subprocess.STDOUT, text=True)
    line = (out or "").strip().splitlines()[-1] if (out or "").strip() else "0"
    return int(line)


def _count_via_ssh() -> int:
    remote = (
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -At -c "
        "\"SELECT count(*)::int FROM thing_rooms WHERE status='live';\""
    )
    cmd = [
        "ssh",
        "-i", SSH_KEY,
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        f"{SSH_USER}@{SSH_HOST}",
        remote,
    ]
    out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True)
    line = (out or "").strip().splitlines()[-1] if (out or "").strip() else "0"
    return int(line)


def check(dsn: str | None = None, ssh: bool = False) -> int:
    """0 = restart OK, 1 = block. Безопасно звать из deploy-скриптов."""
    try:
        if ssh:
            n = _count_via_ssh()
        else:
            n = _count_via_psql(dsn if dsn is not None else os.environ.get("DATABASE_URL") or None)
    except Exception as e:
        print(f"[ting_live_guard] FAIL: cannot query live rooms: {e}", file=sys.stderr)
        return 1
    if n > 0:
        print(
            f"[ting_live_guard] BLOCK: {n} live Ting room(s). "
            "Можно заливать файлы, но НЕ systemctl restart asgard-crm.",
            file=sys.stderr,
        )
        return 1
    print("[ting_live_guard] OK: 0 live rooms — restart allowed")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Block CRM restart while Ting rooms are live")
    ap.add_argument("--dsn", default=os.environ.get("DATABASE_URL") or None)
    ap.add_argument(
        "--ssh",
        action="store_true",
        help="Count live rooms on prod via SSH (deploy key)",
    )
    args = ap.parse_args(argv)
    return check(args.dsn, ssh=bool(args.ssh))


if __name__ == "__main__":
    sys.exit(main())
