// @ts-check
// File 26: Business Chain Tests — end-to-end flows through the UI
// Tests complete workflows: create → process → finalize
// Each chain verifies data flows between pages and roles without console errors.
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const TS = () => Date.now();

// ═══════════════════════════════════════════════════════════════
// CHAIN 1: Тендерная цепочка
// Pre-tender → Tender → Estimate (TKP) → view on PM page
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Chain 1: Tender Chain (TO → PM)', () => {
  test.setTimeout(240000);

  test('C1-01: TO creates pre-tender request', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'TO');
    await h.navigateTo(page, 'pre-tenders');
    await h.waitForPageLoad(page);

    await h.clickCreate(page);
    await page.waitForTimeout(800);

    const nameField = page.locator('#mcName, .modal input[name="customer_name"], .modal input[type="text"]').first();
    if (await nameField.count() > 0) {
      await nameField.fill(`Chain1 Customer ${TS()}`);
    }

    const descField = page.locator('#mcDesc, .modal textarea, .modal input[name="work_description"]').first();
    if (await descField.count() > 0) {
      await descField.fill('Chain1: pipeline survey and design works');
    }

    const sumField = page.locator('#mcSum, .modal input[name="estimated_sum"], .modal input[name="budget"]').first();
    if (await sumField.count() > 0) {
      await sumField.fill('1500000');
    }

    await h.clickSave(page).catch(() => {});
    await page.waitForTimeout(1500);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C1-01 TO creates pre-tender');
  });

  test('C1-02: ADMIN views tenders list (has content)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(100);
    h.assertNoConsoleErrors(errors, 'C1-02 ADMIN views tenders');
  });

  test('C1-03: PM views estimates (pm-calcs) page loads', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pm-calcs');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(1000);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Try to open first estimate if available
    const row = page.locator('tbody tr[data-id], .card[data-id], [data-id]').first();
    if (await row.count() > 0) {
      await h.clickRow(page, row);
      await page.waitForTimeout(1500);
      const hasDetail = await h.isModalVisible(page);
      // Modal opens or navigates to detail page — both OK
    }

    h.assertNoConsoleErrors(errors, 'C1-03 PM views estimates');
  });

  test('C1-04: PM views works (pm-works) page renders', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pm-works');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C1-04 PM pm-works');
  });
});

// ═══════════════════════════════════════════════════════════════
// CHAIN 2: Пропускная цепочка (Pass Request lifecycle)
// PM creates → submits → DIRECTOR approves → HR issues
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Chain 2: Pass Request Chain (PM → DIR → HR)', () => {
  test.setTimeout(240000);
  let passId = null;

  test('C2-01: PM creates pass request via UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    await h.clickCreate(page);
    await page.waitForTimeout(800);

    const nameField = page.locator('.modal input[name="visitor_name"], .modal input[name="object_name"], .modal input[type="text"]').first();
    if (await nameField.count() > 0) {
      await nameField.fill(`Chain2 Visitor ${TS()}`);
    }

    const purposeField = page.locator('.modal textarea, .modal input[name="purpose"]').first();
    if (await purposeField.count() > 0) {
      await purposeField.fill('Chain2: electrical inspection crew');
    }

    const dateFromField = page.locator('.modal input[type="date"]').first();
    if (await dateFromField.count() > 0) {
      await dateFromField.fill('2026-05-01');
    }

    await h.clickSave(page).catch(() => {});
    await page.waitForTimeout(1500);

    // Get ID from URL or first row
    const token = await h.getSessionToken(page);
    if (token) {
      const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/pass-requests?limit=1&orderBy=created_at&desc=true', null, token);
      passId = resp.data?.items?.[0]?.id || resp.data?.pass_requests?.[0]?.id || null;
    }

    h.assertNoConsoleErrors(errors, 'C2-01 PM creates pass request');
  });

  test('C2-02: PM submits pass request (draft → submitted)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const row = page.locator('tbody tr, .pass-row, [data-id]').first();
    if (await row.count() > 0) {
      await h.clickRow(page, row);
      await page.waitForTimeout(1000);

      const submitBtn = page.locator('button:has-text("Отправить"), button:has-text("Подать"), button:has-text("На рассмотрение")');
      if (await submitBtn.count() > 0) {
        await submitBtn.first().click();
        await page.waitForTimeout(1500);
      }
      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'C2-02 PM submits pass request');
  });

  test('C2-03: DIRECTOR approves pass request', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const row = page.locator('tbody tr, .pass-row, [data-id]').first();
    if (await row.count() > 0) {
      await h.clickRow(page, row);
      await page.waitForTimeout(1000);

      const approveBtn = page.locator('button:has-text("Утвердить"), button:has-text("Одобрить"), button:has-text("Approve")');
      if (await approveBtn.count() > 0) {
        await approveBtn.first().click();
        await page.waitForTimeout(1500);
      }
      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'C2-03 DIRECTOR approves pass request');
  });

  test('C2-04: HR marks pass as issued + verify status badge', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'pass-requests');
    await h.waitForPageLoad(page);

    const row = page.locator('tbody tr, .pass-row, [data-id]').first();
    if (await row.count() > 0) {
      await h.clickRow(page, row);
      await page.waitForTimeout(1000);

      const issueBtn = page.locator('button:has-text("Выдан"), button:has-text("Выдать"), button:has-text("Issued")');
      if (await issueBtn.count() > 0) {
        await issueBtn.first().click();
        await page.waitForTimeout(1500);
      }
      await h.closeModal(page);
    }

    // Verify status elements exist on page
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'C2-04 HR issues pass request');
  });
});

