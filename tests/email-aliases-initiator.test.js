/**
 * V410: алиасы почт (почта → сотрудник) и их влияние на инициатора счёта.
 * Заказчик 19.10.2026: счета шлют десятки сотрудников с разных (в т.ч. личных) почт.
 */
const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { resolveSenderUserId } = require('../src/services/doc-email-intake');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  const db = { query: (t, p) => pool.query(t, p) };

  console.log('=== Таблица алиасов заполнена ===');
  const cnt = (await db.query(`SELECT count(*)::int AS n FROM user_email_aliases`)).rows[0].n;
  ok(cnt >= 20, 'алиасов в таблице: ' + cnt);

  console.log('\n=== Алиас pd@ (Путков) — раньше не резолвился ===');
  const putkov = (await db.query(`SELECT id FROM users WHERE lower(email)='d.putkov@asgard-service.com'`)).rows[0];
  const r1 = await resolveSenderUserId(db, { from_email: 'pd@asgard-service.com' });
  ok(r1 === putkov.id, 'pd@ → Путков #' + r1 + ' (ждали ' + putkov.id + ')');

  console.log('\n=== Личная почта Андросова — раньше не резолвилась ===');
  const androsov = (await db.query(`SELECT id FROM users WHERE lower(login)='n.androsov'`)).rows[0];
  const r2 = await resolveSenderUserId(db, { from_email: 'andr0sov.nikita@yandex.ru' });
  ok(r2 === androsov.id, 'andr0sov.nikita@yandex.ru → #' + r2 + ' (ждали ' + androsov.id + ')');

  console.log('\n=== Обычные адреса (через users.email) не сломаны ===');
  for (const [mail, login] of [['bv@asgard-service.com', 'bv'], ['hv@asgard-service.com', 'hv'], ['g.gazretov@asgard-service.com', 'g.gazretov']]) {
    const u = (await db.query(`SELECT id FROM users WHERE lower(login)=$1`, [login])).rows[0];
    const r = await resolveSenderUserId(db, { from_email: mail });
    ok(r === u.id, mail + ' → #' + r + ' (ждали ' + u.id + ')');
  }

  console.log('\n=== Несколько почт на ОДИН аккаунт (Пираев = АГПЗ) ===');
  const agpz = (await db.query(`SELECT id FROM users WHERE lower(login)='agpz'`)).rows[0];
  const r4 = await resolveSenderUserId(db, { from_email: 's.piraev@asgard-service.com' });
  ok(r4 === agpz.id, 's.piraev@ и agpz@ → ОДИН аккаунт АГПЗ #' + r4 + ' (ждали ' + agpz.id + ')');

  console.log('\n=== Совсем неизвестная почта → офис-менеджер ===');
  const office = (await db.query(`SELECT id FROM users WHERE role='OFFICE_MANAGER' AND is_active IS NOT FALSE ORDER BY id LIMIT 1`)).rows[0];
  const r4b = await resolveSenderUserId(db, { from_email: 'unknown-person-xyz@nowhere-abcd.com' });
  ok(r4b === office.id, 'неизвестная почта → офис-менеджер #' + r4b);

  console.log('\n=== Алиас с user_id=NULL не перекрывает корректный поиск ===');
  await db.query(`INSERT INTO user_email_aliases(email, user_id, source, label) VALUES('nobody@nowhere.test', NULL, 'manual', 'проверка')
                  ON CONFLICT (lower(email)) DO NOTHING`).catch(() => {});
  const r5 = await resolveSenderUserId(db, { from_email: 'nobody@nowhere.test' });
  ok(r5 === office.id || r5 === null, 'алиас без user_id → фолбэк (' + r5 + ')');
  await db.query(`DELETE FROM user_email_aliases WHERE email='nobody@nowhere.test'`).catch(() => {});

  await pool.end();
  console.log('\nИТОГ алиасов: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message, e.stack); process.exit(1); });
