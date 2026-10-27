'use strict';
/**
 * Визуальная проверка премиального экрана недельного присутствия.
 * Снимает: Nordic Night, Soldag Light, открытую панель выбора, узкий экран.
 * Плюс проверяет, что эмодзи и нативные <select> на экране отсутствуют.
 *
 * Запуск: node tests/visual/presence-week-visual.js   (нужен :3100)
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '..', 'reports', 'presence-week');
fs.mkdirSync(OUT, { recursive: true });

const USER = process.env.PW_USER || 'test_buh';
const PASS = process.env.PW_PASS || 'Test123!';

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); }
};

(async () => {
  // D-330: чистим неделю, иначе гейт не покажется (она уже заполнена прошлым тестом).
  const { Client } = require('pg');
  const db = new Client({ database: 'asgard_crm_test', user: 'asgard', password: '123456789', host: '127.0.0.1' });
  await db.connect();
  await db.query(`
    DELETE FROM staff_plan sp USING staff s, users u
    WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
      AND sp.date >= date_trunc('week', CURRENT_DATE)::date
      AND sp.date <  date_trunc('week', CURRENT_DATE)::date + 7`);
  await db.end();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console: ' + m.text()); });

  // Полная авторизация как в проде: логин → подтверждение PIN → рабочий токен.
  // Без verify-pin роуты присутствия отдают 403 «Требуется подтверждение PIN».
  const login = await page.request.post(BASE + '/api/auth/login', { data: { login: USER, password: PASS } });
  check('логин API 200', login.status() === 200, 'status=' + login.status());
  const lj = await login.json().catch(() => ({}));
  const firstToken = lj.token || (lj.data && lj.data.token);
  const user = lj.user || (lj.data && lj.data.user);
  check('токен получен', !!firstToken);
  if (!firstToken) { await browser.close(); process.exit(1); }

  const pinResp = await page.request.post(BASE + '/api/auth/verify-pin', {
    headers: { Authorization: 'Bearer ' + firstToken },
    data: { pin: '0000' },
  });
  const pj = await pinResp.json().catch(() => ({}));
  const token = pj.token || firstToken;
  check('PIN подтверждён', pinResp.status() === 200, 'status=' + pinResp.status());

  await page.goto(BASE + '/', { waitUntil: 'commit' });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u));
    if (u && u.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(u.permissions));
    localStorage.removeItem('presence_week_done_' + new Date().toISOString().slice(0, 10));
    // чистим все флаги недели, чтобы гейт точно показался
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf('presence_week_done_') === 0) localStorage.removeItem(k);
    }
  }, [token, user]);
  await page.goto(BASE + '/', { waitUntil: 'commit' });
  await page.waitForTimeout(1800);
  // Компонент подключается через defer — дождёмся его, а не полагаемся на таймаут.
  await page.waitForFunction(() => !!(window.AsgardPresenceWeek && window.AsgardPresenceWeek.mount), null, { timeout: 15000 })
    .catch(() => {});
  const hasComp = await page.evaluate(() => !!(window.AsgardPresenceWeek && window.AsgardPresenceWeek.mount));
  check('компонент presence_week.js загружен', hasComp);
  if (!hasComp) { await browser.close(); process.exit(1); }

  // ── /week должен отдавать данные офисной роли ─────────────────────────────
  const wk = await page.evaluate(async () => {
    const a = window.AsgardAuth && AsgardAuth.getAuth && AsgardAuth.getAuth();
    if (!a) return { status: 0, body: null };
    const r = await fetch('/api/daily-presence/week', { headers: { Authorization: 'Bearer ' + a.token } });
    return { status: r.status, body: await r.json().catch(() => null) };
  });
  check('/week отвечает 200', wk.status === 200, 'status=' + wk.status);
  check('/week отдаёт week_start', !!(wk.body && wk.body.week_start), JSON.stringify(wk.body && wk.body.week_start));
  check('/week отдаёт дни недели', !!(wk.body && wk.body.days && wk.body.days.length), 'дней: ' + (wk.body && wk.body.days ? wk.body.days.length : 0));

  async function mountGate(theme) {
    await page.evaluate((th) => {
      document.documentElement.setAttribute('data-theme', th);
      var old = document.getElementById('asgard-presence-week');
      if (old) old.remove();
    }, theme);
    await page.evaluate(() => {
      var auth = (window.AsgardAuth && AsgardAuth.getAuth) ? AsgardAuth.getAuth() : null;
      // mount() резолвится только после сохранения — не возвращаем Promise наружу.
      AsgardPresenceWeek.mount({ auth: auth });
      return true;
    });
    try {
      await page.waitForSelector('.pg-card', { timeout: 6000 });
      await page.waitForTimeout(400);
      return true;
    } catch (_) { return false; }
  }

  // ── Nordic Night ─────────────────────────────────────────────────────────
  check('гейт смонтирован (dark)', await mountGate('dark'));
  check('карточка отрисована', !!(await page.$('.pg-card')));

  const nativeSelects = await page.$$eval('.pg-scene select', (els) => els.length).catch(() => -1);
  check('нет нативных <select>', nativeSelects === 0, 'найдено: ' + nativeSelects);

  const emoji = await page.evaluate(() => {
    const el = document.querySelector('.pg-scene');
    const t = el ? el.innerText : '';
    return (t.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  });
  check('нет эмодзи в тексте', emoji === 0, 'найдено: ' + emoji);

  const svgIcons = await page.$$eval('.pg-scene svg', (els) => els.length);
  check('SVG-иконки на месте', svgIcons > 5, 'svg: ' + svgIcons);

  const rows = await page.$$eval('.pg-row', (els) => els.length);
  check('строки дней отрисованы', rows >= 5, 'строк: ' + rows);

  await page.screenshot({ path: path.join(OUT, '01-dark.png') });

  // ── Открытая панель выбора ───────────────────────────────────────────────
  await page.click('.pg-select .pg-trigger >> nth=0');
  await page.waitForSelector('.pg-pop', { timeout: 4000 });
  await page.waitForTimeout(320);
  const opts = await page.$$eval('.pg-pop .pg-opt', (els) => els.length);
  check('панель выбора открылась', opts >= 6, 'опций: ' + opts);
  await page.screenshot({ path: path.join(OUT, '02-dark-open.png') });

  await page.click('.pg-pop .pg-opt');
  await page.waitForTimeout(300);
  check('статус выбран, триггер окрашен', await page.$eval('.pg-select', (el) => el.classList.contains('has-value')));
  check('панель закрылась после выбора', (await page.$$eval('.pg-pop', (e) => e.length)) === 0);

  // ── Светлая тема ─────────────────────────────────────────────────────────
  await page.evaluate(() => { const o = document.getElementById('asgard-presence-week'); if (o) o.remove(); });
  check('гейт смонтирован (light)', await mountGate('light'));
  await page.screenshot({ path: path.join(OUT, '03-light.png') });

  await page.click('.pg-select .pg-trigger >> nth=0');
  await page.waitForSelector('.pg-pop', { timeout: 4000 });
  await page.waitForTimeout(320);
  await page.screenshot({ path: path.join(OUT, '04-light-open.png') });
  await page.keyboard.press('Escape');

  // ── Узкий экран ──────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(OUT, '05-narrow.png') });
  const overflow = await page.evaluate(() => {
    const c = document.querySelector('.pg-card');
    if (!c) return -1;
    return Math.round(c.getBoundingClientRect().width) - Math.round(window.innerWidth);
  });
  check('карточка не вылезает на 390px', overflow <= 0, 'перелив: ' + overflow + 'px');

  // ── JS-ошибки ────────────────────────────────────────────────────────────
  const realErrors = jsErrors.filter((e) => !/favicon|404|Failed to load resource|ERR_/i.test(e));
  check('0 JS-ошибок на экране', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nСкриншоты: ' + OUT);
  console.log('ИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
