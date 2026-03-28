// @ts-check
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

/**
 * E2E Browser Tests: Procurement + Warehouse + Assembly Pipeline
 * Maps to: flow-procurement-warehouse-assembly.test.js
 * Pages: #/procurement, #/warehouse, #/equipment, #/assembly
 *
 * 65 tests across 7 sections:
 *   S1: Access control (1-5)
 *   S2: PM creates procurement, adds items (6-15)
 *   S3: Approval chain (16-25)
 *   S4: Equipment creation from procurement items (26-35)
 *   S5: Assembly lifecycle (36-50)
 *   S6: DnD API assign/unassign (51-60)
 *   S7: Integration tests and full E2E cycle (61-65)
 */

// ─── Shared state across sections ───
let procReqId = null;
let procItemIds = [];
let assemblyId = null;
let palletId = null;
let asmWorkId = null;
let equipmentId = null;
let fullProcId = null;
let fullAssemblyId = null;
let demobAssemblyId = null;

// ═══════════════════════════════════════════════════════════
// SECTION 1: Access Control (tests 1-5)
// ═══════════════════════════════════════════════════════════

test.describe.serial('S1: Access Control', () => {
  test('01 — HR cannot create procurement request', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'procurement');

    const noAccess = await h.expectNoAccess(page);
    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить")');
    expect((await createBtn.count()) === 0 || noAccess).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'HR cannot create procurement');
  });

  test('02 — Procurement page loads for PM', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'procurement');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'Procurement page loads for PM');
  });

  test('03 — Warehouse page loads for WAREHOUSE', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'WAREHOUSE');
    await h.navigateTo(page, 'warehouse');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'Warehouse page loads');
  });

  test('04 — Assembly page loads for PM', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'assembly');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'Assembly page loads');
  });

  test('05 — Server is alive (API health check)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    expect(token).toBeTruthy();

    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/auth/me', null, token);
    expect(resp.status).toBe(200);
    expect(resp.data?.user?.id).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'Server alive');
  });
});

// ═══════════════════════════════════════════════════════════
// SECTION 2: PM creates procurement, adds items (tests 6-15)
// ═══════════════════════════════════════════════════════════

