#!/usr/bin/env python3
"""Logs since last manual check (~Jul 10 15:00 MSK) + HR 403 tracking."""
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
# Последняя проверка логов + деплой HR-fix ~10.07.2026 15:00 MSK
SINCE = "2026-07-10 15:00:00"


def run(c, cmd, timeout=300):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    return o.read().decode("utf-8", "replace").strip()


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    print(f"=== Логи asgard-crm с {SINCE} ({HOST}) ===\n")

    raw = run(c, f'journalctl -u asgard-crm --since "{SINCE}" --no-pager', timeout=300)
    lines = raw.splitlines() if raw else []

    pending = {}
    status_codes = Counter()
    fourxx = Counter()
    fivexx_lines = []
    hr403 = []
    bg_errors = defaultdict(list)

    BG_PATTERNS = [
        ("IMAP timeout", re.compile(r"IMAP.*(?:timeout|ETIMEDOUT|ECONNRESET|Failed to establish)|imap.*error", re.I)),
        ("FolderSorter ETIMEDOUT", re.compile(r"FolderSorter|ETIMEDOUT.*mail", re.I)),
        ("LogMonitor buffer", re.compile(r"LogMonitor|maxBuffer length exceeded", re.I)),
        ("SSE/upstream closed", re.compile(r"upstream prematurely closed|events/stream", re.I)),
    ]

    for line in lines:
        rid_m = re.search(r'"reqId":"([^"]+)"', line)
        if rid_m:
            rid = rid_m.group(1)
            if "incoming request" in line:
                url_m = re.search(r'"url":"([^"]+)"', line)
                meth_m = re.search(r'"method":"([^"]+)"', line)
                pending[rid] = (
                    meth_m.group(1) if meth_m else "?",
                    url_m.group(1) if url_m else "?",
                    line,
                )
            if '"statusCode":' in line and rid in pending:
                code_m = re.search(r'"statusCode":(\d+)', line)
                if code_m:
                    code = int(code_m.group(1))
                    status_codes[code] += 1
                    meth, url, _ = pending[rid]
                    if 400 <= code < 500:
                        fourxx[(code, meth, url)] += 1
                        if code == 403 and (
                            "employee_assignments" in url or "employee_reviews" in url
                        ):
                            hr403.append((line[:19], meth, url))
                    if code >= 500:
                        fivexx_lines.append((code, meth, url, line[:200]))

        low = line.lower()
        if '"level":50' in line or '"level":40' in line:
            for name, pat in BG_PATTERNS:
                if pat.search(line):
                    if len(bg_errors[name]) < 5:
                        bg_errors[name].append(line[:250])

        for name, pat in BG_PATTERNS:
            if pat.search(line) and name not in ("SSE/upstream closed",):
                if len(bg_errors[name]) < 8 and line not in bg_errors[name]:
                    bg_errors[name].append(line[:250])

    err_journal = run(
        c, f'journalctl -u asgard-crm --since "{SINCE}" -p err --no-pager -n 50'
    )
    nginx_err = run(c, "grep -E 'error|crit|alert' /var/log/nginx/error.log 2>/dev/null | tail -40")
    nginx_5xx = run(
        c,
        f'journalctl -u asgard-crm --since "{SINCE}" --no-pager | grep -c upstream || true',
    )
    restarts = run(
        c,
        f'journalctl -u asgard-crm --since "{SINCE}" --no-pager | grep -iE "Started ASGARD|Stopped ASGARD|Failed with result|Main process exited" | tail -15',
    )

    print("--- HTTP status (топ) ---")
    for code, cnt in status_codes.most_common(12):
        print(f"  {code}: {cnt}")

    print(f"\n--- 5xx: {len(fivexx_lines)} ---")
    for item in fivexx_lines[:15]:
        print(" ", item)
    if not fivexx_lines:
        print("  (нет)")

    print("\n--- 4xx (топ-25) ---")
    for (code, meth, url), cnt in fourxx.most_common(25):
        print(f"  {code} {meth} x{cnt}: {url}")

    print(f"\n--- HR 403 (employee_assignments/reviews): {len(hr403)} ---")
    for row in hr403[:10]:
        print(" ", row)
    if not hr403:
        print("  (нет — фикс сработал)")

    print("\n--- journalctl ERR ---")
    print(err_journal or "(нет)")

    print("\n--- Фоновые ошибки ---")
    for name, samples in bg_errors.items():
        print(f"  [{name}] x{len(samples)} sample(s)")
        for s in samples[:3]:
            print(f"    {s}")

    print("\n--- Перезапуски сервиса ---")
    print(restarts or "(нет)")

    print("\n--- nginx error.log (хвост) ---")
    print(nginx_err or "(пусто)")

    c.close()
    print("\n=== Готово ===")


if __name__ == "__main__":
    main()