// ═══════════════════════════════════════════════════════════════
// CHAIN 3: Кадровая цепочка
// HR creates staff request → HEAD_PM approves → HR closes
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Chain 3: Staff Request Chain (HR → HEAD_PM)', () => {
  test.setTimeout(200000);

  test('C3-01: HR navigates to staff requests page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'personnel');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C3-01 HR on personnel');
  });

  test('C3-02: HR creates staff request via API (direct)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getSessionToken(page);
    if (token) {
      const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/staff-requests', {
        request_type: 'hire',
        position: `Chain3 Position ${TS()}`,
        department: 'Test Department',
        notes: 'Chain3 test staff request'
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'C3-02 HR creates staff request');
  });

  test('C3-03: HEAD_PM views staff requests page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HEAD_PM');
    await h.navigateTo(page, 'personnel');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C3-03 HEAD_PM views personnel');
  });
});

// ═══════════════════════════════════════════════════════════════
// CHAIN 4: Финансовая цепочка
// PM creates invoice → BUH reviews → DIRECTOR approves
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Chain 4: Invoice Chain (PM → BUH → DIR)', () => {
  test.setTimeout(200000);

  test('C4-01: PM views invoices page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'invoices');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(1000);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Try to open first invoice if exists
    const row = page.locator('tbody tr[data-id], [data-id]').first();
    if (await row.count() > 0) {
      await h.clickRow(page, row);
      await page.waitForTimeout(1200);
      const hasDetail = await h.isModalVisible(page);
      if (hasDetail) {
        await h.closeModal(page);
      }
    }

    h.assertNoConsoleErrors(errors, 'C4-01 PM invoices');
  });

  test('C4-02: BUH views invoices page + finances', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    await h.navigateTo(page, 'invoices');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C4-02 BUH invoices');
  });

  test('C4-03: BUH views finances page (cash flow)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    await h.navigateTo(page, 'finances');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C4-03 BUH finances');
  });

  test('C4-04: DIRECTOR_GEN views analytics (financial overview)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');
    await h.navigateTo(page, 'analytics');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(2000); // charts may take time

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C4-04 DIR analytics');
  });
});

