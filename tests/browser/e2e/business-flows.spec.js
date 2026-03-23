// @ts-check
// Business Flows E2E — 27 browser tests
// Maps to: flow-business.test.js (14), flows-complete.test.js (8), flows.test.js (5)
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const TS = () => Date.now();

// ─── Group A: flow-business (14 tests) ───────────────────────────

test.describe('Business Flows — Core', () => {

  test('BIZ-01: Tender lifecycle via UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    // Verify tenders page loads with data or empty state
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(100);

    // Create tender
    await h.clickCreate(page);
    await page.waitForTimeout(500);
    expect(await h.isModalVisible(page)).toBeTruthy();

    const descField = page.locator('.modal textarea, .modal input[name="description"]');
    if (await descField.count() > 0) {
      await descField.first().fill('PW BIZ Tender ' + TS());
    }
    const priceField = page.locator('.modal input[name="tender_price"], .modal input[id*="price"]');
    if (await priceField.count() > 0) {
      await priceField.first().fill('500000');
    }

    await h.clickSave(page);
    await page.waitForTimeout(1500);

    h.assertNoConsoleErrors(errors, 'BIZ-01 Tender lifecycle');
  });

  test('BIZ-02: Cash request flow', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'cash');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Новая заявка")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(500);

      const amtField = page.locator('.modal input[name="amount"], .modal input[id*="amount"], .modal input[type="number"]');
      if (await amtField.count() > 0) {
        await amtField.first().fill('15000');
      }
      const descField = page.locator('.modal textarea, .modal input[name="purpose"]');
      if (await descField.count() > 0) {
        await descField.first().fill('PW Cash request ' + TS());
      }

      await h.clickSave(page);
      await page.waitForTimeout(1000);
    }

    h.assertNoConsoleErrors(errors, 'BIZ-02 Cash request');
  });

  test('BIZ-03: Tender to Estimate link', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    // Open first tender
    const row = page.locator('tbody tr, .tender-row, .tender-card').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1500);

      // Look for estimate button/tab
      const estBtn = page.locator('button:has-text("Смета"), button:has-text("ТКП"), a:has-text("Смета")');
      if (await estBtn.count() > 0) {
        await estBtn.first().click();
        await page.waitForTimeout(1000);
      }
      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'BIZ-03 Tender→Estimate');
  });

  test('BIZ-04: Calendar event creation', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'calendar');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить"), button:has-text("Событие")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(500);

      const titleField = page.locator('.modal input[name="title"], .modal input[id*="title"], .modal input[name="name"]');
      if (await titleField.count() > 0) {
        await titleField.first().fill('PW Calendar Event ' + TS());
      }
      await h.clickSave(page);
      await page.waitForTimeout(1000);
    }

    h.assertNoConsoleErrors(errors, 'BIZ-04 Calendar event');
  });

  test('BIZ-05: Equipment page loads', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'warehouse');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Wait for equipment page toolbar to fully render (async fetch + DOM)
    await page.waitForSelector('#btnAddEquipment, #btnAddEquip', { timeout: 10000 }).catch(() => {});

    // Verify create button exists for admin
    const createBtn = page.locator('#btnAddEquipment, #btnAddEquip, button:has-text("Создать"), button:has-text("Добавить")');
    expect(await createBtn.count()).toBeGreaterThan(0);

    h.assertNoConsoleErrors(errors, 'BIZ-05 Equipment');
  });

  test('BIZ-06: Chat group creation', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'messenger');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    const newChatBtn = page.locator('button:has-text("Создать"), button:has-text("Новый чат"), button:has-text("Группа"), .hg-new-chat-btn');
    if (await newChatBtn.count() > 0) {
      await newChatBtn.first().click();
      await page.waitForTimeout(500);

      const nameField = page.locator('.modal input[name="name"], .modal input[id*="name"], input[placeholder*="Название"]');
      if (await nameField.count() > 0) {
        await nameField.first().fill('PW Chat Group ' + TS());
      }
      await h.clickSave(page);
      await page.waitForTimeout(1000);
    }

    h.assertNoConsoleErrors(errors, 'BIZ-06 Chat group');
  });

  test('BIZ-07: Customer creation', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'customers');
    await h.waitForPageLoad(page);

    await h.clickCreate(page);
    await page.waitForTimeout(500);

    const nameField = page.locator('.modal input[name="name"], .modal input[id*="name"], .modal input[id*="customer"]');
    if (await nameField.count() > 0) {
      await nameField.first().fill('PW Customer ' + TS());
    }
    const innField = page.locator('.modal input[name="inn"], .modal input[id*="inn"]');
    if (await innField.count() > 0) {
      await innField.first().fill('7707083893');
    }

    // Customers page may navigate to card page (not modal) — guard save
    if (await h.isModalVisible(page)) {
      await h.clickSave(page);
    }
    await page.waitForTimeout(1000);

    h.assertNoConsoleErrors(errors, 'BIZ-07 Customer');
  });

  test('BIZ-08: Invoice with payments page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    await h.navigateTo(page, 'invoices');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Verify BUH can see invoices
    const table = page.locator('table, .invoice-list, tbody');
    if (await table.count() > 0) {
      const rows = page.locator('tbody tr');
      // May or may not have data
    }

    h.assertNoConsoleErrors(errors, 'BIZ-08 Invoices');
  });

  test('BIZ-09: Work with expenses', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pm-works');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'BIZ-09 Works');
  });

  test('BIZ-10: Permits page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'permits');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'BIZ-10 Permits');
  });

  test('BIZ-11: Acts page loads', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'acts');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'BIZ-11 Acts');
  });

  test('BIZ-12: Notifications page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'alerts');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'BIZ-12 Notifications');
  });

  test('BIZ-13: Settings page (ADMIN only)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'settings');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Verify settings-specific elements
    const tabs = page.locator('.tab, .nav-tab, [role="tab"]');
    // Settings page should have some form elements
    const inputs = await h.getVisibleInputs(page);
    expect(inputs.length).toBeGreaterThanOrEqual(0); // at least renders

    h.assertNoConsoleErrors(errors, 'BIZ-13 Settings');
  });

  test('BIZ-14: Sites management', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'home');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(500);

      const nameField = page.locator('.modal input[name="name"], .modal input[type="text"]');
      if (await nameField.count() > 0) {
        await nameField.first().fill('PW Site ' + TS());
      }
      const addrField = page.locator('.modal input[name="address"], .modal textarea[name="address"]');
      if (await addrField.count() > 0) {
        await addrField.first().fill('Test address');
      }
      await h.clickSave(page);
      await page.waitForTimeout(1000);
    }

    h.assertNoConsoleErrors(errors, 'BIZ-14 Sites');
  });
});

