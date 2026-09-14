'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, 'reports', 'wms-browser-qa');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_warehouse', password: 'Test123!' }),
  }).then(r => r.json());
  const pr = await fetch(BASE + '/api/auth/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lr.token },
    body: JSON.stringify({ pin: '0000' }),
  }).then(r => r.json());
  const token = pr.token;
  const user = pr.user;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    serviceWorkers: 'block',
  });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('presence_done_' + new Date().toISOString().slice(0, 10), '1');
  }, { token, user });

  const page = await context.newPage();
  const consoleErrors = [];
  const netFails = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('response', async (r) => {
    if (r.status() >= 400 && r.url().includes('/api/')) {
      let body = '';
      try { body = (await r.text()).slice(0, 200); } catch (_) {}
      netFails.push({ status: r.status(), url: r.url().replace(BASE, ''), body });
    }
  });

  await page.goto(BASE + '/m/warehouse-wms', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  // hydrate if still on loader/welcome
  if (page.url().includes('/welcome') || page.url().includes('/pin') || page.url().includes('/login')) {
    await page.evaluate(({ token, user }) => {
      localStorage.setItem('asgard_token', token);
      localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    }, { token, user });
    await page.goto(BASE + '/m/warehouse-wms', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
  }

  if (page.url().includes('/pin')) {
    for (const d of ['0', '0', '0', '0']) {
      const btn = page.getByRole('button', { name: d, exact: true });
      if (await btn.count()) await btn.first().click();
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(2000);
    await page.goto(BASE + '/m/warehouse-wms', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: path.join(OUT, '06c-mobile-wms-helper.png'), fullPage: true });
  const body = await page.locator('body').innerText().catch(() => '');
  const hasHelper = /Открытые сессии|WMS помощник|скан|Раскладка|Пикинг|помощник/i.test(body);
  if (hasHelper) {
    const btn = page.getByText(/Открытые сессии/);
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, '06d-mobile-sessions.png'), fullPage: true });
    }
  }

  const report = {
    url: page.url(),
    hasHelper,
    bodySlice: body.replace(/\s+/g, ' ').slice(0, 800),
    consoleErrors: consoleErrors.slice(0, 30),
    netFails: netFails.slice(0, 30),
  };
  fs.writeFileSync(path.join(OUT, 'MOBILE-QA.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(hasHelper ? 0 : 2);
})().catch(e => { console.error(e); process.exit(1); });