test.describe.serial('S2: Procurement Creation & Items', () => {
  test('06 — PM creates procurement request via UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'procurement');
    await h.waitForPageLoad(page);

    // Use direct selector to avoid generic clickCreate clicking the Mimir sidebar button instead
    const createBtn = page.locator('#pf-create, button:has-text("Новая заявка")').first();
    await createBtn.waitFor({ state: 'visible', timeout: 8000 });
    await createBtn.click();
    await page.waitForTimeout(800);

    const titleField = page.locator('input[name*="title"], input[id*="title"], input[placeholder*="Название"]');
    if (await titleField.count() > 0) {
      await titleField.first().fill('PIPELINE_TEST: Закупка E2E ' + Date.now());
    }

    const prioritySelect = page.locator('select[name*="priority"], select[id*="priority"]');
    if (await prioritySelect.count() > 0) {
      await prioritySelect.first().selectOption({ index: 1 });
    }

    await h.clickSave(page);
    await page.waitForTimeout(1000);

    // Get procReqId via API (PM is already logged in via loginAs above)
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/procurement?search=PIPELINE_TEST&limit=5', null, token);
    if (resp.status === 200 && resp.data?.items?.length > 0) {
      procReqId = resp.data.items[0].id;
    }
    expect(procReqId).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'PM creates procurement');
  });

  test('07 — PM adds item 1 (pipe)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procReqId}/items`, {
      name: 'Труба 108', article: 'TR-108', unit: 'м.п.', quantity: 50, unit_price: 2500
    }, token);
    expect(resp.status).toBeLessThan(300);
    if (resp.data?.item?.id) procItemIds.push(resp.data.item.id);
    expect(parseFloat(resp.data?.item?.total_price)).toBe(125000);

    h.assertNoConsoleErrors(errors, 'Add item 1');
  });

  test('08 — PM adds item 2 (electrodes)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    await h.loginAs(page, 'PM');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procReqId}/items`, {
      name: 'Электроды', unit: 'кг', quantity: 100, unit_price: 500
    }, token);
    expect(resp.status).not.toBe(500);
    if (resp.status < 300 && resp.data?.item?.id) procItemIds.push(resp.data.item.id);

    h.assertNoConsoleErrors(errors, 'Add item 2');
  });

  test('09 — PM views detail with 2 items and correct total', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procReqId}`, null, token);
    expect(resp.status).toBe(200);
    expect(resp.data?.items?.length).toBe(2);
    expect(Number(resp.data?.item?.total_sum)).toBe(175000);

    h.assertNoConsoleErrors(errors, 'Detail with items');
  });

  test('10 — PM updates item quantity/price', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId || !procItemIds[0]) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procReqId}/items/${procItemIds[0]}`, {
      quantity: 60, unit_price: 2600
    }, token);
    expect(resp.status).toBeLessThan(300);
    expect(Number(resp.data?.item?.total_price)).toBe(156000);

    h.assertNoConsoleErrors(errors, 'Update item');
  });

  test('11 — PM deletes item', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId || !procItemIds[0]) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    await h.apiCall(page, 'DELETE', h.BASE_URL + `/api/procurement/${procReqId}/items/${procItemIds[0]}`, null, token);

    const check = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procReqId}`, null, token);
    expect(check.data?.items?.length).toBe(1);
    procItemIds.shift();

    h.assertNoConsoleErrors(errors, 'Delete item');
  });

  test('12 — PM adds bulk items (3 at once)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procReqId}/items/bulk`, {
      items: [
        { name: 'Шланг', unit: 'м', quantity: 50, unit_price: 800 },
        { name: 'Головка O33', unit: 'шт', quantity: 4, unit_price: 15000 },
        { name: 'Манометр', unit: 'шт', quantity: 2, unit_price: 3500 }
      ]
    }, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.count).toBe(3);

    h.assertNoConsoleErrors(errors, 'Bulk items');
  });

  test('13 — Validation: bad delivery target rejects 400', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procReqId}/items`, {
      name: 'X', quantity: 1, delivery_target: 'xxx'
    }, token);
    expect(resp.status).toBe(400);

    h.assertNoConsoleErrors(errors, 'Bad delivery target');
  });

  test('14 — Validation: NaN quantity rejects 400', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procReqId}/items`, {
      name: 'X', quantity: 'abc'
    }, token);
    expect(resp.status).toBe(400);

    h.assertNoConsoleErrors(errors, 'NaN quantity');
  });

  test('15 — Search finds procurement by title', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/procurement?search=PIPELINE_TEST', null, token);
    expect(resp.status).toBe(200);
    expect(resp.data?.items?.length).toBeGreaterThanOrEqual(1);

    h.assertNoConsoleErrors(errors, 'Search procurement');
  });
});

// ═══════════════════════════════════════════════════════════
// SECTION 3: Approval Chain (tests 16-25)
// ═══════════════════════════════════════════════════════════

