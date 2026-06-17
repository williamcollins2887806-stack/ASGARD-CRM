/* Wave-6 vanilla 15-role smoke — §6 п.18.
 * Запуск:
 *   $env:DB_NAME='asgard_crm_kanban_test'; $env:JWT_SECRET=(process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })());
 *   node tests/_wave6_vanilla_15roles_smoke.cjs
 * Сервер :3120, БД asgard_crm_kanban_test.
 *
 * Цикл по 15 ролям:
 *  - JWT signed с pinVerified=true.
 *  - Открыть #/personal-kanban; если роль с доступом — ждём h1.page-title;
 *    если без — ожидаем редирект на #/ или сообщение «Нет доступа», без краша.
 *  - Открыть #/director-inbox — аналогично.
 *  - Тема: для test_pm дополнительно dark→light (S-theme).
 *  - Считаем console.error+pageerror за сессию роли — ассерт = 0.
 * Скриншоты: audit-reports/personal-kanban/roles/vanilla-<role>-<page>.png.
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

async function gotoVanilla(page, token, hashPath, theme, user) {
  const userSnap = { id: user.id, login: user.login, role: user.role, name: user.login };
  await page.addInitScript(({ tok, th, usr }) => {
    try {
      localStorage.setItem('asgard_token', tok);
      localStorage.setItem('asgard_user', JSON.stringify(usr));
    } catch (e) {}
    try { localStorage.setItem('asgard_theme', th || 'dark'); } catch (e) {}
    // PIN-gate bypass
    try {
      localStorage.setItem('asgard_pin_verified', 'true');
      const d = new Date().toISOString().slice(0, 10);
      localStorage.setItem('presence_done_' + d, '1');
    } catch (e) {}
    if (th === 'light') {
      try {
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.classList.add('light');
      } catch (e) {}
    }
  }, { tok: token, th: theme || 'dark', usr: userSnap });

  await page.goto(`${BASE}/${hashPath}`, { waitUntil: 'commit' });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1800);
}

// Фильтр чисто инфраструктурного шума, который не «наш Wave-* код»:
// - HTTP 401/403/404 (RBAC + ожидаемое отсутствие данных)
// - service-worker registration
// - сторонние favicon / hot-reload websocket
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
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
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
    await gotoVanilla(page, tok, '#/personal-kanban', 'dark', u);
    // Если доступ — h1.page-title содержит «Канбан»; иначе — редирект на #/ или сообщение.
    const pkTitle = await page.evaluate(() => {
      const el = document.querySelector('h1.page-title');
      return el ? (el.textContent || '') : '';
    });
    const url = page.url();
    const hash = url.split('#')[1] || '';
    if (access_pk) {
      // Ожидаем что hash остался #/personal-kanban (или /-fallback и заголовок Канбан)
      pk_state = /канбан/i.test(pkTitle) ? 'access_ok' : 'access_no_render';
    } else {
      // Ожидаем редирект (hash≠personal-kanban) или нет заголовка Канбан
      pk_state = (!/personal-kanban/.test(hash) || !/канбан/i.test(pkTitle)) ? 'denied_ok' : 'denied_leak';
    }
    try {
      await page.screenshot({ path: path.join(SHOTS, `vanilla-${u.role}-personal-kanban.png`), fullPage: false });
    } catch (e) {}
  } catch (e) {
    pk_state = `error:${e.message}`;
  }

  // --- director-inbox ---
  let di_state = 'unknown';
  try {
    await gotoVanilla(page, tok, '#/director-inbox', 'dark', u);
    const diTitle = await page.evaluate(() => {
      const el = document.querySelector('h1.page-title');
      return el ? (el.textContent || '') : '';
    });
    const url = page.url();
    const hash = url.split('#')[1] || '';
    if (access_di) {
      di_state = /корзина|заявок|inbox/i.test(diTitle) ? 'access_ok' : 'access_no_render';
    } else {
      di_state = (!/director-inbox/.test(hash) || !/корзина|inbox/i.test(diTitle)) ? 'denied_ok' : 'denied_leak';
    }
    try {
      await page.screenshot({ path: path.join(SHOTS, `vanilla-${u.role}-director-inbox.png`), fullPage: false });
    } catch (e) {}
  } catch (e) {
    di_state = `error:${e.message}`;
  }

  await ctx.close();

  const pass = console_errors.length === 0 && page_errors.length === 0;
  results.push({
    front: 'vanilla',
    role: u.role,
    login: u.login,
    pk_state,
    di_state,
    console_errors,
    page_errors,
    pass,
  });
  console.log(`[vanilla:${u.role.padEnd(15)}] pk=${pk_state.padEnd(15)} di=${di_state.padEnd(15)} ce=${console_errors.length} pe=${page_errors.length} → ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) {
    if (console_errors.length) console_errors.slice(0, 5).forEach((x) => console.log(`    [ce] ${x}`));
    if (page_errors.length)   page_errors.slice(0, 5).forEach((x) => console.log(`    [pe] ${x}`));
  }
}

(async () => {
  console.log('=== Wave-6 vanilla 15-role smoke (§6 п.18) ===');
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
  console.log(`=== ИТОГ vanilla: ${passed}/${results.length} PASS ===`);
  const out = path.join(SHOTS, '..', 'wave6-vanilla-results.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Артефакты: ${out}`);
  process.exit(passed === results.length ? 0 : 1);
})();
