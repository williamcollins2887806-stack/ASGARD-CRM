'use strict';
/**
 * D-330: можно ли закрыть недельный гейт, отметив НЕ ВСЕ дни?
 * Ожидание по ТЗ: нет — пока не отмечены все рабочие дни, работать нельзя.
 */
const { chromium } = require('playwright');
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

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const lg = await page.request.post(BASE + '/api/auth/login', { data: { login: 'test_buh', password: 'Test123!' } });
  const lj = await lg.json();
  const t0 = lj.token || (lj.data && lj.data.token);
  const u = lj.user || (lj.data && lj.data.user);
  const pr = await page.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t0 }, data: { pin: '0000' } });
  const pj = await pr.json();
  const token = pj.token || t0;

  await page.goto(BASE + '/', { waitUntil: 'commit' });
  await page.evaluate(([t, uu]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(uu));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.indexOf('presence_done_') === 0 || k.indexOf('presence_week_done_') === 0)) localStorage.removeItem(k);
    }
  }, [token, u]);
  await page.goto(BASE + '/#/home', { waitUntil: 'commit' });
  await page.waitForSelector('#asgard-presence-week', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const weekShown = await page.$('#asgard-presence-week');
  check('недельное окно показано', !!weekShown);
  if (!weekShown) { await db.end(); await browser.close(); process.exit(0); }

  const total = await page.$$eval('.pg-row[data-day-row]', (e) => e.length);
  console.log('рабочих дней в неделе: ' + total);

  // Отмечаем ТОЛЬКО ОДИН день
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.pg-row[data-day-row]'));
    if (rows[0]) { const t = rows[0].querySelector('.pg-trigger'); if (t) t.click(); }
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const o = document.querySelector('.pg-pop .pg-opt'); if (o) o.click(); });
  await page.waitForTimeout(500);

  const filledNow = await page.$$eval('.pg-select.has-value', (e) => e.length);
  console.log('отмечено дней: ' + filledNow + ' из ' + total);

  // Пытаемся сохранить
  await page.evaluate(() => { const b = document.querySelector('.pg-btn'); if (b) b.click(); });
  await page.waitForTimeout(4000);

  const after = await page.evaluate(() => ({
    weekStillOpen: !!document.getElementById('asgard-presence-week'),
    errText: (document.querySelector('.pg-err') || {}).innerText || '',
    weekFlag: localStorage.getItem('presence_week_done_2026-10-26') || localStorage.getItem('presence_week_done_2026-10-19'),
  }));
  console.log('после сохранения: ' + JSON.stringify(after));

  // Ожидание: окно ОСТАЁТСЯ открытым, флаг НЕ ставится
  check('НЕЛЬЗЯ сохранить с неполной неделей (окно остаётся)', after.weekStillOpen === true,
    'weekStillOpen=' + after.weekStillOpen);
  check('показана ошибка о неполных днях', !!after.errText, JSON.stringify(after.errText));
  check('флаг недели НЕ выставлен', !after.weekFlag, 'flag=' + after.weekFlag);

  // Проверяем в базе — частичное сохранение не должно записаться
  const rows = await db.query(`
    SELECT count(*)::int AS n FROM staff_plan sp
      JOIN staff s ON s.id = sp.staff_id JOIN users u ON u.id = s.user_id
     WHERE u.login = 'test_buh'
       AND sp.date >= date_trunc('week', CURRENT_DATE)::date
       AND sp.date <  date_trunc('week', CURRENT_DATE)::date + 7`);
  check('в базе ничего не записалось', rows.rows[0].n === 0, 'строк: ' + rows.rows[0].n);

  await db.end();
  await browser.close();
  console.log('\nИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
