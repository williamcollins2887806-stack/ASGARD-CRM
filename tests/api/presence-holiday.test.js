'use strict';
/** Проверка: праздник РФ по-прежнему НЕ спрашивается (регресс D-329). */
const { Client } = require('pg');

const BASE = 'http://127.0.0.1:3100';
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

(async () => {
  const db = new Client({ database: 'asgard_crm_test', user: 'asgard', password: '123456789', host: '127.0.0.1' });
  await db.connect();

  // Берём ближайший праздник РФ из производственного календаря
  const h = await db.query(`
    SELECT to_char(date,'YYYY-MM-DD') AS d, title
      FROM work_calendar
     WHERE kind = 'holiday' AND date >= CURRENT_DATE
     ORDER BY date LIMIT 1`);
  if (!h.rows.length) { console.log('SKIP: праздников в календаре нет'); await db.end(); return; }
  const holiday = h.rows[0];
  console.log('праздник: ' + holiday.d + ' — ' + holiday.title);

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

  // Спрашиваем /today на дату праздника через параметр date
  const r = await fetch(BASE + '/api/daily-presence/today?date=' + holiday.d, { headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json();
  console.log('/today на праздник: ' + JSON.stringify({ required: j.required, holiday: j.holiday, non_working: j.non_working }));

  check('на праздник РФ НЕ спрашиваем', j.required === false, 'required=' + j.required);
  check('праздник помечен', j.holiday === true || j.non_working === true,
    JSON.stringify({ holiday: j.holiday, non_working: j.non_working }));

  await db.end();
  console.log('\nИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
