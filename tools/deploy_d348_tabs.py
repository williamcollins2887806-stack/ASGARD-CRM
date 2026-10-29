#!/usr/bin/env python3
"""Деплой D-348: переключение вкладок «Анализ/Просчёты/Мои/Архив» грузило дважды.

Причина: обработчик вкладки в `pm_duty.js` одновременно ставил `location.hash`
и вызывал `refreshUI()`. Смена хэша → `hashchange` → `AsgardRouter.render()`,
то есть полный второй цикл (6 запросов + layout). Пользователь видел мигание
«страница как будто 2 раза грузится».

Правка: единственный источник правды — хэш (роутер рисует один раз); если хэш
уже такой — обновляем напрямую. Плюс счётчик поколений отрисовки, чтобы ответ
старой вкладки не перерисовывал новую.

Только фронт: бэкенд не менялся, restart не нужен (но сделаем — оболочка
кэшируется service worker'ом, и перезапуск безвреден).
"""
import hashlib
import io
import sys
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
SHELL_V = "20.28.327"

FILES = [
    "public/assets/js/pm_duty.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]


def md5b(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:140].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out:
        print(out if len(out) <= 12000 else out[-12000:])
    if err.strip():
        print("STDERR:", err[:2000])
    return out


def main():
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"MISSING LOCAL: {rel}")

    pm = (ROOT / "public/assets/js/pm_duty.js").read_text(encoding="utf-8")
    sw = (ROOT / "public/sw.js").read_text(encoding="utf-8")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")

    if f"SHELL_VERSION = '{SHELL_V}'" not in sw:
        raise SystemExit("LOCAL sw.js не на " + SHELL_V)
    if f"?v={SHELL_V}" not in idx:
        raise SystemExit("LOCAL index.html ?v= не на " + SHELL_V)

    # Правки D-348 обязаны быть на месте.
    if "if (location.hash === want) refreshUI();" not in pm:
        raise SystemExit("pm_duty.js: нет разведения хэша и refreshUI")
    if "location.hash = '#/pm-calculations?tab=' + next; refreshUI();" in pm:
        raise SystemExit("pm_duty.js: остался двойной вызов (хэш + refreshUI)")
    if "let renderSeq = 0;" not in pm:
        raise SystemExit("pm_duty.js: нет счётчика поколений")
    if "if (next === tab) return;" not in pm:
        raise SystemExit("pm_duty.js: нет защиты от повторного клика")
    for rel in FILES:
        if "\ufffd" in (ROOT / rel).read_text(encoding="utf-8"):
            raise SystemExit("U+FFFD в " + rel)
    print(f"preflight local: OK (shell {SHELL_V}, правки D-348 на месте)")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    snap = f"/root/snapshots/asgard-crm-pre-deploy-d348-tabs-{stamp}"
    print(f"\n### SNAPSHOT → {snap}")
    run(c, f"mkdir -p {snap} && " + " && ".join(
        f"(cp -a {PROJECT}/{rel} {snap}/{rel.replace('/', '__')}.bak 2>/dev/null || echo 'NO {rel}')"
        for rel in FILES
    ) + f" && ls -1 {snap} | wc -l")

    print("\n### PROD BEFORE")
    run(c,
        f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1; "
        f"grep -c 'if (next === tab) return;' {PROJECT}/public/assets/js/pm_duty.js || true")

    print("\n### UPLOAD")
    for rel in FILES:
        data = (ROOT / rel).read_bytes()
        sftp.put(str(ROOT / rel), f"{PROJECT}/{rel}")
        print(f"  ↑ {rel} md5={md5b(data)} size={len(data)}")

    print("\n### RESTART")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm")

    print("\n### POST-DEPLOY md5")
    bad = []
    for rel in FILES:
        local = md5b((ROOT / rel).read_bytes())
        try:
            remote = md5b(sftp.file(f"{PROJECT}/{rel}", "r").read())
        except IOError:
            bad.append(rel)
            print(f"  NOFILE {rel}")
            continue
        ok = local == remote
        if not ok:
            bad.append(rel)
        print(f"  {'OK    ' if ok else 'MISMATCH'} {rel} local={local} prod={remote}")

    print("\n### ПРОД ОТДАЁТ ИСПРАВЛЕННЫЙ ОБРАБОТЧИК")
    served = run(c,
                 "curl -s -H 'Cache-Control: no-cache' "
                 "'https://asgard-crm.ru/assets/js/pm_duty.js?d348=1' "
                 "| grep -c 'if (location.hash === want) refreshUI();' || true")

    run(c, "journalctl -u asgard-crm -n 6 --no-pager | tail -6")

    sftp.close()
    c.close()

    print("\n" + "=" * 60)
    print("исправленный обработчик на проде (строк):", served.strip())
    print("SNAPSHOT:", snap)
    print("BAD FILES:", bad if bad else "нет — все md5 совпали")
    if bad:
        raise SystemExit("ДЕПЛОЙ НЕПОЛНЫЙ: " + ", ".join(bad))
    if not served.strip() or int(served.strip()) < 1:
        raise SystemExit("ПРОД НЕ ОТДАЁТ ИСПРАВЛЕНИЕ — проверьте nginx/кэш")
    print("ИТОГ: OK — D-348 выкачен, версия " + SHELL_V)


if __name__ == "__main__":
    main()