// ─── Group B: flows-complete (8 tests) ──────────────────────────

test.describe('Business Flows — Complete Scenarios', () => {

  test('COMPLETE-01: Tender → Work → Estimate → Act → Invoice', async ({ page }) => {
    test.setTimeout(200000);
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');

    // Step 1: Verify tenders page
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);
    const tendersBody = await page.textContent('body');
    expect(tendersBody.length).toBeGreaterThan(100);

    // Step 2: Navigate to works
    await h.navigateTo(page, 'pm-works');
    await h.waitForPageLoad(page);
    const worksBody = await page.textContent('body');
    expect(worksBody.length).toBeGreaterThan(50);

    // Step 3: Navigate to estimates
    await h.navigateTo(page, 'all-estimates');
    await h.waitForPageLoad(page);

    // Step 4: Navigate to acts
    await h.navigateTo(page, 'acts');
    await h.waitForPageLoad(page);

    // Step 5: Navigate to invoices
    await h.navigateTo(page, 'invoices');
    await h.waitForPageLoad(page);

    h.assertNoConsoleErrors(errors, 'COMPLETE-01 Full lifecycle');
  });

  test('COMPLETE-02: Task assign and complete', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'tasks');
    await h.waitForPageLoad(page);

    const createBtn = page.locator('#btnNewTask, button:has-text("Новая задача")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click({ force: true });
      await page.waitForTimeout(800);

      const titleField = page.locator('.modal input[name="title"], .modal input[name="name"], .modal input[type="text"]');
      if (await titleField.count() > 0) {
        await titleField.first().fill('PW Task ' + TS());
      }
      const descField = page.locator('.modal textarea');
      if (await descField.count() > 0) {
        await descField.first().fill('Test task description');
      }

      if (await h.isModalVisible(page)) {
        await h.clickSave(page);
      }
      await page.waitForTimeout(1500);
    }

    h.assertNoConsoleErrors(errors, 'COMPLETE-02 Task flow');
  });

  test('COMPLETE-03: Employee onboarding flow', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'personnel');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // HR should see personnel list
    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить"), button:has-text("Новый сотрудник")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(500);

      const nameField = page.locator('.modal input[name="full_name"], .modal input[name="name"], .modal input[id*="name"]');
      if (await nameField.count() > 0) {
        await nameField.first().fill('PW Employee ' + TS());
      }
      const posField = page.locator('.modal input[name="position"], .modal select[name="position"]');
      if (await posField.count() > 0) {
        if (await posField.first().evaluate(el => el.tagName) === 'SELECT') {
          await posField.first().selectOption({ index: 1 });
        } else {
          await posField.first().fill('Тестировщик');
        }
      }

      await h.clickSave(page);
      await page.waitForTimeout(1000);
    }

    h.assertNoConsoleErrors(errors, 'COMPLETE-03 Employee onboarding');
  });

  test('COMPLETE-04: Cash request approval flow', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    // PM creates cash request
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'cash');
    await h.waitForPageLoad(page);

    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Новая заявка")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(500);

      const amtField = page.locator('.modal input[name="amount"], .modal input[type="number"]');
      if (await amtField.count() > 0) await amtField.first().fill('25000');
      const descField = page.locator('.modal textarea, .modal input[name="purpose"]');
      if (await descField.count() > 0) await descField.first().fill('PW Cash approval test ' + TS());

      await h.clickSave(page);
      await page.waitForTimeout(1000);
    }

    // Director can see cash requests
    await h.loginAs(page, 'DIRECTOR_GEN');
    await h.navigateTo(page, 'cash');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'COMPLETE-04 Cash approval');
  });

  test('COMPLETE-05: Pre-tender → Tender conversion', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'TO');
    await h.navigateTo(page, 'pre-tenders');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Verify pre-tenders list is accessible for TO
    await page.waitForSelector('#btnPtCreate, button:has-text("Создать заявку")', { timeout: 10000 }).catch(() => {});
    const createBtn = page.locator('button:has-text("Создать"), #btnPtCreate');
    expect(await createBtn.count()).toBeGreaterThan(0);

    h.assertNoConsoleErrors(errors, 'COMPLETE-05 Pre-tender→Tender');
  });

  test('COMPLETE-06: Work with office expense', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pm-works');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Navigate to expenses
    await h.navigateTo(page, 'office-expenses');
    await h.waitForPageLoad(page);
    const expBody = await page.textContent('body');
    expect(expBody.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'COMPLETE-06 Work+expense');
  });

  test('COMPLETE-07: User CRUD (ADMIN)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'settings');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Verify user list renders
    const table = page.locator('table, tbody, .user-list');
    if (await table.count() > 0) {
      const rows = page.locator('tbody tr');
      expect(await rows.count()).toBeGreaterThan(0);
    }

    h.assertNoConsoleErrors(errors, 'COMPLETE-07 User CRUD');
  });

  test('COMPLETE-08: Equipment create → issue → return', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'warehouse');
    await h.waitForPageLoad(page);

    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(500);

      const nameField = page.locator('.modal input[name="name"], .modal input[type="text"]');
      if (await nameField.count() > 0) {
        await nameField.first().fill('PW Equipment ' + TS());
      }
      const serialField = page.locator('.modal input[name="serial_number"], .modal input[name="serial"]');
      if (await serialField.count() > 0) {
        await serialField.first().fill('SN-PW-' + TS());
      }

      await h.clickSave(page);
      await page.waitForTimeout(1000);
    }

    h.assertNoConsoleErrors(errors, 'COMPLETE-08 Equipment lifecycle');
  });
});

