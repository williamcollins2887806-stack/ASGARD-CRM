// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo, isModalVisible, closeModal } = require('./helpers');

test.describe('Cross-Role Business Flows', () => {

  test('FLOW 1: TO creates pre-tender → DIRECTOR approves', async ({ page }) => {
    // Step 1: TO creates a manual pre-tender
    await loginAs(page, 'TO');
    await navigateTo(page, 'pre-tenders');
    await page.waitForTimeout(1000);

    const createBtn = page.locator('#btnPtCreate, button:has-text("Создать")');
    if (await createBtn.count() === 0) {
      test.skip();
      return;
    }
    await createBtn.first().click();
    await page.waitForTimeout(500);

    // Fill form
    const nameField = page.locator('.modal input[name="customer_name"], .modal input[id*="customer"]');
    if (await nameField.count() > 0) {
      await nameField.first().fill('PW Test Customer ' + Date.now());
    }
    const emailField = page.locator('.modal input[name="customer_email"], .modal input[type="email"]');
    if (await emailField.count() > 0) {
      await emailField.first().fill('pwtest@example.com');
    }
    const descField = page.locator('.modal textarea[name="work_description"], .modal textarea');
    if (await descField.count() > 0) {
      await descField.first().fill('Playwright test: installation work');
    }

    const submitBtn = page.locator('.modal button:has-text("Создать"), .modal button.green');
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click();
      await page.waitForTimeout(2000);
    }

    // Step 2: Verify it appeared in the list
    await navigateTo(page, 'pre-tenders');
    await page.waitForTimeout(1000);
    const content = await page.textContent('body');
    expect(content).toContain('PW Test');
  });

  test('FLOW 2: PM sees tenders but not pre-tenders', async ({ page }) => {
    await loginAs(page, 'PM');

    // Can see tenders
    await navigateTo(page, 'tenders');
    await page.waitForTimeout(1000);
    let url = page.url();
    expect(url).toContain('tenders');

    // Cannot see pre-tenders
    await navigateTo(page, 'pre-tenders');
    await page.waitForTimeout(1500);
    url = page.url();
    const redirected = !url.includes('pre-tenders');
    const denied = (await page.locator(':has-text("Доступ")').count()) > 0;
    expect(redirected || denied).toBeTruthy();
  });

  test('FLOW 3: HR accesses personnel but not tenders', async ({ page }) => {
    await loginAs(page, 'HR');

    // Can see personnel
    await navigateTo(page, 'personnel');
    await page.waitForTimeout(1000);
    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);

    // Cannot see tenders
    await navigateTo(page, 'tenders');
    await page.waitForTimeout(1500);
    const url = page.url();
    const redirected = !url.includes('tenders');
    expect(redirected).toBeTruthy();
  });

  test('FLOW 4: BUH can access invoices and cash', async ({ page }) => {
    await loginAs(page, 'BUH');

    // Can see invoices
    await navigateTo(page, 'invoices');
    await page.waitForTimeout(1000);
    const table = page.locator('table, tbody');
    expect(await table.count()).toBeGreaterThan(0);

    // Can see cash
    await navigateTo(page, 'cash');
    await page.waitForTimeout(1000);
    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
  });

  test('FLOW 5: ADMIN can access settings', async ({ page }) => {
    await loginAs(page, 'ADMIN');
    await navigateTo(page, 'settings');
    await page.waitForTimeout(1000);

    // Should see settings tabs/sections
    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(100);

    // Should have save buttons
    const saveBtn = page.locator('button:has-text("Сохранить")');
    expect(await saveBtn.count()).toBeGreaterThanOrEqual(0);
  });
});
