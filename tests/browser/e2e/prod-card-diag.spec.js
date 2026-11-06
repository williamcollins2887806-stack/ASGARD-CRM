const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PROD_URL || 'https://asgard-crm.ru';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

test('прод: видимость и стили карточки ДВ', async ({ page }) => {
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

  const diag = await page.evaluate(() => {
    const card = document.querySelector('.rp-calc-dv-card');
    if (!card) return { error: 'нет карточки' };
    const cs = getComputedStyle(card);
    const h4 = card.querySelector('h4');
    const rect = card.getBoundingClientRect();
    return {
      cardWidth: Math.round(rect.width),
      cardHeight: Math.round(rect.height),
      bg: cs.backgroundColor,
      color: cs.color,
      opacity: cs.opacity,
      display: cs.display,
      h4Size: h4 ? getComputedStyle(h4).fontSize : null,
      h4Color: h4 ? getComputedStyle(h4).color : null,
      h4Text: h4 ? h4.textContent.trim().slice(0, 40) : null,
      panelBg: getComputedStyle(document.querySelector('[data-panel="dv"]')).backgroundColor,
      cssLoaded: Array.from(document.styleSheets).some((s) => (s.href || '').includes('rp-calc-modal')),
      cssHref: Array.from(document.styleSheets).map((s) => s.href).filter((h) => h && h.includes('rp-calc'))[0] || null
    };
  });
  console.log('ДИАГНОСТИКА:', JSON.stringify(diag, null, 1));

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'C2-prod-viewport.png') });
});
