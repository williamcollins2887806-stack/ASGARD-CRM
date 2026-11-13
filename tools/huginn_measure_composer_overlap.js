'use strict';
/**
 * Замер: перекрывает ли композер последние сообщения в открытом чате Хугинна,
 * и какого размера шрифт пузыря. Воспроизводит жалобу 13.11.2026:
 *   «в боковом меню смс начинаются ниже инпута ввода, не могу прочитать что снизу»
 *   «уменьши шрифт — очень большой»
 *
 * Run: node tools/huginn_measure_composer_overlap.js
 * Requires clone :3100.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const VIEWPORT = { width: 543, height: 1024 }; // как на скриншоте заказчика
const OUT = path.join(__dirname, '../tests/reports/huginn-ui/OVERLAP-DIAG');

fs.mkdirSync(OUT, { recursive: true });

const LOCAL_CSS = fs.readFileSync(path.join(__dirname, '../public/assets/css/huginn_dock.css'), 'utf8');
const LOCAL_JS = fs.readFileSync(path.join(__dirname, '../public/assets/js/huginn_dock.js'), 'utf8');
const LOCAL_ICONS = fs.readFileSync(path.join(__dirname, '../public/assets/js/huginn_icons.js'), 'utf8');
const LOCAL_PHONE_CSS = fs.readFileSync(path.join(__dirname, '../public/assets/css/phone.css'), 'utf8');
const LOCAL_PHONE_JS = fs.readFileSync(path.join(__dirname, '../public/assets/js/phone_ui.js'), 'utf8');

async function apiLogin() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login: ' + JSON.stringify(data));
  return {
    token: data.token,
    user: data.user || {},
    needPin: data.status === 'need_pin' || data.pinVerified === false
  };
}

async function verifyPin(token) {
  const res = await fetch(BASE + '/api/auth/verify-pin', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: PIN })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error('pin: ' + JSON.stringify(data).slice(0, 200));
  return data.token;
}

async function main() {
  const auth = await apiLogin();
  if (auth.needPin) auth.token = await verifyPin(auth.token);
  console.log('login ok:', auth.user && (auth.user.name || auth.user.login), '| pin:', !!auth.needPin);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 160)); });

  await page.goto(BASE, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    try { localStorage.setItem('asgard_token', t); } catch (_) {}
    try { localStorage.setItem('token', t); } catch (_) {}
  }, auth.token);

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelectorAll('#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback').forEach((el) => {
      try { el.style.setProperty('display', 'none', 'important'); el.remove(); } catch (_) {}
    });
  });

  await page.addStyleTag({ content: LOCAL_CSS });
  await page.addStyleTag({ content: LOCAL_PHONE_CSS });
  await page.evaluate(() => {
    document.querySelectorAll('#huginnDock, .hg-chrome, .hg-bottom-nav, .hg-nav-search').forEach((el) => el.remove());
    document.body.classList.remove('hg-dock-open', 'hg-dock-collapsed');
    try { delete window.HuginnDock; } catch (_) { window.HuginnDock = undefined; }
  });
  await page.addScriptTag({ content: LOCAL_ICONS });
  await page.addScriptTag({ content: LOCAL_PHONE_JS });
  await page.addScriptTag({ content: LOCAL_JS });
  await page.evaluate(async () => {
    await window.HuginnDock.mount();
    window.HuginnDock.open('huginn');
  });
  await page.waitForSelector('#huginnDock', { timeout: 20000 });
  await page.waitForTimeout(2500);

  // Открываем первый доступный чат.
  const opened = await page.evaluate(() => {
    const row = document.querySelector('.hg-chat-row');
    if (!row) return null;
    row.click();
    return row.getAttribute('data-cid');
  });
  console.log('открыт чат cid:', opened);
  await page.waitForTimeout(3000);

  const report = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const box = q('.hg-msgs');
    const composer = q('.hg-thread .hg-composer') || q('.hg-composer');
    const thread = q('.hg-thread');
    const bubbles = Array.from(document.querySelectorAll('.hg-msgs .hg-bubble'));
    const out = {};

    if (!box || !composer) return { error: 'нет .hg-msgs или .hg-composer', hasBox: !!box, hasComposer: !!composer };

    const boxRect = box.getBoundingClientRect();
    const compRect = composer.getBoundingClientRect();
    const cs = getComputedStyle(box);
    const csC = getComputedStyle(composer);

    out.viewport = { w: window.innerWidth, h: window.innerHeight };
    out.visualViewportH = window.visualViewport ? Math.round(window.visualViewport.height) : null;
    out.msgs = {
      top: Math.round(boxRect.top), bottom: Math.round(boxRect.bottom), height: Math.round(boxRect.height),
      clientHeight: box.clientHeight, scrollHeight: box.scrollHeight,
      paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
      overflowY: cs.overflowY
    };
    out.composer = {
      top: Math.round(compRect.top), bottom: Math.round(compRect.bottom), height: Math.round(compRect.height),
      position: csC.position, zIndex: csC.zIndex, paddingBottom: csC.paddingBottom
    };
    out.composerVarOnThread = thread ? thread.style.getPropertyValue('--hg-composer-height') : null;
    out.overlapPx = Math.round(Math.max(0, boxRect.bottom - compRect.top));

    // Последний пузырь: виден ли он целиком над композером.
    const last = bubbles[bubbles.length - 1];
    if (last) {
      const r = last.getBoundingClientRect();
      out.lastBubble = { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
      out.lastBubbleHiddenBehindComposerPx = Math.round(Math.max(0, r.bottom - compRect.top));
      out.lastBubbleFullyAboveComposer = r.bottom <= compRect.top;
    }

    // Шрифт пузыря и композера.
    if (bubbles[0]) {
      const bs = getComputedStyle(bubbles[0]);
      out.bubbleFont = { size: bs.fontSize, lineHeight: bs.lineHeight, family: bs.fontFamily.slice(0, 40) };
    }
    const ta = q('#hgInput');
    if (ta) {
      const ts = getComputedStyle(ta);
      out.inputFont = { size: ts.fontSize, lineHeight: ts.lineHeight };
    }
    out.threadVarBody = getComputedStyle(document.documentElement).getPropertyValue('--hg-font-body').trim();
    out.bubbleCount = bubbles.length;
    out.isThreadClass = document.querySelector('.hg-chrome')?.classList.contains('is-thread');
    out.chromeIsThread = !!document.querySelector('.hg-chrome.is-thread');
    return out;
  });

  console.log('\n=== ЗАМЕР ===');
  console.log(JSON.stringify(report, null, 2));

  const shotPath = path.join(OUT, 'scroll-bottom.png');
  await page.screenshot({ path: shotPath });
  // Прокрутим в самый низ и снимем ещё раз — так видно, читается ли последнее.
  await page.evaluate(() => {
    const b = document.querySelector('.hg-msgs');
    if (b) b.scrollTop = b.scrollHeight;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'scrolled-to-bottom.png') });
  console.log('\nснимки:', OUT);

  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(report, null, 2), 'utf8');
  await browser.close();
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