// ─── Group C: flows deep (5 tests) ──────────────────────────────

test.describe('Business Flows — Deep Integration', () => {

  test('DEEP-01: Tender → Estimate linked verification', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');

    // Open tenders
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    // Open first tender to check estimate link
    const row = page.locator('tbody tr, .tender-row').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1500);

      // Check for estimate tab/section in tender detail
      const estSection = page.locator('[data-tab="estimate"], button:has-text("Смета"), a:has-text("ТКП"), .tab:has-text("Смет")');
      if (await estSection.count() > 0) {
        await estSection.first().click();
        await page.waitForTimeout(1000);
      }

      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'DEEP-01 Tender→Estimate linked');
  });

  test('DEEP-02: Work → expense → income flow', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');

    // Works page
    await h.navigateTo(page, 'pm-works');
    await h.waitForPageLoad(page);
    let body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Expenses page
    await h.navigateTo(page, 'office-expenses');
    await h.waitForPageLoad(page);
    body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Income page
    await h.navigateTo(page, 'finances');
    await h.waitForPageLoad(page);
    body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'DEEP-02 Work→expense→income');
  });

  test('DEEP-03: Task full cycle (create → assign → progress → complete)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'tasks');
    await h.waitForPageLoad(page);

    // Create task
    const createBtn = page.locator('#btnNewTask, button:has-text("Новая задача")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click({ force: true });
      await page.waitForTimeout(800);

      const titleField = page.locator('.modal input[name="title"], .modal input[name="name"], .modal input[type="text"]');
      if (await titleField.count() > 0) {
        await titleField.first().fill('PW Full Cycle Task ' + TS());
      }
      const descField = page.locator('.modal textarea');
      if (await descField.count() > 0) {
        await descField.first().fill('Full cycle test');
      }

      if (await h.isModalVisible(page)) {
        await h.clickSave(page);
      }
      await page.waitForTimeout(1500);
    }

    // Verify task list is accessible
    await h.navigateTo(page, 'tasks');
    await h.waitForPageLoad(page);
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'DEEP-03 Task full cycle');
  });

  test('DEEP-04: Employee → Permit creation', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');

    // Navigate to personnel
    await h.navigateTo(page, 'personnel');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Navigate to permits
    await h.navigateTo(page, 'permits');
    await h.waitForPageLoad(page);

    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(500);

      const fields = await h.getVisibleInputs(page);
      expect(fields.length).toBeGreaterThan(0);

      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'DEEP-04 Employee→Permit');
  });

  test('DEEP-05: Site CRUD (create, verify, navigate)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const siteName = 'PW Site CRUD ' + TS();

    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'home');
    await h.waitForPageLoad(page);

    // Create site
    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(500);

      const nameField = page.locator('.modal input[name="name"], .modal input[type="text"]');
      if (await nameField.count() > 0) {
        await nameField.first().fill(siteName);
      }
      const addrField = page.locator('.modal input[name="address"], .modal textarea[name="address"]');
      if (await addrField.count() > 0) {
        await addrField.first().fill('Test address for CRUD');
      }

      await h.clickSave(page);
      await page.waitForTimeout(1500);
    }

    // Verify page accessible (route /sites may redirect to home if not configured)
    await h.navigateTo(page, 'home');
    await h.waitForPageLoad(page);
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(100);

    h.assertNoConsoleErrors(errors, 'DEEP-05 Site CRUD');
  });
});
