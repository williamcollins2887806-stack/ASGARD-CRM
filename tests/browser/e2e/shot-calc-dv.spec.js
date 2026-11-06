const { test } = require('@playwright/test');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const CLONE = process.env.CLONE_URL || 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

test('снимок вкладки Объёмы в просчёте', async ({ page }) => {
  test.setTimeout(150000);
  const lr = await fetch(`${CLONE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_pm', password: 'Test123!' })
  });
  const ld = await lr.json();
  const pr = await fetch(`${CLONE}/api/auth/verify-pin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ld.token },
    body: JSON.stringify({ pin: '0000' })
  });
  const token = (await pr.json()).token;

  const db = new Client({ host: 'localhost', port: 5432, user: 'asgard', password: '123456789', database: 'asgard_crm_test' });
  await db.connect();
  const r = await db.query("SELECT id FROM tenders WHERE tender_title ILIKE '%ДЕМО Мимир%' AND deleted_at IS NULL ORDER BY id LIMIT 1");
  await db.end();
  const id = r.rows[0].id;

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => { localStorage.setItem('asgard_token', t); localStorage.setItem('token', t); }, token);
  await page.goto(`${CLONE}/#/tenders-registry`, { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof window.AsgardRpCalcModal === 'object', null, { timeout: 30000 });

  await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const d = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } }).then((x) => x.json());
    window.AsgardRpCalcModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'calc' });
    await new Promise((res) => setTimeout(res, 2500));
  }, id);

  await page.locator('.rp-calc-tab[data-rp-tab="dv"]').click({ force: true });
  await page.waitForTimeout(1200);

  const panel = page.locator('[data-panel="dv"]');
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  fs.mkdirSync(OUT, { recursive: true });
  await panel.screenshot({ path: path.join(OUT, 'B1-calc-dv.png') });
  console.log('карточек:', await page.locator('.rp-calc-dv-card').count());
});
