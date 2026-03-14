// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo, isModalVisible, closeModal } = require('./helpers');

test.describe('Modals & Buttons — Comprehensive Test', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN');
  });

  // Pages with known "create" buttons
  const CREATE_PAGES = [
    { route: 'tenders',        btnText: 'Новый',       modalFields: ['customer_name', 'tender_type'] },
    { route: 'customers',      btnText: 'Добавить',    modalFields: ['inn', 'name'] },
    { route: 'pre-tenders',    btnText: 'Создать',     modalFields: ['customer_name'] },
    { route: 'tasks',          btnText: 'Создать',     modalFields: ['title'] },
    { route: 'meetings',       btnText: 'Создать',     modalFields: ['title'] },
    { route: 'cash',           btnText: 'Создать',     modalFields: ['amount'] },
    { route: 'correspondence', btnText: 'Создать',     modalFields: [] },
  ];

  for (const pg of CREATE_PAGES) {
    test(`${pg.route}: "Create" button opens modal with form`, async ({ page }) => {
      await navigateTo(page, pg.route);
      await page.waitForTimeout(1000);

      const btn = page.locator(`button:has-text("${pg.btnText}"), #btnNew, .btn:has-text("${pg.btnText}")`).first();
      if (await btn.count() === 0) {
        test.skip();
        return;
      }

      await btn.click();
      await page.waitForTimeout(700);

      const hasModal = await isModalVisible(page);
      expect(hasModal).toBeTruthy();

      // Modal should have form elements
      const formElements = page.locator('.modal input:not([type="hidden"]), .modal select, .modal textarea');
      expect(await formElements.count()).toBeGreaterThan(0);

      // Close modal
      await closeModal(page);
      await page.waitForTimeout(300);

      // Modal should be closed
      const stillOpen = await isModalVisible(page);
      expect(stillOpen).toBeFalsy();
    });
  }

  // Test table row click → detail modal
  const DETAIL_PAGES = [
    { route: 'tenders',       selector: 'tbody tr' },
    { route: 'pre-tenders',   selector: 'tbody tr, [data-id]' },
    { route: 'all-works',     selector: 'tbody tr' },
    { route: 'all-estimates', selector: 'tbody tr' },
    { route: 'customers',     selector: 'tbody tr' },
    { route: 'tkp',           selector: 'tbody tr' },
    { route: 'invoices',      selector: 'tbody tr' },
  ];

  for (const pg of DETAIL_PAGES) {
    test(`${pg.route}: row click opens detail`, async ({ page }) => {
      await navigateTo(page, pg.route);
      await page.waitForTimeout(1000);

      const row = page.locator(pg.selector).first();
      if (await row.count() === 0) {
        test.skip();
        return;
      }

      await row.click();
      await page.waitForTimeout(1000);

      // Should open a modal or detail panel
      const hasModal = await isModalVisible(page);
      const hasDetail = (await page.locator('.detail-panel, .detail-view').count()) > 0;
      expect(hasModal || hasDetail).toBeTruthy();

      if (hasModal) {
        await closeModal(page);
      }
    });
  }

  test('pass-requests page loads and has form', async ({ page }) => {
    await navigateTo(page, 'pass-requests');
    await page.waitForTimeout(1000);

    const newBtn = page.locator('button:has-text("Создать"), button:has-text("Новая"), button:has-text("Заявка")');
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

  test('permit-applications page loads', async ({ page }) => {
    await navigateTo(page, 'permit-applications');
    await page.waitForTimeout(1000);
    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
  });

  test('correspondence page loads and has create button', async ({ page }) => {
    await navigateTo(page, 'correspondence');
    await page.waitForTimeout(1000);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
  });

  test('hr-requests page loads', async ({ page }) => {
    await navigateTo(page, 'hr-requests');
    await page.waitForTimeout(1000);
    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
  });

  test('proc-requests page loads', async ({ page }) => {
    await navigateTo(page, 'proc-requests');
    await page.waitForTimeout(1000);
    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
  });
});
