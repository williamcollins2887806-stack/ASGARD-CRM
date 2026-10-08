'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '../VERIFY/PREDEPLOY-VISUAL/CAPTURE');
const CSS = fs.readFileSync(path.join(__dirname, '../public/assets/css/huginn_dock.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '../public/assets/js/huginn_dock.js'), 'utf8');
const ICO = fs.readFileSync(path.join(__dirname, '../public/assets/js/huginn_icons.js'), 'utf8');

async function login() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'huginn-test-ok' })
  });
  let data = await res.json();
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234' })
    });
    data = await res.json();
  }
  return { token: data.token, user: data.user || {} };
}

(async () => {
  const auth = await login();
  const ch = await fetch(BASE + '/api/chat-groups', {
    headers: { Authorization: 'Bearer ' + auth.token }
  }).then((r) => r.json());
  let target = null;
  for (const c of ch.chats || []) {
    if (Number(c.id) <= 0) continue;
    if (/мимир/i.test(String(c.name || ''))) continue;
    const sh = await fetch(BASE + '/api/chat-groups/' + c.id + '/shared', {
      headers: { Authorization: 'Bearer ' + auth.token }
    }).then((r) => r.json()).catch(() => ({}));
    if ((sh.media || []).length > 0) {
      target = { id: c.id, n: (sh.media || []).length };
      break;
    }
  }
  if (!target) {
    const c = (ch.chats || []).find((x) => Number(x.id) > 0 && !/мимир/i.test(String(x.name || '')));
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'dot.png');
    fd.append('message_type', 'image');
    await fetch(BASE + '/api/chat-groups/' + c.id + '/upload-file', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + auth.token },
      body: fd
    });
    target = { id: c.id, n: 1 };
  }
  console.log('target', target);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
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
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: CSS });
  await page.addScriptTag({ content: ICO });
  await page.addScriptTag({ content: JS });
  await page.evaluate(async () => {
    await HuginnDock.mount();
    HuginnDock.open('huginn');
  });
  await page.waitForSelector('#huginnDock');
  await page.evaluate(async (id) => {
    await HuginnDock.openChat(id);
  }, target.id);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('#hgThreadProfile') && document.querySelector('#hgThreadProfile').click());
  await page.waitForTimeout(800);
  const shots = [
    ['CRM-S06-profile-main.png'],
    ['CRM-S03-group-profile.png'],
    ['CRM-S18-shared-media-grid.png']
  ];
  for (const [name] of shots) {
    await page.screenshot({ path: path.join(OUT, name) });
  }
  const tabs = [
    ['files', 'CRM-S20-shared-files.png'],
    ['links', 'CRM-S21-shared-links.png'],
    ['voice', 'CRM-S22-shared-voice-list.png'],
    ['members', 'CRM-S23-members-glass.png']
  ];
  for (const [tab, name] of tabs) {
    await page.evaluate((t) => {
      const b = document.querySelector('.hg-profile-tab[data-stab="' + t + '"]');
      if (b) b.click();
    }, tab);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, name) });
  }
  await page.evaluate(() => {
    const b = document.querySelector('#hgProfileMore');
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'CRM-S19-profile-more.png') });
  await page.screenshot({ path: path.join(OUT, 'CRM-S16-mute-menu.png') });
  console.log('profile shots ok');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
