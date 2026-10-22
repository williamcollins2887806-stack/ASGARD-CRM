'use strict';
/**
 * D-327: ситуация заказчика — неделя проставлена в понедельник,
 * на сегодня запись есть, но updated_at вчера.
 * Ожидание: /today → required: true (спрашиваем), current = статус из графика.
 */
const { Client } = require('pg');

const BASE = 'http://127.0.0.1:3100';
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

(async () => {
  const db = new Client({ database: 'asgard_crm_test', user: 'asgard', password: '123456789', host: '127.0.0.1' });
  await db.connect();

  // Готовим как у заказчика: сегодня запись «бн» с updated_at ВЧЕРА.
  await db.query(`
    DELETE FROM staff_plan sp USING staff s, users u
    WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
      AND sp.date = CURRENT_DATE`);
  await db.query(`
    INSERT INTO staff_plan (staff_id, date, status_code, note, created_at, updated_at)
    SELECT s.id, CURRENT_DATE, 'бн', 'из недельного графика',
           NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day'
      FROM staff s JOIN users u ON u.id = s.user_id WHERE u.login = 'test_buh'`);

  const before = await db.query(`
    SELECT sp.status_code, sp.updated_at::date = CURRENT_DATE AS touched_today
      FROM staff_plan sp JOIN staff s ON s.id = sp.staff_id JOIN users u ON u.id = s.user_id
     WHERE u.login = 'test_buh' AND sp.date = CURRENT_DATE`);
  console.log('подготовлено: ' + JSON.stringify(before.rows[0]));

  // Логин и запрос /today
  const lg = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_buh', password: 'Test123!' }),
  });
  const lj = await lg.json();
  const t0 = lj.token || (lj.data && lj.data.token);
  const pr = await fetch(BASE + '/api/auth/verify-pin', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t0 },
    body: JSON.stringify({ pin: '0000' }),
  });
  const pj = await pr.json();
  const token = pj.token || t0;

  let r = await fetch(BASE + '/api/daily-presence/today', { headers: { Authorization: 'Bearer ' + token } });
  let j = await r.json();
  console.log('\n/today (отметка из понедельника):');
  console.log('  required=' + j.required + '  current=' + JSON.stringify(j.current));
  check('спрашиваем, хотя запись есть (updated_at вчера)', j.required === true, 'required=' + j.required);
  check('показываем текущий статус из графика', !!(j.current && j.current.status_code === 'бн'),
    JSON.stringify(j.current));

  // Теперь подтверждаем — POST обновляет updated_at на сегодня
  const post = await fetch(BASE + '/api/daily-presence', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ status_code: 'бн', work_id: null }),
  });
  check('подтверждение сохраняется', post.status === 200, 'status=' + post.status);

  const after = await db.query(`
    SELECT sp.status_code, sp.updated_at::date = CURRENT_DATE AS touched_today
      FROM staff_plan sp JOIN staff s ON s.id = sp.staff_id JOIN users u ON u.id = s.user_id
     WHERE u.login = 'test_buh' AND sp.date = CURRENT_DATE`);
  console.log('после подтверждения: ' + JSON.stringify(after.rows[0]));
  check('updated_at стал сегодняшним', after.rows[0] && after.rows[0].touched_today === true,
    JSON.stringify(after.rows[0]));

  r = await fetch(BASE + '/api/daily-presence/today', { headers: { Authorization: 'Bearer ' + token } });
  j = await r.json();
  check('после подтверждения больше не спрашиваем', j.required === false, 'required=' + j.required);

  await db.end();
  console.log('\nИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
