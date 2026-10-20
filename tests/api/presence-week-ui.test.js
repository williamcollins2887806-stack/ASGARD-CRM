'use strict';
/**
 * Функциональная проверка нового экрана: заполнение недели через кастомные
 * селекты реально сохраняет staff_plan и закрывает гейт.
 */
const { chromium } = require('playwright');
const { Client } = require('pg');

const BASE = 'http://127.0.0.1:3100';
let pass = 0; let fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

(async () => {
  // Чистим отметки офисного сотрудника на клоне, чтобы гейт точно показался.
  const db = new Client({ database: 'asgard_crm_test', user: 'asgard', password: '123456789', host: '127.0.0.1' });
  await db.connect();
  await db.query(`
    DELETE FROM staff_plan sp
    USING staff s, users u
    WHERE sp.staff_id = s.id AND s.user_id = u.id
      AND u.login = 'test_buh'
      AND sp.date >= date_trunc('week', CURRENT_DATE)::date
      AND sp.date <  date_trunc('week', CURRENT_DATE)::date + 7
  `);
  const before = await db.query(`
    SELECT count(*)::int AS n FROM staff_plan sp
    JOIN staff s ON s.id = sp.staff_id JOIN users u ON u.id = s.user_id
    WHERE u.login='test_buh' AND sp.date >= date_trunc('week', CURRENT_DATE)::date
      AND sp.date < date_trunc('week', CURRENT_DATE)::date + 7
  `);
  check('стартовое состояние: неделя пуста', before.rows[0].n === 0, 'строк: ' + before.rows[0].n);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const lg = await page.request.post(BASE + '/api/auth/login', { data: { login: 'test_buh', password: 'Test123!' } });
  const lj = await lg.json();
  const t0 = lj.token || (lj.data && lj.data.token);
  const user = lj.user || (lj.data && lj.data.user);
  const pr = await page.request.post(BASE + '/api/auth/verify-pin', {
    headers: { Authorization: 'Bearer ' + t0 }, data: { pin: '0000' },
  });
  const pj = await pr.json();
  const token = pj.token || t0;

  await page.goto(BASE + '/', { waitUntil: 'commit' });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf('presence_week_done_') === 0) localStorage.removeItem(k);
    }
  }, [token, user]);
  await page.goto(BASE + '/', { waitUntil: 'commit' });
  await page.waitForFunction(() => !!(window.AsgardPresenceWeek && window.AsgardPresenceWeek.mount), null, { timeout: 15000 });

  await page.evaluate(() => {
    document.querySelectorAll('.pg-scene').forEach((e) => e.remove());
    AsgardPresenceWeek.mount({ auth: AsgardAuth.getAuth() });
  });
  await page.waitForSelector('.pg-card', { timeout: 8000 });

  // Заполняем 3 дня: «В офисе», «Удалёнка», «В офисе».
  // Handles перезапрашиваем каждый раз — триггеры перерисовываются после выбора.
  const codes = ['оф', 'уд', 'оф'];
  for (let i = 0; i < codes.length; i++) {
    const trig = page.locator('.pg-select .pg-trigger').nth(i);
    await trig.click();
    await page.waitForSelector('.pg-pop', { timeout: 4000 });
    const label = codes[i] === 'оф' ? 'В офисе' : 'Удалёнка';
    await page.locator('.pg-pop .pg-opt', { hasText: label }).first().click();
    await page.waitForTimeout(260);
  }

  const filled = await page.$$eval('.pg-select.has-value', (els) => els.length);
  check('3 статуса выбраны в UI', filled === 3, 'заполнено: ' + filled);

  // Сохраняем
  await page.click('#pgSave');
  await page.waitForFunction(() => !document.getElementById('asgard-presence-week'), null, { timeout: 12000 })
    .then(() => check('гейт закрылся после сохранения', true))
    .catch(() => check('гейт закрылся после сохранения', false, 'сцена осталась'));

  await page.waitForTimeout(600);

  const after = await db.query(`
    SELECT to_char(sp.date,'YYYY-MM-DD') AS d, sp.status_code
    FROM staff_plan sp JOIN staff s ON s.id = sp.staff_id JOIN users u ON u.id = s.user_id
    WHERE u.login='test_buh' AND sp.date >= date_trunc('week', CURRENT_DATE)::date
      AND sp.date < date_trunc('week', CURRENT_DATE)::date + 7
    ORDER BY sp.date
  `);
  check('в staff_plan записались 3 дня', after.rows.length === 3, 'строк: ' + after.rows.length + ' :: ' + JSON.stringify(after.rows));
  const got = after.rows.map((r) => r.status_code);
  check('коды статусов верные', JSON.stringify(got) === JSON.stringify(codes), 'получено: ' + JSON.stringify(got));

  // Флаг недели выставлен → повторный вход гейт не показывает
  const flag = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('presence_week_done_') === 0 && localStorage.getItem(k) === '1') return k;
    }
    return null;
  });
  check('флаг недели выставлен (гейт не повторится)', !!flag, String(flag));

  const remount = await page.evaluate(async () => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      // НЕ удаляем флаг — проверяем именно поведение «уже заполнено»
    }
    const r = await AsgardPresenceWeek.mount({ auth: AsgardAuth.getAuth() });
    return { res: r, scene: document.querySelectorAll('.pg-scene').length };
  });
  check('повторно экран не показывается', remount.res === false && remount.scene === 0,
    'res=' + remount.res + ' scene=' + remount.scene);

  await db.end();
  await browser.close();
  console.log('\nИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
