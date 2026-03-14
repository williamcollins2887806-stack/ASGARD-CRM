// @ts-check
const { test, expect } = require('@playwright/test');
const { BASE_URL, loginAs, navigateTo, getVisibleButtons } = require('./helpers');

test.describe('Page Navigation & Rendering', () => {
  // Core pages that ADMIN should access
  const CORE_PAGES = [
    { route: 'home',            title: 'Главная' },
    { route: 'dashboard',       title: 'Дашборд' },
    { route: 'tenders',         title: 'Тендеры' },
    { route: 'pre-tenders',     title: 'Заявки' },
    { route: 'all-works',       title: 'Работы' },
    { route: 'all-estimates',   title: 'Сметы' },
    { route: 'customers',       title: 'Заказчики' },
    { route: 'tkp',             title: 'ТКП' },
    { route: 'invoices',        title: 'Счета' },
    { route: 'personnel',       title: 'Персонал' },
    { route: 'hr-requests',     title: 'Заявки на персонал' },
    { route: 'proc-requests',   title: 'Закупки' },
    { route: 'correspondence',  title: 'Корреспонденция' },
    { route: 'calendar',        title: 'Календарь' },
    { route: 'tasks',           title: 'Задачи' },
    { route: 'cash',            title: 'Касса' },
    { route: 'settings',        title: 'Настройки' },
    { route: 'pass-requests',   title: 'Пропуска' },
    { route: 'permits',         title: 'Допуски' },
    { route: 'meetings',        title: 'Совещания' },
    { route: 'kpi-money',       title: 'KPI Деньги' },
    { route: 'kpi-works',       title: 'KPI Работы' },
  ];

  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN');
  });

  for (const pg of CORE_PAGES) {
    test(`Navigate to ${pg.route} — page renders without errors`, async ({ page }) => {
      // Capture console errors
      const errors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
      });

      await navigateTo(page, pg.route);

      // Page should have some content
      const bodyText = await page.textContent('body');
      expect(bodyText.length).toBeGreaterThan(50);

      // No JS errors that crash the page (filter out known non-critical)
      const criticalErrors = errors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('net::ERR') &&
        !e.includes('ETELEGRAM') &&
        !e.includes('ResizeObserver') &&
        !e.includes('indexedDB') &&
        (e.includes('TypeError') || e.includes('ReferenceError') || e.includes('SyntaxError'))
      );
      expect(criticalErrors).toEqual([]);
    });
  }

  test('Sidebar navigation links are visible for ADMIN', async ({ page }) => {
    await navigateTo(page, 'home');
    // Check sidebar has navigation items
    const navItems = await page.locator('.nav-item, .sidebar-item, [data-page], a[href*="#/"]').count();
    expect(navItems).toBeGreaterThan(5);
  });

  test('Page-not-found route handled gracefully', async ({ page }) => {
    await navigateTo(page, 'nonexistent-page-xyz');
    await page.waitForTimeout(1000);
    // Should redirect to home or show message, not crash
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(50);
  });
});
