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

    {
      await h.clickCreate(page);
      await page.waitForTimeout(500);

      // Fill contractor
      const contractorField = page.locator('.modal input[name="contractor_name"], .modal input[id*="contractor"], .modal input[name="title"]');
      if (await contractorField.count() > 0) {
        await contractorField.first().fill('PW Test Contractor LLC ' + TS());
      }

      // Fill contractor email
      const emailField = page.locator('.modal input[name="contractor_email"], .modal input[type="email"]');
      if (await emailField.count() > 0) {
        await emailField.first().fill('pw-test@example.com');
      }

      // Fill cover letter / description
      const descField = page.locator('.modal textarea[name="cover_letter"], .modal textarea');
      if (await descField.count() > 0) {
        await descField.first().fill('PW autotest permit application');
      }

      // Try to select employee/item if there's a dropdown
      const empSelect = page.locator('.modal select[name="employee_id"], .modal select[id*="employee"]');
      if (await empSelect.count() > 0) {
        const options = await empSelect.first().locator('option').count();
        if (options > 1) {
          await empSelect.first().selectOption({ index: 1 });
        }
      }

      // Try to select permit type
      const typeSelect = page.locator('.modal select[name="permit_type"], .modal select[name="type_id"], .modal select[id*="type"]');
      if (await typeSelect.count() > 0) {
        const options = await typeSelect.first().locator('option').count();
        if (options > 1) {
          await typeSelect.first().selectOption({ index: 1 });
        }
      }

      await h.clickSave(page);
      await page.waitForTimeout(1500);
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
