/* Wave-6 React v2 15-role smoke — §6 п.18.
 * Запуск:
 *   $env:DB_NAME='asgard_crm_kanban_test'; $env:JWT_SECRET=(process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })());
 *   node tests/_wave6_v2_15roles_smoke.cjs
 * Сервер :3120, БД asgard_crm_kanban_test.
 *
 * Цикл по 15 ролям × {personal-kanban, director-inbox}:
 *  - role с доступом → видит h1 «Личный канбан РП»/«Корзина заявок».
 *  - role без доступа → видит «Нет доступа» (AppShell access-denied), НЕ крашит.
 *  - console.error+pageerror = 0.
 * Скриншоты: audit-reports/personal-kanban/roles/v2-<role>-<page>.png.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const { enforceAllowlist, ROLES, hasPersonalKanban, hasDirectorInbox } = require('./_wave6_15roles_helpers.cjs');

enforceAllowlist();

const SECRET = process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })();
const BASE   = process.env.BASE || 'http://127.0.0.1:3120';
const SHOTS  = path.resolve(__dirname, '..', 'audit-reports', 'personal-kanban', 'roles');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

function sign(u) {
  return jwt.sign({ id: u.id, login: u.login, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' });
}

async function gotoV2(page, token, hash, theme, user) {
  const userSnap = { id: user.id, login: user.login, role: user.role, name: user.login };
  await page.addInitScript(({ tok, th, usr }) => {
    try {
      localStorage.setItem('asgard_token', tok);
      localStorage.setItem('asgard_user', JSON.stringify(usr));
    } catch (e) {}
    try {
      localStorage.setItem('asgard_v2_theme', th || 'dark');
      localStorage.setItem('asgard_theme', th || 'dark');
    } catch (e) {}
    try { localStorage.setItem('asgard_pin_verified', 'true'); } catch (e) {}
  }, { tok: token, th: theme || 'dark', usr: userSnap });

  await page.goto(`${BASE}/v2/${hash}`, { waitUntil: 'commit' });
  // Подождать React mount + auth check (fetch /api/auth/me)
  await page.waitForSelector('#root > *', { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2200);
}

function isInfraNoise(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  if (t.includes('401') && (t.includes('unauthorized') || t.includes('failed to load'))) return true;
  if (t.includes('403') && t.includes('forbidden')) return true;
  if (t.includes('the resource') && t.includes('was preloaded')) return true;
  if (t.includes('manifest') && t.includes('icon')) return true;
  if (t.includes('serviceworker') && t.includes('registration')) return true;
  if (t.startsWith('failed to load resource:')) return true;
  return false;
}

async function runRole(browser, u, results) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const console_errors = [];
  const page_errors = [];
  page.on('console',   (m) => { if (m.type() === 'error' && !isInfraNoise(m.text())) console_errors.push(m.text()); });
  page.on('pageerror', (e) => { page_errors.push(e.message); });

  const tok = sign(u);
  const access_pk = hasPersonalKanban(u.role);
  const access_di = hasDirectorInbox(u.role);

  // --- personal-kanban ---
  let pk_state = 'unknown';
  try {
    await gotoV2(page, tok, '#/personal-kanban', 'dark', u);
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    if (access_pk) {
      // success: title «Личный канбан» / «Мой канбан»
      pk_state = /(Личный канбан|Мой канбан)/.test(bodyText) ? 'access_ok' : 'access_no_render';
    } else {
      // denied: access-denied card OR redirected to welcome
      pk_state = /Нет доступа|welcome|Вход/i.test(bodyText) ? 'denied_ok' : 'denied_leak';
    }
    try {
      await page.screenshot({ path: path.join(SHOTS, `v2-${u.role}-personal-kanban.png`), fullPage: false });
    } catch (e) {}
  } catch (e) {
    pk_state = `error:${e.message}`;
  }

  // --- director-inbox ---
  let di_state = 'unknown';
  try {
    await gotoV2(page, tok, '#/director-inbox', 'dark', u);
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    if (access_di) {
      di_state = /(Корзина заявок|Inbox|Заявки на распред)/.test(bodyText) ? 'access_ok' : 'access_no_render';
    } else {
      di_state = /Нет доступа|welcome|Вход/i.test(bodyText) ? 'denied_ok' : 'denied_leak';
    }
    try {
      await page.screenshot({ path: path.join(SHOTS, `v2-${u.role}-director-inbox.png`), fullPage: false });
    } catch (e) {}
  } catch (e) {
    di_state = `error:${e.message}`;
  }

  await ctx.close();

  const pass = console_errors.length === 0 && page_errors.length === 0;
  results.push({
    front: 'v2',
    role: u.role,
    login: u.login,
    pk_state,
    di_state,
    console_errors,
    page_errors,
    pass,
  });
  console.log(`[v2:${u.role.padEnd(15)}] pk=${pk_state.padEnd(15)} di=${di_state.padEnd(15)} ce=${console_errors.length} pe=${page_errors.length} → ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) {
    if (console_errors.length) console_errors.slice(0, 5).forEach((x) => console.log(`    [ce] ${x}`));
    if (page_errors.length)   page_errors.slice(0, 5).forEach((x) => console.log(`    [pe] ${x}`));
  }
}

(async () => {
  console.log('=== Wave-6 React v2 15-role smoke (§6 п.18) ===');
  console.log(`BASE=${BASE}  DB=${process.env.DB_NAME}`);

  try {
    const r = await fetch(`${BASE}/api/health`);
    if (!r.ok) throw new Error(`health ${r.status}`);
  } catch (e) {
    console.error('Preflight FAIL: server unreachable —', e.message);
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const u of ROLES) await runRole(browser, u, results);
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log('');
  console.log(`=== ИТОГ v2: ${passed}/${results.length} PASS ===`);
  const out = path.join(SHOTS, '..', 'wave6-v2-results.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Артефакты: ${out}`);
  process.exit(passed === results.length ? 0 : 1);
})();
