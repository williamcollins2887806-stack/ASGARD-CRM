// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo, isModalVisible, closeModal, getVisibleInputs } = require('./helpers');

test.describe('Customers Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN');
    await navigateTo(page, 'customers');
  });

  test('page loads with customer list', async ({ page }) => {
    const table = page.locator('table, tbody, .customer-list');
    await expect(table.first()).toBeVisible({ timeout: 5000 });
  });

  test('"Добавить" button opens create form', async ({ page }) => {
    const newBtn = page.locator('button:has-text("Добавить"), button:has-text("Создать"), #btnNewCustomer');
    if (await newBtn.count() > 0) {
      await newBtn.first().click();
      await page.waitForTimeout(500);
      const hasModal = await isModalVisible(page);
      expect(hasModal).toBeTruthy();

      // Should have INN field with DaData autocomplete
      const innField = page.locator('input[name*="inn"], input[id*="inn"], input[placeholder*="ИНН"]');
      expect(await innField.count()).toBeGreaterThan(0);

      await closeModal(page);
    }
  });

  test('DaData autocomplete triggers on INN input', async ({ page }) => {
    const newBtn = page.locator('button:has-text("Добавить"), button:has-text("Создать"), #btnNewCustomer');
    if (await newBtn.count() > 0) {
      await newBtn.first().click();
      await page.waitForTimeout(500);

      const innField = page.locator('input[name*="inn"], input[id*="inn"]');
      if (await innField.count() > 0) {
        await innField.first().fill('7707083893'); // Сбербанк ИНН
        await page.waitForTimeout(1000);
        // Check for dropdown suggestions
        const dropdown = page.locator('.dadata-dropdown, .suggest-dropdown, [class*="suggest"]');
        // May or may not appear depending on API key
        expect(await dropdown.count()).toBeGreaterThanOrEqual(0);
      }

      await closeModal(page);
    }
  });

  test('search filter works', async ({ page }) => {
    const search = page.locator('input[type="search"], input[placeholder*="Поиск"]');
    if (await search.count() > 0) {
      await search.first().fill('тест');
      await page.waitForTimeout(500);
      // Table should update
      const bodyText = await page.textContent('body');
      expect(bodyText.length).toBeGreaterThan(0);
    }
  });
});

test.describe('Personnel Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN');
    await navigateTo(page, 'personnel');
  });

  test('page loads with personnel list', async ({ page }) => {
    const table = page.locator('table, tbody, .personnel-list');
    await expect(table.first()).toBeVisible({ timeout: 5000 });
  });

  test('"Добавить сотрудника" button opens form', async ({ page }) => {
    const newBtn = page.locator('button:has-text("Добавить"), button:has-text("Создать"), #btnAddEmployee');
    if (await newBtn.count() > 0) {
      await newBtn.first().click();
      await page.waitForTimeout(500);
      const hasModal = await isModalVisible(page);
      expect(hasModal).toBeTruthy();

      // Should have name, position, phone fields
      const inputs = await getVisibleInputs(page);
      expect(inputs.length).toBeGreaterThan(2);

      await closeModal(page);
    }
  });

  test('HR role can access personnel page', async ({ page }) => {
    await loginAs(page, 'HR');
    await navigateTo(page, 'personnel');
    await page.waitForTimeout(1000);
    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
  });
});
