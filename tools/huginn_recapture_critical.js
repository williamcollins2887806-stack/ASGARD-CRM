'use strict';

/**
 * Honest rematrix — recapture scenes that were wrong/dupe:
 * S09 voice record bar, S10 circle record bar, S12 contacts+glass nav,
 * S32 settings root, S13 compose opaque, S18 media grid (via profile tabs).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const OUT = path.join(__dirname, '../VERIFY/PREDEPLOY-VISUAL/CAPTURE');
const LOCAL_CSS = fs.readFileSync(path.join(__dirname, '../public/assets/css/huginn_dock.css'), 'utf8');
const LOCAL_JS = fs.readFileSync(path.join(__dirname, '../public/assets/js/huginn_dock.js'), 'utf8');
const LOCAL_ICONS = fs.readFileSync(path.join(__dirname, '../public/assets/js/huginn_icons.js'), 'utf8');

async function login() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login');
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
  }
  return { token: data.token, user: data.user || {} };
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log('SHOT', name, fs.statSync(file).size);
}

(async () => {
  if (process.env.HUGINN_AI_STUB === '1' || process.env.HUGINN_STT_STUB === '1') {
    throw new Error('Refuse stubs on capture');
  }
  const auth = await login();
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-fake-device-permission-for-media-stream'
    ]
  });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ['microphone', 'camera']
  });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('hg_theme', 'dark');
    localStorage.setItem('asgard_safe_mode', '1');
  }, auth);
  const page = await ctx.newPage();
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.querySelectorAll('#asgard-presence-gate,#asgard-splash,.cr-m-overlay').forEach((el) => {
      try { el.remove(); } catch (_) {}
    });
  });
  await page.addStyleTag({ content: LOCAL_CSS });
  await page.addScriptTag({ content: LOCAL_ICONS });
  await page.addScriptTag({ content: LOCAL_JS });
  await page.waitForFunction(() => !!(window.HuginnDock && HuginnDock.mount), { timeout: 20000 });
  await page.evaluate(async () => {
    document.querySelectorAll('#huginnDock, .hg-chrome').forEach((el) => el.remove());
    await HuginnDock.mount();
    HuginnDock.open('huginn');
  });
  await page.waitForSelector('#huginnDock #hgPanel', { state: 'attached', timeout: 20000 });

  // S01 / S36 list + tabbar
  await shot(page, 'CRM-S01-chat-list-dark.png');
  await shot(page, 'CRM-S36-glass-tabbar-fab.png');

  // S12 contacts + glass nav
  await page.evaluate(() => {
    const b = document.querySelector('.hg-bottom-nav button[data-mnav="contacts"]');
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  await shot(page, 'CRM-S02-contacts-list.png');
  await shot(page, 'CRM-S12-contacts-glass-nav.png');

  // S32 settings
  await page.evaluate(() => {
    const b = document.querySelector('.hg-bottom-nav button[data-mnav="settings"]');
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  await shot(page, 'CRM-S32-settings-root.png');
  await shot(page, 'CRM-S29-settings-profile.png');
  await shot(page, 'CRM-S33-settings-menu.png');
  await shot(page, 'CRM-S34-settings-compact.png');

  // S13 compose
  await page.evaluate(() => {
    const b = document.querySelector('.hg-bottom-nav button[data-mnav="chats"]');
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const c = document.querySelector('#hgCompose');
    if (c) c.click();
  });
  await page.waitForTimeout(600);
  await shot(page, 'CRM-S13-compose-create.png');
  await page.evaluate(() => {
    const x = document.querySelector('#hgComposeClose');
    if (x) x.click();
    else document.querySelectorAll('.hg-compose-sheet').forEach((el) => el.remove());
  });

  // open chat
  const chatId = await page.evaluate(async (token) => {
    const res = await fetch('/api/chat-groups', { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    const chat = (data.chats || []).find((c) => Number(c.id) > 0 && !/мимир/i.test(String(c.name || '')));
    if (!chat) return null;
    await HuginnDock.openChat(chat.id);
    return chat.id;
  }, auth.token);
  if (!chatId) throw new Error('no chat');
  await page.waitForTimeout(800);
  await shot(page, 'CRM-S05-group-chat-ios-dark.png');
  await shot(page, 'CRM-S11-ios-chat-bubbles.png');
  await shot(page, 'CRM-S28-composer-glass.png');

  // S10 attach menu entry
  await page.evaluate(() => {
    const a = document.querySelector('#hgAttach');
    if (a) a.click();
  });
  await page.waitForTimeout(400);
  await shot(page, 'CRM-S10-circle-entry.png');

  // S10 circle record overlay
  await page.evaluate(() => {
    const c = document.querySelector('.hg-attach-menu [data-kind="circle"]');
    if (c) c.click();
  });
  await page.waitForTimeout(1000);
  await shot(page, 'CRM-S10-circle-record.png');
  await page.evaluate(() => {
    const stop = document.querySelector('#hgRecStop');
    if (stop) stop.click();
    document.querySelectorAll('.hg-rec-bar,.hg-attach-menu').forEach((el) => el.remove());
    const dock = document.getElementById('huginnDock');
    if (dock) dock.classList.remove('is-recording');
    document.body.classList.remove('hg-recording');
  });
  await page.waitForTimeout(500);

  // S09 voice record
  await page.evaluate(() => {
    const a = document.querySelector('#hgAttach');
    if (a) a.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const v = document.querySelector('.hg-attach-menu [data-kind="voice"]');
    if (v) v.click();
  });
  await page.waitForTimeout(1000);
  await shot(page, 'CRM-S09-voice-record-locked.png');
  await page.evaluate(() => {
    const stop = document.querySelector('#hgRecStop');
    if (stop) stop.click();
    document.querySelectorAll('.hg-rec-bar,.hg-attach-menu').forEach((el) => el.remove());
    const dock = document.getElementById('huginnDock');
    if (dock) dock.classList.remove('is-recording');
    document.body.classList.remove('hg-recording');
  });
  await page.waitForTimeout(400);

  // profile + shared
  await page.evaluate(() => {
    const b = document.querySelector('#hgThreadProfile');
    if (b) b.click();
  });
  await page.waitForTimeout(800);
  await shot(page, 'CRM-S06-profile-main.png');
  await shot(page, 'CRM-S03-group-profile.png');
  await page.evaluate(() => {
    const t = document.querySelector('[data-stab="media"], .hg-profile-tab[data-tab="media"]');
    if (t) t.click();
  });
  await page.waitForTimeout(400);
  await shot(page, 'CRM-S18-shared-media-grid.png');
  await page.evaluate(() => {
    const m = document.querySelector('#hgProfileMore');
    if (m) m.click();
  });
  await page.waitForTimeout(300);
  await shot(page, 'CRM-S19-profile-more.png');
  await shot(page, 'CRM-S16-mute-menu.png');

  fs.writeFileSync(
    path.join(OUT, 'manifest-critical.json'),
    JSON.stringify({ at: new Date().toISOString(), chatId, note: 'honest rematrix critical recapture' }, null, 2)
  );
  await browser.close();
  console.log('RECAPTURE_CRITICAL_OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
