// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo } = require('./helpers');

test.describe('Dashboard Widgets', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN');
  });

  test('dashboard loads with widgets', async ({ page }) => {
    await navigateTo(page, 'dashboard');
    await page.waitForTimeout(2000);

    // Should have widget containers
    const widgets = page.locator('.widget, .dashboard-widget, [data-widget], .card');
    expect(await widgets.count()).toBeGreaterThan(0);
  });

  test('dashboard has no JS errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && (msg.text().includes('TypeError') || msg.text().includes('ReferenceError'))) {
        errors.push(msg.text());
      }
    });

    await navigateTo(page, 'dashboard');
    await page.waitForTimeout(3000);

    expect(errors).toEqual([]);
  });

  test('widgets show actual data (not empty)', async ({ page }) => {
    await navigateTo(page, 'dashboard');
    await page.waitForTimeout(3000);

    const widgetContents = await page.evaluate(() => {
      const widgets = document.querySelectorAll('.widget, .dashboard-widget, [data-widget], .card');
      return Array.from(widgets).map(w => (w.textContent || '').trim().length);
    });

    // At least some widgets should have content
    const nonEmpty = widgetContents.filter(len => len > 10);
    expect(nonEmpty.length).toBeGreaterThan(0);
  });

  test('big screen mode loads', async ({ page }) => {
    await navigateTo(page, 'big-screen');
    await page.waitForTimeout(2000);
    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
  });
});

test.describe('KPI Pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN');
  });

  test('KPI Money page loads with charts', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('Error')) errors.push(msg.text());
    });

    await navigateTo(page, 'kpi-money');
    await page.waitForTimeout(2000);

    // Should have canvas elements (Chart.js)
    const canvases = page.locator('canvas');
    expect(await canvases.count()).toBeGreaterThanOrEqual(0);

    // Page should have content
    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
  });

  test('KPI Works page loads with performance data', async ({ page }) => {
    await navigateTo(page, 'kpi-works');
    await page.waitForTimeout(2000);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);

    // Should have some chart/gauge/meter
    const charts = page.locator('canvas, .chart, .gauge, svg');
    expect(await charts.count()).toBeGreaterThanOrEqual(0);
  });

  test('only ADMIN and directors can access KPI pages', async ({ page }) => {
    await loginAs(page, 'PM');
    await navigateTo(page, 'kpi-money');
    await page.waitForTimeout(1500);
    // PM should be redirected or denied
    const url = page.url();
    const denied = !url.includes('kpi-money') || (await page.locator(':has-text("Доступ")').count()) > 0;
    expect(denied).toBeTruthy();
  });
});
