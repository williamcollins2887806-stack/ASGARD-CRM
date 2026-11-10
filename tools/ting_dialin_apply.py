#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Включить Ting dial-in ТОЛЬКО с отдельным DID (не CRM inbound).

Usage (на машине с доступом к БД / после SSH):
  python tools/ting_dialin_apply.py --did 7499XXXXXXX --dry-run
  python tools/ting_dialin_apply.py --did 7499XXXXXXX

Запрещает основной Mango DID компании (74993223062) — он остаётся в CRM _X.
Asterisk-ветку нужно добавить вручную из ops/asterisk/ting_did_inbound.snippet
ДО вызова этого скрипта (или подтвердить --i-added-dialplan).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

CRM_MAIN_DID = "74993223062"
CRM_MAIN_VARIANTS = {
    "74993223062",
    "+74993223062",
    "84993223062",
    "+7 499 322-30-62",
    "7 499 322-30-62",
    "4993223062",
}


def normalize(did: str) -> str:
    return re.sub(r"\D+", "", did or "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--did", required=True, help="Ting-only DID digits, e.g. 7499...")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--i-added-dialplan",
        action="store_true",
        help="Confirm Asterisk exten for this DID → from-ting-dialin is live",
    )
    ap.add_argument("--dsn", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()

    raw = args.did.strip()
    digits = normalize(raw)
    if len(digits) < 10:
        print("FAIL: DID too short", file=sys.stderr)
        return 1
    if digits == CRM_MAIN_DID or raw in CRM_MAIN_VARIANTS:
        print(
            "FAIL: нельзя вешать Ting на основной CRM DID 74993223062 — "
            "весь inbound уйдёт в IVR. Нужен ОТДЕЛЬНЫЙ номер Mango.",
            file=sys.stderr,
        )
        return 1
    if not args.i_added_dialplan and not args.dry_run:
        print(
            "FAIL: сначала добавьте dialplan (ops/asterisk/ting_did_inbound.snippet), "
            "затем повторите с --i-added-dialplan",
            file=sys.stderr,
        )
        return 1

    display = raw if raw.startswith("+") else ("+" + digits if digits.startswith("7") else digits)
    print(f"Ting DID display={display!r} digits={digits}")
    if args.dry_run:
        print("dry-run OK — settings не писали")
        return 0

    sql = f"""
UPDATE settings SET value_json = 'true', updated_at = NOW() WHERE key = 'thing_dialin_enabled';
UPDATE settings SET value_json = {json.dumps(json.dumps(display))}, updated_at = NOW()
  WHERE key = 'thing_dialin_number';
SELECT key, value_json FROM settings WHERE key LIKE 'thing_dialin%';
"""
    env = os.environ.copy()
    if args.dsn:
        cmd = ["psql", args.dsn, "-v", "ON_ERROR_STOP=1", "-c", sql]
    else:
        env.setdefault("PGPASSWORD", env.get("PGPASSWORD", "123456789"))
        cmd = [
            "psql",
            "-U", env.get("PGUSER", "asgard"),
            "-d", env.get("PGDATABASE", "asgard_crm"),
            "-h", env.get("PGHOST", "127.0.0.1"),
            "-v", "ON_ERROR_STOP=1",
            "-c", sql,
        ]
    subprocess.check_call(cmd, env=env)
    print("OK settings updated. Verify: GET /api/thing/dial-in")
    print("Регресс: звонок на 74993223062 → CRM; звонок на Ting-DID → IVR код комнаты.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
