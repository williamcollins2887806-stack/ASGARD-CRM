/* Wave-6 mobile-app 15-role smoke — §6 п.18.
 * Запуск:
 *   $env:DB_NAME='asgard_crm_kanban_test'; $env:JWT_SECRET=(process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })());
 *   node tests/_wave6_mobile_15roles_smoke.cjs
 * Сервер :3120, БД asgard_crm_kanban_test.
 *
 * Цикл по 15 ролям:
 *  - JWT signed с pinVerified=true → localStorage.asgard_token.
 *  - Открыть /m/personal-kanban; если access — ждём заголовок «Мой канбан»;
 *    если без — ожидаем редирект на «/m/» или сообщение «Нет доступа», без краша.
 *  - Открыть /m/director-inbox — аналогично («Корзина заявок» для HEAD_PM/ADMIN/DIRECTOR_*).
 *  - Считаем console.error+pageerror за сессию роли — ассерт = 0.
 * Скриншоты: audit-reports/personal-kanban/roles/mobile-<role>-<page>.png.
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

async function gotoMobile(page, token, routePath, user) {
  await page.addInitScript(({ tok }) => {
    try {
      localStorage.setItem('asgard_token', tok);
      // PIN-gate bypass (mobile может хранить отдельный флаг)
      localStorage.setItem('asgard_pin_verified', 'true');
      const d = new Date().toISOString().slice(0, 10);
      localStorage.setItem('presence_done_' + d, '1');
    } catch (e) {}
  }, { tok: token });

  await page.goto(`${BASE}/m${routePath}`, { waitUntil: 'commit' });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(2000);
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
  // Ожидаемые 404 на push subscribe для ролей без подписки
  if (t.includes('push') && t.includes('404')) return true;
  return false;
}

async function runRole(browser, u, results) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14 viewport — mobile-first
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const console_errors = [];
  const page_errors   = [];
  page.on('console',   (m) => { if (m.type() === 'error' && !isInfraNoise(m.text())) console_errors.push(m.text()); });
  page.on('pageerror', (e) => { page_errors.push(e.message); });

  const tok = sign(u);
  const access_pk  = hasPersonalKanban(u.role);
  const access_di  = hasDirectorInbox(u.role);

  // --- personal-kanban ---
  let pk_state = 'unknown';
  try {
    await gotoMobile(page, tok, '/personal-kanban', u);
    // Заголовок страницы в PageShell — обычно h1 или title-content;
    // ищем «Мой канбан» в любом видимом текстовом узле.
    const pkVisible = await page.evaluate(() => {
      const text = (document.body && document.body.innerText) || '';
      return /Мой канбан/i.test(text);
    });
    const url = page.url();
    const deniedRedirect = /\/m\/?$|\/m\/login|\/m\/welcome/.test(url) || !/personal-kanban/.test(url);
    if (access_pk) {
      pk_state = pkVisible ? 'access_ok' : 'access_no_render';
    } else {
      // Если PageShell отрендерил «Мой канбан» при denied → leak
      // Если редирект или просто нет заголовка → denied OK
      pk_state = !pkVisible ? 'denied_ok' : 'denied_leak';
    }
    try {
      await page.screenshot({ path: path.join(SHOTS, `mobile-${u.role}-personal-kanban.png`), fullPage: false });
    } catch (e) {}
  } catch (e) {
    pk_state = `error:${e.message}`;
  }

  // --- director-inbox ---
  let di_state = 'unknown';
  try {
    await gotoMobile(page, tok, '/director-inbox', u);
    const diVisible = await page.evaluate(() => {
      const text = (document.body && document.body.innerText) || '';
      return /Корзина заявок|Director.*Inbox/i.test(text);
    });
    if (access_di) {
      di_state = diVisible ? 'access_ok' : 'access_no_render';
    } else {
      di_state = !diVisible ? 'denied_ok' : 'denied_leak';
    }
    try {
      await page.screenshot({ path: path.join(SHOTS, `mobile-${u.role}-director-inbox.png`), fullPage: false });
    } catch (e) {}
  } catch (e) {
    di_state = `error:${e.message}`;
  }

  await ctx.close();

  const pass = console_errors.length === 0 && page_errors.length === 0;
  results.push({
    front: 'mobile',
    role: u.role,
    login: u.login,
    pk_state,
    di_state,
    console_errors,
    page_errors,
    pass,
  });
  console.log(`[mobile:${u.role.padEnd(15)}] pk=${pk_state.padEnd(15)} di=${di_state.padEnd(15)} ce=${console_errors.length} pe=${page_errors.length} → ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) {
    if (console_errors.length) console_errors.slice(0, 5).forEach((x) => console.log(`    [ce] ${x}`));
    if (page_errors.length)   page_errors.slice(0, 5).forEach((x) => console.log(`    [pe] ${x}`));
  }
}

(async () => {
  console.log('=== Wave-6 mobile 15-role smoke (§6 п.18) ===');
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
  console.log(`=== ИТОГ mobile: ${passed}/${results.length} PASS ===`);
  const out = path.join(SHOTS, '..', 'wave6-mobile-results.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Артефакты: ${out}`);
  process.exit(passed === results.length ? 0 : 1);
})();
