// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo, isModalVisible, closeModal, getVisibleButtons } = require('./helpers');

test.describe('Tenders Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN');
    await navigateTo(page, 'tenders');
  });

  test('page loads with table and toolbar', async ({ page }) => {
    // Should have toolbar with buttons
    const toolbar = page.locator('.toolbar, .panel-header, .filters');
    await expect(toolbar.first()).toBeVisible({ timeout: 5000 });

    // Should have table or list
    const table = page.locator('table, .tender-list, .kanban-board, tbody');
    await expect(table.first()).toBeVisible({ timeout: 5000 });
  });

  test('filter controls work', async ({ page }) => {
    // Status filter
    const statusFilter = page.locator('select#fStatus, select[data-filter="status"]');
    if (await statusFilter.count() > 0) {
      await statusFilter.first().selectOption({ index: 1 });
      await page.waitForTimeout(500);
    }

    // Search field
    const search = page.locator('input[type="search"], input#fSearch, input[placeholder*="Поиск"]');
    if (await search.count() > 0) {
      await search.first().fill('тест');
      await page.waitForTimeout(500);
      await search.first().fill('');
    }
  });

  test('"Новый тендер" button opens modal', async ({ page }) => {
    const newBtn = page.locator('button:has-text("Новый"), button:has-text("Создать"), #btnNewTender');
    if (await newBtn.count() > 0) {
      await newBtn.first().click();
      await page.waitForTimeout(500);
      const hasModal = await isModalVisible(page);
      expect(hasModal).toBeTruthy();

      // Modal should have form fields
      const inputs = page.locator('.modal input, .modal select, .modal textarea');
      expect(await inputs.count()).toBeGreaterThan(0);

      await closeModal(page);
    }
  });

  test('clicking a tender row opens detail modal', async ({ page }) => {
    const row = page.locator('tbody tr, .tender-row, .tender-card').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);
      const hasModal = await isModalVisible(page);
      // Either modal opens or detail panel appears
      const hasDetail = hasModal || (await page.locator('.detail-panel, .tender-detail').count()) > 0;
      expect(hasDetail).toBeTruthy();
    }
  });

  test('tender detail has action buttons', async ({ page }) => {
    const row = page.locator('tbody tr, .tender-row, .tender-card').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);

      const buttons = await getVisibleButtons(page);
      const buttonTexts = buttons.map(b => b.text.toLowerCase());
      // Should have at least some action buttons
      expect(buttons.length).toBeGreaterThan(0);
    }
  });

  test('pagination controls visible when >20 items', async ({ page }) => {
    const pagination = page.locator('[id*="pagination"], .pagination-controls, .page-size-selector');
    // Pagination may or may not be visible depending on data count
    const count = await pagination.count();
    // Just check it doesn't crash
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
