#!/usr/bin/env python3
"""Деплой D-346: кнопка «Отправить просчёт» падала с ReferenceError.

Симптом на проде: `rp_calc_modal.js?v=20.28.324 Uncaught ReferenceError:
state is not defined at wantApproval`. Правка в локальном репозитории была,
но до сервера не доехала — прод отдавал сломанную функцию без параметра.

Что делает:
  * preflight: в локальных файлах есть фикс и версия, нет U+FFFD;
  * snapshot затронутых файлов на сервере ДО заливки;
  * заливка 5 файлов (модуль + оболочка: index.html, sw.js, h/*);
  * restart asgard-crm;
  * post-deploy: md5 local == prod, и главное — HTTP-проверка,
    что прод отдаёт `function wantApproval(state)`, а не сломанную форму.
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
SHELL_V = "20.28.325"

FILES = [
    "public/assets/js/rp_calc_modal.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]


def md5b(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:150].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out:
        print(out if len(out) <= 15000 else out[-15000:])
    if err.strip():
        print("STDERR:", err[:3000])
    return out


def main():
    # ---- preflight local ----
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"MISSING LOCAL: {rel}")

    sw = (ROOT / "public/sw.js").read_text(encoding="utf-8")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    mod = (ROOT / "public/assets/js/rp_calc_modal.js").read_text(encoding="utf-8")

    if f"SHELL_VERSION = '{SHELL_V}'" not in sw:
        raise SystemExit("LOCAL sw.js не на " + SHELL_V)
    if f"ASGARD_SHELL_VERSION = '{SHELL_V}'" not in idx:
        raise SystemExit("LOCAL index.html не на " + SHELL_V)
    if f"?v={SHELL_V}" not in idx:
        raise SystemExit("LOCAL index.html ?v= не на " + SHELL_V)
    # Главная проверка: в файле именно ИСПРАВЛЕННАЯ функция.
    if "function wantApproval(state)" not in mod:
        raise SystemExit("LOCAL rp_calc_modal.js без фикса wantApproval(state)")
    if "function wantApproval()" in mod:
        raise SystemExit("LOCAL rp_calc_modal.js всё ещё содержит сломанную форму wantApproval()")
    if "return wantApproval(state);" not in mod:
        raise SystemExit("LOCAL approvalWanted() не передаёт state")
    for rel in FILES:
        if "\ufffd" in (ROOT / rel).read_text(encoding="utf-8"):
            raise SystemExit("U+FFFD в " + rel)
    print(f"preflight local: OK (shell {SHELL_V}, фикс на месте)")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    # ---- snapshot ДО ----
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    snap = f"/root/snapshots/asgard-crm-pre-deploy-d346-wantapproval-{stamp}"
    print(f"\n### SNAPSHOT → {snap}")
    run(c, f"mkdir -p {snap} && " + " && ".join(
        f"(cp -a {PROJECT}/{rel} {snap}/{rel.replace('/', '__')}.bak 2>/dev/null || echo 'NO {rel}')"
        for rel in FILES
    ) + f" && ls -1 {snap} | wc -l")

    print("\n### PROD BEFORE")
    run(c,
         f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1; "
         f"grep -n 'function wantApproval' {PROJECT}/public/assets/js/rp_calc_modal.js; "
         f"systemctl is-active asgard-crm")

    # ---- upload ----
    print("\n### UPLOAD")
    for rel in FILES:
        data = (ROOT / rel).read_bytes()
        sftp.put(str(ROOT / rel), f"{PROJECT}/{rel}")
        print(f"  ↑ {rel} md5={md5b(data)} size={len(data)}")

    # ---- restart ----
    print("\n### RESTART")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm")

    # ---- post-deploy ----
    print("\n### POST-DEPLOY md5 (local vs prod)")
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

    print("\n### ПРОД ОТДАЁТ (curl через nginx, мимо кэша) ###")
    served = run(c,
                 "curl -s -H 'Cache-Control: no-cache' "
                 "'https://asgard-crm.ru/assets/js/rp_calc_modal.js?deploycheck=1' "
                 "| grep -o 'function wantApproval([^)]*)' | head -1")
    print("\n### ВЕРСИЯ ОБОЛОЧКИ НА ПРОДЕ")
    run(c,
        f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1; "
        f"grep -oP \"ASGARD_SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/index.html | head -1; "
        f"curl -s -H 'Cache-Control: no-cache' https://asgard-crm.ru/ "
        f"| grep -oP \"ASGARD_SHELL_VERSION = '\\K[^']+\" | head -1")

    run(c, "journalctl -u asgard-crm -n 10 --no-pager | tail -10")

    sftp.close()
    c.close()

    fixed_served = "wantApproval(state)" in served
    print("\n" + "=" * 60)
    print("ПРОД ОТДАЁТ:", served.strip() or "(не найдено)")
    print("SNAPSHOT:", snap)
    print("BAD FILES:", bad if bad else "нет — все md5 совпали")
    if bad:
        raise SystemExit("ДЕПЛОЙ НЕПОЛНЫЙ: " + ", ".join(bad))
    if not fixed_served:
        raise SystemExit("ПРОД ВСЁ ЕЩЁ ОТДАЁТ СЛОМАННУЮ ФУНКЦИЮ — проверьте nginx/кэш")
    print("ИТОГ: OK — на проде исправленная wantApproval(state), версия " + SHELL_V)


if __name__ == "__main__":
    main()
