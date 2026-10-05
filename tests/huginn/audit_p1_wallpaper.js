'use strict';

/**
 * P1 runtime asserts — reuses capture openDock/login.
 * Run: node tests/huginn/audit_p1_wallpaper.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const PIN = process.env.TEST_PIN || '1234';
const PIN_B = process.env.TEST_PIN_B || '1234';
const CSS = fs.readFileSync(path.join(__dirname, '../../public/assets/css/huginn_dock.css'), 'utf8');
const ICONS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_icons.js'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_dock.js'), 'utf8');
const OUT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/PHASE-1');
fs.mkdirSync(OUT, { recursive: true });

function fail(m) { console.error('FAIL', m); process.exitCode = 1; }
function ok(m) { console.log('PASS', m); }
function parseRgb(s) {
  const m = String(s || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

async function apiLogin(login, password, pinPrefer) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login ' + login + ': ' + JSON.stringify(data));
  if (data.status === 'need_setup') throw new Error(login + ' need_setup');
  if (data.status === 'need_pin' || data.pinVerified === false) {
    const pins = [...new Set([pinPrefer, PIN, PIN_B, '1234', '0000'].filter(Boolean))];
    let last = null;
    for (const pin of pins) {
      res = await fetch(BASE + '/api/auth/verify-pin', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: String(pin) })
      });
      const next = await res.json();
      if (res.ok) { data = next; last = null; break; }
      last = next;
      const again = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
      });
      data = await again.json();
    }
    if (last) throw new Error('pin ' + login + ': ' + JSON.stringify(last));
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
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function dismiss(page) {
  await page.evaluate(() => {
    document.querySelectorAll(
      '#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback,.tp-popup,#sg-overlay,.ui-modal,.modal-overlay'
    ).forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
      try { el.remove(); } catch (_) {}
    });
  }).catch(() => {});
}

(async () => {
  const auth = await apiLogin('admin', 'huginn-test-ok', '1234');
  const authB = await apiLogin('test_pm', 'huginn-test-ok', '1234');
  const direct = await api(auth.token, 'POST', '/api/chat-groups/direct', { user_id: authB.user.id });
  const chatId = Number(direct.data?.id || direct.data?.chat_id || direct.data?.chat?.id);
  if (!chatId) throw new Error('no chat ' + JSON.stringify(direct));

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('hg_theme', 'dark');
    localStorage.setItem('asgard_safe_mode', '1');
    localStorage.setItem('hg_dock_collapsed', '0');
    try { localStorage.setItem('asgard_v2_banner_dismissed', '1'); } catch (_) {}
  }, auth);
  const page = await ctx.newPage();
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.addStyleTag({ content: CSS });
  await page.evaluate(() => {
    document.querySelectorAll('#huginnDock, .hg-chrome, .hg-bottom-nav').forEach((el) => el.remove());
    if (document.body) document.body.classList.remove('hg-dock-open', 'hg-dock-collapsed');
  });
  await page.addScriptTag({ content: ICONS });
  await page.addScriptTag({ content: JS });
  await dismiss(page);
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    await HuginnDock.mount();
    HuginnDock.open();
  });
  await page.waitForSelector('#huginnDock', { timeout: 20000 });
  await page.evaluate(async (id) => { await HuginnDock.openChat(id); }, chatId);
  await page.waitForSelector('.hg-msgs', { timeout: 15000 });
  // ensure at least some height / scrollable content
  await page.evaluate(() => {
    const m = document.querySelector('.hg-msgs');
    if (m && m.children.length < 3) {
      for (let i = 0; i < 12; i++) {
        const d = document.createElement('div');
        d.className = 'hg-bubble me';
        d.textContent = 'seed ' + i;
        d.style.margin = '8px 0';
        m.appendChild(d);
      }
    }
  });
  await page.waitForTimeout(200);

  const proof = await page.evaluate(() => {
    const msgs = document.querySelector('.hg-msgs');
    const thread = document.querySelector('.hg-thread');
    const composer = document.querySelector('.hg-composer');
    const me = document.querySelector('.hg-bubble.me');
    const m = getComputedStyle(msgs);
    const t = getComputedStyle(thread);
    const c = getComputedStyle(composer);
    const meCs = me ? getComputedStyle(me) : null;
    msgs.scrollTop = 0;
    const y0 = m.backgroundPositionY;
    msgs.scrollTop = Math.min(180, Math.max(0, msgs.scrollHeight - msgs.clientHeight));
    const m2 = getComputedStyle(msgs);
    return {
      image: m.backgroundImage,
      attach: m.backgroundAttachment,
      color: m.backgroundColor,
      size: m.backgroundSize,
      threadBg: t.backgroundColor,
      composerOpacity: c.opacity,
      composerBg: c.backgroundColor,
      meBg: meCs && meCs.backgroundColor,
      meOpacity: meCs && meCs.opacity,
      scrollTop: msgs.scrollTop,
      bgPosBefore: y0,
      bgPosAfter: m2.backgroundPositionY
    };
  });
  console.log('P1_RUNTIME', JSON.stringify(proof, null, 2));

  if (!/hg-chat-pattern\.svg/.test(proof.image || '')) fail('pattern url missing');
  else ok('pattern url');
  const attach = String(proof.attach || '').toLowerCase();
  if (!attach.includes('local')) fail('attachment missing local: ' + proof.attach);
  else ok('attachment includes local: ' + proof.attach);
  if (!/radial-gradient/i.test(proof.image || '')) fail('dark missing radial-gradient layer');
  else ok('radial-gradient layer');
  const rgb = parseRgb(proof.color);
  if (!rgb || rgb[0] !== 14 || rgb[1] !== 22 || rgb[2] !== 33) fail('msgs bg ' + proof.color);
  else ok('msgs #0E1621');
  if (/rgb\(\s*21\s*,\s*25\s*,\s*34/.test(proof.threadBg || '')) fail('thread is --bg2');
  else ok('thread not --bg2');
  const me = parseRgb(proof.meBg);
  if (me && (me[0] !== 43 || me[1] !== 82 || me[2] !== 120)) fail('me bubble ' + proof.meBg);
  else if (me) ok('me #2B5278');
  if (Number(proof.composerOpacity) < 1) fail('composer opacity');
  else ok('composer opaque');

  const box = await page.locator('.hg-msgs').boundingBox();
  if (box) {
    await page.screenshot({
      path: path.join(OUT, 'P1-msgs-wallpaper-crop.png'),
      clip: { x: box.x, y: box.y, width: Math.min(box.width, 360), height: Math.min(box.height, 420) }
    });
  }
  await browser.close();
  if (process.exitCode) process.exit(1);
  ok('P1 runtime green');
})().catch((e) => { console.error(e); process.exit(1); });