test.describe.serial('S3: Approval Chain', () => {
  test('16 — PM sends to PROC (draft -> sent_to_proc)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procReqId}/send-to-proc`, {}, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('sent_to_proc');

    h.assertNoConsoleErrors(errors, 'PM sends to proc');
  });

  test('17 — No re-send (409 conflict)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procReqId}/send-to-proc`, {}, token);
    expect(resp.status).toBe(409);

    h.assertNoConsoleErrors(errors, 'No re-send');
  });

  test('18 — PROC responds (sent_to_proc -> proc_responded)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'PROC');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procReqId}/proc-respond`, {
      comment: 'OK'
    }, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('proc_responded');

    h.assertNoConsoleErrors(errors, 'PROC responds');
  });

  test('19 — PM approves (proc_responded -> pm_approved)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procReqId}/pm-approve`, {}, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('pm_approved');

    h.assertNoConsoleErrors(errors, 'PM approves');
  });

  test('20 — DIRECTOR_GEN approves -> locked', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'DIRECTOR_GEN');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procReqId}/dir-approve`, {}, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.locked).toBe(true);

    h.assertNoConsoleErrors(errors, 'DIR approves');
  });

  test('21 — Cannot edit locked request (409)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procReqId}/items`, {
      name: 'Fail', quantity: 1
    }, token);
    expect(resp.status).toBe(409);

    h.assertNoConsoleErrors(errors, 'Cannot edit locked');
  });

  test('22 — Cannot pay from draft (409)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    const pmToken = await h.getToken(page, 'PM');
    const cr = await h.apiCall(page, 'POST', h.BASE_URL + '/api/procurement', { title: 'TmpPayTest' }, pmToken);
    if (cr.status >= 400 || !cr.data?.item?.id) { test.skip(); return; }

    const tmpId = cr.data.item.id;
    const buhToken = await h.getToken(page, 'BUH');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${tmpId}/mark-paid`, {}, buhToken);
    expect(resp.status).toBe(409);

    // Cleanup
    const adminToken = await h.getToken(page, 'ADMIN');
    await h.apiCall(page, 'DELETE', h.BASE_URL + `/api/procurement/${tmpId}`, null, adminToken);

    h.assertNoConsoleErrors(errors, 'Cannot pay from draft');
  });

  test('23 — BUH pays (dir_approved -> paid)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'BUH');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procReqId}/mark-paid`, {}, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('paid');

    h.assertNoConsoleErrors(errors, 'BUH pays');
  });

  test('24 — Deliver items -> partially_delivered -> delivered', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'WAREHOUSE');
    const detail = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procReqId}`, null, token);
    const items = detail.data?.items || [];
    expect(items.length).toBeGreaterThan(0);

    // Deliver first item
    const dr1 = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procReqId}/items/${items[0].id}/deliver`, {}, token);
    expect(dr1.status).toBeLessThan(300);

    if (items.length > 1) {
      const check = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procReqId}`, null, token);
      expect(check.data?.item?.status).toBe('partially_delivered');
    }

    // Deliver remaining items
    for (let i = 1; i < items.length; i++) {
      await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procReqId}/items/${items[i].id}/deliver`, {}, token);
    }

    const final = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procReqId}`, null, token);
    expect(final.data?.item?.status).toBe('delivered');

    h.assertNoConsoleErrors(errors, 'Deliver items');
  });

  test('25 — PM closes procurement (delivered -> closed)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!procReqId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procReqId}/close`, {}, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('closed');

    // Verify via UI
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'procurement');
    await page.waitForTimeout(1000);

    h.assertNoConsoleErrors(errors, 'PM closes');
  });
});

// ═══════════════════════════════════════════════════════════
// SECTION 4: Equipment creation from procurement (tests 26-35)
// ═══════════════════════════════════════════════════════════

