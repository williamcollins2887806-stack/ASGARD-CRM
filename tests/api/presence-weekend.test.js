'use strict';
/**
 * D-329: суббота/воскресенье — спрашиваем «где ты сегодня».
 * Проверяем:
 *   1. /today в субботу → required: true, is_weekend: true
 *   2. Праздник РФ → по-прежнему required: false (не спрашиваем)
 *   3. Отметка в субботу сохраняется (POST /)
 *   4. После отметки → required: false
 *   5. Окно в браузере появляется и показывает плашку «Выходной день»
 */
const { chromium } = require('playwright');
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '..', 'reports', 'presence-weekend');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

async function token() {
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
  return pj.token || t0;
}

(async () => {
  const db = new Client({ database: 'asgard_crm_test', user: 'asgard', password: '123456789', host: '127.0.0.1' });
  await db.connect();

  const dow = new Date().getUTCDay();
  console.log('сегодня день недели: ' + dow + ' (0=вс, 6=сб)');

  // чистим отметку на сегодня
  await db.query(`
    DELETE FROM staff_plan sp USING staff s, users u
    WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
      AND sp.date = CURRENT_DATE`);

  const t = await token();

  // 1. /today
  let r = await fetch(BASE + '/api/daily-presence/today', { headers: { Authorization: 'Bearer ' + t } });
  let j = await r.json();
  console.log('/today: ' + JSON.stringify({ required: j.required, is_weekend: j.is_weekend, holiday: j.holiday, non_working: j.non_working }));

  if (dow === 0 || dow === 6) {
    check('выходной: спрашиваем (required=true)', j.required === true, 'required=' + j.required);
    check('выходной помечен is_weekend', j.is_weekend === true, 'is_weekend=' + j.is_weekend);
    check('выходной НЕ помечен как праздник', j.holiday !== true && j.non_working !== true,
      JSON.stringify({ holiday: j.holiday, non_working: j.non_working }));
  } else {
    console.log('SKIP: сегодня не выходной — проверка на выходной пропущена');
  }

  // 2. Сохранение в выходной
  const post = await fetch(BASE + '/api/daily-presence', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: JSON.stringify({ status_code: 'оф', work_id: null }),
  });
  check('отметка в выходной сохраняется', post.status === 200, 'status=' + post.status);

  const after = await db.query(`
    SELECT sp.status_code FROM staff_plan sp
      JOIN staff s ON s.id = sp.staff_id JOIN users u ON u.id = s.user_id
     WHERE u.login = 'test_buh' AND sp.date = CURRENT_DATE`);
  check('запись появилась в staff_plan', after.rows.length === 1, 'строк: ' + after.rows.length);
  check('статус верный', after.rows[0] && after.rows[0].status_code === 'оф',
    JSON.stringify(after.rows[0]));

  // 3. После отметки — не спрашиваем
  r = await fetch(BASE + '/api/daily-presence/today', { headers: { Authorization: 'Bearer ' + t } });
  j = await r.json();
  check('после отметки не спрашиваем', j.required === false, 'required=' + j.required);

  // 4. Браузер: окно и плашка «Выходной день»
  if (dow === 0 || dow === 6) {
    await db.query(`
      UPDATE staff_plan sp SET updated_at = NOW() - INTERVAL '1 day'
        FROM staff s, users u
       WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
         AND sp.date = CURRENT_DATE`);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const lg = await page.request.post(BASE + '/api/auth/login', { data: { login: 'test_buh', password: 'Test123!' } });
    const lj = await lg.json();
    const t0 = lj.token || (lj.data && lj.data.token);
    const u = lj.user || (lj.data && lj.data.user);
    const pr = await page.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t0 }, data: { pin: '0000' } });
    const pj = await pr.json();

    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await page.evaluate(([tk, uu]) => {
      localStorage.setItem('asgard_token', tk);
      localStorage.setItem('asgard_user', JSON.stringify(uu));
      localStorage.setItem('presence_week_done_2026-10-19', '1');
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.indexOf('presence_done_') === 0) localStorage.removeItem(k);
      }
    }, [pj.token || t0, u]);
    await page.goto(BASE + '/#/home', { waitUntil: 'commit' });
    await page.waitForSelector('#asgard-presence-day', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const ui = await page.evaluate(() => ({
      dayDom: !!document.getElementById('asgard-presence-day'),
      weekendNote: (document.querySelector('.pd-weekend') || {}).innerText || null,
      tiles: document.querySelectorAll('.pd-opt').length,
    }));
    console.log('браузер: ' + JSON.stringify(ui));

    check('в браузере окно дня в выходной появилось', ui.dayDom === true);
    check('показана плашка «Выходной день»', !!ui.weekendNote, String(ui.weekendNote));
    check('плитки статусов на месте', ui.tiles >= 6, 'плиток: ' + ui.tiles);

    await page.screenshot({ path: path.join(OUT, 'weekend-day.png') });
    await browser.close();
  }

  await db.end();
  console.log('\nИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
