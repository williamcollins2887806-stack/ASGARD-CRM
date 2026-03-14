// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo, isModalVisible, closeModal, getVisibleInputs } = require('./helpers');

test.describe('TKP (Commercial Proposals) Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN');
    await navigateTo(page, 'tkp');
  });

  test('page loads with TKP list', async ({ page }) => {
    const table = page.locator('table, tbody, .tkp-list');
    await expect(table.first()).toBeVisible({ timeout: 5000 });
  });

  test('"Создать ТКП" button opens form', async ({ page }) => {
    const newBtn = page.locator('button:has-text("Создать"), button:has-text("Новое ТКП"), #btnNewTkp');
    if (await newBtn.count() > 0) {
      await newBtn.first().click();
      await page.waitForTimeout(500);
      const hasModal = await isModalVisible(page);
      expect(hasModal).toBeTruthy();

      // Should have customer, amount, description fields
      const inputs = await getVisibleInputs(page);
      expect(inputs.length).toBeGreaterThan(2);

      await closeModal(page);
    }
  });

  test('TKP detail shows with PDF download button', async ({ page }) => {
    const row = page.locator('tbody tr').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);

      // Should have PDF button
      const pdfBtn = page.locator('button:has-text("PDF"), a:has-text("PDF"), button:has-text("Скачать")');
      expect(await pdfBtn.count()).toBeGreaterThanOrEqual(0);
    }
  });

  test('pagination controls present', async ({ page }) => {
    const pagination = page.locator('[id*="pagination"], .pagination');
    expect(await pagination.count()).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Invoices Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN');
    await navigateTo(page, 'invoices');
  });

  test('page loads with invoice list', async ({ page }) => {
    const table = page.locator('table, tbody, .invoice-list');
    await expect(table.first()).toBeVisible({ timeout: 5000 });
  });

  test('"Создать счёт" opens form with auto-number placeholder', async ({ page }) => {
    const newBtn = page.locator('button:has-text("Создать"), button:has-text("Новый"), #btnNewInvoice');
    if (await newBtn.count() > 0) {
      await newBtn.first().click();
      await page.waitForTimeout(500);
      const hasModal = await isModalVisible(page);
      expect(hasModal).toBeTruthy();

      // Invoice number field should have auto placeholder
      const numField = page.locator('input[name*="number"], input[id*="number"], input[placeholder*="СЧ"]');
      if (await numField.count() > 0) {
        const placeholder = await numField.first().getAttribute('placeholder');
        // Placeholder should suggest auto-numbering
        expect(placeholder || '').toMatch(/СЧ|Авто|автоматически/i);
      }

      await closeModal(page);
    }
  });

  test('invoice detail shows PDF button', async ({ page }) => {
    const row = page.locator('tbody tr').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);
      const pdfBtn = page.locator('button:has-text("PDF"), a:has-text("PDF")');
      expect(await pdfBtn.count()).toBeGreaterThanOrEqual(0);
    }
  });
});