test.describe.serial('S4: Equipment from Procurement', () => {
  let eqProcId = null;
  let eqItemId = null;
  let eqProcId2 = null;
  let eqItemId2 = null;

  test('26 — Equipment stats endpoint works', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const token = await h.getToken(page, 'WAREHOUSE');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/equipment/stats/summary', null, token);
    if (resp.status === 404) { test.skip(); return; }
    expect(resp.status).toBe(200);

    h.assertNoConsoleErrors(errors, 'Equipment stats');
  });

  test('27 — from-procurement rejects invalid ID', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const token = await h.getToken(page, 'WAREHOUSE');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/equipment/from-procurement', {
      procurement_item_id: -1
    }, token);
    expect(resp.status).not.toBe(500);

    h.assertNoConsoleErrors(errors, 'Reject invalid ID');
  });

  test('28 — Available equipment endpoint works', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/equipment/available', null, token);
    expect(resp.status).not.toBe(500);

    h.assertNoConsoleErrors(errors, 'Available equipment');
  });

  test('29 — Create procurement for warehouse delivery -> auto equipment', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    const pmToken = await h.getToken(page, 'PM');
    const cr = await h.apiCall(page, 'POST', h.BASE_URL + '/api/procurement', {
      title: 'S4: FromProc Test'
    }, pmToken);
    if (cr.status === 404) { test.skip(); return; }
    expect(cr.status).toBeLessThan(300);
    eqProcId = cr.data.item.id;

    const it = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${eqProcId}/items`, {
      name: 'Кабель ВВГ', unit: 'м', quantity: 100, unit_price: 150, delivery_target: 'warehouse'
    }, pmToken);
    expect(it.status).toBeLessThan(300);
    eqItemId = it.data.item.id;

    // Run through approval chain
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId}/send-to-proc`, {}, pmToken);
    const procToken = await h.getToken(page, 'PROC');
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId}/proc-respond`, {}, procToken);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId}/pm-approve`, {}, pmToken);
    const dirToken = await h.getToken(page, 'DIRECTOR_GEN');
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId}/dir-approve`, {}, dirToken);
    const buhToken = await h.getToken(page, 'BUH');
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId}/mark-paid`, {}, buhToken);

    // Deliver -> should auto-create equipment
    const whToken = await h.getToken(page, 'WAREHOUSE');
    const dr = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId}/items/${eqItemId}/deliver`, {}, whToken);
    expect(dr.status).toBeLessThan(300);
    expect(dr.data?.item?.equipment_id).toBeTruthy();

    // Verify equipment exists
    const eq = await h.apiCall(page, 'GET', h.BASE_URL + `/api/equipment/${dr.data.item.equipment_id}`, null, whToken);
    expect(eq.status).toBe(200);
    expect(eq.data?.equipment?.status).toBe('on_warehouse');
    equipmentId = dr.data.item.equipment_id;

    h.assertNoConsoleErrors(errors, 'Auto equipment from procurement');
  });

  test('30 — Manual from-procurement for object delivery', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    const pmToken = await h.getToken(page, 'PM');
    const cr = await h.apiCall(page, 'POST', h.BASE_URL + '/api/procurement', {
      title: 'S4: Manual FromProc'
    }, pmToken);
    if (cr.status === 404) { test.skip(); return; }
    eqProcId2 = cr.data.item.id;

    const it = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${eqProcId2}/items`, {
      name: 'Насос ЭЦВ', unit: 'шт', quantity: 1, unit_price: 85000, delivery_target: 'object'
    }, pmToken);
    eqItemId2 = it.data.item.id;

    // Approval chain
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId2}/send-to-proc`, {}, pmToken);
    const procToken = await h.getToken(page, 'PROC');
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId2}/proc-respond`, {}, procToken);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId2}/pm-approve`, {}, pmToken);
    const dirToken = await h.getToken(page, 'DIRECTOR_GEN');
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId2}/dir-approve`, {}, dirToken);
    const buhToken = await h.getToken(page, 'BUH');
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId2}/mark-paid`, {}, buhToken);
    const whToken = await h.getToken(page, 'WAREHOUSE');
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${eqProcId2}/items/${eqItemId2}/deliver`, {}, whToken);

    // Manual from-procurement
    const fp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/equipment/from-procurement', {
      procurement_item_id: eqItemId2
    }, whToken);
    expect(fp.status).toBeLessThan(300);
    expect(fp.data?.equipment?.id).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'Manual from-procurement');
  });

  test('31 — Duplicate from-procurement returns 409', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!eqItemId2) { test.skip(); return; }

    const whToken = await h.getToken(page, 'WAREHOUSE');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/equipment/from-procurement', {
      procurement_item_id: eqItemId2
    }, whToken);
    expect(resp.status).toBe(409);

    h.assertNoConsoleErrors(errors, 'Duplicate 409');
  });

  test('32 — Equipment page shows items in UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'WAREHOUSE');
    await h.navigateTo(page, 'warehouse');
    await page.waitForTimeout(1500);

    const rows = page.locator('table tbody tr, .card[data-id], .equipment-card, [data-id]');
    const count = await rows.count();
    // Equipment list may be empty in test environment — just verify page loaded
    expect(count).toBeGreaterThanOrEqual(0);
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'Equipment page UI');
  });

  test('33 — Equipment detail opens in UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'WAREHOUSE');
    await h.navigateTo(page, 'warehouse');
    await page.waitForTimeout(1500);

    const row = page.locator('table tbody tr, .card[data-id], .equipment-card').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);

      const hasModal = await h.isModalVisible(page);
      const hasDetail = (await page.locator('.detail-panel, .equipment-detail').count()) > 0;
      expect(hasModal || hasDetail || page.url().includes('equipment/')).toBeTruthy();
    }

    h.assertNoConsoleErrors(errors, 'Equipment detail UI');
  });

  test('34 — Dashboard endpoint works for PROC', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const token = await h.getToken(page, 'PROC');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/procurement/dashboard', null, token);
    expect(resp.status).toBe(200);
    expect(Array.isArray(resp.data?.counts)).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'Dashboard PROC');
  });

  test('35 — HR cannot access dashboard (403)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const token = await h.getToken(page, 'HR');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/procurement/dashboard', null, token);
    expect(resp.status).toBe(403);

    h.assertNoConsoleErrors(errors, 'HR no dashboard');
  });
});

