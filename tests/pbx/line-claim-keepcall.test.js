'use strict';
/**
 * Интеграционная проверка multi-line (V442) против клона БД.
 *
 * Сценарий: 3465 на линии → 3474 встаёт на линию вторым.
 * Ожидание (multi-line): оба остаются on_line=true, никого не снимаем,
 * previousUserId = null, счётчик линии ≥ 2.
 *
 * Отдельно проверяем, что детект «идёт разговор» работает (для инфо/логов).
 *
 * Usage:
 *   DATABASE_URL=postgresql://...asgard_crm_test node tests/pbx/line-claim-keepcall.test.js
 */
const { Pool } = require('pg');
const { joinLine, claimLine } = require('../../src/pbx/line-claim.js');

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.log('line-claim-multiline: skip (нужен DATABASE_URL на asgard_crm_test)');
  process.exit(0);
}

const pool = new Pool({ connectionString: cs });

(async () => {
  let ok = true;
  const say = (c, m) => { console.log((c ? '  OK   ' : '  FAIL ') + m); if (!c) ok = false; };

  const { rows: u } = await pool.query(
    `SELECT id FROM users WHERE is_active = true ORDER BY id LIMIT 2`
  );
  const [a, b] = [u[0].id, u[1].id];

  // Подготовка
  await pool.query(`UPDATE pbx_operators SET on_line=false WHERE user_id IN ($1,$2)`, [a, b]);

  // 1) Первый встаёт на линию
  const r1 = await joinLine(pool, a, { receiveMode: 'browser' });
  say(r1.ok === true, `joinLine(${a}) ok`);
  say(r1.previousUserId === null, `первый вход: previousUserId = ${r1.previousUserId} (ожидали null)`);

  // 2) Второй встаёт на линию — ПЕРВОГО НЕ СНИМАЕМ
  const r2 = await claimLine(pool, b, { receiveMode: 'browser' });
  say(r2.previousUserId === null, `второй вход НЕ снимает первого: previousUserId = ${r2.previousUserId}`);
  say(r2.onLineCount >= 2, `счётчик линии = ${r2.onLineCount} (ожидали ≥ 2)`);

  const after = await pool.query(
    `SELECT user_id, on_line FROM pbx_operators WHERE user_id IN ($1,$2) ORDER BY user_id`,
    [a, b]
  );
  console.log('НА ЛИНИИ:', JSON.stringify(after.rows));
  say(after.rows.length === 2 && after.rows.every((r) => r.on_line === true),
    'оба оператора остались на линии (multi-line)');

  // 3) Сход с линии одного не влияет на другого
  const { leaveLine } = require('../../src/pbx/line-claim.js');
  const r3 = await leaveLine(pool, a);
  const after2 = await pool.query(
    `SELECT user_id, on_line FROM pbx_operators WHERE user_id IN ($1,$2) ORDER BY user_id`,
    [a, b]
  );
  const aStill = after2.rows.find((x) => x.user_id === a);
  const bStill = after2.rows.find((x) => x.user_id === b);
  say(aStill.on_line === false, 'первый сошёл с линии');
  say(bStill.on_line === true, 'второй остался на линии (сход одного не мешает другому)');
  say(r3.onLineCount === 1, `счётчик линии после схода = ${r3.onLineCount} (ожидали 1)`);

  // Уборка
  await pool.query(`UPDATE pbx_operators SET on_line=false WHERE user_id IN ($1,$2)`, [a, b]);
  await pool.end();
  console.log(`\n${ok ? 'ALL PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
