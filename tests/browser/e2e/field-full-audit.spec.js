const { test } = require('@playwright/test');
const h = require('../helpers');

test.describe.serial('Field Audit — Андросов PM', () => {

  test('All tabs + buttons', async ({ page }) => {
    await h.loginAs(page, 'PM_ANDROSOV');
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(4000);

    // Open field modal directly via JS (skip UI navigation)
    const opened = await page.evaluate(async () => {
      const w = await AsgardDB.get('works', 10);
      if (!w) return 'work not found';
      const auth = await AsgardAuth.requireUser();
      if (!auth) return 'no auth';
      if (window.AsgardFieldTab && AsgardFieldTab.openFieldModal) {
        AsgardFieldTab.openFieldModal(w, auth.user);
        return 'opened';
      }
      return 'no AsgardFieldTab';
    });
    console.log('Field modal:', opened);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'tests/screenshots/field-audit/01-field-opened.png', fullPage: true });

    // Screenshot each tab
    const tabs = ['Бригада','Логистика','Дашборд','Табель','Подотчёт','Сборы','Маршруты','Выплаты'];
    for (let i = 0; i < tabs.length; i++) {
      const btn = page.locator('button').filter({ hasText: tabs[i] }).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(2500);
        const n = String(i + 2).padStart(2, '0');
        await page.screenshot({ path: `tests/screenshots/field-audit/${n}-${tabs[i]}.png`, fullPage: true });
        console.log(tabs[i], '— ✓');
      } else {
        console.log(tabs[i], '— NOT FOUND');
      }
    }

    // === Test: Бригада → "Добавить" ===
    await page.locator('button').filter({ hasText: 'Бригада' }).first().click().catch(() => {});
    await page.waitForTimeout(2000);
    const addBtn = page.locator('button').filter({ hasText: /добавить/i }).first();
    if (await addBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'tests/screenshots/field-audit/crew-add.png', fullPage: true });
      console.log('Crew add — ✓');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // === Test: Табель → "Редактировать" ===
    await page.locator('button').filter({ hasText: 'Табель' }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'tests/screenshots/field-audit/timesheet-view.png', fullPage: true });
    const editBtn = page.locator('button:has-text("Редактировать"), #tsEdit').first();
    if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'tests/screenshots/field-audit/timesheet-edit.png', fullPage: true });
      console.log('Timesheet edit — ✓');
    }

    // === Test: Выплаты → "+ Суточные" ===
    await page.locator('button').filter({ hasText: 'Выплаты' }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'tests/screenshots/field-audit/payments.png', fullPage: true });
    const pdBtn = page.locator('button:has-text("Суточные")').first();
    if (await pdBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pdBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'tests/screenshots/field-audit/payments-perdiem.png', fullPage: true });
      // Fill and submit
      await page.fill('#pdFrom', '2026-03-26').catch(() => {});
      await page.fill('#pdTo', '2026-03-31').catch(() => {});
      await page.fill('#pdRate', '1000').catch(() => {});
      await page.fill('#pdComment', 'Суточные АРХБУМ — выдано').catch(() => {});
      await page.locator('#pdSubmit').click().catch(() => {});
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'tests/screenshots/field-audit/payments-done.png', fullPage: true });
      console.log('Per diem — ✓');
    }
  });

  test('PWA + Work Report', async ({ page }) => {
    await page.goto(h.BASE_URL + '/field/');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/screenshots/field-audit/pwa-login.png', fullPage: true });

    await h.loginAs(page, 'PM_ANDROSOV');
    await page.goto(h.BASE_URL + '/#/work-report?id=10');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'tests/screenshots/field-audit/work-report.png', fullPage: true });
  });
});
