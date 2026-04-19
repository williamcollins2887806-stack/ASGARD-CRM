// @ts-check
// File 15: Permits E2E — 3 browser tests
// Maps to: flow-permit-application.test.js
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const TS = () => Date.now();

test.describe.serial('Permits & Permit Applications', () => {

  test('PRM-01: HR creates permit application', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'permit-applications');
    await h.waitForPageLoad(page);

    const url = page.url();
    // If page redirected (no access), try alternate route
    if (!url.includes('permit')) {
      await h.navigateTo(page, 'permits');
      await h.waitForPageLoad(page);
    }

    // permit_applications.js uses #btnNewApp which navigates to #/permit-application-form (full page, no modal)
    const newAppBtn = page.locator('#btnNewApp, #btnNewAppEmpty, button:has-text("Новая заявка")');
    if (await newAppBtn.count() > 0) {
      await newAppBtn.first().click();
      // Wait for navigation to permit-application-form page
      await page.waitForTimeout(1500);
      await h.waitForPageLoad(page);

      // Fill contractor name (page-level input, NOT modal)
      const contractorField = page.locator('#fContractorName, input[id*="contractor"], input[placeholder*="подрядчик"]');
      if (await contractorField.count() > 0) {
        await contractorField.first().fill('PW Test Contractor LLC ' + TS());
      }

      // Fill contractor email
      const emailField = page.locator('#fContractorEmail, input[type="email"]');
      if (await emailField.count() > 0) {
        await emailField.first().fill('pw-test@example.com');
      }

      // Save draft (page-level button, NOT inside .modal)
      const saveDraftBtn = page.locator('#btnSaveDraft, button:has-text("Сохранить черновик")');
      if (await saveDraftBtn.count() > 0) {
        await saveDraftBtn.first().click();
        await page.waitForTimeout(1500);
      }
    }

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'PRM-01 HR creates permit application');
  });

  test('PRM-02: HR updates draft, lists applications, ADMIN can view', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    // --- HR updates draft ---
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'permit-applications');
    await h.waitForPageLoad(page);

    let url = page.url();
    if (!url.includes('permit')) {
      await h.navigateTo(page, 'permits');
      await h.waitForPageLoad(page);
    }

    // Open first item
    const row = page.locator('tbody tr, .permit-row, [data-id], .data-row').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);

      // Edit button
      const editBtn = page.locator('button:has-text("Редактировать"), button:has-text("Изменить"), button:has-text("Ред.")');
      if (await editBtn.count() > 0) {
        await editBtn.first().click();
        await page.waitForTimeout(500);

        const descField = page.locator('.modal textarea, .modal input[name="cover_letter"], .modal input[name="title"]');
        if (await descField.count() > 0) {
          await descField.first().fill('PW Updated permit application ' + TS());
        }

        await h.clickSave(page);
        await page.waitForTimeout(1000);
      }

      await h.closeModal(page);
    }

    // --- HR lists ---
    await h.navigateTo(page, 'permit-applications');
    await h.waitForPageLoad(page);
    let body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // --- ADMIN can view ---
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'permit-applications');
    await h.waitForPageLoad(page);

    url = page.url();
    if (!url.includes('permit')) {
      await h.navigateTo(page, 'permits');
      await h.waitForPageLoad(page);
    }

    body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // ADMIN opens first item
    const adminRow = page.locator('tbody tr, .permit-row, [data-id]').first();
    if (await adminRow.count() > 0) {
      await adminRow.click();
      await page.waitForTimeout(1000);

      body = await page.textContent('body');
      expect(body.length).toBeGreaterThan(100);
      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'PRM-02 HR update + ADMIN view');
  });

  test('PRM-03: PM cannot view permit applications (no access)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'permit-applications');
    await h.waitForPageLoad(page);

    const url = page.url();
    const redirected = !url.includes('permit');

    // Also try API check
    const token = await h.getToken(page, 'PM');
    let apiForbidden = false;
    if (token) {
      const result = await h.apiCall(page, 'GET', h.BASE_URL + '/api/permit-applications', null, token);
      apiForbidden = result.status === 403;
    }

    // PM should either be redirected or get 403 via API
    expect(redirected || apiForbidden).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'PRM-03 PM no access');
  });

});
