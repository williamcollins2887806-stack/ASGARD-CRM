const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PROD = process.env.PROD_URL || 'https://asgard-crm.ru';
const TOKEN = process.env.PROD_TOKEN || '';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-prod');

test('где реестр и как открыть карточку', async ({ page }) => {
  test.skip(!TOKEN, 'нужен PROD_TOKEN');
  await page.goto(`${PROD}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('token', t);
  }, TOKEN);

  for (const hash of ['#/tenders', '#/registry', '#/pm-duty', '#/pm-calculations', '#/tenders-registry']) {
    await page.goto(`${PROD}/${hash}`, { waitUntil: 'commit' });
    await page.waitForTimeout(2600);
    const info = await page.evaluate(() => ({
      hash: location.hash,
      rows: document.querySelectorAll('.reg-row, .tender-row, tr[data-id], [data-tender-id]').length,
      hasRegistry: !!document.querySelector('.registry-wrap, .reg-table, .tenders-register'),
      bodyHead: document.body.innerText.slice(0, 160).replace(/\s+/g, ' ')
    }));
    console.log(hash, '→', JSON.stringify(info));
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `20-${hash.replace(/[#/]/g, '')}.png`) });
  }
});
