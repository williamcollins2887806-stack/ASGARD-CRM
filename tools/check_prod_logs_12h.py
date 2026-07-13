#!/usr/bin/env python3
"""Check production logs for errors in the last 12 hours."""
import re
import sys
from collections import Counter
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
SINCE = "12 hours ago"


def run(c, cmd, timeout=180):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace").strip()
    err = e.read().decode("utf-8", "replace").strip()
    return out, err


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    print(f"=== Логи asgard-crm за последние 12 часов ({HOST}) ===\n")

    # 1. systemd err priority
    out, _ = run(c, f'journalctl -u asgard-crm --since "{SINCE}" -p err --no-pager -n 100')
    print("--- journalctl ERR (приоритет error) ---")
    print(out or "(нет записей уровня err)")

    # 2. Full journal grep for app errors
    out, _ = run(c, f'journalctl -u asgard-crm --since "{SINCE}" --no-pager', timeout=300)
    lines = out.splitlines() if out else []

    status_codes = Counter()
    errors_4xx = Counter()
    errors_5xx = []
    app_errors = []
    director_lines = []
    unhandled = []

    for line in lines:
        m = re.search(r'"statusCode":(\d+)', line)
        if m:
            code = int(m.group(1))
            status_codes[code] += 1
            if 400 <= code < 500:
                # extract url
                url_m = re.search(r'"url":"([^"]+)"', line)
                url = url_m.group(1) if url_m else "?"
                errors_4xx[(code, url)] += 1
            if code >= 500:
                errors_5xx.append(line)

        low = line.lower()
        if any(x in low for x in ['"level":50', 'unhandled', 'uncaught', 'econnrefused', 'etimedout', 'stack']):
            if 'telephony/webhook' not in line:  # noisy but usually ok
                app_errors.append(line)
        if 'director-review' in low or 'director_review' in low or 'rp-review/tkp' in low:
            director_lines.append(line)
        if re.search(r'\b(error|exception)\b', low) and '"level":30' not in line:
            if 'statusCode":200' not in line and 'telephony/webhook' not in line:
                if len(unhandled) < 40:
                    unhandled.append(line)

    print("\n--- HTTP status codes (из логов node) ---")
    for code, cnt in sorted(status_codes.items(), key=lambda x: -x[1])[:25]:
        print(f"  {code}: {cnt}")

    print("\n--- 5xx ответы ---")
    if errors_5xx:
        for line in errors_5xx[-20:]:
            print(line[:500])
    else:
        print("  (нет 5xx)")

    print("\n--- Частые 4xx (код + URL, топ-15) ---")
    for (code, url), cnt in errors_4xx.most_common(15):
        print(f"  {code} x{cnt}: {url}")

    print("\n--- Ошибки приложения / stack (выборка) ---")
    shown = set()
    for line in (app_errors + unhandled)[:25]:
        key = line[:120]
        if key in shown:
            continue
        shown.add(key)
        print(line[:600])

    print("\n--- Director / rp-review (если есть) ---")
    if director_lines:
        for line in director_lines[-15:]:
            print(line[:500])
    else:
        print("  (нет обращений к director-review)")

    # nginx
    print("\n--- nginx access 5xx (если лог есть) ---")
    out, _ = run(c, 'grep -h "\\" 5" /var/log/nginx/access.log 2>/dev/null | tail -30')
    print(out or "(нет 5xx в nginx access или лог недоступен)")

    print("\n--- nginx error.log (последние 30 строк) ---")
    out, _ = run(c, "tail -30 /var/log/nginx/error.log 2>/dev/null")
    print(out or "(пусто)")

    # restart events
    print("\n--- Перезапуски сервиса за 12ч ---")
    out, _ = run(c, f'journalctl -u asgard-crm --since "{SINCE}" --no-pager | grep -iE "Started|Stopped|restart" | tail -10')
    print(out or "(нет)")

    c.close()
    print("\n=== Готово ===")


if __name__ == "__main__":
    main()
