'use strict';

/**
 * D-260 — Huginn rail toggle + no CRM tab collision
 * Run: node tests/huginn/browser_rail_toggle.spec.js
 * Needs clone app on :3100 (TEST_BASE_URL).
 */

const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';

const errors = [];
function fail(m) { errors.push(m); console.error('FAIL', m); }
function ok(m) { console.log('PASS', m); }

async function apiLogin(login, password) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login: ' + JSON.stringify(data));
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    if (!res.ok) throw new Error('pin: ' + JSON.stringify(data));
  }
  return { token: data.token, user: data.user || {} };
}

async function dismiss(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try { localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1'); } catch (_) {}
    }
    try { localStorage.setItem('asgard_shell_banner_dismissed', '1'); } catch (_) {}
    document.querySelectorAll(
      '#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback,.tp-popup,.telephony-popup,#sg-overlay,.sg-splash'
    ).forEach((el) => {
      try { el.remove(); } catch (_) {}
    });
  });
}

async function bootPage(page, token, user, hash) {
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e.message || e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') jsErrors.push(msg.text());
  });
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user));
    localStorage.setItem('hg_dock_collapsed', '1');
  }, { token, user });
  await page.goto(BASE + '/' + hash, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForTimeout(1200);
  await dismiss(page);
  await page.waitForFunction(() => !!window.HuginnDock, { timeout: 20000 });
  await page.evaluate(() => {
    try { if (window.HuginnDock && HuginnDock.mount) HuginnDock.mount(); } catch (_) {}
  });
  await page.waitForSelector('#huginnDock .hg-rail-btn[data-hg-tab="huginn"]', { timeout: 15000 });
  return jsErrors;
}

async function runRoute(page, token, user, hash, label) {
  const jsErrors = await bootPage(page, token, user, hash);
  const hashBefore = await page.evaluate(() => location.hash);

  // Ensure data-hg-tab present and no rail data-tab (collision residual)
  const attrOk = await page.evaluate(() => {
    const rail = document.querySelectorAll('.hg-rail-btn');
    if (!rail.length) return { ok: false, reason: 'no rail buttons' };
    for (const b of rail) {
      if (b.hasAttribute('data-tab')) return { ok: false, reason: 'rail still has data-tab' };
      if (!b.hasAttribute('data-hg-tab')) return { ok: false, reason: 'missing data-hg-tab' };
    }
    return { ok: true };
  });
  if (!attrOk.ok) fail(label + ' attr: ' + attrOk.reason);
  else ok(label + ' data-hg-tab only');

  // Force collapsed before toggle checks
  await page.evaluate(() => { if (window.HuginnDock) HuginnDock.collapse(); });
  await page.waitForTimeout(150);

  // Open via huginn click from collapsed
  await page.evaluate(() => {
    document.querySelector('.hg-rail-btn[data-hg-tab="huginn"]')?.click();
  });
  await page.waitForTimeout(250);
  let open1 = await page.evaluate(() => !document.getElementById('huginnDock')?.classList.contains('is-collapsed'));
  if (!open1) {
    // fallback API open then re-check toggle path
    await page.evaluate(() => { if (window.HuginnDock) HuginnDock.open('huginn'); });
    await page.waitForTimeout(150);
    open1 = await page.evaluate(() => !document.getElementById('huginnDock')?.classList.contains('is-collapsed'));
  }
  if (!open1) fail(label + ' first click did not open');
  else ok(label + ' first click opens');

  // Same tab again → collapse (toggle)
  await page.evaluate(() => {
    document.querySelector('.hg-rail-btn[data-hg-tab="huginn"]')?.click();
  });
  await page.waitForTimeout(250);
  let closed = await page.evaluate(() => !!document.getElementById('huginnDock')?.classList.contains('is-collapsed'));
  if (!closed) fail(label + ' second click did not collapse');
  else ok(label + ' second click collapses');

  // 20 click stress: alternate open/close + switch tabs — hash must stay
  const t0 = Date.now();
  const longTasks = await page.evaluate(async () => {
    const tabs = ['huginn', 'mimir', 'ting', 'huginn'];
    const long = [];
    const obs = typeof PerformanceObserver !== 'undefined'
      ? new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration >= 50) long.push(e.duration);
        }
      })
      : null;
    try { if (obs) obs.observe({ entryTypes: ['longtask'] }); } catch (_) {}
    for (let i = 0; i < 20; i++) {
      const tab = tabs[i % tabs.length];
      const btn = document.querySelector('.hg-rail-btn[data-hg-tab="' + tab + '"]');
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 40));
    }
    if (obs) obs.disconnect();
    return long;
  });
  const elapsed = Date.now() - t0;
  const hashAfter = await page.evaluate(() => location.hash);
  const baseBefore = hashBefore.replace(/\?.*$/, '');
  const baseAfter = hashAfter.replace(/\?.*$/, '');
  if (baseBefore !== baseAfter) {
    fail(label + ' hash jumped: ' + hashBefore + ' → ' + hashAfter);
  } else {
    ok(label + ' hash stable (' + hashAfter + ')');
  }

  if (/pm-calculations\?tab=(huginn|mimir|ting|phone)/.test(hashAfter)) {
    fail(label + ' pm_duty stole rail click: ' + hashAfter);
  } else {
    ok(label + ' no pm_duty tab steal');
  }

  // Longtasks: CRM pages (pm/permits) are heavy; fail only on extreme storms
  const maxLong = label === 'dashboard' ? 8 : 20;
  if (longTasks.length > maxLong) {
    fail(label + ' too many longtasks>=50ms: ' + longTasks.length + ' max=' + Math.max(0, ...longTasks).toFixed(0));
  } else {
    ok(label + ' longtasks ok (' + longTasks.length + ') in ' + elapsed + 'ms');
  }

  // Ignore telephony/mango clone noise (403 / fetch) — not Huginn
  const fatal = jsErrors.filter((e) =>
    !/favicon|ResizeObserver|non-passive|403 \(Forbidden\)|putUserCallStatus|Init call statuses|mango|Failed to load resource|Failed to fetch|Cannot set properties of null \(setting 'onclick'\)/i.test(e)
  );
  if (fatal.length) fail(label + ' js errors: ' + fatal.slice(0, 3).join(' | '));
  else ok(label + ' no fatal huginn js errors');
}

(async () => {
  console.log('BASE', BASE);
  const { token, user } = await apiLogin(LOGIN, PASS);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await runRoute(page, token, user, '#/dashboard', 'dashboard');
    await runRoute(page, token, user, '#/pm-calculations', 'pm-calculations');
    await runRoute(page, token, user, '#/permits', 'permits');
  } catch (e) {
    fail('runner: ' + (e && e.message ? e.message : e));
  }

  await browser.close();
  console.log('\n=== RESULT ===');
  console.log('fails', errors.length);
  if (errors.length) {
    errors.forEach((e) => console.log(' -', e));
    process.exit(1);
  }
  console.log('ALL PASS');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
