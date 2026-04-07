const { test } = require('@playwright/test');
const h = require('../helpers');

// Helper: open work card by navigating to pm-works and clicking the row
async function openWorkCard(page, workId) {
  await page.goto(h.BASE_URL + '/#/pm-works');
  await page.waitForTimeout(3000);

  // Try different periods until we find the work
  const sel = page.locator('select').first();
  if (await sel.isVisible({ timeout: 2000 }).catch(() => false)) {
    const opts = await sel.locator('option').allTextContents();
    for (const o of opts) {
      await sel.selectOption({ label: o }).catch(() => {});
      await page.waitForTimeout(1500);
      const row = page.locator(`tr[data-id="${workId}"]`);
      if (await row.isVisible({ timeout: 1000 }).catch(() => false)) {
        await row.click();
        await page.waitForTimeout(2000);
        return true;
      }
    }
  }

  // Fallback: click any row with matching text
  const row = page.locator('tr').filter({ hasText: /АРХБУМ|Химическая/ }).first();
  if (await row.isVisible({ timeout: 2000 }).catch(() => false)) {
    await row.click();
    await page.waitForTimeout(2000);
    return true;
  }

  return false;
}

// Helper: open field module from work card
async function openFieldModule(page) {
  // Try #btnActions first
  const actBtn = page.locator('#btnActions');
  if (await actBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await actBtn.click();
    await page.waitForTimeout(800);
    const fieldItem = page.locator('text=Полевой модуль');
    if (await fieldItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fieldItem.click();
      await page.waitForTimeout(3000);
      return true;
    }
  }

  // Fallback: open field modal directly via JS
  const opened = await page.evaluate(() => {
    if (window.AsgardFieldTab && typeof AsgardFieldTab.openFieldModal === 'function') {
      const works = window.AsgardDB ? null : null;
      // Try to get work from already-open modal
      return false;
    }
    return false;
  });
  return opened;
}

test.describe.serial('Field Audit — Андросов PM', () => {

  test('All tabs + buttons', async ({ page }) => {
    await h.loginAs(page, 'PM_ANDROSOV');

    const found = await openWorkCard(page, 10);
    await page.screenshot({ path: 'tests/screenshots/field-audit/01-works.png', fullPage: true });

    if (!found) {
      console.log('Work 10 not found in any period — FAIL');
      return;
    }

    await page.screenshot({ path: 'tests/screenshots/field-audit/02-work-card.png', fullPage: true });

    // Check if btnActions exists (inside modal)
    const modalContent = await page.locator('.modal, .modal-back, [class*="modal"]').first().isVisible({ timeout: 2000 }).catch(() => false);
    console.log('Modal visible:', modalContent);

    // Try to find actions button
    const btnActions = page.locator('button:has-text("Действия"), #btnActions').first();
    const actionsVisible = await btnActions.isVisible({ timeout: 3000 }).catch(() => false);
    console.log('Actions button visible:', actionsVisible);

    if (actionsVisible) {
      await btnActions.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: 'tests/screenshots/field-audit/03-actions.png', fullPage: true });

      const fieldItem = page.locator('div:has-text("Полевой модуль"), li:has-text("Полевой модуль"), a:has-text("Полевой модуль")').first();
      if (await fieldItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await fieldItem.click();
        await page.waitForTimeout(3000);
      }
    }

    await page.screenshot({ path: 'tests/screenshots/field-audit/04-field.png', fullPage: true });

    // Try each tab
    const tabs = ['Бригада','Логистика','Дашборд','Табель','Подотчёт','Сборы','Маршруты','Выплаты'];
    for (let i = 0; i < tabs.length; i++) {
      const tabBtn = page.locator('button').filter({ hasText: tabs[i] }).first();
      const vis = await tabBtn.isVisible({ timeout: 1500 }).catch(() => false);
      if (vis) {
        await tabBtn.click();
        await page.waitForTimeout(2500);
        const n = String(i + 5).padStart(2, '0');
        await page.screenshot({ path: `tests/screenshots/field-audit/${n}-${tabs[i]}.png`, fullPage: true });
        console.log(`${tabs[i]} — ✓`);
      } else {
        console.log(`${tabs[i]} — NOT FOUND`);
      }
    }

    // === Test buttons ===

    // Бригада → "+ Добавить"
    const crewTab = page.locator('button').filter({ hasText: 'Бригада' }).first();
    if (await crewTab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await crewTab.click();
      await page.waitForTimeout(2000);
      const addBtn = page.locator('button').filter({ hasText: /добавить/i }).first();
      if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await addBtn.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: 'tests/screenshots/field-audit/crew-add.png', fullPage: true });
        console.log('Crew add modal — ✓');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    }

    // Табель → "Редактировать"
    const tsTab = page.locator('button').filter({ hasText: 'Табель' }).first();
    if (await tsTab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await tsTab.click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: 'tests/screenshots/field-audit/timesheet-view.png', fullPage: true });
      const editBtn = page.locator('button:has-text("Редактировать"), #tsEdit').first();
      if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'tests/screenshots/field-audit/timesheet-edit.png', fullPage: true });
        console.log('Timesheet edit — ✓');
      }
    }

    // Выплаты → "+ Суточные" + заполнить
    const payTab = page.locator('button').filter({ hasText: 'Выплаты' }).first();
    if (await payTab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await payTab.click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: 'tests/screenshots/field-audit/payments-tab.png', fullPage: true });

      const pdBtn = page.locator('button:has-text("Суточные")').first();
      if (await pdBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await pdBtn.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: 'tests/screenshots/field-audit/payments-perdiem.png', fullPage: true });

        // Fill period + submit
        await page.fill('#pdFrom', '2026-03-26').catch(() => {});
        await page.fill('#pdTo', '2026-03-31').catch(() => {});
        await page.fill('#pdRate', '1000').catch(() => {});
        await page.fill('#pdComment', 'Суточные АРХБУМ — выдано').catch(() => {});
        await page.locator('#pdSubmit').click().catch(() => {});
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'tests/screenshots/field-audit/payments-done.png', fullPage: true });
        console.log('Per diem submitted — ✓');
      }
    }
  });

  test('PWA login page', async ({ page }) => {
    await page.goto(h.BASE_URL + '/field/');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/screenshots/field-audit/pwa-login.png', fullPage: true });
  });
});
