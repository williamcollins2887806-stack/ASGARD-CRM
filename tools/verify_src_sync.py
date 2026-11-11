#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pre-deploy гейт: серверный код и его импорты совпадают с продом.

ЗАЧЕМ (инцидент 11.11.2026). Выкатили ассеты, прод ушёл в 502 на ~5 минут:
`Cannot find module '../services/invoice-items-check'`. Файл был в git и
локально, но на прод не попал — `restore_asset_sync.py` везёт только
`public/`, а новый серверный модуль из чужого коммита остался дома.
Код, который его требует (`payment-invoices.js`, `payment-mail.js`), на
проде уже был, и приложение падало на старте.

Гейт делает три вещи:

  1. ЛОКАЛЬНО: каждый относительный `require('./x')` внутри `src/`
     резолвится в существующий файл. Ловит «забыл добавить модуль».
  2. ПРОД: ни один файл из `src/` не отсутствует на сервере. Ловит
     «файл есть в git, но не залит» — ровно сегодняшний случай.
  3. ПРОД: все относительные require разрешаются на сервере.

РЕАЛИЗАЦИЯ. Скрипт проверки — отдельный файл (`tools/_src_check_remote.sh`),
который заливается через scp и запускается. Всё остальное (heredoc внутри
`bash -s`, xargs с вложенным `sh -c`, awk с кавычками) на этом канале
ломается — проверено, поэтому так.

Запуск:
    python tools/verify_src_sync.py            # всё
    python tools/verify_src_sync.py --local    # только локальная (без ssh)

Выход: 0 — зелёный, 1 — красный.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
REMOTE = "/var/www/asgard-crm"
REMOTE_DIR = "/tmp/src-sync-check"

SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"

# require, который заведомо не файл на проде и НЕ роняет старт:
#   * ./* — условный, внутри try/catch;
#   * ../services/sse — SSE опционален;
#   * самоссылки — опечатки в путях, ветка не выполняется;
#   * tools/proxy-qa-fixtures — ленивый require ВНУТРИ обработчика ADMIN-роута
#     (src/routes/proxies.js:678), вызывается только по запросу, не при старте.
ALLOW_MISSING = {
    "./notify",
    "../services/sse",
    "./routes/telephony-pbx",
    "./services/NotificationService",
    "../../tools/proxy-qa-fixtures.js",
}

RE_REQUIRE = re.compile(r"""require\(\s*['"](\.[^'"]+)['"]\s*\)""")

# Скрипт-проверка. Читает список файлов из $1, работает от /var/www/asgard-crm.
REMOTE_SCRIPT = r"""#!/bin/sh
# Проверка синхронизации src с продом. Аргумент: файл со списком путей.
set -u
LIST="${1:-/tmp/src-sync-check/list.txt}"
cd /var/www/asgard-crm || { echo "REMOTE_FAIL cd"; exit 1; }
if [ ! -f "$LIST" ]; then echo "REMOTE_FAIL no list"; exit 1; fi

while IFS= read -r f; do
  [ -n "$f" ] || continue
  if [ ! -f "$f" ]; then
    echo "MISSING $f"
  fi
done < "$LIST"

while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || continue
  d=$(dirname "$f")
  grep -o 'require("[^"]*")' "$f" 2>/dev/null | tr -d '\r' > /tmp/src-sync-check/req.txt
  grep -o "require('[^']*')" "$f" 2>/dev/null | tr -d '\r' >> /tmp/src-sync-check/req.txt
  while IFS= read -r ln; do
    [ -n "$ln" ] || continue
    rel=$(printf '%s' "$ln" | sed "s/^require('//; s/^require(\"//; s/')$//; s/\")$//")
    case "$rel" in
      .*) ;;
      *) continue ;;
    esac
    b="$d/$rel"
    if [ ! -f "$b" ] && [ ! -f "$b.js" ] && [ ! -f "$b.json" ] && [ ! -f "$b/index.js" ]; then
      echo "UNRESOLVED $f -> $rel"
    fi
  done < /tmp/src-sync-check/req.txt
done < "$LIST"
echo "REMOTE_DONE"
"""


def local_check() -> list[str]:
    """Все относительные require внутри src резолвятся в файл."""
    problems: list[str] = []
    for path in SRC.rglob("*.js"):
        try:
            src = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for rel in RE_REQUIRE.findall(src):
            if rel in ALLOW_MISSING:
                continue
            base = (path.parent / rel).resolve()
            if not any(
                cand.exists()
                for cand in (
                    base,
                    Path(str(base) + ".js"),
                    Path(str(base) + ".json"),
                    base / "index.js",
                )
            ):
                problems.append(f"{path.relative_to(ROOT)} -> {rel}")
    return problems


