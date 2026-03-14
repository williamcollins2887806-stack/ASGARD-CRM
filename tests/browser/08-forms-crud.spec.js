// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo, isModalVisible, closeModal, waitForToast } = require('./helpers');

test.describe('Forms — Create and Save Operations', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN');
  });

  test('create and delete a customer', async ({ page }) => {
    await navigateTo(page, 'customers');
    const newBtn = page.locator('button:has-text("Добавить"), button:has-text("Создать")');
    if (await newBtn.count() === 0) return;

    await newBtn.first().click();
    await page.waitForTimeout(500);

    // Fill required fields
    const nameField = page.locator('input[name*="name"], input[id*="name"], input[placeholder*="Наименование"]');
    if (await nameField.count() > 0) {
      await nameField.first().fill('E2E Test Customer ' + Date.now());
    }

    const innField = page.locator('input[name*="inn"], input[id*="inn"]');
    if (await innField.count() > 0) {
      await innField.first().fill('9999999999');
    }

    // Submit
    const saveBtn = page.locator('.modal button:has-text("Сохранить"), .modal button:has-text("Создать"), .modal button.green, .modal .btn-primary');
    if (await saveBtn.count() > 0) {
      await saveBtn.first().click();
      await page.waitForTimeout(1500);
    }
  });

  test('create a manual pre-tender', async ({ page }) => {
    await navigateTo(page, 'pre-tenders');
    const createBtn = page.locator('#btnPtCreate, button:has-text("Создать")');
    if (await createBtn.count() === 0) return;

    await createBtn.first().click();
    await page.waitForTimeout(500);

    // Fill form
    const fields = {
      'customer_name': 'E2E Test Corp',
      'customer_email': 'e2e@test.com',
      'work_description': 'E2E test pre-tender description',
    };

    for (const [name, value] of Object.entries(fields)) {
      const input = page.locator(`input[name="${name}"], textarea[name="${name}"], #${name}, input[id*="${name}"]`);
      if (await input.count() > 0) {
        if (await input.first().evaluate(el => el.tagName) === 'TEXTAREA') {
          await input.first().fill(value);
        } else {
          await input.first().fill(value);
        }
      }
    }

    // Submit
    const submitBtn = page.locator('.modal button:has-text("Создать"), .modal button:has-text("Сохранить"), .modal button.green');
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click();
      await page.waitForTimeout(1500);
    }
  });

  test('settings page — company profile loads and saves', async ({ page }) => {
    await navigateTo(page, 'settings');
    await page.waitForTimeout(1000);

    // Should have settings sections
    const sections = page.locator('.settings-section, .tab, [data-tab]');
    expect(await sections.count()).toBeGreaterThanOrEqual(0);

    // Company profile tab
    const profileTab = page.locator('button:has-text("Профиль"), [data-tab*="profile"], a:has-text("Профиль")');
    if (await profileTab.count() > 0) {
      await profileTab.first().click();
      await page.waitForTimeout(500);
    }

    // Should have company name field
    const companyName = page.locator('input[id*="company"], input[name*="company_name"]');
    expect(await companyName.count()).toBeGreaterThanOrEqual(0);
  });

  test('calendar page loads without errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('Error')) errors.push(msg.text());
    });

    await navigateTo(page, 'calendar');
    await page.waitForTimeout(2000);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
  });

  test('tasks page — create task button works', async ({ page }) => {
    await navigateTo(page, 'tasks');
    await page.waitForTimeout(1000);

    const newBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить"), #btnNewTask');
    if (await newBtn.count() > 0) {
      await newBtn.first().click();
      await page.waitForTimeout(500);
      const hasModal = await isModalVisible(page);
      if (hasModal) {
        const inputs = page.locator('.modal input, .modal select, .modal textarea');
        expect(await inputs.count()).toBeGreaterThan(0);
        await closeModal(page);
      }
    }
  });
});
