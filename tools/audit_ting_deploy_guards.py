#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Список deploy_ting_*.py без ting_live_guard — новые обязаны иметь guard.

Exit 0 всегда (отчёт). Exit 2 если --strict и есть незащищённые скрипты
новее cutoff (по умолчанию только файлы с датой в имени >= 20_28_470).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--min-ver", default="20_28_470", help="Strict only for deploy_ting_* >= this")
    args = ap.parse_args()

    files = sorted(TOOLS.glob("deploy_ting_*.py"))
    missing = []
    ok = []
    for p in files:
        text = p.read_text(encoding="utf-8", errors="replace")
        if "ting_live_guard" in text:
            ok.append(p.name)
        else:
            missing.append(p.name)

    print(f"ting deploy scripts: {len(files)}")
    print(f"WITH live_guard: {len(ok)}")
    for n in ok:
        print(f"  OK  {n}")
    print(f"WITHOUT live_guard: {len(missing)}")
    for n in missing:
        print(f"  MISS {n}")

    if not args.strict:
        return 0

    def ver_key(name: str) -> str | None:
        m = re.search(r"20_28_(\d+)", name)
        return m.group(0) if m else None

    min_v = args.min_ver
    bad_new = []
    for n in missing:
        v = ver_key(n)
        if v and v >= min_v.replace("-", "_"):
            bad_new.append(n)
    if bad_new:
        print("STRICT FAIL — new deploy without guard:", ", ".join(bad_new), file=sys.stderr)
        return 2
    print("STRICT OK — no new unguarded deploy_ting_*")
    return 0


if __name__ == "__main__":
    sys.exit(main())
