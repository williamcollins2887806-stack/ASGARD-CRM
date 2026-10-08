'use strict';

/**
 * Mimir Huginn-chrome — BE + UI-gate asserts on clone :3100
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const REPORT = path.join(__dirname, '../reports/HUGINN-MIMIR-TRIPLE.md');
const results = [];

function ok(id, pass, detail) {
  results.push({ id, ok: !!pass, detail: String(detail || '') });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`);
  if (!pass) throw new Error('FAIL ' + id + ': ' + detail);
}

async function login() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let data = await res.json();
  assert.ok(res.ok, JSON.stringify(data));
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    assert.ok(res.ok, JSON.stringify(data));
  }
  return { token: data.token, user: data.user };
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

(async () => {
  const auth = await login();
  const mimir = await api(auth.token, 'GET', '/api/chat-groups/mimir');
  ok('MIMIR-GET', mimir.status === 200 && mimir.data.chat_id, 'id=' + mimir.data.chat_id);
  const chatId = mimir.data.chat_id;

  const sent = await api(auth.token, 'POST', '/api/chat-groups/' + chatId + '/mimir', {
    message: 'ping triple-gate ' + Date.now()
  });
  ok(
    'MIMIR-SEND',
    sent.status === 200 && sent.data.user_message && sent.data.mimir_message,
    'status=' + sent.status
  );

  const list = await api(auth.token, 'GET', '/api/chat-groups');
  const chats = list.data.chats || list.data || [];
  // list filters is_mimir=false — row may be absent from main list by design; GET /mimir is SSOT
  ok('MIMIR-LIST-API', list.status === 200, 'n=' + (Array.isArray(chats) ? chats.length : 0));

  // Left menu without Хугинн
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/assets/js/app.js'), 'utf8');
  ok('LEFT-MENU-NO-HUGINN', !/\{r:"\/messenger",l:"Хугинн"/.test(appJs), 'entry removed');

  // UI gate: voice/circle absent in mimir composer
  const LOCAL_CSS = fs.readFileSync(path.join(__dirname, '../../public/assets/css/huginn_dock.css'), 'utf8');
  const LOCAL_JS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_dock.js'), 'utf8');
  const LOCAL_ICONS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_icons.js'), 'utf8');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('hg_dock_collapsed', '0');
  }, auth);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.HuginnDock && HuginnDock.mount), { timeout: 45000 });
  await page.addStyleTag({ content: LOCAL_CSS });
  await page.evaluate(() => {
    document.querySelectorAll('#huginnDock').forEach((el) => el.remove());
    try { delete window.HuginnDock; } catch (_) { window.HuginnDock = undefined; }
  });
  await page.addScriptTag({ content: LOCAL_ICONS });
  await page.addScriptTag({ content: LOCAL_JS });
  await page.evaluate(async () => {
    await HuginnDock.mount();
    HuginnDock.open('mimir');
  });
  await page.waitForSelector('.hg-composer.is-mimir, .hg-title-text', { timeout: 20000 });
  await page.waitForTimeout(800);
  const gate = await page.evaluate(async () => {
    const composer = !!document.querySelector('.hg-composer.is-mimir');
    const title = (document.querySelector('.hg-title-text') || {}).textContent || '';
    const attach = document.querySelector('#hgAttach');
    if (attach) attach.click();
    await new Promise((r) => setTimeout(r, 250));
    const voice = !!document.querySelector('.hg-attach-menu [data-kind="voice"]');
    const circle = !!document.querySelector('.hg-attach-menu [data-kind="circle"]');
    const photo = !!document.querySelector('.hg-attach-menu [data-kind="image"]');
    const file = !!document.querySelector('.hg-attach-menu [data-kind="file"]');
    document.querySelectorAll('.hg-attach-menu').forEach((el) => el.remove());
    const sendMic = !!document.querySelector('#hgSend.is-mic');
    return { composer, title, voice, circle, photo, file, sendMic };
  });
  ok('MIMIR-UI-CHROME', gate.composer && /мимир/i.test(gate.title), JSON.stringify(gate));
  ok('MIMIR-NO-VOICE', !gate.voice && !gate.sendMic, JSON.stringify(gate));
  ok('MIMIR-NO-CIRCLE', !gate.circle, JSON.stringify(gate));
  ok('MIMIR-HAS-FILE-PHOTO', gate.photo && gate.file, JSON.stringify(gate));
  await browser.close();

  const md = [
    '# HUGINN-MIMIR-TRIPLE',
    '',
    `Base: ${BASE}`,
    `PASS ${results.filter((r) => r.ok).length} / ${results.length}`,
    '',
    '| Case | Result | Detail |',
    '|------|--------|--------|',
    ...results.map((r) => `| ${r.id} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`),
    ''
  ].join('\n');
  fs.writeFileSync(REPORT, md, 'utf8');
  console.log('REPORT', REPORT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
