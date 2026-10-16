'use strict';
/**
 * ASGARD Field — Phase 0 baseline screenshot harness.
 *
 * Снимает ТЕКУЩЕЕ состояние приложения рабочего (/m/field*) для сравнения
 * before/after при редизайне. Логика:
 *   1. сид тестового работника в БД (PIN 0000, как tests/wms-roles-ui-e2e.js);
 *   2. field_token через pin-login (fallback — SMS-код из БД);
 *   3. контекст с localStorage (field_token/employee/has_pin, тема);
 *   4. навигация по экранам, съёмка вьюпортов устройств.
 *
 * Запуск:  node tools/field-baseline-shots.js [--base=http://127.0.0.1:3100] [--only=home,money]
 * Выход:   prototypes/field-redesign/_shots/before/<device>/<theme>/<screen>.png
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

const BASE = arg('base', process.env.TEST_BASE_URL || 'http://127.0.0.1:3100');
const ONLY = arg('only', '') ? arg('only', '').split(',').map((s) => s.trim()).filter(Boolean) : null;
const OUT = path.join(ROOT, 'prototypes', 'field-redesign', '_shots', 'before');

// ВАЖНО: стенд на :3100 поднимается на КЛОНЕ (asgard_crm_test), не на .env-БД.
// Поэтому БД по умолчанию — клон; переопределяется --db=.
const DB = {
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
  database: arg('db', process.env.FIELD_DB || 'asgard_crm_test'),
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
};

const DEVICES = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, dpr: 2, safeTop: 20, safeBottom: 0 },
  { id: 'iphone-13', label: 'iPhone 13', width: 390, height: 844, dpr: 3, safeTop: 47, safeBottom: 34 },
  { id: 'iphone-14-pro', label: 'iPhone 14 Pro (DI)', width: 393, height: 852, dpr: 3, safeTop: 59, safeBottom: 34 },
  { id: 'iphone-15-pro-max', label: 'iPhone 15 Pro Max', width: 430, height: 932, dpr: 3, safeTop: 59, safeBottom: 34 },
  { id: 'android', label: 'Android', width: 360, height: 800, dpr: 3, safeTop: 24, safeBottom: 16 },
];

const THEMES = ['dark', 'light'];

/** key → { url, wait (ms), ready (regex on body), note } */
const SCREENS = [
  { key: 'welcome', url: '/m/field/welcome', wait: 1600, ready: /Асгард|войти|воин/i, clearAuth: true },
  { key: 'login', url: '/m/field-login', wait: 1600, ready: /телефон|Назови|войти|Продолжить/i, clearAuth: true },
  { key: 'home', url: '/m/field/home', wait: 2600, ready: /смен|Асгард|работ|руб|Главная/i },
  { key: 'money', url: '/m/field/money', wait: 2200, ready: /руб|выплат|начисл|баланс|заработ/i },
  { key: 'earnings', url: '/m/field/earnings', wait: 2200, ready: /руб|заработ|аванс|выплат/i },
  { key: 'timesheet', url: '/m/field/timesheet', wait: 2200, ready: /табел|смен|час/i },
  { key: 'my-works', url: '/m/field/my-works', wait: 2200, ready: /работ|объект|наряд/i },
  { key: 'crew', url: '/m/field/crew', wait: 2200, ready: /бригад|воин|состав/i },
  { key: 'profile', url: '/m/field/profile', wait: 2400, ready: /ранг|профиль|викинг|уровень/i },
  { key: 'readiness', url: '/m/field/readiness', wait: 2200, ready: /готов|смен|брифинг|чек/i },
  { key: 'shift', url: '/m/field/shift', wait: 2200, ready: /смен|чек|гео|выход/i },
  { key: 'funds', url: '/m/field/funds', wait: 2200, ready: /подотч|чек|средств|руб/i },
  { key: 'academy', url: '/m/field/academy', wait: 2200, ready: /академ|урок|мимир/i },
  { key: 'shop', url: '/m/field/shop', wait: 2200, ready: /магазин|товар|монет|руб/i },
  { key: 'leaderboard', url: '/m/field/leaderboard', wait: 2200, ready: /рейтинг|место|воин/i },
  { key: 'quests', url: '/m/field/quests', wait: 2200, ready: /квест|задан/i },
];

