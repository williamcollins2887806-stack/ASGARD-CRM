'use strict';
/**
 * Функциональная проверка мобильного гейта: заполняем неделю через
 * bottom-sheet и проверяем, что данные дошли до staff_plan.
 */
const { chromium, devices } = require('playwright');
const { Client } = require('pg');

const BASE = 'http://127.0.0.1:3100';
let pass = 0; let fail = 0;
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
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();

  const lg = await page.request.post(BASE + '/api/auth/login', { data: { login: 'test_buh', password: 'Test123!' } });
  const lj = await lg.json();
  const t0 = lj.token || (lj.data && lj.data.token);
  const u = lj.user || (lj.data && lj.data.user);
  const pr = await page.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t0 }, data: { pin: '0000' } });
  const pj = await pr.json();
  const token = pj.token || t0;

  await page.goto(BASE + '/m/', { waitUntil: 'commit' });
  await page.evaluate(([t, uu]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(uu));
    if (uu && uu.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(uu.permissions));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf('presence_week_done_') === 0) localStorage.removeItem(k);
    }
  }, [token, u]);
  await page.goto(BASE + '/m/', { waitUntil: 'commit' });
  await page.waitForSelector('.pgm-sheet', { timeout: 25000 });
  await page.waitForTimeout(800);

  // Заполняем 3 дня
  const codes = ['В офисе', 'Удалёнка', 'В офисе'];
  for (let i = 0; i < codes.length; i++) {
    await page.locator('.pgm-trig').nth(i).click();
    await page.waitForSelector('.pgm-pick-sheet', { timeout: 5000 });
    await page.locator('.pgm-pick-list .pgm-opt', { hasText: codes[i] }).first().click();
    await page.waitForTimeout(350);
  }
  const filled = await page.$$eval('.pgm-trig.has-value', (e) => e.length);
  check('3 статуса выбраны', filled === 3, 'заполнено: ' + filled);

  await page.locator('.pgm-btn').click();
  await page.waitForFunction(() => !document.querySelector('.pgm-sheet'), null, { timeout: 15000 })
    .then(() => check('гейт закрылся после сохранения', true))
    .catch(() => check('гейт закрылся после сохранения', false, 'лист остался'));

  await page.waitForTimeout(700);
  const after = await db.query(`
    SELECT to_char(sp.date,'YYYY-MM-DD') AS d, sp.status_code
    FROM staff_plan sp JOIN staff s ON s.id = sp.staff_id JOIN users u ON u.id = s.user_id
    WHERE u.login='test_buh' AND sp.date >= date_trunc('week', CURRENT_DATE)::date
      AND sp.date < date_trunc('week', CURRENT_DATE)::date + 7 ORDER BY sp.date`);
  check('в staff_plan записались 3 дня', after.rows.length === 3, 'строк: ' + after.rows.length + ' :: ' + JSON.stringify(after.rows));
  const got = after.rows.map((r) => r.status_code);
  check('коды верные', JSON.stringify(got) === JSON.stringify(['оф', 'уд', 'оф']), 'получено: ' + JSON.stringify(got));

  const flag = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('presence_week_done_') === 0 && localStorage.getItem(k) === '1') return k;
    }
    return null;
  });
  check('флаг недели выставлен', !!flag, String(flag));

  await db.end();
  await browser.close();
  console.log('\nИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
