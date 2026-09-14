'use strict';
/**
 * WMS local e2e + final screenshots (scenarios A–F coverage via API + UI shots).
 * Usage: node tests/wms-final-e2e.js
 * Requires: local CRM on :3000, asgard_crm_dev, playwright chromium.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
process.env.TEST_BASE_URL = BASE;
const OUT = path.join(__dirname, 'reports', 'wms-final-shots');
const USER = process.env.WMS_USER || 'test_warehouse';
const PASS = process.env.WMS_PASS || 'Test123!';
const PIN = process.env.WMS_PIN || '0000';

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

async function api(token, method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'X-Asgard-Pin-Verified': '1'
    },
    body: body != null ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(method + ' ' + url + ' → ' + r.status + ' ' + text.slice(0, 300));
  return data;
}

async function loginFull() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: USER, password: PASS })
  });
  const d = await r.json();
  if (!r.ok || !d.token) {
    // fallback via config accounts
    try {
      const { getToken, ACCOUNTS } = require('./config');
      const token = await getToken('WAREHOUSE');
      const acc = ACCOUNTS.find((a) => a.role === 'WAREHOUSE');
      // re-login to get user payload
      const r2 = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: acc.login, password: acc.password })
      });
      const d2 = await r2.json();
      let token2 = d2.token || token;
      let user = d2.user || null;
      if (d2.status === 'need_pin') {
        const pinR = await fetch(BASE + '/api/auth/verify-pin', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token2, 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: acc.pin })
        });
        const pinD = await pinR.json();
        if (pinD.token) token2 = pinD.token;
        if (pinD.user) user = pinD.user;
      }
      return { token: token2, user };
    } catch (e) {
      throw new Error('login failed: ' + JSON.stringify(d) + ' / ' + e.message);
    }
  }
  let token = d.token;
  let user = d.user || null;
  if (d.status === 'need_pin') {
    const pinR = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    const pinD = await pinR.json();
    if (pinD.token) token = pinD.token;
    if (pinD.user) user = pinD.user;
  }
  return { token, user };
}

async function shot(page, name, sub) {
  const dir = path.join(OUT, sub || 'map');
  ensureDir(dir);
  const file = path.join(dir, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  console.log('SHOT', file);
  return file;
}

async function main() {
  ensureDir(OUT);
  const report = { started: new Date().toISOString(), base: BASE, steps: [], fails: [] };
  const auth = await loginFull();
  const token = auth.token;
  report.steps.push({ id: 'login', ok: true, hasUser: !!auth.user });

  // --- API scenario coverage ---
  const floors = await api(token, 'GET', '/api/warehouse-map/floors');
  const floor = (floors.items || floors.floors || floors)[0] || floors.item;
  if (!floor) throw new Error('no floor');
  const whId = floor.warehouse_id;
  report.steps.push({ id: 'floor', ok: true, width: floor.width_m, depth: floor.depth_m, whId });

  const objs = await api(token, 'GET', '/api/warehouse-map/objects?floor_id=' + floor.id);
  const objects = objs.items || objs.objects || [];
  report.steps.push({ id: 'objects', ok: objects.length >= 40, n: objects.length });

  // sync locations for a few racks
  const sample = objects.filter((o) => ['shelf_light', 'shelf_pallet', 'clothing'].includes(o.object_type)).slice(0, 8);
  for (const o of sample) {
    try {
      await api(token, 'POST', '/api/warehouse-map/objects/' + o.id + '/sync-locations', {});
      report.steps.push({ id: 'sync-' + o.code, ok: true });
    } catch (e) {
      report.fails.push('sync ' + o.code + ': ' + e.message);
    }
  }

  // place lookup
  try {
    const by = await api(token, 'GET', '/api/warehouse-map/by-place/' + encodeURIComponent('L-R2-1A1'));
    report.steps.push({ id: 'by-place', ok: true, n: (by.items || []).length });
  } catch (e) {
    // try alternate code pattern after sync
    report.steps.push({ id: 'by-place', ok: false, err: e.message });
  }

  // director
  try {
    const dir = await api(token, 'GET', '/api/warehouse-ops/director-summary');
    report.steps.push({ id: 'director', ok: true, map_fill: dir.map_fill });
  } catch (e) {
    report.fails.push('director: ' + e.message);
  }

  // receive session + confirm path (scan UX)
  let receiveSessionId = null;
  try {
    const sess = await api(token, 'POST', '/api/warehouse-ops/sessions', {
      warehouse_id: whId,
      session_type: 'receive',
      title: 'E2E receive ' + Date.now(),
      items: [
        { track_type: 'consumable', planned_qty: 10, item_name: 'Болт М10 E2E', meta_json: { barcode: 'E2E-BOLT-M10' } }
      ]
    });
    receiveSessionId = sess.session && sess.session.id;
    report.steps.push({ id: 'A/B-receive-session', ok: !!receiveSessionId, idv: receiveSessionId });
  } catch (e) {
    report.fails.push('receive session: ' + e.message);
  }

  // putaway session
  try {
    const sess = await api(token, 'POST', '/api/warehouse-ops/sessions', {
      warehouse_id: whId,
      session_type: 'putaway',
      title: 'E2E putaway ' + Date.now(),
      items: [
        { track_type: 'consumable', planned_qty: 5, item_name: 'Круг 125 E2E' }
      ]
    });
    report.steps.push({ id: 'putaway-session', ok: !!(sess.session && sess.session.id) });
  } catch (e) {
    report.fails.push('putaway: ' + e.message);
  }

  // inventory
  try {
    const inv = await api(token, 'POST', '/api/warehouse-ops/inventory', {
      warehouse_id: whId,
      title: 'E2E inventory ' + Date.now()
    });
    report.steps.push({ id: 'E-inventory', ok: !!(inv.session && inv.session.id), idv: inv.session && inv.session.id });
  } catch (e) {
    report.fails.push('inventory: ' + e.message);
  }

  // AI suggest
  try {
    const ai = await api(token, 'POST', '/api/warehouse-cart/suggest-ai', {
      rows: [{ name: 'Болт М10', qty: 50, unit: 'шт' }]
    });
    report.steps.push({ id: 'A-ai-excel', ok: true, n: (ai.rows || ai.items || []).length });
  } catch (e) {
    report.fails.push('suggest-ai: ' + e.message);
  }

  // unpick queue
  try {
    const u = await api(token, 'GET', '/api/warehouse-ops/unpick-queue');
    report.steps.push({ id: 'unpick-queue', ok: true, n: (u.items || []).length });
  } catch (e) {
    report.fails.push('unpick: ' + e.message);
  }

  // --- UI screenshots ---
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    bypassCSP: true
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.fails.push('pageerror: ' + e.message));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((payload) => {
    localStorage.setItem('asgard_token', payload.token);
    localStorage.setItem('auth_token', payload.token);
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    if (payload.user) {
      localStorage.setItem('asgard_user', JSON.stringify(payload.user));
      if (payload.user.permissions) {
        localStorage.setItem('asgard_permissions', JSON.stringify(payload.user.permissions));
      }
      if (payload.user.menu_settings) {
        localStorage.setItem('asgard_menu_settings', JSON.stringify(payload.user.menu_settings));
      }
    }
  }, { token, user: auth.user });

  // dismiss theme modal if still shown
  await page.goto(BASE + '/#/warehouse-v2', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const cont = page.getByRole('button', { name: /Продолжить/i });
  if (await cont.count()) {
    await page.locator('.ats-theme-card, .ats-card, [data-theme="dark"]').first().click().catch(() => {});
    await cont.click().catch(() => {});
    await page.waitForTimeout(600);
  }

  // PIN if shown
  const pinInput = page.locator('input[type="password"], input[placeholder*="PIN" i], #pin-input, input[inputmode="numeric"]').first();
  if (await pinInput.isVisible().catch(() => false)) {
    try {
      await pinInput.fill(PIN);
      const pinBtn = page.getByRole('button', { name: /подтвер|войти|ok/i }).first();
      if (await pinBtn.count()) await pinBtn.click();
      else await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);
    } catch (_) {}
  }

  // re-inject after any auth wipe on boot
  await page.evaluate((payload) => {
    localStorage.setItem('asgard_token', payload.token);
    if (payload.user) localStorage.setItem('asgard_user', JSON.stringify(payload.user));
  }, { token, user: auth.user });
  await page.goto(BASE + '/#/warehouse-v2', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // close any modal overlays (changelog, tips, pin, etc.)
  await page.evaluate(() => {
    document.querySelectorAll('.cr-m-overlay--visible, .modalback, .cr-m-overlay').forEach((el) => {
      el.classList.remove('cr-m-overlay--visible');
      el.style.display = 'none';
    });
    document.querySelectorAll('.cr-m, .modal, [role="dialog"]').forEach((el) => {
      if (el.id === 'asgard-theme-selector') return;
      el.style.display = 'none';
    });
  });
  const closeBtns = page.locator('.cr-m-overlay--visible .cr-m-close, .cr-m-overlay--visible button, button:has-text("Закрыть"), button:has-text("Понятно")');
  const n = await closeBtns.count();
  for (let i = 0; i < Math.min(n, 3); i++) {
    await closeBtns.nth(i).click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(400);

  // click Карта tab
  async function clickTab(dataTab) {
    await page.evaluate(() => {
      document.querySelectorAll('.cr-m-overlay--visible').forEach((el) => {
        el.classList.remove('cr-m-overlay--visible');
        el.style.display = 'none';
      });
    });
    const tab = page.locator('.wh2-tab[data-tab="' + dataTab + '"]');
    if (await tab.count()) {
      await tab.click({ force: true });
      await page.waitForTimeout(1400);
      return true;
    }
    return false;
  }

  await clickTab('map');
  await page.waitForSelector('#wh2-map-host canvas, .whm__view canvas', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot(page, '01-map-plan-2d', 'map');

  const find = page.locator('#whm-find');
  if (await find.count()) {
    await find.fill('PR-1');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await shot(page, '03-map-find-PR1-pulse', 'map');
    await find.fill('L-R2-1');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await shot(page, '04-map-find-LR21-pulse', 'map');
  }

  const btn3d = page.locator('button[data-a="mode3d"]');
  if (await btn3d.count()) {
    await btn3d.click();
    await page.waitForTimeout(1500);
  }
  await shot(page, '02-map-3d', 'map');

  if (await find.count()) {
    await find.fill('PR-1');
    await page.keyboard.press('Enter');
    // tour: plan → route → 3D glow; wait for 3D step
    await page.waitForTimeout(6500);
    await shot(page, '07-map-3d-find-PR1-pulse', 'map');
  }

  const editBtn = page.locator('button[data-a="edit"], button').filter({ hasText: /редакт/i }).first();
  if (await editBtn.count()) {
    await editBtn.click();
    await page.waitForTimeout(1000);
    await shot(page, '05-map-editor', 'map');
  }

  // facade from sidebar if object selected
  const facade = page.locator('button').filter({ hasText: /Фасад/i }).first();
  if (await facade.count()) {
    await facade.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1800);
    await shot(page, '06-map-facade', 'map');
  }

  // other tabs
  const tabs = [
    ['ops', 'ops', '10-ops'],
    ['unpick', 'pages', '11-unpick'],
    ['inventory', 'pages', '12-inventory'],
    ['writeoffs', 'pages', '13-writeoffs'],
    ['director', 'pages', '14-director'],
    ['incoming', 'pages', '15-incoming']
  ];
  for (const [dataTab, sub, name] of tabs) {
    const ok = await clickTab(dataTab);
    await page.waitForTimeout(900);
    await shot(page, name + (ok ? '' : '-miss'), sub);
  }

  // assembly page for site bulk
  await page.goto(BASE + '/#/assembly', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await shot(page, '16-assembly', 'pages');

  // mobile helper if built
  try {
    await page.goto(BASE + '/m/#/warehouse-wms', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    await shot(page, '17-mobile-helper', 'pages');
  } catch (e) {
    report.fails.push('mobile-helper: ' + e.message);
    await shot(page, '17-mobile-helper-fail', 'pages').catch(() => {});
  }

  await browser.close();

  report.finished = new Date().toISOString();
  report.ok = report.fails.length === 0 && report.steps.every((s) => s.ok !== false);
  fs.writeFileSync(path.join(OUT, 'REPORT.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(2);
  console.log('E2E_PASS');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