const WHITELIST_CONSOLE = /favicon|ResizeObserver|Failed to load resource|service worker|SW|manifest/i;

function ok(cond, msg) { return { pass: !!cond, msg }; }

async function ensureFieldWorker() {
  const pool = new Pool(DB);
  try {
    // Приоритет: активный сотрудник с телефоном И уже привязанным пользователем.
    const emp = (await pool.query(`
      SELECT e.id, e.phone, e.fio, e.full_name, e.user_id
      FROM employees e
      WHERE e.is_active = true AND e.phone IS NOT NULL
        AND length(regexp_replace(e.phone, '\\D', '', 'g')) >= 10
        AND e.user_id IS NOT NULL
      ORDER BY e.id ASC LIMIT 1`)).rows[0]
      || (await pool.query(`
      SELECT e.id, e.phone, e.fio, e.full_name, e.user_id
      FROM employees e
      WHERE e.is_active = true AND e.phone IS NOT NULL
        AND length(regexp_replace(e.phone, '\\D', '', 'g')) >= 10
      ORDER BY e.id ASC LIMIT 1`)).rows[0];
    if (!emp) throw new Error('no active employee with phone');

    let userId = emp.user_id;
    if (!userId) {
      const login = 'field_test_' + emp.id;
      await pool.query(
        `INSERT INTO users(login, name, role, is_active, password_hash)
         VALUES($1, $2, 'FIELD_WORKER', true, $3)
         ON CONFLICT DO NOTHING`,
        [login, emp.fio || emp.full_name || 'Field Test', await bcrypt.hash('FieldTest123!', 10)]
      );
      userId = (await pool.query('SELECT id FROM users WHERE login=$1', [login])).rows[0]?.id;
      if (userId) await pool.query('UPDATE employees SET user_id=$1 WHERE id=$2', [userId, emp.id]);
    } else {
      // Убедимся, что роль/активность пользователя подходят полю.
      await pool.query(
        `UPDATE users SET role='FIELD_WORKER', is_active=true WHERE id=$1 AND role <> 'FIELD_WORKER'`,
        [userId]
      );
    }
    if (!userId) throw new Error('cannot resolve user_id for employee ' + emp.id);
    const pinHash = await bcrypt.hash('0000', 10);
    await pool.query('UPDATE users SET pin_hash=$1 WHERE id=$2', [pinHash, userId]);
    return { employee_id: emp.id, phone: emp.phone, user_id: userId, fio: emp.fio || emp.full_name, pin: '0000' };
  } finally {
    await pool.end();
  }
}

