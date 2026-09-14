'use strict';
/**
 * Desktop Excel AI panel: open cart → Excel → upload fixture → AI preview screenshot.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, 'reports', 'wms-browser-qa');
const FIX = path.join(__dirname, 'fixtures', 'wms-cart-scenario-a.xlsx');
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
  const me = await fetch(BASE + '/api/auth/me', {
    headers: { Authorization: 'Bearer ' + pr.token },
  }).then(r => r.json());
  const user = me.user || pr.user;
  const permissions = user.permissions || { cash: { read: true }, chat_groups: { read: true } };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ token, user, permissions }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_permissions', JSON.stringify(permissions || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
  }, { token: pr.token, user, permissions });

  const page = await context.newPage();
  const consoleErrors = [];
  const netFails = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', r => {
    if (r.status() >= 400 && r.url().includes('/api/')) {
      netFails.push({ status: r.status(), url: r.url().replace(BASE, '').slice(0, 120) });
    }
  });

  await page.goto(BASE + '/#/warehouse-v2', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  // dismiss compliance / CRM banners / theme overlays
  await page.evaluate(() => {
    document.querySelectorAll('.cr-m-overlay, .modalback, .banner, [class*="overlay"]').forEach(el => {
      el.classList.remove('cr-m-overlay--visible');
      el.style.display = 'none';
      el.remove();
    });
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('compliance_ack', '1');
  });
  for (const t of ['Понял', 'Принять вызов', 'Закрыть', 'Попробовать', '×']) {
    await page.getByRole('button', { name: new RegExp(t.replace('×', '×|x'), 'i') }).first().click({ timeout: 500 }).catch(() => {});
    await page.getByText(t, { exact: true }).first().click({ timeout: 400 }).catch(() => {});
  }
  await page.waitForTimeout(400);

  // open cart FAB (force if overlay remains)
  await page.locator('.wh2-fab__btn').first().click({ force: true, timeout: 10000 });
  await page.waitForTimeout(1000);

  let excelOpened = false;
  if (await page.locator('#wh2-cart-excel').count()) {
    await page.locator('#wh2-cart-excel').click();
    excelOpened = true;
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: path.join(OUT, '07b-excel-panel.png') });

  let matchedRows = 0;
  if (excelOpened && fs.existsSync(FIX) && await page.locator('#wh2-xl-file').count()) {
    await page.locator('#wh2-xl-file').setInputFiles(FIX);
    await page.waitForTimeout(8000);
    const preview = page.locator('#wh2-xl-preview');
    if (await preview.count()) {
      const txt = await preview.innerText().catch(() => '');
      matchedRows = (txt.match(/со склада|закупка|оборудован|новая/gi) || []).length;
    }
  }
  await page.screenshot({ path: path.join(OUT, '07c-excel-ai-preview.png') });

  const body = await page.locator('body').innerText();
  const report = {
    url: page.url(),
    excelOpened,
    matchedRows,
    hasTemplateLink: /Скачать шаблон/i.test(body),
    hasAiPreview: /wh2-xl-preview|со склада|закупка/i.test(body) || matchedRows > 0,
    kpiHasCatalog: /2\s*2\d{2}|позиций в каталоге/i.test(body),
    consoleErrors: consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e)).slice(0, 20),
    netFails: [...new Map(netFails.map(n => [n.url, n])).values()].slice(0, 20),
    bodySlice: body.replace(/\s+/g, ' ').slice(0, 600),
  };
  fs.writeFileSync(path.join(OUT, 'DESKTOP-EXCEL-QA.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(excelOpened && report.hasAiPreview ? 0 : 2);
})().catch(e => { console.error(e); process.exit(1); });