def _run(args: list[str], timeout: int = 300, attempts: int = 5) -> subprocess.CompletedProcess:
    """ssh/scp с ретраями: канал часто рвётся на «banner exchange»."""
    last = None
    for i in range(attempts):
        last = subprocess.run(
            args, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout,
        )
        if last.returncode == 0:
            return last
        if i < attempts - 1:
            time.sleep(5 + i * 5)
    return last


def _ssh(cmd: str, timeout: int = 600, attempts: int = 5) -> subprocess.CompletedProcess:
    return _run(
        ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=25", "-o", "ServerAliveInterval=5", SSH_HOST, cmd],
        timeout=timeout, attempts=attempts,
    )


def _scp(local: str, remote: str, timeout: int = 300,
         attempts: int = 5) -> subprocess.CompletedProcess:
    return _run(
        ["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=25", local, f"{SSH_HOST}:{remote}"],
        timeout=timeout, attempts=attempts,
    )


def remote_report(local_files: list[str]) -> tuple[list[str], list[str], str]:
    """Залить список + скрипт, выполнить, разобрать вывод."""
    with tempfile.TemporaryDirectory() as tmp:
        script_path = Path(tmp) / "check.sh"
        script_path.write_text(REMOTE_SCRIPT, encoding="utf-8", newline="\n")

        list_path = Path(tmp) / "list.txt"
        list_path.write_text("\n".join(local_files) + "\n", encoding="utf-8", newline="\n")

        mk = _ssh(f"mkdir -p {REMOTE_DIR}")
        if mk.returncode != 0:
            return [], [], f"ssh: {(mk.stderr or '')[:200]}"

        for src, dst in ((str(script_path), f"{REMOTE_DIR}/check.sh"),
                         (str(list_path), f"{REMOTE_DIR}/list.txt")):
            res = _scp(src, dst)
            if res.returncode != 0:
                return [], [], f"scp: {(res.stderr or '')[:200]}"

        proc = _ssh(f"sh {REMOTE_DIR}/check.sh {REMOTE_DIR}/list.txt")
        if "REMOTE_DONE" not in (proc.stdout or ""):
            return [], [], f"скрипт не завершился: {(proc.stderr or proc.stdout or '')[:300]}"

    missing: list[str] = []
    unresolved: list[str] = []
    for line in proc.stdout.splitlines():
        if line.startswith("MISSING "):
            missing.append(line[len("MISSING "):])
        elif line.startswith("UNRESOLVED "):
            body = line[len("UNRESOLVED "):]
            if body.split(" -> ")[-1] in ALLOW_MISSING:
                continue
            unresolved.append(body)
    return missing, unresolved, ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true", help="только локальная проверка")
    args = ap.parse_args()

    failed = 0

    print("=== 1. Локальные require внутри src ===")
    local = local_check()
    if local:
        failed += 1
        print(f"  FAIL  не резолвится: {len(local)}")
        for item in local[:20]:
            print(f"        {item}")
    else:
        print("  PASS  все относительные require находят файл")

    if args.local:
        print("\nSRC_SYNC_" + ("FAIL" if failed else "OK"))
        return 1 if failed else 0

    local_files = sorted(
        str(p.relative_to(ROOT)).replace("\\", "/") for p in SRC.rglob("*.js")
    )
    print(f"\n=== 2. Файлы src и их require на проде ({len(local_files)}) ===")
    try:
        missing, unresolved, err = remote_report(local_files)
    except subprocess.TimeoutExpired:
        print("  FAIL  ssh timeout — прод не ответил")
        print("\nSRC_SYNC_FAIL")
        return 1

    if err:
        print(f"  FAIL  {err}")
        print("\nSRC_SYNC_FAIL")
        return 1

    if missing:
        failed += 1
        print(f"  FAIL  отсутствуют на проде: {len(missing)}")
        for item in missing[:30]:
            print(f"        {item}")
        print("        КАК ЧИНИТЬ: python tools/deploy_src_sync.py — залить ДО рестарта,")
        print("        иначе приложение упадёт на старте с Cannot find module.")
    else:
        print("  PASS  все файлы src есть на проде")

    if unresolved:
        failed += 1
        print(f"  FAIL  require не разрешается на проде: {len(unresolved)}")
        for item in unresolved[:20]:
            print(f"        {item}")
    else:
        print("  PASS  все относительные require разрешаются на сервере")

    print("\nSRC_SYNC_" + ("FAIL" if failed else "OK"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
