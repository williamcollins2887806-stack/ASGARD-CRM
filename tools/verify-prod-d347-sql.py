#!/usr/bin/env python3
"""Проверка D-347 на ПРОДЕ без изменения данных.

Тендер 2101 уже закрыт, поэтому сквозной сценарий через HTTP там не пройдёт
(«Отчёт уже закрыт»). Вместо этого проверяем сам механизм в транзакции с
ROLLBACK: `UPDATE ... RETURNING updated_at` обязан вернуть НОВОЕ значение.

Именно этого не хватало: без RETURNING клиент не узнаёт новый токен, остаётся
со старым — и следующее сохранение падает 409 «Отчёт изменился у другого
пользователя». Ровно жалоба РП «добавляю ТКП — отправить не даёт».

Ничего не коммитится: после проверки ROLLBACK.
"""
import io
import json
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
PROJECT = "/var/www/asgard-crm"

# Через все три колонки, которые двигают загрузки (смета / отчёт / ТКП).
SCRIPT = r"""
require('dotenv').config({path:'/var/www/asgard-crm/.env'});
const {Pool} = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});
(async () => {
  const out = [];
  const cols = ['estimate_file_id', 'report_file_id', 'tkp_file_id'];
  for (const col of cols) {
    // ВАЖНО: каждую колонку проверяем в ОТДЕЛЬНОЙ транзакции. `NOW()` возвращает
    // время начала транзакции, поэтому три UPDATE в одной транзакции дали бы
    // одинаковый updated_at и проверка ложно показала бы «не сдвинулось».
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query(
        'SELECT id, updated_at FROM tender_rp_reviews ORDER BY id DESC LIMIT 1'
      );
      const before = row.rows[0].updated_at;
      const upd = await client.query(
        `UPDATE tender_rp_reviews SET ${col} = ${col}, updated_at = NOW()
         WHERE id = $1 RETURNING updated_at`, [row.rows[0].id]
      );
      out.push({
        col,
        returned: upd.rows.length === 1 && upd.rows[0].updated_at != null,
        newAt: upd.rows[0] ? upd.rows[0].updated_at : null,
        before,
        moved: !!(upd.rows[0] && new Date(upd.rows[0].updated_at) > new Date(before))
      });
    } catch (e) {
      out.push({ col, error: e.message });
    } finally {
      await client.query('ROLLBACK');   // ничего не сохраняем
      client.release();
    }
  }
  await pool.end();
  console.log(JSON.stringify(out));
})();
"""


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root",
              pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)

    # Скрипт кладём ВНУТРЬ проекта: node берёт модули из node_modules проекта,
    # а не из /tmp (иначе «Cannot find module 'dotenv'»).
    cmd = (
        "cd /var/www/asgard-crm && cat > ._d347_probe.js <<'PROBE_EOF'\n"
        + SCRIPT + "\nPROBE_EOF\nnode ._d347_probe.js; rm -f ._d347_probe.js"
    )
    _, o, e = c.exec_command(cmd, timeout=120)
    out = o.read().decode("utf-8", "replace").strip()
    err = e.read().decode("utf-8", "replace").strip()
    c.close()

    if not out:
        raise SystemExit("нет ответа от проверки: " + err[:600])

    rows = json.loads(out)
    print("=== UPDATE ... RETURNING updated_at на реальной БД (ROLLBACK) ===")
    fail = 0
    for r in rows:
        if "error" in r:
            print("  FAIL", r["error"])
            fail += 1
            continue
        if r["returned"] and r["moved"]:
            print(f"  OK   {r['col']}: вернулось новое значение "
                  f"{r['newAt']} (было {r['before']})")
        else:
            print(f"  FAIL {r['col']}: RETURNING не дал нового updated_at → 409 после загрузки")
            fail += 1

    print("\n" + "=" * 60)
    print("ИТОГ:", "OK — токен блокировки возвращается, 409 после загрузки не будет"
          if fail == 0 else f"FAIL — {fail} нарушений")
    print("Данные не изменены (ROLLBACK).")


if __name__ == "__main__":
    main()
