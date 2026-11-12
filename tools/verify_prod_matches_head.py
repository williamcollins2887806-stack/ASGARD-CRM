#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сверка: содержимое задеплоенных файлов == коммит HEAD (побайтово, по md5).

Нужна перед записью `.last-verified`: гейт допускает деплой только при
HEAD == .last-verified, а .last-verified обязан указывать на РЕАЛЬНО
проверенный коммит. Поэтому сравниваем то, что лежит на проде, с блобами
HEAD — не с рабочей копией (в ней могут быть чужие правки).
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

ROOT = Path(__file__).resolve().parents[1]
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"

PATHS = [
    "src/services/asgard-smeta.js",
    "public/assets/js/asgard_smeta.js",
    "src/services/excel-structure.js",
    "src/services/mimir-tender-stages.js",
    "src/services/mimir-tender-stages-ai.js",
    "src/services/visit-plan-reconcile.js",
    "src/routes/tkp_quick.js",
    "src/routes/pm-duty.js",
    "public/assets/js/rp_review_modal.js",
    "public/assets/js/rp_calc_modal.js",
    "public/assets/js/mimir_stages_ui.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]


def head_bytes(rel: str) -> bytes | None:
    p = subprocess.run(["git", "show", "HEAD:" + rel], cwd=str(ROOT),
                       capture_output=True)
    if p.returncode != 0:
        return None
    return p.stdout


def norm(b: bytes) -> bytes:
    """Приводит переводы строк к LF: git может отдавать LF, прод — CRLF."""
    return b.replace(b"\r\n", b"\n")


def md5_norm(b: bytes) -> str:
    return hashlib.md5(norm(b)).hexdigest()


def main() -> None:
    # ОДИН ssh: на проде считаем md5 от содержимого с вырезанными CR.
    # Так EOL не влияет, а сетевые обрывы не дают ложных «пустых» хешей.
    remote_cmd = ("cd " + PROJECT + " && for f in " + " ".join(PATHS)
                  + "; do printf '%s  ' \"$f\"; tr -d '\\r' < \"$f\" | md5sum | cut -d' ' -f1; done")
    p = subprocess.run(
        ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=30", SSH_HOST, remote_cmd],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        print("FAIL ssh:", p.stderr[-500:])
        raise SystemExit(1)

    prod = {}
    for line in p.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            prod[parts[0]] = parts[1]

    bad = []
    for rel in PATHS:
        want = head_bytes(rel)
        if want is None:
            print(f"  SKIP {rel} — нет в HEAD")
            continue
        want_md5 = md5_norm(want)
        got = prod.get(rel)
        ok = want_md5 == got
        print(("  OK   " if ok else "  FAIL ") + rel + f"  head={want_md5} prod={got}")
        if not ok:
            bad.append(rel)

    print()
    if bad:
        print(f"ИТОГ: FAIL — {len(bad)} файл(ов) на проде НЕ равны HEAD")
        for b in bad:
            print("  ", b)
        raise SystemExit(1)
    print(f"ИТОГ: OK — {len(PATHS)} файлов на проде равны HEAD (содержимое, EOL не в счёт)")


if __name__ == "__main__":
    main()
