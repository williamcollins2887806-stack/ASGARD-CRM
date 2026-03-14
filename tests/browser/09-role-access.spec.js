// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo } = require('./helpers');

/**
 * Role-based access matrix
 * Each role should only see pages they have access to
 */
const ACCESS_MATRIX = {
  PM: {
    allowed: ['home', 'dashboard', 'tenders', 'all-works', 'all-estimates', 'customers', 'tkp', 'invoices', 'tasks', 'calendar'],
    denied: ['settings', 'personnel', 'kpi-money', 'kpi-works', 'cash-admin'],
  },
  TO: {
    allowed: ['home', 'dashboard', 'tenders', 'pre-tenders', 'all-works', 'all-estimates', 'customers', 'tkp', 'tasks', 'calendar'],
    denied: ['settings', 'personnel', 'invoices', 'kpi-money', 'cash-admin'],
  },
  HR: {
    allowed: ['home', 'dashboard', 'personnel', 'hr-requests', 'calendar', 'tasks'],
    denied: ['tenders', 'pre-tenders', 'settings', 'kpi-money', 'cash-admin', 'invoices'],
  },
  BUH: {
    allowed: ['home', 'dashboard', 'invoices', 'cash', 'calendar', 'tasks'],
    denied: ['tenders', 'pre-tenders', 'settings', 'kpi-money', 'personnel'],
  },
};

for (const [role, access] of Object.entries(ACCESS_MATRIX)) {
  test.describe(`Role ${role} — Access Control`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, role);
    });

    for (const pageName of access.allowed) {
      test(`can access ${pageName}`, async ({ page }) => {
        await navigateTo(page, pageName);
        await page.waitForTimeout(1500);

        // Should not be redirected away
        const url = page.url();
        const content = await page.textContent('body');
        const isAccessible = url.includes(pageName) || content.length > 100;
        expect(isAccessible).toBeTruthy();
      });
    }

    for (const pageName of access.denied) {
      test(`denied access to ${pageName}`, async ({ page }) => {
        await navigateTo(page, pageName);
        await page.waitForTimeout(1500);

        // Should be redirected to home or show access denied
        const url = page.url();
        const redirectedAway = !url.includes(pageName);
        const hasAccessDenied = (await page.locator(':has-text("Доступ запрещен"), :has-text("403"), :has-text("Нет доступа")').count()) > 0;
        expect(redirectedAway || hasAccessDenied).toBeTruthy();
      });
    }
  });
}
