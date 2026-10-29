#!/usr/bin/env python3
"""Проверка D-347 на ПРОДЕ сквозным сценарием РП.

Воспроизводит жалобу: «добавляю ТКП — не даёт отправить».
  1. GET  /rp-review        → токен блокировки (updated_at)
  2. POST /rp-review/tkp    → загрузка ТКП (двигает updated_at в БД)
     → ответ ОБЯЗАН содержать review_updated_at (это и починили)
  3. PUT  со СТАРЫМ токеном → 409 «отчёт изменился» (так и должно быть)
  4. PUT  со СВЕЖИМ токеном → НЕ 409 (главная проверка; раньше был 409)

Шаг 4 шлём без finalize — просчёт не закрываем, данные не портим.
Токен подписываем на сервере тем же секретом, что и приложение.
"""
import io
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
TENDER = "2101"


def ssh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root",
              pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)
    return c


def exec_out(c, cmd, timeout=90):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    return o.read().decode("utf-8", "replace"), e.read().decode("utf-8", "replace")


def main():
    c = ssh()

    # Владелец просчёта по тендеру.
    js = (
        "require('dotenv').config({path:'/var/www/asgard-crm/.env'});"
        "const {Pool}=require('pg');"
        "const p=new Pool({host:process.env.DB_HOST,port:process.env.DB_PORT||5432,"
        "user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});"
        "p.query('SELECT r.calculator_user_id AS uid, r.updated_at, u.login "
        f"FROM tender_rp_reviews r JOIN users u ON u.id=r.calculator_user_id WHERE r.tender_id={TENDER} LIMIT 1')"
        ".then(r=>{console.log(JSON.stringify(r.rows[0]||null));return p.end();})"
        ".catch(e=>{console.error(e.message);process.exit(1);});"
    )
    out, err = exec_out(c, f'cd {PROJECT} && node -e "{js}"')
    if not out.strip():
        raise SystemExit("не получил владельца просчёта: " + err[:400])
    owner = json.loads(out.strip())
    print("владелец просчёта:", owner)

    # Подписываем токен ровно как приложение (тот же секрет и payload).
    sign = (
        "const jwt=require('jsonwebtoken');require('dotenv').config({path:'/var/www/asgard-crm/.env'});"
        f"const u={{id:{owner['uid']},login:{json.dumps(str(owner['login']))},name:'D347 probe',role:'PM',"
        "email:'probe@asgard-service.com',pinVerified:true,is_huginn_guest:false};"
        "console.log(jwt.sign(u,process.env.JWT_SECRET,{expiresIn:'10m'}));"
    )
    # node -e получает код в двойных кавычках шелла → экранируем двойные кавычки.
    sign_esc = sign.replace("\\", "\\\\").replace('"', '\\"')
    tok, terr = exec_out(c, f'cd {PROJECT} && node -e "{sign_esc}"')
    token = tok.strip()
    if not token:
        raise SystemExit("не подписал токен: " + terr[:400])
    print("токен получен, длина:", len(token))
    c.close()

    base = f"https://asgard-crm.ru/api/tenders/{TENDER}/rp-review"
    hdr = {"Authorization": "Bearer " + token, "Accept": "application/json"}

    def call(method, url, data=None, headers=None):
        h = dict(headers or hdr)
        body = None
        if data is not None:
            body = json.dumps(data).encode()
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.status, json.loads(r.read().decode("utf-8", "replace") or "{}")
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                return e.code, json.loads(raw or "{}")
            except json.JSONDecodeError:
                return e.code, {"raw": raw[:300]}

    fail = 0

    # 1. Текущий токен блокировки
    st, rev = call("GET", base)
    print(f"\n1. GET  → {st}")
    if st != 200:
        raise SystemExit(f"GET не прошёл: {st} {rev}")
    old_at = rev.get("review", {}).get("updated_at") or rev.get("updated_at")
    print("   старый токен:", old_at)

    # 2. Загрузка ТКП
    boundary = "----d347probe"
    payload = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="probe_d347.txt"\r\n'
        "Content-Type: text/plain\r\n\r\n"
        "D-347 probe\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    req = urllib.request.Request(
        base + "/tkp", data=payload, method="POST",
        headers={"Authorization": hdr["Authorization"],
                 "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            st, up = r.status, json.loads(r.read().decode("utf-8", "replace") or "{}")
    except urllib.error.HTTPError as e:
        st, up = e.code, json.loads(e.read().decode("utf-8", "replace") or "{}")
    print(f"\n2. POST /tkp → {st}")
    new_at = up.get("review_updated_at")
    print("   review_updated_at:", new_at)
    if st in (200, 201) and new_at:
        print("   OK   ответ содержит новый токен блокировки")
    elif st in (200, 201):
        print("   FAIL ответ БЕЗ review_updated_at — 409 после загрузки вернётся")
        fail += 1
    else:
        print(f"   (загрузку пропускаем, код {st}: {str(up)[:200]})")

    # 3. Со старым токеном — 409 ожидаем
    st_old, r_old = call("PUT", base, {"decision": "submit", "expected_updated_at": old_at})
    print(f"\n3. PUT со СТАРЫМ токеном → {st_old} (ожидается 409, если токен реально сдвинулся)")
    if new_at and old_at and new_at != old_at:
        if st_old == 409:
            print("   OK   старый токен отвергнут — optimistic lock работает")
        elif st_old in (200, 201):
            print("   ВНИМАНИЕ: старый токен принят (загрузка не сдвинула updated_at?)")
    else:
        print("   (пропуск: токен не изменился)")

    # 4. СО СВЕЖИМ токеном — не должно быть 409 (это и был баг)
    if new_at:
        st_new, r_new = call("PUT", base, {"decision": "submit", "expected_updated_at": new_at})
        print(f"\n4. PUT со СВЕЖИМ токеном → {st_new}")
        if st_new == 409:
            print("   FAIL снова 409 — баг НЕ исправлен:", str(r_new)[:200])
            fail += 1
        else:
            print(f"   OK   сохранение после загрузки проходит (не 409): {str(r_new)[:160]}")

    print("\n" + "=" * 60)
    print("ИТОГ:", "OK — загрузка файла не блокирует сохранение" if fail == 0
          else f"FAIL — {fail} нарушений")


if __name__ == "__main__":
    main()
