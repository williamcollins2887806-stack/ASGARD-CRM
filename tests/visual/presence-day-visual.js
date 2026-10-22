'use strict';
/**
 * Ежедневный гейт присутствия — проверка поведения и дизайна.
 *  1. Появляется при первом входе, если на сегодня нет отметки.
 *  2. Показывает статус из табеля и текст «в табеле стоит …».
 *  3. Сетка 2 колонки, кнопка СИНЯЯ в обеих темах.
 *  4. Сохранение пишет в staff_plan и ставит флаг дня.
 *  5. Повторно в тот же день не показывается.
 */
const { chromium } = require('playwright');
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '..', 'reports', 'presence-day');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

function isBlue(bg) {
  const m = String(bg).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return false;
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  return b > r + 25 && b > 100 && g < b;
}

(async () => {
  const db = new Client({ database: 'asgard_crm_test', user: 'asgard', password: '123456789', host: '127.0.0.1' });
  await db.connect();
  // Чистим сегодняшнюю отметку, чтобы гейт точно появился.
  await db.query(`
    DELETE FROM staff_plan sp USING staff s, users u
    WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
      AND sp.date = CURRENT_DATE`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console: ' + m.text()); });

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
    if (uu && uu.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(uu.permissions));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.indexOf('presence_done_') === 0 || k.indexOf('presence_week_done_') === 0)) localStorage.removeItem(k);
    }
  }, [token, u]);
  await page.goto(BASE + '/#/home', { waitUntil: 'commit' });
  await page.waitForTimeout(3000);

  // Порядок: сначала неделя, потом день. Для проверки дневного гейта
  // закрываем неделю — тест сфокусирован именно на дневном экране.
  await page.waitForSelector('#asgard-presence-week, #asgard-presence-day', { timeout: 25000 }).catch(() => {});
  const weekFirst = await page.$('#asgard-presence-week');
  check('сначала показывается неделя', !!weekFirst);
  if (weekFirst) {
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.pg-row[data-day-row]'));
      if (!rows.length) return;
      const trig = rows[0].querySelector('.pg-trigger');
      if (trig) trig.click();
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => { const o = document.querySelector('.pg-pop .pg-opt'); if (o) o.click(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const b = document.querySelector('.pg-btn'); if (b) b.click(); });
    await page.waitForTimeout(3500);
  }

  await page.waitForSelector('#asgard-presence-day', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Дневное окно появляется НЕ в день заполнения недели (D-326: сегодняшний
  // день уже отмечен). Для проверки дневного экрана эмулируем следующий день —
  // стареем updated_at в базе, ставим флаг недели, перезагружаем.
  if (!(await page.$('#asgard-presence-day'))) {
    const wkStart = await page.evaluate(async () => {
      const a = AsgardAuth.getAuth();
      const r = await fetch('/api/daily-presence/week', { headers: { Authorization: 'Bearer ' + a.token } });
      const j = await r.json();
      return j.week_start;
    });
    await db.query(`
      UPDATE staff_plan sp SET updated_at = NOW() - INTERVAL '1 day'
        FROM staff s, users u
       WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
         AND sp.date = CURRENT_DATE`);
    await page.evaluate((k) => localStorage.setItem(k, '1'), 'presence_week_done_' + wkStart);
    await page.reload({ waitUntil: 'commit' });
    await page.waitForSelector('#asgard-presence-day', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }

  // Дневной гейт должен появиться после недели
  const gate = await page.$('#asgard-presence-day');
  check('дневной гейт показан после недели', !!gate, 'нет #asgard-presence-day');

  if (!gate) {
    console.log('текст страницы: ' + (await page.evaluate(() => document.body.innerText || '')).slice(0, 200));
    await db.end(); await browser.close();
    console.log('ИТОГ: FAIL'); process.exit(1);
  }

  // 1. Сетка 2 колонки
  const cols = await page.$eval('.pd-opts', (el) => getComputedStyle(el).gridTemplateColumns);
  const colCount = cols.split(' ').length;
  check('сетка статусов в 2 колонки', colCount === 2, 'колонок: ' + colCount + ' (' + cols + ')');

  // 2. Плитки с иконками, выбранная с золотой обводкой
  const tiles = await page.$$eval('.pd-opt', (e) => e.length);
  const icons = await page.$$eval('.pd-opt .pd-oi svg', (e) => e.length);
  check('статусы-плитки отрисованы', tiles >= 6, 'плиток: ' + tiles);
  check('иконки вместо эмодзи', icons === tiles, `иконок ${icons} из ${tiles}`);
  const emoji = await page.evaluate(() => {
    const t = document.querySelector('#asgard-presence-day')?.innerText || '';
    return (t.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  });
  check('нет эмодзи', emoji === 0, 'найдено: ' + emoji);

  // Кликаем по плитке, которая ЕЩЁ НЕ выбрана, затем читаем ЛЮБУЮ выбранную.
  await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.pd-opt'));
    const target = tiles.find((t) => !t.classList.contains('sel'));
    if (target) target.click();
  });
  await page.waitForTimeout(500);

  const selState = await page.evaluate(() => {
    const el = document.querySelector('.pd-opt.sel');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { border: cs.borderTopColor, width: cs.borderTopWidth, color: cs.color, code: el.getAttribute('data-code') };
  });
  // Золото может прийти с альфой (rgba) — проверяем каналы, а не точную строку.
  const isGold = (() => {
    const m = String((selState && selState.border) || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return false;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    return r > 150 && r < 240 && g > 120 && g < 200 && b < 110;   // золотой диапазон
  })();
  check('выбранная плитка с акцентной обводкой', !!selState && parseFloat(selState.width) >= 1 && isGold,
    selState ? `border=${selState.border} width=${selState.width}` : 'нет .pd-opt.sel');
  // Возвращаем на «оф» — остальной сценарий проверяет сохранение этого статуса.
  await page.evaluate(() => {
    const b = document.querySelector('.pd-opt[data-code="оф"]');
    if (b) b.click();
  });
  await page.waitForTimeout(250);

  // 3. Кнопка синяя (тёмная тема)
  const btnDark = await page.$eval('.pd-btn', (el) => getComputedStyle(el).backgroundImage);
  check('кнопка СИНЯЯ в тёмной теме', isBlue(btnDark), btnDark.slice(0, 70));
  await page.screenshot({ path: path.join(OUT, '01-day-dark.png') });

  // 4. Светлая тема — кнопка тоже синяя
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(600);
  const btnLight = await page.$eval('.pd-btn', (el) => getComputedStyle(el).backgroundImage);
  check('кнопка СИНЯЯ в светлой теме', isBlue(btnLight), btnLight.slice(0, 70));
  await page.screenshot({ path: path.join(OUT, '02-day-light.png') });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  // 5. Текст сверки с табелем (если статус уже был)
  const hasQ = await page.evaluate(() => {
    const t = document.querySelector('.pd-q')?.innerText || '';
    return t.length > 10;
  });
  check('есть поясняющий вопрос', hasQ);

  // 6. Сохранение
  await page.evaluate(() => {
    const b = document.querySelector('.pd-opt[data-code="оф"]');
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  await page.click('#pdSave');
  await page.waitForFunction(() => !document.getElementById('asgard-presence-day'), null, { timeout: 12000 })
    .then(() => check('гейт закрылся после сохранения', true))
    .catch(() => check('гейт закрылся после сохранения', false, 'не закрылся'));

  await page.waitForTimeout(800);
  const rows = await db.query(`
    SELECT sp.status_code FROM staff_plan sp
      JOIN staff s ON s.id = sp.staff_id JOIN users u ON u.id = s.user_id
     WHERE u.login = 'test_buh' AND sp.date = CURRENT_DATE`);
  check('отметка записана в staff_plan', rows.rows.length === 1, 'строк: ' + rows.rows.length);
  check('статус верный', rows.rows[0] && rows.rows[0].status_code === 'оф',
    'получено: ' + (rows.rows[0] && rows.rows[0].status_code));

  const flag = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('presence_done_') === 0 && localStorage.getItem(k) === '1') return k;
    }
    return null;
  });
  check('флаг ДНЯ выставлен (не недели)', !!flag && !/week/.test(flag), String(flag));

  // 7. Повторно в тот же день не показывается
  await page.goto(BASE + '/#/home', { waitUntil: 'commit' });
  await page.waitForTimeout(5000);
  const again = await page.$('#asgard-presence-day');
  check('повторно в тот же день не показывается', !again);

  const errs = jsErrors.filter((e) => !/favicon|404|Failed to load|ERR_/i.test(e));
  check('0 JS-ошибок', errs.length === 0, errs.slice(0, 2).join(' | '));

  await db.end();
  await browser.close();
  console.log('\nСкриншоты: ' + OUT);
  console.log('ИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
