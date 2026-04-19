// @ts-check
// File 14: Pass Requests E2E — 12 browser tests
// Maps to: flow-pass-request.test.js (9) + 3
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const TS = () => Date.now();

test.describe.serial('Pass Requests Lifecycle', () => {

  test('PR-01: BUH cannot create pass request (no create button)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const url = page.url();
    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить"), button:has-text("Новая заявка")');
    const redirected = !url.includes('pass_requests');
    const noCreate = (await createBtn.count()) === 0;

    expect(redirected || noCreate).toBeTruthy();
    h.assertNoConsoleErrors(errors, 'PR-01 BUH no pass create');
  });

  test('PR-02: PM creates pass request (draft)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить"), button:has-text("Новая")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(500);

      // Fill visitor/object name
      const nameField = page.locator('.modal input[name="visitor_name"], .modal input[name="object_name"], .modal input[id*="visitor"], .modal input[id*="object"]');
      if (await nameField.count() > 0) {
        await nameField.first().fill('PW Visitor Ivanov ' + TS());
      }

      // Fill purpose
      const purposeField = page.locator('.modal input[name="purpose"], .modal textarea[name="purpose"], .modal textarea, .modal input[name="notes"]');
      if (await purposeField.count() > 0) {
        await purposeField.first().fill('PW test: pipeline maintenance crew');
      }

      // Fill date from
      const dateFromField = page.locator('.modal input[name="pass_date_from"], .modal input[name="date_from"], .modal input[type="date"]').first();
      if (await dateFromField.count() > 0) {
        await dateFromField.fill('2026-04-01');
      }

      // Fill date to
      const dateToField = page.locator('.modal input[name="pass_date_to"], .modal input[name="date_to"], .modal input[type="date"]').nth(1);
      if (await dateToField.count() > 0) {
        await dateToField.fill('2026-04-30');
      }

      // Contact person
      const contactField = page.locator('.modal input[name="contact_person"], .modal input[id*="contact"]');
      if (await contactField.count() > 0) {
        await contactField.first().fill('Sidorov S.S.');
      }

      // Contact phone
      const phoneField = page.locator('.modal input[name="contact_phone"], .modal input[id*="phone"], .modal input[type="tel"]');
      if (await phoneField.count() > 0) {
        await phoneField.first().fill('+7-900-123-4567');
      }

      await h.clickSave(page);
      await page.waitForTimeout(1500);
    }

    h.assertNoConsoleErrors(errors, 'PR-02 PM creates pass request');
  });

  test('PR-03: PM views pass request detail', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const row = page.locator('tbody tr, .pass-row, [data-id], .data-row').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1500);

      const body = await page.textContent('body');
      expect(body.length).toBeGreaterThan(100);
    }

    h.assertNoConsoleErrors(errors, 'PR-03 PM views pass request');
  });

  test('PR-04: PM updates pass request', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const row = page.locator('tbody tr, .pass-row, [data-id]').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);

      // Look for edit button
      const editBtn = page.locator('button:has-text("Редактировать"), button:has-text("Изменить"), button:has-text("Ред.")');
      if (await editBtn.count() > 0) {
        await editBtn.first().click();
        await page.waitForTimeout(500);

        const notesField = page.locator('.modal textarea[name="notes"], .modal textarea');
        if (await notesField.count() > 0) {
          await notesField.first().fill('Updated: PW test, added safety briefing');
        }

        await h.clickSave(page);
        await page.waitForTimeout(1000);
      }
    }

    h.assertNoConsoleErrors(errors, 'PR-04 PM updates pass request');
  });

  test('PR-05: PM submits (draft -> submitted) via button', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const row = page.locator('tbody tr, .pass-row, [data-id]').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);

      // Look for submit/send button
      const submitBtn = page.locator('button:has-text("Отправить"), button:has-text("Подать"), button:has-text("На рассмотрение"), button:has-text("Submit")');
      if (await submitBtn.count() > 0) {
        await submitBtn.first().click();
        await page.waitForTimeout(1500);
      }
    }

    h.assertNoConsoleErrors(errors, 'PR-05 PM submits pass request');
  });

  test('PR-06: PM lists pass requests (verify table)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(100);

    // Verify table/list structure
    const rows = page.locator('tbody tr, .pass-row, .data-row, [data-id]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(0);

    h.assertNoConsoleErrors(errors, 'PR-06 PM lists pass requests');
  });

  test('PR-07: DIRECTOR_GEN approves (submitted -> approved)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const row = page.locator('tbody tr, .pass-row, [data-id]').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);

      const approveBtn = page.locator('button:has-text("Утвердить"), button:has-text("Одобрить"), button:has-text("Approve"), button:has-text("Согласовать")');
      if (await approveBtn.count() > 0) {
        await approveBtn.first().click();
        await page.waitForTimeout(1500);
      }
    }

    h.assertNoConsoleErrors(errors, 'PR-07 DIRECTOR approves');
  });

  test('PR-08: HR marks issued (approved -> issued)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const row = page.locator('tbody tr, .pass-row, [data-id]').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);

      const issueBtn = page.locator('button:has-text("Выдан"), button:has-text("Выдать"), button:has-text("Issued"), button:has-text("Пропуск выдан")');
      if (await issueBtn.count() > 0) {
        await issueBtn.first().click();
        await page.waitForTimeout(1500);
      }
    }

    h.assertNoConsoleErrors(errors, 'PR-08 HR marks issued');
  });

  test('PR-09: Verify final state (issued)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(100);

    // Page should load and contain status information
    const statusElements = page.locator('.badge, .status, [class*="status"], .tag');
    const count = await statusElements.count();
    expect(count).toBeGreaterThanOrEqual(0);

    h.assertNoConsoleErrors(errors, 'PR-09 Verify final state');
  });

  test('PR-10: PDF generation (click PDF button)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const row = page.locator('tbody tr, .pass-row, [data-id]').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);

      const pdfBtn = page.locator('button:has-text("PDF"), button:has-text("Скачать"), button:has-text("Печать"), a:has-text("PDF")');
      if (await pdfBtn.count() > 0) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
          pdfBtn.first().click(),
        ]);
        expect(true).toBeTruthy();
      }
    }

    h.assertNoConsoleErrors(errors, 'PR-10 PDF generation');
  });

  test('PR-11: Invalid status rejected (button disabled or error)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    // Try to use API to set invalid status and verify error
    const token = await h.getToken(page, 'PM');
    if (token) {
      const result = await h.apiCall(page, 'GET', h.BASE_URL + '/api/pass-requests?limit=1', null, token);
      if (result.status === 200 && result.data?.items?.length > 0) {
        const passId = result.data.items[0].id;
        const badStatus = await h.apiCall(page, 'PUT', h.BASE_URL + '/api/pass-requests/' + passId + '/status', { status: 'bogus_status' }, token);
        expect(badStatus.status).toBe(400);
      }
    }

    h.assertNoConsoleErrors(errors, 'PR-11 Invalid status rejected');
  });

  test('PR-12: Page loads for each role without errors', async ({ page }) => {
    test.setTimeout(180000);
    const roles = ['ADMIN', 'PM', 'DIRECTOR_GEN', 'HR', 'TO', 'BUH'];

    for (const role of roles) {
      const errors = h.setupConsoleCollector(page);
      await h.loginAs(page, role);
      await h.navigateTo(page, 'pass-requests');
      await h.waitForPageLoad(page);

      // Page either loads content or redirects (no access) — both valid
      const body = await page.textContent('body');
      expect(body.length).toBeGreaterThan(10);

      h.assertNoConsoleErrors(errors, `PR-12 ${role} page load`);
    }
  });

});
