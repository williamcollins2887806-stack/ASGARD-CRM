const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PROD_URL || 'https://asgard-crm.ru';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

test('прод: первые карточки ДВ в просчёте', async ({ page }) => {
  test.setTimeout(150000);
  const token = (process.env.PROD_TOKEN || '').trim();
  test.skip(!token, 'нет токена');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => { localStorage.setItem('asgard_token', t); localStorage.setItem('token', t); }, token);
  await page.goto(`${BASE}/#/tenders-registry`, { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof window.AsgardRpCalcModal === 'object', null, { timeout: 30000 });

  const id = Number(process.env.PROD_TENDER || 2131);
  await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const d = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } }).then((x) => x.json());
    window.AsgardRpCalcModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'calc' });
    await new Promise((res) => setTimeout(res, 2600));
  }, id);

  await page.locator('.rp-calc-tab[data-rp-tab="dv"]').click({ force: true });
  await page.waitForTimeout(1400);

  // Снимаем первую карточку крупно — на ней видно, читается или нет.
  const first = page.locator('.rp-calc-dv-card').first();
  await first.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  fs.mkdirSync(OUT, { recursive: true });
  await first.screenshot({ path: path.join(OUT, 'C1-prod-first-card.png') });

  const box = await first.boundingBox();
  console.log('карточка:', JSON.stringify({ w: Math.round(box.width), h: Math.round(box.height) }));

  const text = await first.innerText();
  console.log('СОДЕРЖИМОЕ:\n' + text);
});