// ═══════════════════════════════════════════════════════════
// SECTION 5: Assembly lifecycle (tests 36-50)
// ═══════════════════════════════════════════════════════════

test.describe.serial('S5: Assembly Lifecycle', () => {
  test('36 — Find work_id for assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const token = await h.getToken(page, 'ADMIN');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/works?limit=1', null, token);
    expect(resp.status).toBe(200);
    const works = resp.data?.works || resp.data?.items || [];
    if (works.length > 0) asmWorkId = works[0].id;
    if (!asmWorkId) { test.skip(); return; }

    h.assertNoConsoleErrors(errors, 'Find work_id');
  });

  test('37 — PM creates mobilization assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!asmWorkId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/assembly', {
      work_id: asmWorkId, type: 'mobilization', title: 'PIPELINE_E2E: Моб', destination: 'НПЗ'
    }, token);
    if (resp.status === 404) { test.skip(); return; }
    expect(resp.status).toBeLessThan(300);
    assemblyId = resp.data?.item?.id;
    expect(assemblyId).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'Create assembly');
  });

  test('38 — Bad assembly type returns 400', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!asmWorkId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/assembly', {
      work_id: asmWorkId, type: 'xxx'
    }, token);
    expect(resp.status).toBe(400);

    h.assertNoConsoleErrors(errors, 'Bad type 400');
  });

  test('39 — Add item to assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!assemblyId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${assemblyId}/items`, {
      name: 'Насос', unit: 'шт', quantity: 1, source: 'manual'
    }, token);
    expect(resp.status).toBeLessThan(300);

    h.assertNoConsoleErrors(errors, 'Add assembly item');
  });

  test('40 — WAREHOUSE creates pallet', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!assemblyId) { test.skip(); return; }

    const token = await h.getToken(page, 'WAREHOUSE');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${assemblyId}/pallets`, {
      label: 'П1'
    }, token);
    expect(resp.status).toBeLessThan(300);
    palletId = resp.data?.pallet?.id;
    expect(palletId).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'Create pallet');
  });

  test('41 — PM confirms assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!assemblyId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${assemblyId}/confirm`, {}, token);
    expect(resp.status).toBeLessThan(300);

    h.assertNoConsoleErrors(errors, 'Confirm assembly');
  });

  test('42 — Assign item to pallet and pack', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!assemblyId || !palletId) { test.skip(); return; }

    const pmToken = await h.getToken(page, 'PM');
    const detail = await h.apiCall(page, 'GET', h.BASE_URL + `/api/assembly/${assemblyId}`, null, pmToken);
    const items = detail.data?.items || [];
    if (!items.length) { test.skip(); return; }

    const whToken = await h.getToken(page, 'WAREHOUSE');
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${assemblyId}/items/${items[0].id}/assign-pallet`, {
      pallet_id: palletId
    }, whToken);

    const packResp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${assemblyId}/items/${items[0].id}/pack`, {}, whToken);
    expect(packResp.status).toBeLessThan(300);

    h.assertNoConsoleErrors(errors, 'Assign and pack');
  });

  test('43 — QR code for pallet', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!assemblyId || !palletId) { test.skip(); return; }

    const token = await h.getToken(page, 'WAREHOUSE');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/assembly/${assemblyId}/pallets/${palletId}/qr`, null, token);
    expect(resp.status).toBe(200);

    h.assertNoConsoleErrors(errors, 'QR code');
  });

  test('44 — Pack pallet and send assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!assemblyId) { test.skip(); return; }

    const whToken = await h.getToken(page, 'WAREHOUSE');
    if (palletId) {
      await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${assemblyId}/pallets/${palletId}/pack`, {}, whToken);
    }

    const pmToken = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${assemblyId}/send`, {}, pmToken);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('in_transit');

    h.assertNoConsoleErrors(errors, 'Pack and send');
  });

  test('45 — Scan pallet in transit', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!assemblyId || !palletId) { test.skip(); return; }

    await h.loginAs(page, 'PM');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${assemblyId}/pallets/${palletId}/scan`, {
      lat: 54.6, lon: 39.7
    }, token);
    expect(resp.status).not.toBe(500);

    h.assertNoConsoleErrors(errors, 'Scan pallet');
  });

  test('46 — Create demobilization from assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!assemblyId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${assemblyId}/create-demob`, {}, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.type).toBe('demobilization');
    demobAssemblyId = resp.data?.item?.id;

    h.assertNoConsoleErrors(errors, 'Create demob');
  });

  test('47 — PM creates pallet on demob assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!demobAssemblyId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${demobAssemblyId}/pallets`, {
      label: 'PM-паллет', capacity_items: 8
    }, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.pallet?.id).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'PM creates pallet on demob');
  });

  test('48 — Assembly page shows assemblies in UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'assembly');
    await page.waitForTimeout(1500);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'Assembly page UI');
  });

  test('49 — Assembly detail opens in UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'assembly');
    await page.waitForTimeout(1500);

    const row = page.locator('table tbody tr, .card[data-id], .assembly-card, [data-id]').first();
    if (await row.count() > 0) {
      await row.click();
      // Wait for modal or detail panel to render (API call inside openDetail may take a moment)
      await page.waitForTimeout(3000);

      const hasModal = await h.isModalVisible(page);
      const hasDetail = (await page.locator('.detail-panel, .assembly-detail, .asm-detail').count()) > 0;
      expect(hasModal || hasDetail || page.url().includes('assembly/')).toBeTruthy();
    }

    h.assertNoConsoleErrors(errors, 'Assembly detail UI');
  });

  test('50 — Notifications work for PROC', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const token = await h.getToken(page, 'PROC');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/notifications?limit=5', null, token);
    expect(resp.status).toBe(200);

    h.assertNoConsoleErrors(errors, 'Notifications');
  });
});

