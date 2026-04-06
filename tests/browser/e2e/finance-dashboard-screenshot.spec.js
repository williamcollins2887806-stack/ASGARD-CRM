// @ts-check
const { test } = require('@playwright/test');
const h = require('../helpers');

test.describe('Finance Dashboard Screenshot', () => {
  test('Work Report page - full', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.waitForTimeout(2000);

    await page.goto(h.BASE_URL + '/#/work-report?id=10');
    await page.waitForTimeout(4000);

    // Screenshot top part (hero + KPI)
    await page.screenshot({
      path: 'tests/screenshots/work-report-top.png',
      fullPage: true,
    });

    // Scroll down to see bottom blocks
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: 'tests/screenshots/work-report-bottom.png',
      fullPage: true,
    });
  });
});