async function fieldToken(fw) {
  const pinR = await fetch(`${BASE}/api/field/auth/pin-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: fw.employee_id, pin: fw.pin }),
  });
  const pinD = await pinR.json().catch(() => ({}));
  if (pinR.ok && pinD.token) return pinD;

  await fetch(`${BASE}/api/field/auth/request-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: fw.phone }),
  });
  const pool = new Pool(DB);
  let code;
  try {
    code = (await pool.query(
      `SELECT code FROM field_auth_codes
       WHERE employee_id=$1 AND used=false AND expires_at>NOW()
       ORDER BY id DESC LIMIT 1`, [fw.employee_id])).rows[0]?.code;
  } finally { await pool.end(); }
  if (!code) throw new Error('no SMS code in DB (pin-login failed and rate-limit?)');

  const vr = await fetch(`${BASE}/api/field/auth/verify-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: fw.phone, code }),
  }).then((r) => r.json());
  if (vr.status === 'need_pin_setup' && vr.token) {
    await fetch(`${BASE}/api/field/auth/setup-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vr.token}` },
      body: JSON.stringify({ pin: fw.pin }),
    });
    return fieldToken(fw);
  }
  if (!vr.token) throw new Error('field verify-code failed: ' + JSON.stringify(vr));
  return vr;
}

function deviceContext(browser, device, theme, auth) {
  return browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.dpr,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
    userAgent: device.id === 'android'
      ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36'
      : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  }).then(async (ctx) => {
    await ctx.addInitScript(({ auth, theme, device }) => {
      localStorage.setItem('asgard_theme', theme);
      localStorage.setItem('asgard_theme_chosen', '1');
      localStorage.setItem('asgard_shell_banner_dismissed', '1');
      if (auth) {
        localStorage.setItem('field_auth_epoch', '6');
        localStorage.setItem('field_token', auth.token);
        localStorage.setItem('field_employee', JSON.stringify(auth.employee || {}));
        localStorage.setItem('field_has_pin', '1');
      }
      // CSS env() нельзя выставить скриптом — эмулируем safe-area через custom property,
      // которую фиксируем в замере: печатаем в отчёт фактические значения.
      window.__safeArea = { top: device.safeTop, bottom: device.safeBottom };
    }, { auth, theme, device: { safeTop: device.safeTop, safeBottom: device.safeBottom } });
    return ctx;
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { started_at: new Date().toISOString(), base: BASE, devices: {}, screens: {}, issues: [] };

  let fw, tok;
  try {
    fw = await ensureFieldWorker();
    tok = await fieldToken(fw);
    report.worker = { employee_id: fw.employee_id, fio: fw.fio, token_ok: !!tok.token };
    console.log(`[seed] employee ${fw.employee_id} (${fw.fio}) token ${tok.token ? 'OK' : 'FAIL'}`);
  } catch (e) {
    report.worker = { error: e.message };
    console.error('[seed] FAIL', e.message);
    console.error('Дальше снимаем только публичные экраны (welcome/login).');
  }

  const auth = tok && tok.token
    ? { token: tok.token, employee: tok.employee || { id: fw.employee_id, fio: fw.fio } }
    : null;

  const browser = await chromium.launch({ headless: true });
  const screens = ONLY ? SCREENS.filter((s) => ONLY.includes(s.key)) : SCREENS;

  for (const device of DEVICES) {
    report.devices[device.id] = { label: device.label, ...device };
    for (const theme of THEMES) {
      const dir = path.join(OUT, device.id, theme);
      fs.mkdirSync(dir, { recursive: true });
      for (const screen of screens) {
        if (screen.clearAuth && !auth) { /* всё равно снимаем */ }
        const ctx = await deviceContext(browser, device, theme, screen.clearAuth ? null : auth);
        const page = await ctx.newPage();
        const consoleErrors = [];
        const netFails = [];
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
        page.on('pageerror', (e) => consoleErrors.push(String(e.message || e)));
        page.on('response', (r) => {
          if (r.status() >= 500 && r.url().includes('/api/')) netFails.push({ s: r.status(), u: r.url().slice(0, 120) });
        });

        let status = 'ok';
        try {
          await page.goto(BASE + screen.url, { waitUntil: 'commit', timeout: 45000 });
          await page.waitForTimeout(screen.wait);
          // если улетели на pin-entry — вводим 0000
          if (page.url().includes('pin-entry')) {
            const pin = page.locator('input[type="tel"], input[inputmode="numeric"]').first();
            if (await pin.count()) { await pin.fill('0000'); await page.waitForTimeout(1800); }
          }
          const body = await page.locator('body').innerText().catch(() => '');
          if (screen.ready && !screen.ready.test(body)) status = 'unexpected-body';
          await page.screenshot({ path: path.join(dir, `${screen.key}.png`), fullPage: false });
        } catch (e) {
          status = 'error: ' + e.message.slice(0, 120);
          report.issues.push({ device: device.id, theme, screen: screen.key, error: status });
        }

        const hardErr = consoleErrors.filter((e) => !WHITELIST_CONSOLE.test(e));
        report.screens[`${device.id}/${theme}/${screen.key}`] = {
          url: page.url(), status, consoleErrors: hardErr.slice(0, 5), netFails,
        };
        if (hardErr.length) report.issues.push({ device: device.id, theme, screen: screen.key, console: hardErr.slice(0, 3) });
        if (netFails.length) report.issues.push({ device: device.id, theme, screen: screen.key, api5xx: netFails });
        console.log(`  ${device.id}/${theme}/${screen.key} → ${status} (${hardErr.length} console)`);
        await ctx.close();
      }
    }
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'baseline-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nDONE. Screens in ${OUT}`);
  console.log(`Issues: ${report.issues.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
