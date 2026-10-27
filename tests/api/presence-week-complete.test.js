'use strict';
/** D-330: полная неделя сохраняется, неполная — нет. */
const { Client } = require('pg');
const BASE = 'http://127.0.0.1:3100';

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

(async () => {
  const db = new Client({ database: 'asgard_crm_test', user: 'asgard', password: '123456789', host: '127.0.0.1' });
  await db.connect();
  await db.query(`
    DELETE FROM staff_plan sp USING staff s, users u
    WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
      AND sp.date >= date_trunc('week', CURRENT_DATE)::date
      AND sp.date <  date_trunc('week', CURRENT_DATE)::date + 7`);

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

  const w = await fetch(BASE + '/api/daily-presence/week', { headers: { Authorization: 'Bearer ' + token } });
  const wj = await w.json();
  const days = wj.days || [];
  console.log('дней в неделе: ' + days.length + ', required=' + wj.required + ', filled=' + wj.filled + '/' + wj.total);

  // 1. Неполная неделя — отклоняется
  const partial = days.slice(0, 1).map((d) => ({ date: d.date, status_code: 'оф' }));
  let r = await fetch(BASE + '/api/daily-presence/week', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ days: partial }),
  });
  let j = await r.json();
  console.log('неполная: ' + r.status + ' ' + JSON.stringify(j).slice(0, 130));
  check('неполная неделя отклонена (400)', r.status === 400, 'status=' + r.status);
  check('код week_incomplete', j.error === 'week_incomplete', 'error=' + j.error);
  check('перечислены недостающие дни', Array.isArray(j.missing) && j.missing.length === days.length - 1,
    'missing=' + (j.missing || []).length);

  const cnt1 = await db.query(`
    SELECT count(*)::int AS n FROM staff_plan sp
      JOIN staff s ON s.id = sp.staff_id JOIN users u ON u.id = s.user_id
     WHERE u.login='test_buh' AND sp.date >= date_trunc('week', CURRENT_DATE)::date
       AND sp.date < date_trunc('week', CURRENT_DATE)::date + 7`);
  check('в базу ничего не попало', cnt1.rows[0].n === 0, 'строк: ' + cnt1.rows[0].n);

  // 2. Полная неделя — сохраняется
  const full = days.map((d) => ({ date: d.date, status_code: 'оф' }));
  r = await fetch(BASE + '/api/daily-presence/week', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ days: full }),
  });
  j = await r.json();
  console.log('полная: ' + r.status + ' saved=' + j.saved);
  check('полная неделя сохранена', r.status === 200, 'status=' + r.status);
  check('сохранены все дни', j.saved === days.length, 'saved=' + j.saved + ' из ' + days.length);

  const cnt2 = await db.query(`
    SELECT count(*)::int AS n FROM staff_plan sp
      JOIN staff s ON s.id = sp.staff_id JOIN users u ON u.id = s.user_id
     WHERE u.login='test_buh' AND sp.date >= date_trunc('week', CURRENT_DATE)::date
       AND sp.date < date_trunc('week', CURRENT_DATE)::date + 7`);
  check('в базе все дни', cnt2.rows[0].n === days.length, 'строк: ' + cnt2.rows[0].n);

  // 3. После полной недели — больше не спрашиваем
  const w2 = await fetch(BASE + '/api/daily-presence/week', { headers: { Authorization: 'Bearer ' + token } });
  const wj2 = await w2.json();
  check('после полной недели required=false', wj2.required === false, 'required=' + wj2.required);

  await db.end();
  console.log('\nИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
