'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/PHASE-7');

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

async function probe(page, theme) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelectorAll('#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback').forEach((el) => {
      try { el.remove(); } catch (_) {}
    });
    const dock = document.querySelector('#huginnDock');
    if (dock) dock.style.setProperty('opacity', '0', 'important');
    document.body.style.overflow = '';
  });
  const data = await page.evaluate(() => {
    const rgb = (el) => {
      if (!el) return null;
      const c = getComputedStyle(el).backgroundColor;
      const r = el.getBoundingClientRect();
      return { color: c, tag: el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : ''), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    };
    const root = getComputedStyle(document.documentElement);
    const tokens = {};
    ['bg0', 'bg1', 'bg2', 'bg3', 'bg4', 'bg5', 'overlay'].forEach((k) => {
      tokens['--' + k] = root.getPropertyValue('--' + k).trim();
    });
    const sidenav = document.querySelector('.sidenav');
    const topbar = document.querySelector('.topbar, .asg-header');
    const main = document.querySelector('.main, #layout, .asg-content');
    const card = document.querySelector('.dash-widget, .card');
    const body = document.body;
    const pick = (el, ox, oy) => {
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + (ox != null ? ox : Math.min(24, r.width / 2))), y: Math.round(r.y + (oy != null ? oy : Math.min(80, r.height / 2))) };
    };
    const pts = {
      sidenav: pick(sidenav, 20, 120),
      main: pick(main || body, 280, 220),
      card: pick(card, 40, 40)
    };
    document.getElementById('palette-audit-overlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'palette-audit-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;font:700 12px/1.2 Segoe UI,sans-serif';
    const mark = (p, label, n) =>
      '<div style="position:absolute;left:' + p.x + 'px;top:' + p.y + 'px;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid #FF3B30;border-radius:50%;background:transparent"></div>' +
      '<div style="position:absolute;left:' + (p.x + 12) + 'px;top:' + (p.y - 18) + 'px;background:#FF3B30;color:#fff;padding:3px 6px;border-radius:4px">' + n + ' ' + label + '</div>';
    ov.innerHTML = mark(pts.sidenav, 'меню', '1') + mark(pts.main, 'центр', '2') + mark(pts.card, 'карточка', '3');
    document.body.appendChild(ov);
    return {
      tokens,
      layers: {
        body: rgb(body),
        sidenav: rgb(sidenav),
        topbar: rgb(topbar),
        main: rgb(main),
        card: rgb(card)
      }
    };
  });
  const dir = OUT;
  fs.mkdirSync(dir, { recursive: true });
  const shot = path.join(dir, '_crm_palette_' + theme + '.png');
  await page.screenshot({ path: shot, fullPage: false });
  fs.writeFileSync(path.join(dir, 'CRM-PALETTE-' + theme + '.json'), JSON.stringify(data, null, 2));
  console.log('THEME', theme, JSON.stringify(data, null, 2));
  console.log('SHOT', shot);
  return { data, shot };
}

(async () => {
  const health = await fetch(BASE + '/api/health').then((r) => r.status).catch(() => 0);
  if (!health) throw new Error('BASE down');
  const auth = await login();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_safe_mode', '1');
  }, auth);
  const page = await ctx.newPage();
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  await probe(page, 'dark');
  await probe(page, 'light');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
