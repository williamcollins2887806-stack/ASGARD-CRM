/**
 * Playwright headless smoke v2 — post-deploy critical-path check.
 * Read-only: no Create/Save/Delete clicks. Logs in 2 roles, walks
 * Dashboard/Tenders/Works/Procurement/Chat/Alerts, logs out.
 *
 * Run: node tests/smoke-v2.js
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://asgard-crm.ru/v2/';
const REPORT_DIR = path.join(__dirname, 'reports', 'smoke-v2');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

const ROLES = [
  {
    name: 'DIRECTOR_GEN',
    login: 'test_director',
    password: 'Test123!',
    pin: null, // server says has_pin:false
    routes: [
      { hash: '#/home',         label: 'Dashboard' },
      { hash: '#/tenders',      label: 'Tenders' },
      { hash: '#/all-works',    label: 'AllWorks' },
      { hash: '#/procurement',  label: 'Procurement' },
      { hash: '#/chat',         label: 'Chat' },
      { hash: '#/alerts',       label: 'Alerts' },
    ],
  },
  {
    name: 'PM',
    login: 'test_pm',
    password: 'Test123!',
    pin: '1234',
    routes: [
      { hash: '#/home',           label: 'Dashboard' },
      { hash: '#/tenders',        label: 'Tenders' },
      { hash: '#/pm-works',       label: 'PmWorks' },
      { hash: '#/my-procurement', label: 'MyProcurement' },
      { hash: '#/chat',           label: 'Chat' },
      { hash: '#/alerts',         label: 'Alerts' },
    ],
  },
];

// Patterns to ignore in console errors (known noise unrelated to v2 frontend)
const ERR_IGNORE = [
  /favicon/i,
  /net::ERR_/i,
  /ResizeObserver/i,
  /ETELEGRAM/i,
  /service[- ]?worker|sw\.js/i,
  /status of 401|status of 403/i,
  /Failed to load resource/i,
  /Manifest/i,
];

function shouldIgnore(text) {
  return ERR_IGNORE.some(re => re.test(text));
}

async function runRole(browser, role) {
  const result = {
    role: role.name,
    steps: {},
    consoleErrors: [],
    server5xx: [],
    whiteScreens: [],
    emptyWidgets: [],
  };

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
  });
  const page = await ctx.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!shouldIgnore(t)) result.consoleErrors.push(`[${role.name}] ${t}`);
    }
  });
  page.on('pageerror', (err) => {
    result.consoleErrors.push(`[${role.name}] PAGE_ERROR: ${err.message}`);
  });
  page.on('response', (resp) => {
    const status = resp.status();
    const url = resp.url();
    if (status >= 500 && status < 600 && url.includes('asgard-crm.ru')) {
      result.server5xx.push(`[${role.name}] ${status} ${url}`);
    }
  });

  const screenshot = async (label) => {
    const file = path.join(REPORT_DIR, `${role.name}_${label}.png`);
    try { await page.screenshot({ path: file, fullPage: false }); } catch (_) {}
    return file;
  };

  const checkWhiteScreen = async (label) => {
    try {
      const info = await page.evaluate(() => {
        const textLen = (document.body.innerText || '').trim().length;
        const domCount = document.querySelectorAll('body *').length;
        return { textLen, domCount, hash: location.hash };
      });
      // White screen = essentially no DOM and no visible text
      if (info.textLen < 50 && info.domCount < 10) {
        result.whiteScreens.push(`[${role.name}/${label}] textLen=${info.textLen} domCount=${info.domCount} hash=${info.hash}`);
        await screenshot(`white_${label}`);
        return false;
      }
      return true;
    } catch (e) {
      result.whiteScreens.push(`[${role.name}/${label}] checkWhiteScreen error: ${e.message}`);
      return false;
    }
  };

  // ─── 1. Open index ───
  try {
    await page.goto(BASE, { waitUntil: 'commit', timeout: 30000 });
    // SPA needs longer for first paint + welcome render
    await page.waitForFunction(() => {
      const root = document.getElementById('root');
      return root && root.querySelectorAll('*').length > 10;
    }, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    const ok = await checkWhiteScreen('index');
    result.steps['1_index'] = ok ? 'OK' : 'FAIL';
  } catch (e) {
    result.steps['1_index'] = `FAIL: ${e.message}`;
  }

  // ─── 2. Login ───
  try {
    // The SPA may redirect to /#/welcome itself; ensure we're on welcome
    await page.goto(BASE + '#/welcome', { waitUntil: 'commit', timeout: 20000 });
    await page.waitForTimeout(1500);
    // Click "Войти"
    const enterBtn = page.locator('button:has-text("Войти")').first();
    await enterBtn.waitFor({ state: 'visible', timeout: 10000 });
    await enterBtn.click();
    await page.waitForTimeout(800);
    // Fill login/password
    const loginInput = page.locator('input[autocomplete="username"]').first();
    await loginInput.waitFor({ state: 'visible', timeout: 8000 });
    await loginInput.fill(role.login);
    await page.locator('input[autocomplete="current-password"]').first().fill(role.password);
    // Press "Далее"
    await page.locator('button:has-text("Далее")').first().click();
    await page.waitForTimeout(2500);
    result.steps['2_login'] = 'OK';
  } catch (e) {
    result.steps['2_login'] = `FAIL: ${e.message}`;
    await screenshot('login_fail');
  }

  // ─── 3. PIN if needed ───
  try {
    const pinVisible = await page.locator('.welcome-v2-pin-keypad').isVisible().catch(() => false);
    if (pinVisible && role.pin) {
      for (const d of role.pin.split('')) {
        await page.locator(`.welcome-v2-pin-keypad button:has-text("${d}")`).first().click();
        await page.waitForTimeout(200);
      }
      await page.waitForTimeout(3500); // wait for PIN verify + redirect
      result.steps['3_pin'] = 'OK';
    } else if (pinVisible && !role.pin) {
      result.steps['3_pin'] = 'UNEXPECTED PIN PROMPT';
    } else {
      result.steps['3_pin'] = 'N/A';
    }
  } catch (e) {
    result.steps['3_pin'] = `FAIL: ${e.message}`;
    await screenshot('pin_fail');
  }

  // Wait for redirect to /#/home
  try {
    await page.waitForFunction(() => location.hash.includes('/home') || location.hash.includes('home'), { timeout: 15000 });
  } catch (_) {}

  // ─── 4-9. Route walk ───
  for (let i = 0; i < role.routes.length; i++) {
    const r = role.routes[i];
    const stepNum = 4 + i;
    const key = `${stepNum}_${r.label}`;
    try {
      await page.goto(BASE + r.hash, { waitUntil: 'commit', timeout: 20000 });
      await page.waitForTimeout(2500);
      const ok = await checkWhiteScreen(r.label);

      // Widget/list emptiness heuristic for dashboard
      if (r.label === 'Dashboard') {
        const info = await page.evaluate(() => {
          // count any card/widget-like containers with visible text
          const els = Array.from(document.querySelectorAll('[class*="widget"], [class*="card"], [class*="tile"], [class*="kpi"]'));
          const populated = els.filter(el => (el.textContent || '').trim().length > 5).length;
          return { total: els.length, populated };
        });
        if (info.total > 0 && info.populated === 0) {
          result.emptyWidgets.push(`[${role.name}/Dashboard] ${info.total} widget containers, 0 populated`);
        }
      }

      result.steps[key] = ok ? 'OK' : 'WHITE_SCREEN';
      await screenshot(r.label);
    } catch (e) {
      result.steps[key] = `FAIL: ${e.message}`;
      await screenshot(`${r.label}_fail`);
    }
  }

  // ─── 10. Logout ───
  try {
    // Clear all auth storage then force-reload to drop in-memory user state
    await page.evaluate(() => {
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
    });
    await page.goto(BASE + '#/welcome', { waitUntil: 'commit', timeout: 15000 });
    await page.waitForTimeout(2500);
    // After clear, useAuth.ready may not have re-run yet; reload to fully reset
    if (!(await page.locator('button:has-text("Войти")').first().isVisible().catch(() => false))) {
      await page.reload({ waitUntil: 'commit', timeout: 15000 });
      await page.waitForTimeout(2500);
    }
    const onWelcome = await page.locator('button:has-text("Войти")').first().isVisible().catch(() => false);
    result.steps['10_logout'] = onWelcome ? 'OK' : 'FAIL';
    if (!onWelcome) await screenshot('logout_fail');
  } catch (e) {
    result.steps['10_logout'] = `FAIL: ${e.message}`;
  }

  await ctx.close();
  return result;
}

(async () => {
  console.log(`[smoke-v2] start ${new Date().toISOString()}`);
  console.log(`[smoke-v2] target: ${BASE}`);
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const role of ROLES) {
    console.log(`\n[smoke-v2] ─── Role: ${role.name} (${role.login}) ───`);
    try {
      const r = await runRole(browser, role);
      results.push(r);
      console.log(`[smoke-v2] ${role.name}:`, JSON.stringify(r.steps, null, 2));
      if (r.consoleErrors.length) {
        console.log(`[smoke-v2] ${role.name} console errors (${r.consoleErrors.length}):`);
        r.consoleErrors.slice(0, 20).forEach(e => console.log('  -', e.slice(0, 300)));
      }
      if (r.server5xx.length) {
        console.log(`[smoke-v2] ${role.name} 5xx:`, r.server5xx);
      }
      if (r.whiteScreens.length) {
        console.log(`[smoke-v2] ${role.name} white screens:`, r.whiteScreens);
      }
      if (r.emptyWidgets.length) {
        console.log(`[smoke-v2] ${role.name} empty widgets:`, r.emptyWidgets);
      }
    } catch (e) {
      console.log(`[smoke-v2] ${role.name} CRASH: ${e.message}`);
      results.push({ role: role.name, crash: e.message });
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(REPORT_DIR, 'report.json'), JSON.stringify(results, null, 2));
  console.log(`\n[smoke-v2] report → ${path.join(REPORT_DIR, 'report.json')}`);
})();
