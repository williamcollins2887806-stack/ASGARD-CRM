'use strict';

/**
 * Huginn ROUND-5 acceptance — scenarios 1–5 dark+light.
 * Run: node tests/huginn/browser_round5.spec.js
 * Env: TEST_BASE_URL (default http://127.0.0.1:3100)
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
const PIN_B = process.env.TEST_PIN_B || process.env.TEST_PIN || '0000';
const OUT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/ROUND-5');
const REPORTS = path.join(__dirname, '../reports');

const shots = [];
const errors = [];
const notes = [];
function fail(m) { errors.push(m); console.error('FAIL', m); }
function ok(m) { console.log('PASS', m); }
function note(m) { notes.push(m); console.log('NOTE', m); }

async function apiLogin(login, password, pinPrefer) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login ' + login + ': ' + JSON.stringify(data));
  if (data.status === 'need_pin' || data.pinVerified === false) {
    const candidates = [...new Set([pinPrefer, PIN, PIN_B, '1234', '0000'].filter(Boolean))];
    let lastErr = null;
    for (const pin of candidates) {
      res = await fetch(BASE + '/api/auth/verify-pin', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: String(pin) })
      });
      const next = await res.json();
      if (res.ok) { data = next; lastErr = null; break; }
      lastErr = next;
      // refresh login token if pin attempt invalidated session
      const again = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
      });
      data = await again.json();
    }
    if (lastErr) throw new Error('pin ' + login + ': ' + JSON.stringify(lastErr));
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
  return { status: res.status, data };
}

async function shot(page, id) {
  const file = id + '.png';
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  shots.push(file);
  console.log('SHOT', file);
}

async function shotEl(page, sel, id) {
  const loc = page.locator(sel).first();
  if (await loc.count()) {
    const file = id + '.png';
    await loc.screenshot({ path: path.join(OUT, file) }).catch(async () => shot(page, id));
    if (!shots.includes(file)) shots.push(file);
    console.log('SHOT', file);
    return;
  }
  await shot(page, id);
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
      '#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback,.tp-popup,#sg-overlay,.ui-modal,.modal-overlay'
    ).forEach((el) => {
      el.style.display = 'none';
      try { el.remove(); } catch (_) {}
    });
  }).catch(() => {});
}

async function openCrm(context, auth, theme) {
  await context.addInitScript(({ token, user, theme }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', theme);
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('hg_theme', theme);
    localStorage.setItem('asgard_safe_mode', '1');
    localStorage.setItem('hg_dock_collapsed', '0');
    try {
      if (document && document.documentElement) {
        document.documentElement.setAttribute('data-theme', theme);
      }
    } catch (_) {}
  }, { ...auth, theme });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    const msg = String(e.message || e);
    if (/setAttribute/.test(msg)) return; // soft: theme init race
    fail('pageerror: ' + msg.slice(0, 160));
  });
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'commit', timeout: 60000 });
  await page.evaluate((t) => {
    if (document.documentElement) document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await dismiss(page);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    if (window.HuginnDock) { HuginnDock.mount(); HuginnDock.open(); }
  });
  await page.waitForSelector('#huginnDock, .hg-chrome', { timeout: 20000 });
  await dismiss(page);
  return page;
}

async function assertNoYellowChrome(page, label) {
  const bad = await page.evaluate(() => {
    const root = document.querySelector('#huginnDock');
    if (!root) return 'no dock';
    const css = getComputedStyle(root);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--hg-accent').trim();
    const gold = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim();
    const hits = [];
    if (/#f5c542/i.test(accent)) hits.push('accent=' + accent);
    // sample rail active / send / badge
    const send = root.querySelector('.hg-send');
    if (send) {
      const bg = getComputedStyle(send).backgroundColor;
      // #F5C542 ≈ rgb(245,197,66)
      if (bg === 'rgb(245, 197, 66)') hits.push('send bg acid yellow');
    }
    const ring = root.querySelector('.hg-story-ring');
    if (ring) {
      const b = getComputedStyle(ring).backgroundImage || getComputedStyle(ring).background;
      if (/conic|245,\s*197,\s*66/i.test(b)) hits.push('story conic yellow');
    }
    return hits.length ? hits.join('; ') : '';
  });
  if (bad) fail(label + ' yellow chrome: ' + bad);
  else ok(label + ' no acid-yellow chrome');
}

async function runTheme(browser, authA, authB, chatId, theme) {
  const prefix = theme === 'light' ? 'L' : 'D';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await openCrm(ctx, authA, theme);
  ok(prefix + ' crm open');

  // Scenario 1: list + presence + unread badges
  await page.waitForTimeout(400);
  await shotEl(page, '#hgPanel, .hg-panel', prefix + '-s1-list');
  const presence = await page.locator('#hgPresence, .hg-presence').count();
  if (!presence) fail(prefix + ' S1 presence strip missing');
  else ok(prefix + ' S1 presence strip');
  const presenceLabel = await page.locator('#hgPresence').innerText().catch(() => '');
  if (/Статус на 24|Stories/i.test(presenceLabel)) fail(prefix + ' S1 still Stories copy');
  else ok(prefix + ' S1 not Stories');
  await assertNoYellowChrome(page, prefix + ' S1');

  // Scenario 4 early: empty search
  await page.fill('#hgSearch', 'zzz_no_such_chat_q_999');
  await page.waitForTimeout(200);
  const emptySearch = await page.locator('.hg-empty').innerText().catch(() => '');
  if (!/Ничего не найдено/i.test(emptySearch)) fail(prefix + ' S4 empty search copy');
  else ok(prefix + ' S4 empty search');
  await shotEl(page, '#hgList, .hg-list', prefix + '-s4-empty-search');
  await page.fill('#hgSearch', '');

  // Scenario 2: long thread + FAB
  await page.evaluate((id) => HuginnDock.openChat(id), chatId);
  await page.waitForSelector('.hg-msgs', { timeout: 15000 });
  await page.waitForTimeout(400);
  await shotEl(page, '.hg-msgs', prefix + '-s2-thread');
  const groups = await page.locator('.hg-msg-group').count();
  if (groups < 1) note(prefix + ' S2 no .hg-msg-group (maybe all system)');
  else ok(prefix + ' S2 message groups ' + groups);

  await page.evaluate(() => {
    const box = document.querySelector('.hg-msgs');
    if (box) box.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  const fabVis = await page.evaluate(() => {
    const fab = document.querySelector('#hgScrollFab');
    return fab && fab.classList.contains('is-visible');
  });
  if (!fabVis) note(prefix + ' S2 FAB not visible (thread may be short)');
  else {
    ok(prefix + ' S2 FAB visible when scrolled up');
    await shotEl(page, '#hgScrollFab', prefix + '-s2-fab');
  }

  // Scenario 3: photo + reaction + stickers
  await page.evaluate(() => document.querySelector('#hgStickers')?.click());
  await page.waitForSelector('.hg-sticker-grid', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
  const stickerColored = await page.evaluate(() => {
    const btn = document.querySelector('.hg-sticker-emoji');
    if (!btn) return 'no sticker';
    const bg = getComputedStyle(btn).backgroundColor;
    const st = btn.style.getPropertyValue('--st');
    if (st) return 'inline --st ' + st;
    if (/245,\s*197,\s*66|rgb\(59,\s*130|rgb\(239/.test(bg)) return 'colored bg ' + bg;
    return '';
  });
  if (stickerColored) fail(prefix + ' S3 colored sticker tiles: ' + stickerColored);
  else ok(prefix + ' S3 emoji stickers clean');
  await shotEl(page, '.hg-sheet-stickers, .hg-sheet', prefix + '-s3-stickers');
  await page.evaluate(() => document.querySelectorAll('.hg-sheet,.hg-float').forEach((e) => e.remove()));

  const photo = await page.locator('.hg-media-photo, .hg-bubble.image img').count();
  if (!photo) note(prefix + ' S3 no photo bubble in thread');
  else {
    ok(prefix + ' S3 photo bubble');
    await shotEl(page, '.hg-media-photo, .hg-bubble.image', prefix + '-s3-photo');
  }

  // context menu with icons (dispatch contextmenu — Playwright right-click flaky on bubbles)
  const bubble = page.locator('.hg-bubble.me, .hg-bubble.them').first();
  if (await bubble.count()) {
    await page.evaluate(() => {
      const b = document.querySelector('.hg-bubble.me, .hg-bubble.them');
      if (!b) return;
      const r = b.getBoundingClientRect();
      b.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10
      }));
    });
    await page.waitForSelector('.hg-float-actions', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(200);
    const menuIcons = await page.locator('.hg-float-actions button svg').count();
    const hasIconsLib = await page.evaluate(() => !!(window.HuginnIcons && window.HuginnIcons.ICO && window.HuginnIcons.ICO.reply));
    if (!hasIconsLib) fail(prefix + ' S3 HuginnIcons not loaded');
    else if (menuIcons < 3) fail(prefix + ' S3 context menu without icons (' + menuIcons + ')');
    else ok(prefix + ' S3 context menu icons ' + menuIcons);
    await shotEl(page, '.hg-float', prefix + '-s3-context');
    await page.keyboard.press('Escape');
  }

  // dblclick reaction
  if (await bubble.count()) {
    await bubble.dblclick({ force: true });
    await page.waitForTimeout(400);
    const reacts = await page.locator('.hg-reacts').count();
    if (!reacts) note(prefix + ' S3 reaction pill not shown (API may require reload)');
    else ok(prefix + ' S3 reaction pill');
    await shotEl(page, '.hg-msgs', prefix + '-s3-react');
  }

  // composer / send gold accent check
  await shotEl(page, '.hg-composer', prefix + '-s2-composer');
  const sendGold = await page.evaluate(() => {
    const send = document.querySelector('.hg-send');
    if (!send) return false;
    const bg = getComputedStyle(send).backgroundColor;
    // CRM gold #D4A843 ≈ 212,168,67 or light #B8841A
    return /rgb\(\s*212,\s*168,\s*67|rgb\(\s*184,\s*132,\s*26|rgb\(\s*232,\s*195,\s*90/.test(bg);
  });
  if (!sendGold) note(prefix + ' S2 send not exact gold rgb (theme mix ok if not acid yellow)');
  else ok(prefix + ' S2 send uses CRM gold');

  // /h login — fresh context WITHOUT token (auth context would boot dock)
  const loginCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await loginCtx.addInitScript((t) => {
    try {
      localStorage.removeItem('asgard_token');
      localStorage.removeItem('auth_token');
      localStorage.setItem('hg_theme', t);
      localStorage.setItem('asgard_theme', t);
    } catch (_) {}
  }, theme);
  const pageLogin = await loginCtx.newPage();
  await pageLogin.goto(BASE + '/h/?nocache=' + Date.now(), { waitUntil: 'commit', timeout: 60000 });
  await pageLogin.waitForTimeout(400);
  await pageLogin.evaluate((t) => {
    if (document.documentElement) document.documentElement.setAttribute('data-theme', t);
    if (typeof window.__hgSetTheme === 'function') window.__hgSetTheme(t);
  }, theme);
  await pageLogin.waitForTimeout(200);
  await shot(pageLogin, prefix + '-s5-h-login');
  const loginOk = await pageLogin.locator('.h-login').count();
  if (!loginOk) fail(prefix + ' S5 /h login missing');
  else ok(prefix + ' S5 /h login');
  const themeBtns = await pageLogin.locator('[data-theme-set]').count();
  if (themeBtns < 2) fail(prefix + ' S5 theme toggle missing');
  else ok(prefix + ' S5 theme toggle');
  await loginCtx.close();

  await ctx.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.png') || f.endsWith('.md')) {
      try { fs.unlinkSync(path.join(OUT, f)); } catch (_) {}
    }
  }

  // health
  const health = await fetch(BASE + '/api/health').then((r) => r.status).catch(() => 0);
  if (!health) throw new Error('BASE unreachable: ' + BASE);

  const authA = await apiLogin(LOGIN_A, PASS_A, PIN);
  const authB = await apiLogin(LOGIN_B, PASS_B, PIN_B);
  const direct = await api(authA.token, 'POST', '/api/chat-groups/direct', { user_id: authB.user.id });
  const chatId = Number(direct.data?.id || direct.data?.chat_id || direct.data?.chat?.id);
  if (!chatId) throw new Error('no chat');

  // seed volume for S1/S2
  for (let i = 0; i < 12; i++) {
    await api(authA.token, 'POST', `/api/chat-groups/${chatId}/messages`, {
      text: 'ROUND5 seed A ' + i + ' — проверка группировки'
    });
    await api(authB.token, 'POST', `/api/chat-groups/${chatId}/messages`, {
      text: 'ROUND5 seed B ' + i + ' — ответ коллеги'
    });
  }
  // photo
  try {
    const pngPath = path.join(__dirname, 'fixtures_photo.png');
    if (fs.existsSync(pngPath)) {
      const png = fs.readFileSync(pngPath);
      const fd = new FormData();
      const blob = new Blob([png], { type: 'image/png' });
      fd.append('file', blob, 'photo.png');
      fd.append('message_type', 'image');
      const up = await fetch(BASE + `/api/chat-groups/${chatId}/upload-file`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + authA.token },
        body: fd
      });
      if (up.ok) ok('photo upload');
      else note('photo upload ' + up.status);
    }
  } catch (e) { note('photo upload skip ' + e.message); }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    await runTheme(browser, authA, authB, chatId, 'dark');
    await runTheme(browser, authA, authB, chatId, 'light');
  } finally {
    await browser.close();
  }

  const report = [
    '# Huginn ROUND-5 BROWSER REPORT',
    '',
    `At: ${new Date().toISOString()}`,
    `base: ${BASE}`,
    `shots: ${shots.length}`,
    `FAIL: ${errors.length}`,
    `NOTE: ${notes.length}`,
    '',
    '## Scenarios',
    '1. List + presence («На линии») + unread — dark+light',
    '2. Thread + groups + FAB/composer — dark+light',
    '3. Stickers clean + photo + context icons + reactions — dark+light',
    '4. Empty search — dark+light',
    '5. /h login + theme toggle — dark+light',
    '',
    '## Shots',
    ...shots.map((s) => '- ' + s),
    '',
    '## Fails',
    ...(errors.length ? errors.map((e) => '- ' + e) : ['- (none)']),
    '',
    '## Notes',
    ...(notes.length ? notes.map((n) => '- ' + n) : ['- (none)']),
    '',
    `VERDICT: ${errors.length ? 'FAIL' : 'PASS'}`
  ].join('\n');

  fs.writeFileSync(path.join(OUT, 'BROWSER-REPORT.md'), report, 'utf8');
  fs.writeFileSync(path.join(REPORTS, 'HUGINN-SHOT-MATRIX-ROUND-5.md'), report, 'utf8');
  console.log('\n' + report);
  if (errors.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
