#!/usr/bin/env python3
"""Деплой D-347: загрузка файла ломала отправку + врал тост + file chooser.

Три дефекта (29.10.2026, жалобы РП):
  1. После загрузки ТКП/сметы/отчёта сохранение падало 409 «Отчёт изменился у
     другого пользователя», потому что загрузка двигает `updated_at`, а фронт
     оставался со старым токеном.
  2. Тост при финализации ВСЕГДА писал «Просчёт ушёл директору», хотя без
     галочки отчёт идёт сразу в ТО.
  3. Клик по ссылке «Просмотр/Скачать» внутри зоны загрузки открывал выбор
     файла и падал: «File chooser dialog can only be shown with a user activation».

Файлы: фронт + бэкенд (pm-duty.js) → нужен restart. Оболочка → bump версии.
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
SHELL_V = "20.28.326"

FILES = [
    "public/assets/js/rp_calc_modal.js",
    "src/routes/pm-duty.js",
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
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"MISSING LOCAL: {rel}")

    front = (ROOT / "public/assets/js/rp_calc_modal.js").read_text(encoding="utf-8")
    back = (ROOT / "src/routes/pm-duty.js").read_text(encoding="utf-8")
    sw = (ROOT / "public/sw.js").read_text(encoding="utf-8")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")

    if f"SHELL_VERSION = '{SHELL_V}'" not in sw:
        raise SystemExit("LOCAL sw.js не на " + SHELL_V)
    if f"?v={SHELL_V}" not in idx:
        raise SystemExit("LOCAL index.html ?v= не на " + SHELL_V)

    # Все три правки обязаны быть на месте.
    if "state.review.updated_at = d.review_updated_at" not in front:
        raise SystemExit("фронт: нет обновления токена после загрузки")
    if "if (isFileLink(e.target)) return;" not in front:
        raise SystemExit("фронт: нет защиты от file chooser по ссылкам")
    if "ушёл в ТО (согласование не требуется)" not in front:
        raise SystemExit("фронт: тост всё ещё врёт про директора")
    for field in ("estimate_file_id", "report_file_id", "tkp_file_id"):
        if f"SET {field} = $1, updated_at = NOW() WHERE id = $2 RETURNING updated_at" not in back:
            raise SystemExit(f"бэкенд: нет RETURNING updated_at для {field}")
    for rel in FILES:
        if "\ufffd" in (ROOT / rel).read_text(encoding="utf-8"):
            raise SystemExit("U+FFFD в " + rel)
    print(f"preflight local: OK (shell {SHELL_V}, три правки на месте)")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    snap = f"/root/snapshots/asgard-crm-pre-deploy-d347-upload-lock-{stamp}"
    print(f"\n### SNAPSHOT → {snap}")
    run(c, f"mkdir -p {snap} && " + " && ".join(
        f"(cp -a {PROJECT}/{rel} {snap}/{rel.replace('/', '__')}.bak 2>/dev/null || echo 'NO {rel}')"
        for rel in FILES
    ) + f" && ls -1 {snap} | wc -l")

    print("\n### PROD BEFORE")
    run(c,
        f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1; "
        f"grep -c 'RETURNING updated_at' {PROJECT}/src/routes/pm-duty.js || true; "
        f"systemctl is-active asgard-crm")

    print("\n### UPLOAD")
    for rel in FILES:
        data = (ROOT / rel).read_bytes()
        sftp.put(str(ROOT / rel), f"{PROJECT}/{rel}")
        print(f"  ↑ {rel} md5={md5b(data)} size={len(data)}")

    print("\n### RESTART (бэкенд изменён)")
    run(c, "systemctl restart asgard-crm && sleep 5 && systemctl is-active asgard-crm")

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

    print("\n### ПРОД ОТДАЁТ (curl мимо кэша)")
    served = run(c,
                 "curl -s -H 'Cache-Control: no-cache' "
                 "'https://asgard-crm.ru/assets/js/rp_calc_modal.js?d347=1' "
                 "| grep -c 'isFileLink' || true")
    run(c,
        f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1; "
        f"grep -c 'RETURNING updated_at' {PROJECT}/src/routes/pm-duty.js || true")

    run(c, "journalctl -u asgard-crm -n 8 --no-pager | tail -8")

    sftp.close()
    c.close()

    print("\n" + "=" * 60)
    print("isFileLink на проде:", served.strip())
    print("SNAPSHOT:", snap)
    print("BAD FILES:", bad if bad else "нет — все md5 совпали")
    if bad:
        raise SystemExit("ДЕПЛОЙ НЕПОЛНЫЙ: " + ", ".join(bad))
    print("ИТОГ: OK — D-347 выкачен, версия " + SHELL_V)


if __name__ == "__main__":
    main()
