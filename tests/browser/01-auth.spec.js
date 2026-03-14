// @ts-check
const { test, expect } = require('@playwright/test');
const { BASE_URL, ACCOUNTS, loginAs } = require('./helpers');

test.describe('Authentication', () => {
  test('should show welcome/login page by default', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForTimeout(1500);
    // Should see login button or welcome
    const hasLogin = await page.locator('#btnShowLogin, #btnLoginGo, button:has-text("Войти")').count();
    expect(hasLogin).toBeGreaterThan(0);
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto(BASE_URL + '/#/welcome');
    await page.waitForTimeout(800);

    // Show login form
    const showBtn = page.locator('#btnShowLogin, button:has-text("Войти")');
    if (await showBtn.count() > 0) await showBtn.first().click();
    await page.waitForTimeout(500);

    await page.fill('#w_login', 'wronguser');
    await page.fill('#w_pass', 'wrongpass');

    const loginBtn = page.locator('#btnDoLogin');
    if (await loginBtn.count() > 0) await loginBtn.click();
    await page.waitForTimeout(2000);

    // Should show error or stay on login
    const url = page.url();
    const stillOnWelcome = url.includes('welcome') || url.includes('login');
    expect(stillOnWelcome).toBeTruthy();
  });

  test('ADMIN can login successfully', async ({ page }) => {
    await loginAs(page, 'ADMIN');
    const url = page.url();
    // Should be on home, dashboard, or any authenticated page
    expect(url).not.toContain('/welcome');
  });

  // Test login for each major role
  for (const role of ['PM', 'TO', 'DIRECTOR_GEN', 'HR', 'BUH']) {
    test(`${role} can login successfully`, async ({ page }) => {
      await loginAs(page, role);
      const url = page.url();
      expect(url).not.toContain('/welcome');
    });
  }

  test('should logout correctly', async ({ page }) => {
    await loginAs(page, 'ADMIN');

    // Find logout button
    const logoutBtn = page.locator('#btnLogout, button:has-text("Выйти"), [data-action="logout"]');
    if (await logoutBtn.count() > 0) {
      page.on('dialog', dialog => dialog.accept());
      await logoutBtn.first().click();
      await page.waitForTimeout(2000);
      const url = page.url();
      expect(url).toMatch(/welcome|login/);
    }
  });
});
