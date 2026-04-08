const { test } = require('@playwright/test');
const h = require('../helpers');

test.describe.serial('Field Audit — Андросов PM', () => {

  test('All field tabs + buttons', async ({ page }) => {
    await h.loginAs(page, 'PM_ANDROSOV');
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(3000);

    // Switch to March by clicking period dropdown and selecting март
    await page.locator('select').first().selectOption({ index: 1 }).catch(() => {});
    await page.waitForTimeout(1000);
    // Try each index until we find АРХБУМ
    for (let idx = 0; idx < 12; idx++) {
      await page.locator('select').first().selectOption({ index: idx }).catch(() => {});
      await page.waitForTimeout(800);
      const text = await page.locator('tbody').textContent().catch(() => '');
      if (text.includes('АРХБУМ') || text.includes('Химическая')) {
        console.log('Found АРХБУМ in period index', idx);
        break;
      }
    }

    await page.screenshot({ path: 'tests/screenshots/field-audit/01-works.png', fullPage: true });

    // Click on work row
    const workRow = page.locator('tr[data-id="10"]').first();
    if (await workRow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await workRow.click();
      await page.waitForTimeout(2500);
    } else {
      // Try any АРХБУМ row
      const anyRow = page.locator('tr').filter({ hasText: /АРХБУМ|Химическая/ }).first();
      if (await anyRow.isVisible({ timeout: 1000 }).catch(() => false)) {
        await anyRow.click();
        await page.waitForTimeout(2500);
      } else {
        console.log('Work row NOT found — trying page.evaluate');
        // Navigate and use evaluate
        await page.evaluate(async () => {
          const w = await AsgardDB.get('works', 10);
          if (w && window.AsgardUI) {
            const user = window.__asgardUser || (window.AsgardAuth ? await AsgardAuth.requireUser().then(a=>a?.user) : null);
            if (w && user && window.AsgardFieldTab) {
              AsgardFieldTab.openFieldModal(w, user);
            }
          }
        }).catch(() => console.log('evaluate fallback failed'));
        await page.waitForTimeout(3000);
      }
    }

    await page.screenshot({ path: 'tests/screenshots/field-audit/02-work-card.png', fullPage: true });

    // Find actions button - might be in a modal or in page
    const actBtn = page.locator('button').filter({ hasText: /Действия/ }).first();
    if (await actBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await actBtn.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: 'tests/screenshots/field-audit/03-actions.png', fullPage: true });

      // Click "Полевой модуль" in dropdown
      const items = page.locator('[class*="action"], [class*="dropdown"], [class*="menu"]').locator('text=Полевой модуль');
      if (await items.isVisible({ timeout: 1500 }).catch(() => false)) {
        await items.click();
      } else {
        // Try broader match
        await page.locator(':text("Полевой модуль")').last().click().catch(() => {});
      }
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: 'tests/screenshots/field-audit/04-field.png', fullPage: true });

    // Screenshot each tab
    const tabs = ['Бригада','Логистика','Дашборд','Табель','Подотчёт','Сборы','Маршруты','Выплаты'];
    for (let i = 0; i < tabs.length; i++) {
      const btn = page.locator('button').filter({ hasText: tabs[i] }).first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `tests/screenshots/field-audit/${String(i+5).padStart(2,'0')}-${tabs[i]}.png`, fullPage: true });
        console.log(tabs[i], '— ✓');
      } else {
        console.log(tabs[i], '— not found');
      }
    }

    // === Бригада: add button ===
    await page.locator('button').filter({ hasText: 'Бригада' }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    const addBtn = page.locator('button').filter({ hasText: /добавить/i }).first();
    if (await addBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'tests/screenshots/field-audit/crew-add.png', fullPage: true });
      console.log('Crew add — ✓');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // === Табель: edit mode ===
    await page.locator('button').filter({ hasText: 'Табель' }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'tests/screenshots/field-audit/timesheet-view.png', fullPage: true });
    const editBtn = page.locator('button').filter({ hasText: /Редактировать/ }).first();
    if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'tests/screenshots/field-audit/timesheet-edit.png', fullPage: true });
      console.log('Timesheet edit — ✓');
    }

    // === Выплаты: + Суточные ===
    await page.locator('button').filter({ hasText: 'Выплаты' }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'tests/screenshots/field-audit/payments.png', fullPage: true });
    const pdBtn = page.locator('button').filter({ hasText: /Суточные/ }).first();
    if (await pdBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pdBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'tests/screenshots/field-audit/payments-perdiem.png', fullPage: true });
      // Fill
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

    // Also check work report as n.androsov
    await h.loginAs(page, 'PM_ANDROSOV');
    await page.goto(h.BASE_URL + '/#/work-report?id=10');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'tests/screenshots/field-audit/work-report.png', fullPage: true });
  });
});