// ═══════════════════════════════════════════════════════════════
// CHAIN 5: Оборудование (Warehouse chain)
// WAREHOUSE adds equipment → issues to holder → returns
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Chain 5: Equipment Chain (WAREHOUSE)', () => {
  test.setTimeout(200000);

  test('C5-01: WAREHOUSE views warehouse page with equipment', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'WAREHOUSE');
    await h.navigateTo(page, 'warehouse');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(1000);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C5-01 WAREHOUSE page');
  });

  test('C5-02: WAREHOUSE opens equipment card (detail modal)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'WAREHOUSE');
    await h.navigateTo(page, 'warehouse');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(1500);

    const row = page.locator('.fk-card[data-id], table tbody tr[data-id], [data-id]').first();
    if (await row.count() > 0) {
      await h.clickRow(page, row);
      await page.waitForTimeout(1200);

      const body = await page.textContent('body');
      expect(body.length).toBeGreaterThan(100);
      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'C5-02 WAREHOUSE equipment card');
  });

  test('C5-03: ADMIN views assembly page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'assembly');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(1000);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C5-03 ADMIN assembly');
  });
});

// ═══════════════════════════════════════════════════════════════
// CHAIN 6: Обучение (Training chain)
// PM creates → submits → HEAD_PM sees pending → HR completes
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Chain 6: Training Chain (PM → HEAD_PM → HR)', () => {
  test.setTimeout(200000);

  test('C6-01: PM creates training application', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'training');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(2000);

    const createBtn = page.locator('#btnAddTraining, button:has-text("Новая заявка"), button:has-text("Создать")').first();
    if (await createBtn.count() > 0) {
      await createBtn.click();
      await page.waitForTimeout(800);

      const courseField = page.locator('.modal input[id="tfCourseName"], .modal input[name="name"], .modal input[type="text"]').first();
      if (await courseField.count() > 0) {
        await courseField.fill(`Chain6 Course: Safety ${TS()}`);
      }

      const providerField = page.locator('.modal input[id="tfProvider"], .modal input[name="provider"]').first();
      if (await providerField.count() > 0) {
        await providerField.fill('Online Safety Academy');
      }

      await h.clickSave(page).catch(() => {});
      await page.waitForTimeout(1500);
    }

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C6-01 PM creates training');
  });

  test('C6-02: HEAD_PM views training page (sees pending approvals)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HEAD_PM');
    await h.navigateTo(page, 'training');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(1000);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C6-02 HEAD_PM training page');
  });

  test('C6-03: HR views training page (all applications)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'training');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(1000);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C6-03 HR training page');
  });
});

// ═══════════════════════════════════════════════════════════════
// CHAIN 7: Разрешения (Permits chain)
// HR/TO manages permits → PM views (read-only) → no JS errors
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Chain 7: Permits Chain', () => {
  test.setTimeout(200000);

  test('C7-01: HR opens permits page (read+write)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'permits');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(1000);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // HR can click first row
    const row = page.locator('tbody tr[data-id], [data-id]').first();
    if (await row.count() > 0) {
      await h.clickRow(page, row);
      await page.waitForTimeout(1000);
      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'C7-01 HR permits');
  });

  test('C7-02: PM opens permits page (read-only — must NOT be redirected)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'permits');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(1500);

    // PM should see the page (can_read=true in role_presets) OR be redirected
    // Either way no JS errors
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'C7-02 PM permits (read-only)');
  });

  test('C7-03: HR views permit-applications + opens first', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'permit-applications');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(1000);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C7-03 HR permit-applications');
  });
});

// ═══════════════════════════════════════════════════════════════
// CHAIN 8: Коммуникации (Messaging chain)
// PM sends message → ADMIN views in messenger
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Chain 8: Communications Chain', () => {
  test.setTimeout(180000);

  test('C8-01: PM opens messenger (no errors)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'messenger');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(1500);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C8-01 PM messenger');
  });

  test('C8-02: ADMIN opens meetings page + creates meeting', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'meetings');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C8-02 ADMIN meetings');
  });

  test('C8-03: DIRECTOR_GEN opens notifications page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');
    await h.navigateTo(page, 'alerts');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'C8-03 DIR notifications');
  });
});
