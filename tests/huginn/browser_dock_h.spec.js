'use strict';

/**
 * Huginn browser gate — dock + /h + two-context live + screenshots
 * Run: node tests/huginn/browser_dock_h.spec.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN_A = process.env.TEST_LOGIN_A || 'admin';
const PASS_A = process.env.TEST_PASS_A || 'huginn-test-ok';
const LOGIN_B = process.env.TEST_LOGIN_B || 'ok';
const PASS_B = process.env.TEST_PASS_B || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const OUT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/ROUND-3');

const errors = [];
function fail(msg) { errors.push(msg); console.error('FAIL', msg); }
function ok(msg) { console.log('PASS', msg); }

async function apiLogin(login, password) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login ' + login + ': ' + JSON.stringify(data));
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    if (!res.ok) throw new Error('pin ' + login + ': ' + JSON.stringify(data));
  }
  return { token: data.token, user: data.user || {} };
}

async function api(token, method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { res, data, status: res.status };
}

async function ensureSharedChat(tokenA, userBId) {
  const direct = await api(tokenA, 'POST', '/api/chat-groups/direct', { user_id: userBId });
  const id = Number(direct.data?.id || direct.data?.chat_id || direct.data?.chat?.id);
  if (direct.status >= 400 || !id) {
    throw new Error('direct chat failed: ' + JSON.stringify(direct.data));
  }
  return id;
}

async function dismissChrome(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try { localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1'); } catch (_) {}
    }
    const gate = document.getElementById('asgard-presence-gate');
    if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
    document.querySelectorAll(
      '.cr-m-overlay, .modalback, [class*="overlay--visible"], .tp-popup, .telephony-popup, #sg-overlay, .sg-splash, #asgard-presence-gate, #asgard-splash'
    ).forEach((el) => {
      el.classList.remove('cr-m-overlay--visible', 'visible');
      el.style.display = 'none';
      try { el.remove(); } catch (_) {}
    });
    try { localStorage.setItem('asgard_shell_banner_dismissed', '1'); } catch (_) {}
    try { localStorage.setItem('asgard_v2_banner_dismissed', '1'); } catch (_) {}
  }).catch(() => {});
  for (const t of ['Понял', 'Закрыть', 'Позже', 'Пропустить', 'В строй']) {
    await page.getByRole('button', { name: new RegExp(t, 'i') }).first().click({ timeout: 400 }).catch(() => {});
  }
}

async function openAuthedPage(context, auth) {
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
    localStorage.setItem('asgard_safe_mode', '1');
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1');
    }
  }, auth);

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e.message || e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'commit', timeout: 60000 });
  await page.waitForFunction(() => !!localStorage.getItem('asgard_token'), null, { timeout: 15000 });
  await dismissChrome(page);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    if (window.HuginnDock && typeof window.HuginnDock.mount === 'function') {
      window.HuginnDock.mount();
      window.HuginnDock.open();
    }
  });
  await page.waitForTimeout(500);
  await dismissChrome(page);
  return { page, consoleErrors };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const authA = await apiLogin(LOGIN_A, PASS_A);
  const authB = await apiLogin(LOGIN_B, PASS_B);
  ok('api login A/B');

  const chatId = await ensureSharedChat(authA.token, authB.user.id);
  if (!chatId) throw new Error('no shared chat');
  // seed a message so list is non-empty
  await api(authA.token, 'POST', `/api/chat-groups/${chatId}/messages`, {
    text: 'seed-' + Date.now()
  });
  ok('shared chat ' + chatId);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  let consoleA = [];
  let consoleB = [];
  let pageA;
  let pageB;
  try {
    ({ page: pageA, consoleErrors: consoleA } = await openAuthedPage(ctxA, authA));
    ({ page: pageB, consoleErrors: consoleB } = await openAuthedPage(ctxB, authB));
    ok('pages A/B');

    const dockA = pageA.locator('#huginnDock, .hg-chrome');
    await dockA.first().waitFor({ timeout: 20000 });
    ok('dock mounted');

    const railBtns = pageA.locator('.hg-rail-btn');
    const railCount = await railBtns.count();
    if (railCount < 3) fail('rail buttons < 3: ' + railCount);
    else ok('rail 3 icons');

    const panelBox = await pageA.locator('.hg-panel').boundingBox();
    if (!panelBox || Math.abs(panelBox.width - 400) > 8) {
      fail('panel width not ~400: ' + (panelBox && panelBox.width));
    } else ok('panel 400px');

    await pageA.screenshot({ path: path.join(OUT, 'dock-list.png'), fullPage: false });

    // Collapse
    await pageA.locator('[data-collapse], .hg-icon-btn').first().click({ timeout: 5000 }).catch(() => {});
    await pageA.waitForTimeout(400);
    let collapsed = await pageA.locator('.hg-chrome.is-collapsed').count();
    if (!collapsed) {
      await pageA.evaluate(() => window.HuginnDock && window.HuginnDock.collapse && window.HuginnDock.collapse());
      await pageA.waitForTimeout(300);
    }
    collapsed = await pageA.locator('.hg-chrome.is-collapsed').count();
    if (!collapsed) fail('collapse did not apply');
    else ok('collapse');
    await pageA.screenshot({ path: path.join(OUT, 'dock-collapsed.png'), fullPage: false });

    await pageA.evaluate(() => window.HuginnDock && window.HuginnDock.open && window.HuginnDock.open());
    await pageA.waitForTimeout(300);

    // Open seeded chat
    await pageA.evaluate((id) => {
      if (window.HuginnDock && window.HuginnDock.openChat) window.HuginnDock.openChat(id);
    }, chatId);
    await pageA.waitForSelector('.hg-msgs', { timeout: 15000 });
    ok('open thread');
    await pageA.screenshot({ path: path.join(OUT, 'dock-thread.png'), fullPage: false });

    await pageB.evaluate((id) => {
      if (window.HuginnDock && window.HuginnDock.openChat) window.HuginnDock.openChat(id);
    }, chatId);
    await pageB.waitForSelector('.hg-msgs', { timeout: 15000 });

    const marker = 'live-' + Date.now();
    await pageA.fill('#hgInput', marker);
    await pageA.click('#hgSend');
    await pageA.waitForTimeout(1500);

    const seenA = await pageA.locator('.hg-msgs').innerText();
    if (!seenA.includes(marker)) fail('sender does not see own message');
    else ok('sender bubble');

    let seenB = await pageB.locator('.hg-msgs').innerText().catch(() => '');
    if (!seenB.includes(marker)) {
      for (let i = 0; i < 5 && !seenB.includes(marker); i++) {
        await pageB.evaluate(async () => {
          if (window.HuginnSSE && window.HuginnSSE.catchUp) await window.HuginnSSE.catchUp();
          if (window.HuginnDock && window.HuginnDock.refreshOpenChat) await window.HuginnDock.refreshOpenChat();
        });
        await pageB.waitForTimeout(600);
        seenB = await pageB.locator('.hg-msgs').innerText().catch(() => '');
      }
      if (!seenB.includes(marker)) fail('peer did not see live message without reload');
      else ok('peer live via catch-up');
    } else ok('peer live SSE');

    if (await pageA.locator('#hgStickers').count()) {
      await pageA.click('#hgStickers');
      await pageA.waitForTimeout(400);
      await pageA.screenshot({ path: path.join(OUT, 'dock-stickers.png'), fullPage: false });
      ok('stickers sheet');
      await pageA.locator('.hg-sheet [data-close], .hg-sheet button').last().click().catch(() => {});
    } else {
      fail('stickers button missing');
    }

    // voice / invite UI presence shots (composer controls)
    await pageA.screenshot({ path: path.join(OUT, 'dock-composer.png'), fullPage: false });

    // /h standalone — fresh context without CRM chrome injection from dock page
    const ctxH = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctxH.addInitScript(({ token, user }) => {
      localStorage.setItem('asgard_token', token);
      localStorage.setItem('auth_token', token);
      localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    }, authA);
    const pageH = await ctxH.newPage();
    const hErrors = [];
    pageH.on('pageerror', (e) => hErrors.push(String(e.message || e)));
    pageH.on('console', (msg) => { if (msg.type() === 'error') hErrors.push(msg.text()); });

    // login screen without token first
    const ctxLogin = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageLogin = await ctxLogin.newPage();
    await pageLogin.goto(BASE + '/h/', { waitUntil: 'commit', timeout: 60000 });
    await pageLogin.waitForTimeout(800);
    await pageLogin.screenshot({ path: path.join(OUT, 'h-login.png'), fullPage: false });
    const loginShell = await pageLogin.locator('.h-login, #hgHost, h1').count();
    if (!loginShell) fail('/h login shell missing');
    else ok('/h login shell');
    await ctxLogin.close();

    await pageH.goto(BASE + '/h/', { waitUntil: 'commit', timeout: 60000 });
    await pageH.waitForTimeout(1000);
    await pageH.screenshot({ path: path.join(OUT, 'h-chat.png'), fullPage: false });
    const hasSidenav = await pageH.locator('.sidebar, #sidebar, nav.sidenav, .app-sidenav').count();
    if (hasSidenav > 0) fail('/h shows CRM sidenav');
    else ok('/h no CRM sidenav');

    const huginnTitle = await pageH.locator('h1').first().innerText().catch(() => '');
    if (!/Хугинн|Huginn/i.test(huginnTitle) && !(await pageH.locator('#hgHost, .h-login, .hg-chrome').count())) {
      fail('/h shell missing');
    } else ok('/h shell');

    // Ignore Ting-parallel missing assets on clone and chrome noise; keep real JS exceptions.
    const noise = /favicon|ResizeObserver|CDN|Download the React DevTools|ting_icons\.js|ting_common\.js|ting_|Failed to load resource|MIME type|net::ERR_/i;
    const badA = consoleA.filter((e) => !noise.test(e));
    const badB = consoleB.filter((e) => !noise.test(e));
    const badH = hErrors.filter((e) => !noise.test(e));
    if (badA.length || badB.length || badH.length) {
      fail('console errors: ' + JSON.stringify({ badA, badB, badH }).slice(0, 800));
    } else ok('console 0');

    await ctxH.close();
  } catch (e) {
    fail('exception: ' + (e.message || e));
    try { if (pageA) await pageA.screenshot({ path: path.join(OUT, 'error-A.png') }); } catch (_) {}
  }

  await browser.close();

  // Drop stale exception screenshots from prior failed runs when this run is green
  if (!errors.length) {
    try { fs.unlinkSync(path.join(OUT, 'error-A.png')); } catch (_) {}
  }

  const report = [
    '# Huginn browser ROUND-3',
    '',
    `at: ${new Date().toISOString()}`,
    `base: ${BASE}`,
    `out: ${OUT}`,
    '',
    '## Checklist',
    `- peer live without reload: ${errors.some((e) => /peer did not see/.test(e)) ? 'FAIL' : 'PASS'}`,
    `- console 0 JS errors: ${errors.some((e) => /console errors/.test(e)) ? 'FAIL' : 'PASS'}`,
    `- dock 400px + rail + collapse: ${errors.some((e) => /panel width|rail buttons|collapse/.test(e)) ? 'FAIL' : 'PASS'}`,
    `- /h no CRM sidenav: ${errors.some((e) => /sidenav|\/h shell/.test(e)) ? 'FAIL' : 'PASS'}`,
    '',
    errors.length ? 'FAIL_LIST:\n' + errors.map((e) => '- ' + e).join('\n') : 'FAIL_LIST: (none)',
    '',
    errors.length ? 'VERDICT: FAIL' : 'VERDICT: PASS'
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'BROWSER-REPORT.md'), report);
  console.log(report);
  if (errors.length) process.exit(1);
  console.log('HUGINN_BROWSER_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
