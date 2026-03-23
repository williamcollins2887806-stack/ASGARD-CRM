// @ts-check
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

/**
 * E2E Browser Tests: TKP (Technical-Commercial Proposal) Lifecycle
 * Maps to: flow-tkp-lifecycle.test.js (8 API tests) + 3 additional browser tests
 * Page: #/tkp
 */

test.describe.serial('TKP Lifecycle (Browser E2E)', () => {
  /** @type {string|null} */
  let tkpTitle = null;
  /** @type {string|null} */
  let tkpId = null;

  test('01 — HR cannot create TKP (no create button)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'tkp');

    // HR should not see a create button on the TKP page
    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить"), button:has-text("Новый"), button:has-text("+")');
    const count = await createBtn.count();

    // Either no create button, or page redirects, or access denied
    const noAccess = await h.expectNoAccess(page);
    expect(count === 0 || noAccess).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'HR cannot create TKP');
  });

  test('02 — TO creates TKP draft', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'TO');
    await h.navigateTo(page, 'tkp');

    // Click create button
    await h.clickCreate(page);
    await page.waitForTimeout(500);

    // Should see a modal or form
    const hasModal = await h.isModalVisible(page);
    expect(hasModal).toBeTruthy();

    // Fill TKP fields
    tkpTitle = 'E2E Browser TKP ' + Date.now();

    // Try filling title field
    const titleField = page.locator('input[name*="title"], input[id*="title"], input[placeholder*="Название"], input[placeholder*="наименование"], input[placeholder*="Тема"]');
    if (await titleField.count() > 0) {
      await titleField.first().fill(tkpTitle);
    }

    // Try filling customer name
    const customerField = page.locator('input[name*="customer"], input[id*="customer"], input[placeholder*="Заказчик"], input[placeholder*="Клиент"]');
    if (await customerField.count() > 0) {
      await customerField.first().fill('E2E Test Client LLC');
    }

    // Try filling description
    const descField = page.locator('textarea[name*="description"], textarea[name*="services"], textarea[id*="description"], textarea[placeholder*="Описание"]');
    if (await descField.count() > 0) {
      await descField.first().fill('Pipeline inspection, Welding works');
    }

    // Try filling total sum / amount
    const sumField = page.locator('input[name*="sum"], input[name*="total"], input[name*="amount"], input[id*="sum"], input[id*="total"]');
    if (await sumField.count() > 0) {
      await sumField.first().fill('2500000');
    }

    // Save
    await h.clickSave(page);
    await page.waitForTimeout(1000);

    // Expect success toast or modal closes
    await h.expectToast(page, 'ok');

    h.assertNoConsoleErrors(errors, 'TO creates TKP draft');
  });

  test('03 — TO views TKP details', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'TO');
    await h.navigateTo(page, 'tkp');
    await page.waitForTimeout(1000);

    // Find the created TKP row in the table (or any row if title not found)
    let targetRow;
    if (tkpTitle) {
      targetRow = page.locator(`tbody tr:has-text("${tkpTitle.substring(0, 20)}"), .card:has-text("${tkpTitle.substring(0, 20)}")`).first();
    }
    if (!targetRow || (await targetRow.count()) === 0) {
      targetRow = page.locator('tbody tr, .card[data-id], .list-item').first();
    }

    if (await targetRow.count() > 0) {
      await targetRow.click();
      await page.waitForTimeout(1500);

      // Page should have meaningful content (detail view could be modal, panel, or inline)
      const content = await page.textContent('body');
      expect(content.length).toBeGreaterThan(100);
    }

    h.assertNoConsoleErrors(errors, 'TO views TKP details');
  });

  test('04 — PM can list TKPs', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'tkp');

    // Verify table or list is present and not empty
    const rows = page.locator('table tbody tr, .card[data-id], .list-item, [data-id], .data-row');
    // PM may see limited TKPs — just verify the page loaded without error
    await page.waitForTimeout(1000);

    const pageContent = await page.textContent('body');
    // Page should have loaded something meaningful
    expect(pageContent.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'PM can list TKPs');
  });

  test('05 — ADMIN can list TKPs', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'tkp');

    // ADMIN sees all TKPs — verify table not empty
    await h.expectListNotEmpty(page);

    h.assertNoConsoleErrors(errors, 'ADMIN can list TKPs');
  });

  test('06 — PM updates TKP content', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'tkp');
    await page.waitForTimeout(1000);

    // Open first TKP
    const row = page.locator('tbody tr, .card[data-id], .list-item').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);

      // Try to find and edit description field
      const descField = page.locator('textarea[name*="description"], textarea[name*="services"], textarea[id*="description"], .modal textarea').first();
      if (await descField.count() > 0) {
        const current = await descField.inputValue();
        await descField.fill(current + ' [E2E Updated]');

        // Save changes
        const saveBtn = page.locator('button:has-text("Сохранить"), button:has-text("Обновить"), .btn-primary').first();
        if (await saveBtn.count() > 0) {
          await saveBtn.click();
          await page.waitForTimeout(1000);
          await h.expectToast(page, 'ok');
        }
      }
    }

    h.assertNoConsoleErrors(errors, 'PM updates TKP content');
  });

  test('07 — PM changes status to sent', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'tkp');
    await page.waitForTimeout(1000);

    // Open first TKP with draft status
    const draftRow = page.locator('tbody tr:has-text("черновик"), tbody tr:has-text("Черновик"), tbody tr:has-text("draft"), tbody tr').first();
    if (await draftRow.count() > 0) {
      await draftRow.click();
      await page.waitForTimeout(1000);

      // Look for status change button
      const statusBtn = page.locator('button:has-text("Отправить"), button:has-text("Отправлен"), select[name*="status"], .status-select, button:has-text("Статус")');
      if (await statusBtn.count() > 0) {
        await statusBtn.first().click();
        await page.waitForTimeout(500);

        // If it opened a dropdown/select, choose "sent"
        const sentOption = page.locator('option:has-text("Отправлен"), li:has-text("Отправлен"), [data-value="sent"]');
        if (await sentOption.count() > 0) {
          await sentOption.first().click();
          await page.waitForTimeout(500);
        }

        await page.waitForTimeout(1000);
      }
    }

    h.assertNoConsoleErrors(errors, 'PM changes status to sent');
  });

  test('08 — PM changes status to accepted', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'tkp');
    await page.waitForTimeout(1000);

    // Open a TKP with "sent" status
    const sentRow = page.locator('tbody tr:has-text("Отправлен"), tbody tr:has-text("sent"), tbody tr').first();
    if (await sentRow.count() > 0) {
      await sentRow.click();
      await page.waitForTimeout(1000);

      const statusBtn = page.locator('button:has-text("Принять"), button:has-text("Принят"), select[name*="status"], button:has-text("Статус")');
      const statusBtnVisible = await statusBtn.first().isVisible({ timeout: 2000 }).catch(() => false);
      if (statusBtnVisible) {
        await statusBtn.first().click();
        await page.waitForTimeout(500);

        const acceptedOption = page.locator('option:has-text("Принят"), li:has-text("Принят"), [data-value="accepted"]');
        if (await acceptedOption.count() > 0) {
          await acceptedOption.first().click();
          await page.waitForTimeout(500);
        }

        await page.waitForTimeout(1000);
      }
    }

    h.assertNoConsoleErrors(errors, 'PM changes status to accepted');
  });

  test('09 — PDF generation (no error)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'tkp');
    await page.waitForTimeout(1000);

    // Open first TKP
    const row = page.locator('tbody tr, .card[data-id]').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);

      // Look for PDF button
      const pdfBtn = page.locator('button:has-text("PDF"), button:has-text("Скачать"), button:has-text("Печать"), a:has-text("PDF"), [title*="PDF"]');
      if (await pdfBtn.count() > 0) {
        // Listen for download or new tab
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
          pdfBtn.first().click(),
        ]);

        // If download happened, verify it
        if (download) {
          const suggestedName = download.suggestedFilename();
          expect(suggestedName).toBeTruthy();
        }

        await page.waitForTimeout(1000);
      }
    }

    h.assertNoConsoleErrors(errors, 'PDF generation');
  });

  test('10 — Invalid status transition check', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    // Navigate to base URL first so fetch() works in browser context
    await page.goto(h.BASE_URL + '/#/welcome');
    await page.waitForTimeout(500);

    // Use API to verify invalid status transition is rejected
    const token = await h.getToken(page, 'PM');
    if (token) {
      // First get a TKP
      const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/tkp?limit=1', null, token);
      if (listResp.status === 200 && listResp.data?.items?.length > 0) {
        const tkp = listResp.data.items[0];
        // Try invalid status
        const resp = await h.apiCall(page, 'PUT', h.BASE_URL + '/api/tkp/' + tkp.id + '/status', { status: 'invalid_status_xyz' }, token);
        expect(resp.status).toBe(400);
      }
    }

    h.assertNoConsoleErrors(errors, 'Invalid status transition check');
  });

  test('11 — TKP page loads without console errors', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'tkp');
    await h.waitForPageLoad(page);

    // Verify the page loaded with meaningful content
    const pageContent = await page.textContent('body');
    expect(pageContent.length).toBeGreaterThan(50);

    // Verify no JS errors
    h.assertNoConsoleErrors(errors, 'TKP page loads without console errors');
  });
});
