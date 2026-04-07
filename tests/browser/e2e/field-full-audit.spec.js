const { test } = require('@playwright/test');
const h = require('../helpers');

test.describe.serial('Field Module — Full Audit as Андросов', () => {

  test('1. Андросов → АРХБУМ → Действия → Полевой модуль → screenshot each tab', async ({ page }) => {
    await h.loginAs(page, 'PM_ANDROSOV');
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(3000);

    // АРХБУМ is in March — switch period if needed
    const sel = page.locator('select').first();
    if (await sel.isVisible({ timeout: 2000 }).catch(() => false)) {
      const opts = await sel.locator('option').allTextContents();
      for (const o of opts) {
        if (o.toLowerCase().includes('март')) {
          await sel.selectOption({ label: o });
          await page.waitForTimeout(1500);
          break;
        }
      }
    }

    await page.screenshot({ path: 'tests/screenshots/field-audit/01-works-list.png', fullPage: true });

    // Find and click АРХБУМ
    const row = page.locator('tr').filter({ hasText: /АРХБУМ|Химическая/ }).first();
    if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
      await row.click();
    } else {
      // Fallback: direct JS call
      await page.evaluate(() => { if (window.AsgardPmWorks) AsgardPmWorks.openWork(10); });
    }
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/screenshots/field-audit/02-work-card.png', fullPage: true });

    // "Действия" → "Полевой модуль"
    await page.locator('#btnActions').click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'tests/screenshots/field-audit/03-actions.png', fullPage: true });
    await page.locator('text=Полевой модуль').click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/screenshots/field-audit/04-field-opened.png', fullPage: true });

    // Screenshot each tab
    const tabs = [
      'Бригада', 'Логистика', 'Дашборд', 'Табель',
      'Подотчёт', 'Сборы', 'Маршруты', 'Выплаты'
    ];
    for (let i = 0; i < tabs.length; i++) {
      const tabBtn = page.locator('button').filter({ hasText: new RegExp('^\\s*' + tabs[i] + '\\s*$') }).first();
      if (await tabBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await tabBtn.click();
        await page.waitForTimeout(2500);
        const num = String(i + 5).padStart(2, '0');
        await page.screenshot({ path: `tests/screenshots/field-audit/${num}-${tabs[i]}.png`, fullPage: true });
        console.log(`Tab "${tabs[i]}" — ✓`);
      } else {
        console.log(`Tab "${tabs[i]}" — NOT FOUND`);
      }
    }
  });

  test('2. Бригада — нажать "Добавить"', async ({ page }) => {
    await h.loginAs(page, 'PM_ANDROSOV');
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(2000);
    await page.evaluate(() => AsgardPmWorks.openWork(10));
    await page.waitForTimeout(2000);
    await page.locator('#btnActions').click();
    await page.waitForTimeout(500);
    await page.locator('text=Полевой модуль').click();
    await page.waitForTimeout(3000);

    // Бригада tab (default)
    await page.locator('button').filter({ hasText: /^Бригада$/ }).click().catch(() => {});
    await page.waitForTimeout(2000);

    // Click add button
    const addBtn = page.locator('button').filter({ hasText: /добавить|Добавить/ }).first();
    if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'tests/screenshots/field-audit/crew-add.png', fullPage: true });
      console.log('Crew add — ✓');
      await page.keyboard.press('Escape');
    } else {
      console.log('Crew add button not found');
    }
  });

  test('3. Табель — режим редактирования', async ({ page }) => {
    await h.loginAs(page, 'PM_ANDROSOV');
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(2000);
    await page.evaluate(() => AsgardPmWorks.openWork(10));
    await page.waitForTimeout(2000);
    await page.locator('#btnActions').click();
    await page.waitForTimeout(500);
    await page.locator('text=Полевой модуль').click();
    await page.waitForTimeout(3000);

    await page.locator('button').filter({ hasText: /^Табель$/ }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'tests/screenshots/field-audit/timesheet-view.png', fullPage: true });

    // Click "Редактировать"
    const editBtn = page.locator('#tsEdit, button:has-text("Редактировать")').first();
    if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'tests/screenshots/field-audit/timesheet-edit.png', fullPage: true });
      console.log('Timesheet edit mode — ✓');
    }
  });

  test('4. Выплаты — "+ Суточные" + заполнить данные АРХБУМ', async ({ page }) => {
    await h.loginAs(page, 'PM_ANDROSOV');
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(2000);
    await page.evaluate(() => AsgardPmWorks.openWork(10));
    await page.waitForTimeout(2000);
    await page.locator('#btnActions').click();
    await page.waitForTimeout(500);
    await page.locator('text=Полевой модуль').click();
    await page.waitForTimeout(3000);

    await page.locator('button').filter({ hasText: /^Выплаты$/ }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'tests/screenshots/field-audit/payments-empty.png', fullPage: true });

    // Click "+ Суточные"
    const pdBtn = page.locator('button:has-text("Суточные")').first();
    if (await pdBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pdBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'tests/screenshots/field-audit/payments-perdiem-modal.png', fullPage: true });

      // Fill: period 26.03 - 31.03, rate 1000
      await page.fill('#pdFrom', '2026-03-26');
      await page.fill('#pdTo', '2026-03-31');
      await page.fill('#pdRate', '1000');
      await page.fill('#pdComment', 'Суточные АРХБУМ март 2026 — выдано');
      await page.screenshot({ path: 'tests/screenshots/field-audit/payments-perdiem-filled.png', fullPage: true });

      // Submit
      await page.locator('#pdSubmit').click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'tests/screenshots/field-audit/payments-perdiem-done.png', fullPage: true });
      console.log('Per diem submitted — ✓');
    }
  });

  test('5. Field PWA login page', async ({ page }) => {
    await page.goto(h.BASE_URL + '/field/');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/screenshots/field-audit/pwa-login.png', fullPage: true });
  });
});
