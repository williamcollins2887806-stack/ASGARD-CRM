const { test, expect } = require('@playwright/test');
const h = require('../helpers');

test.describe('Field Module — Full Audit', () => {

  test('CRM Field Tab — all tabs for work 10', async ({ page }) => {
    await h.loginAs(page, 'PM');
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/screenshots/field-01-pm-works.png', fullPage: true });

    // Open work 10
    const workRow = page.locator('tr:has-text("АРХБУМ"), .card:has-text("АРХБУМ"), [data-id="10"]').first();
    if (await workRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await workRow.click();
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: 'tests/screenshots/field-02-work-card.png', fullPage: true });

    // Open field module
    const fieldBtn = page.locator('button:has-text("Полевой"), #btnFieldModule').first();
    if (await fieldBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fieldBtn.click();
      await page.waitForTimeout(3000);
    }
    await page.screenshot({ path: 'tests/screenshots/field-03-field-opened.png', fullPage: true });

    // Click each tab
    const tabs = ['Бригада', 'Логистика', 'Дашборд', 'Табель', 'Подотчёт', 'Сборы', 'Маршруты', 'Выплаты'];
    for (let i = 0; i < tabs.length; i++) {
      const tab = page.locator(`button:has-text("${tabs[i]}")`).first();
      if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(2000);
        await page.screenshot({
          path: `tests/screenshots/field-tab-${String(i + 1).padStart(2, '0')}-${tabs[i].replace(/[^a-zA-Zа-яА-Я0-9]/g, '')}.png`,
          fullPage: true
        });
        console.log(`Tab "${tabs[i]}" — screenshot taken`);
      } else {
        console.log(`Tab "${tabs[i]}" — NOT FOUND`);
      }
    }
  });

  test('Work Report — financial dashboard', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.goto(h.BASE_URL + '/#/work-report?id=10');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'tests/screenshots/field-report-top.png' });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'tests/screenshots/field-report-bottom.png' });
  });

  test('Finances dashboard', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.goto(h.BASE_URL + '/#/finances');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'tests/screenshots/field-finances.png', fullPage: true });
  });

  test('Huginn chat — estimate card', async ({ page }) => {
    await h.loginAs(page, 'PM');
    await page.goto(h.BASE_URL + '/#/messenger');
    await page.waitForTimeout(3000);
    const chatItem = page.locator('.chat-item:has-text("Просчёт")').first();
    if (await chatItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatItem.click();
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: 'tests/screenshots/field-huginn-chat.png', fullPage: true });
  });

  test('Field PWA — login page', async ({ page }) => {
    await page.goto(h.BASE_URL + '/field/');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/screenshots/field-pwa-login.png', fullPage: true });
  });

  test('Employee card — OM can open', async ({ page }) => {
    await h.loginAs(page, 'OFFICE_MANAGER');
    await page.goto(h.BASE_URL + '/#/personnel');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/screenshots/field-om-personnel.png', fullPage: true });
  });
});