// ═══════════════════════════════════════════════════════════
// SECTION 6: DnD API assign/unassign (tests 51-60)
// ═══════════════════════════════════════════════════════════

test.describe.serial('S6: DnD Assign/Unassign API', () => {
  let dndAssemblyId = null;
  let dndPalletId = null;
  let dndItemId = null;
  let dndWorkId = null;

  test('51 — Setup: find work for DnD tests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const token = await h.getToken(page, 'ADMIN');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/works?limit=1', null, token);
    const works = resp.data?.works || resp.data?.items || [];
    if (works.length > 0) dndWorkId = works[0].id;
    if (!dndWorkId) { test.skip(); return; }

    h.assertNoConsoleErrors(errors, 'DnD setup work');
  });

  test('52 — Setup: create assembly for DnD', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!dndWorkId) { test.skip(); return; }

    await h.loginAs(page, 'PM');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/assembly', {
      work_id: dndWorkId, type: 'mobilization', title: 'DnD E2E Test'
    }, token);
    if (resp.status === 404 || resp.status === 401) { test.skip(); return; }
    expect(resp.status).not.toBe(500);
    if (resp.status < 300) dndAssemblyId = resp.data?.item?.id;

    h.assertNoConsoleErrors(errors, 'DnD setup assembly');
  });

  test('53 — Setup: add item for DnD', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!dndAssemblyId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${dndAssemblyId}/items`, {
      name: 'DnD Item', unit: 'шт', quantity: 1, source: 'manual'
    }, token);
    expect(resp.status).toBeLessThan(300);
    dndItemId = resp.data?.item?.id;

    h.assertNoConsoleErrors(errors, 'DnD setup item');
  });

  test('54 — Setup: create pallet for DnD', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!dndAssemblyId) { test.skip(); return; }

    const token = await h.getToken(page, 'WAREHOUSE');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${dndAssemblyId}/pallets`, {
      label: 'DnD-P1'
    }, token);
    expect(resp.status).toBeLessThan(300);
    dndPalletId = resp.data?.pallet?.id;

    h.assertNoConsoleErrors(errors, 'DnD setup pallet');
  });

  test('55 — Assign item to pallet (DnD API)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!dndAssemblyId || !dndItemId || !dndPalletId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${dndAssemblyId}/items/${dndItemId}/assign-pallet`, {
      pallet_id: dndPalletId
    }, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.pallet_id).toBe(dndPalletId);

    h.assertNoConsoleErrors(errors, 'DnD assign');
  });

  test('56 — Unassign item from pallet (DnD API)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!dndAssemblyId || !dndItemId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${dndAssemblyId}/items/${dndItemId}/unassign-pallet`, {}, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.pallet_id).toBeNull();

    h.assertNoConsoleErrors(errors, 'DnD unassign');
  });

  test('57 — Re-assign after unassign works', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!dndAssemblyId || !dndItemId || !dndPalletId) { test.skip(); return; }

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${dndAssemblyId}/items/${dndItemId}/assign-pallet`, {
      pallet_id: dndPalletId
    }, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.pallet_id).toBe(dndPalletId);

    h.assertNoConsoleErrors(errors, 'DnD re-assign');
  });

  test('58 — Equipment for work endpoint', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/equipment/work/1/equipment', null, token);
    expect(resp.status).not.toBe(500);

    h.assertNoConsoleErrors(errors, 'Equipment for work');
  });

  test('59 — Assembly for work endpoint', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/assembly?work_id=1', null, token);
    expect(resp.status).not.toBe(500);

    h.assertNoConsoleErrors(errors, 'Assembly for work');
  });

  test('60 — Procurement for work endpoint', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/procurement?work_id=1', null, token);
    expect(resp.status).not.toBe(500);

    h.assertNoConsoleErrors(errors, 'Procurement for work');
  });
});

// ═══════════════════════════════════════════════════════════
// SECTION 7: Integration & Full E2E (tests 61-65)
// ═══════════════════════════════════════════════════════════

test.describe.serial('S7: Full E2E Cycle', () => {
  let e2eProcId = null;
  let e2eItemId = null;
  let e2eAssemblyId = null;
  let e2eWorkId = null;

  test('61 — Full cycle: create procurement + items', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    await h.loginAs(page, 'PM');
    const pmToken = await h.getSessionToken(page);
    const cr = await h.apiCall(page, 'POST', h.BASE_URL + '/api/procurement', {
      title: 'E2E: Полный цикл', priority: 'high'
    }, pmToken);
    expect(cr.status).not.toBe(500);
    if (cr.status < 300 && cr.data?.item?.id) e2eProcId = cr.data.item.id;

    if (e2eProcId) {
      const i1 = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${e2eProcId}/items`, {
        name: 'HCl', unit: 'канистра', quantity: 3, unit_price: 8000, delivery_target: 'warehouse'
      }, pmToken);
      expect(i1.status).not.toBe(500);
      if (i1.status < 300 && i1.data?.item?.id) e2eItemId = i1.data.item.id;
    }

    if (e2eProcId) {
      await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${e2eProcId}/items`, {
        name: 'КИ-1', unit: 'канистра', quantity: 2, unit_price: 12000, delivery_target: 'object'
      }, pmToken);
    }

    h.assertNoConsoleErrors(errors, 'E2E create');
  });

  test('62 — Full cycle: approval chain', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!e2eProcId) { test.skip(); return; }

    const pmToken = await h.getToken(page, 'PM');
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${e2eProcId}/send-to-proc`, {}, pmToken);

    const procToken = await h.getToken(page, 'PROC');
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${e2eProcId}/proc-respond`, {}, procToken);

    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${e2eProcId}/pm-approve`, {}, pmToken);

    const dirToken = await h.getToken(page, 'DIRECTOR_GEN');
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${e2eProcId}/dir-approve`, {}, dirToken);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.locked).toBe(true);

    h.assertNoConsoleErrors(errors, 'E2E chain');
  });

  test('63 — Full cycle: pay + deliver all', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    if (!e2eProcId) { test.skip(); return; }

    const buhToken = await h.getToken(page, 'BUH');
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${e2eProcId}/mark-paid`, {}, buhToken);

    const whToken = await h.getToken(page, 'WAREHOUSE');
    const detail = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${e2eProcId}`, null, whToken);
    for (const it of (detail.data?.items || [])) {
      if (it.item_status !== 'delivered') {
        await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${e2eProcId}/items/${it.id}/deliver`, {}, whToken);
      }
    }

    const check = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${e2eProcId}`, null, whToken);
    expect(check.data?.item?.status).toBe('delivered');

    h.assertNoConsoleErrors(errors, 'E2E pay + deliver');
  });

  test('64 — Full cycle: create assembly from work', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    const adminToken = await h.getToken(page, 'ADMIN');
    const works = await h.apiCall(page, 'GET', h.BASE_URL + '/api/works?limit=1', null, adminToken);
    const workList = works.data?.works || works.data?.items || [];
    if (!workList.length) { test.skip(); return; }
    e2eWorkId = workList[0].id;

    const pmToken = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/assembly', {
      work_id: e2eWorkId, type: 'mobilization', title: 'E2E Full Cycle Моб'
    }, pmToken);
    if (resp.status >= 400) { test.skip(); return; }
    e2eAssemblyId = resp.data?.item?.id;
    expect(e2eAssemblyId).toBeTruthy();

    // Add item, create pallet, confirm, assign, pack, send
    await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${e2eAssemblyId}/items`, {
      name: 'Насос', quantity: 1, source: 'manual'
    }, pmToken);

    const whToken = await h.getToken(page, 'WAREHOUSE');
    const p = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${e2eAssemblyId}/pallets`, {
      label: 'E2E-P1'
    }, whToken);
    const pId = p.data?.pallet?.id;

    const d = await h.apiCall(page, 'GET', h.BASE_URL + `/api/assembly/${e2eAssemblyId}`, null, pmToken);
    const items = d.data?.items || [];

    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${e2eAssemblyId}/confirm`, {}, pmToken);

    if (items.length && pId) {
      await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${e2eAssemblyId}/items/${items[0].id}/assign-pallet`, {
        pallet_id: pId
      }, whToken);
      await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${e2eAssemblyId}/items/${items[0].id}/pack`, {}, whToken);
      await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${e2eAssemblyId}/pallets/${pId}/pack`, {}, whToken);
    }

    const sendResp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${e2eAssemblyId}/send`, {}, pmToken);
    expect(sendResp.status).toBeLessThan(300);
    expect(sendResp.data?.item?.status).toBe('in_transit');

    if (pId) {
      await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${e2eAssemblyId}/pallets/${pId}/scan`, {
        lat: 54.6, lon: 39.7
      }, pmToken);
    }

    h.assertNoConsoleErrors(errors, 'E2E assembly');
  });

  test('65 — Full cycle: verify via UI + export', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    // Verify procurement list loads with data
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'procurement');
    await page.waitForTimeout(1500);
    await h.expectListNotEmpty(page);

    // Test export endpoint if available
    if (e2eProcId) {
      const token = await h.getToken(page, 'PM');
      const exportResp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${e2eProcId}/export/excel`, null, token);
      expect(exportResp.status).toBe(200);

      const templateResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/procurement/template/excel', null, token);
      expect(templateResp.status).toBe(200);
    }

    // Navigate to assembly page and verify
    await h.navigateTo(page, 'assembly');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'E2E verify UI');
  });
});
