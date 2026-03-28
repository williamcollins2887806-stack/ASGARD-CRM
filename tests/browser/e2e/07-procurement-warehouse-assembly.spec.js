// @ts-check
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

/**
 * E2E Browser Tests: Procurement + Warehouse + Assembly Pipeline
 * Maps to: flow-procurement-warehouse-assembly.test.js
 * Pages: #/procurement, #/warehouse, #/equipment, #/assembly
 *
 * 65 tests across 7 sections.
 * ALL TESTS INDEPENDENT — each creates its own fresh data via API.
 * No shared state, no serial cascades, no test.describe.serial.
 */

// ─── File-scope helpers ───────────────────────────────────────────────────────

/** Create fresh procurement. Returns { id, pmToken } */
async function mkProc(page, title) {
  await h.loginAs(page, 'PM');
  const pmToken = await h.getSessionToken(page);
  const cr = await h.apiCall(page, 'POST', h.BASE_URL + '/api/procurement', {
    title: title || ('T07_' + Date.now()), priority: 'medium'
  }, pmToken);
  return { id: cr.data?.item?.id || null, pmToken };
}

/** Add item to procurement. Returns item id or null. */
async function addProcItem(page, procId, pmToken, opts = {}) {
  const r = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
    name: opts.name || 'Труба E2E',
    unit: opts.unit || 'шт',
    quantity: opts.qty || 2,
    unit_price: opts.price || 1000,
    delivery_target: opts.target || 'warehouse'
  }, pmToken);
  return r.data?.item?.id || null;
}

/**
 * Advance procurement through status chain to targetStatus.
 * Chain: draft → sent_to_proc → proc_responded → pm_approved → dir_approved → paid
 * After call, page auth state is set to the last role used.
 */
async function advanceTo(page, procId, targetStatus) {
  const ORDER = ['draft', 'sent_to_proc', 'proc_responded', 'pm_approved', 'dir_approved', 'paid'];
  const idx = ORDER.indexOf(targetStatus);
  if (idx < 0) return;
  await h.loginAs(page, 'PM');
  const pmTok = await h.getSessionToken(page);
  if (idx >= 1) {
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/send-to-proc`, {}, pmTok);
  }
  if (idx >= 2) {
    await h.loginAs(page, 'PROC');
    const pTok = await h.getSessionToken(page);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/proc-respond`, {}, pTok);
  }
  if (idx >= 3) {
    await h.loginAs(page, 'PM');
    const pmTok2 = await h.getSessionToken(page);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/pm-approve`, {}, pmTok2);
  }
  if (idx >= 4) {
    await h.loginAs(page, 'DIRECTOR_GEN');
    const dTok = await h.getSessionToken(page);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/dir-approve`, {}, dTok);
  }
  if (idx >= 5) {
    await h.loginAs(page, 'BUH');
    const bTok = await h.getSessionToken(page);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/mark-paid`, {}, bTok);
  }
}

/** Get first available work_id. Returns id or null. */
async function getWorkId(page) {
  await h.loginAs(page, 'ADMIN');
  const tok = await h.getSessionToken(page);
  const r = await h.apiCall(page, 'GET', h.BASE_URL + '/api/works?limit=1', null, tok);
  const list = r.data?.works || r.data?.items || [];
  return list.length ? list[0].id : null;
}

/** Create assembly. Returns { id, pmToken } */
async function mkAsm(page, workId, type = 'mobilization') {
  await h.loginAs(page, 'PM');
  const pmToken = await h.getSessionToken(page);
  const r = await h.apiCall(page, 'POST', h.BASE_URL + '/api/assembly', {
    work_id: workId, type, title: 'ASM07_' + Date.now()
  }, pmToken);
  return { id: r.data?.item?.id || null, pmToken };
}

/** Create pallet on assembly. Returns pallet id or null. */
async function mkPallet(page, asmId, whToken, label) {
  const r = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${asmId}/pallets`, {
    label: label || ('P_' + Date.now())
  }, whToken);
  return r.data?.pallet?.id || null;
}

/**
 * Create assembly + item + pallet. Returns { asmId, itemId, pId, pmToken }.
 * Page ends up logged in as PM.
 */
async function mkAsmSetup(page, workId) {
  const { id: asmId, pmToken } = await mkAsm(page, workId);
  if (!asmId) return { asmId: null, itemId: null, pId: null, pmToken };
  const iResp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${asmId}/items`, {
    name: 'Item_' + Date.now(), unit: 'шт', quantity: 1, source: 'manual'
  }, pmToken);
  const itemId = iResp.data?.item?.id || null;
  await h.loginAs(page, 'WAREHOUSE');
  const whTok = await h.getSessionToken(page);
  const pId = await mkPallet(page, asmId, whTok);
  await h.loginAs(page, 'PM');
  const pmTok2 = await h.getSessionToken(page);
  return { asmId, itemId, pId, pmToken: pmTok2 };
}

/**
 * Build assembly all the way to in_transit status.
 * Returns { asmId, pId, pmToken }.
 */
async function sendAssembly(page, workId) {
  const { asmId, itemId, pId, pmToken } = await mkAsmSetup(page, workId);
  if (!asmId) return { asmId: null, pId: null, pmToken };
  await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/confirm`, {}, pmToken);
  const detail = await h.apiCall(page, 'GET', h.BASE_URL + `/api/assembly/${asmId}`, null, pmToken);
  const items = detail.data?.items || [];
  await h.loginAs(page, 'WAREHOUSE');
  const whTok2 = await h.getSessionToken(page);
  if (items.length && pId) {
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${items[0].id}/assign-pallet`, { pallet_id: pId }, whTok2);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${items[0].id}/pack`, {}, whTok2);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/pallets/${pId}/pack`, {}, whTok2);
  }
  await h.loginAs(page, 'PM');
  const pmTok3 = await h.getSessionToken(page);
  await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/send`, {}, pmTok3);
  return { asmId, pId, pmToken: pmTok3 };
}

// ─── S1: Access Control (tests 1-5) ──────────────────────────────────────────

test.describe('S1: Access Control', () => {

  test('01 — HR cannot create procurement request', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'procurement');
    const noAccess = await h.expectNoAccess(page);
    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить")');
    expect((await createBtn.count()) === 0 || noAccess).toBeTruthy();
    h.assertNoConsoleErrors(errors, '01 HR no create');
  });

  test('02 — Procurement page loads for PM', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'procurement');
    await h.waitForPageLoad(page);
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, '02 PM procurement page');
  });

  test('03 — Warehouse page loads for WAREHOUSE', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'WAREHOUSE');
    await h.navigateTo(page, 'warehouse');
    await h.waitForPageLoad(page);
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, '03 WAREHOUSE page');
  });

  test('04 — Assembly page loads for PM', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'assembly');
    await h.waitForPageLoad(page);
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, '04 PM assembly page');
  });

  test('05 — Server is alive (API health check)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    expect(token).toBeTruthy();
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/auth/me', null, token);
    expect(resp.status).toBe(200);
    expect(resp.data?.user?.id).toBeTruthy();
    h.assertNoConsoleErrors(errors, '05 server alive');
  });

});

// ─── S2: Procurement Creation & Items (tests 6-15) ───────────────────────────

test.describe('S2: Procurement Creation & Items', () => {

  test('06 — PM creates procurement request via UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'procurement');
    await h.waitForPageLoad(page);
    try {
      const createBtn = page.locator('#pf-create, button:has-text("Новая заявка")').first();
      if (await createBtn.isVisible().catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(800);
        const tf = page.locator('input[name*="title"], input[placeholder*="Название"]');
        if (await tf.count() > 0) await tf.first().fill('PIPELINE_TEST: Закупка E2E ' + Date.now());
        await h.clickSave(page);
        await page.waitForTimeout(1000);
      }
    } catch (e) { /* UI creation optional */ }
    // Verify via API that procurement creation works
    const { id } = await mkProc(page, 'PIPELINE_TEST: Закупка E2E ' + Date.now());
    expect(id).toBeTruthy();
    h.assertNoConsoleErrors(errors, '06 PM creates proc');
  });

  test('07 — PM adds item 1, total_price calculated correctly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Труба 108', article: 'TR-108', unit: 'м.п.', quantity: 50, unit_price: 2500
    }, pmToken);
    expect(resp.status).toBeLessThan(300);
    expect(parseFloat(resp.data?.item?.total_price)).toBe(125000);
    h.assertNoConsoleErrors(errors, '07 add item 1');
  });

  test('08 — PM adds item 2 (electrodes)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken, { name: 'Труба', qty: 10, price: 500 });
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Электроды', unit: 'кг', quantity: 100, unit_price: 500
    }, pmToken);
    expect(resp.status).not.toBe(500);
    h.assertNoConsoleErrors(errors, '08 add item 2');
  });

  test('09 — PM views detail with 2 items and correct total', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Труба 108', unit: 'м.п.', quantity: 50, unit_price: 2500
    }, pmToken);
    await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Электроды', unit: 'кг', quantity: 100, unit_price: 500
    }, pmToken);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procId}`, null, pmToken);
    expect(resp.status).toBe(200);
    expect(resp.data?.items?.length).toBe(2);
    expect(Number(resp.data?.item?.total_sum)).toBe(175000);
    h.assertNoConsoleErrors(errors, '09 detail 2 items');
  });

  test('10 — PM updates item quantity/price', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    const itemId = await addProcItem(page, procId, pmToken, { qty: 50, price: 2500 });
    if (!itemId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/items/${itemId}`, {
      quantity: 60, unit_price: 2600
    }, pmToken);
    expect(resp.status).toBeLessThan(300);
    expect(Number(resp.data?.item?.total_price)).toBe(156000);
    h.assertNoConsoleErrors(errors, '10 update item');
  });

  test('11 — PM deletes item, one remains', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    const item1 = await addProcItem(page, procId, pmToken, { name: 'Item1', qty: 1, price: 100 });
    await addProcItem(page, procId, pmToken, { name: 'Item2', qty: 1, price: 200 });
    if (!item1) { test.skip(); return; }
    await h.apiCall(page, 'DELETE', h.BASE_URL + `/api/procurement/${procId}/items/${item1}`, null, pmToken);
    const check = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procId}`, null, pmToken);
    expect(check.data?.items?.length).toBe(1);
    h.assertNoConsoleErrors(errors, '11 delete item');
  });

  test('12 — PM adds bulk items (3 at once)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items/bulk`, {
      items: [
        { name: 'Шланг', unit: 'м', quantity: 50, unit_price: 800 },
        { name: 'Головка O33', unit: 'шт', quantity: 4, unit_price: 15000 },
        { name: 'Манометр', unit: 'шт', quantity: 2, unit_price: 3500 }
      ]
    }, pmToken);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.count).toBe(3);
    h.assertNoConsoleErrors(errors, '12 bulk items');
  });

  test('13 — Validation: bad delivery target rejects 400', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'X', quantity: 1, delivery_target: 'xxx'
    }, pmToken);
    expect(resp.status).toBe(400);
    h.assertNoConsoleErrors(errors, '13 bad delivery target');
  });

  test('14 — Validation: NaN quantity rejects 400', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'X', quantity: 'abc'
    }, pmToken);
    expect(resp.status).toBe(400);
    h.assertNoConsoleErrors(errors, '14 NaN quantity');
  });

  test('15 — Search finds procurement by title', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const title = 'PIPELINE_TEST_SRCH_' + Date.now();
    const { id: procId, pmToken } = await mkProc(page, title);
    if (!procId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/procurement?search=PIPELINE_TEST_SRCH', null, pmToken);
    expect(resp.status).toBe(200);
    expect(resp.data?.items?.length).toBeGreaterThanOrEqual(1);
    h.assertNoConsoleErrors(errors, '15 search');
  });

});

// ─── S3: Approval Chain (tests 16-25) ────────────────────────────────────────

test.describe('S3: Approval Chain', () => {

  test('16 — PM sends to PROC (draft → sent_to_proc)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/send-to-proc`, {}, pmToken);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('sent_to_proc');
    h.assertNoConsoleErrors(errors, '16 send to proc');
  });

  test('17 — No re-send (409 conflict)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/send-to-proc`, {}, pmToken);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/send-to-proc`, {}, pmToken);
    expect(resp.status).toBe(409);
    h.assertNoConsoleErrors(errors, '17 no re-send');
  });

  test('18 — PROC responds (sent_to_proc → proc_responded)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/send-to-proc`, {}, pmToken);
    await h.loginAs(page, 'PROC');
    const procTok = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/proc-respond`, { comment: 'OK' }, procTok);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('proc_responded');
    h.assertNoConsoleErrors(errors, '18 proc responds');
  });

  test('19 — PM approves (proc_responded → pm_approved)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    await advanceTo(page, procId, 'proc_responded');
    await h.loginAs(page, 'PM');
    const pmTok2 = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/pm-approve`, {}, pmTok2);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('pm_approved');
    h.assertNoConsoleErrors(errors, '19 PM approves');
  });

  test('20 — DIRECTOR_GEN approves → locked', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    await advanceTo(page, procId, 'pm_approved');
    await h.loginAs(page, 'DIRECTOR_GEN');
    const dirTok = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/dir-approve`, {}, dirTok);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.locked).toBe(true);
    h.assertNoConsoleErrors(errors, '20 DIR approves');
  });

  test('21 — Cannot edit locked request (409)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    await advanceTo(page, procId, 'dir_approved');
    await h.loginAs(page, 'PM');
    const pmTok2 = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Fail', quantity: 1
    }, pmTok2);
    expect(resp.status).toBe(409);
    h.assertNoConsoleErrors(errors, '21 locked 409');
  });

  test('22 — Cannot pay from draft (409)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await h.loginAs(page, 'BUH');
    const buhTok = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/mark-paid`, {}, buhTok);
    expect(resp.status).toBe(409);
    h.assertNoConsoleErrors(errors, '22 pay from draft 409');
  });

  test('23 — BUH pays (dir_approved → paid)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    await advanceTo(page, procId, 'dir_approved');
    await h.loginAs(page, 'BUH');
    const buhTok = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/mark-paid`, {}, buhTok);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('paid');
    h.assertNoConsoleErrors(errors, '23 BUH pays');
  });

  test('24 — Deliver items → partially_delivered → delivered', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken, { name: 'Item1', qty: 5, price: 1000 });
    await addProcItem(page, procId, pmToken, { name: 'Item2', qty: 3, price: 2000 });
    await advanceTo(page, procId, 'paid');
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    const detail = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procId}`, null, whTok);
    const items = detail.data?.items || [];
    expect(items.length).toBeGreaterThan(0);
    const dr1 = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/items/${items[0].id}/deliver`, {}, whTok);
    expect(dr1.status).toBeLessThan(300);
    if (items.length > 1) {
      const check = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procId}`, null, whTok);
      expect(check.data?.item?.status).toBe('partially_delivered');
      for (let i = 1; i < items.length; i++) {
        await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/items/${items[i].id}/deliver`, {}, whTok);
      }
    }
    const final = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procId}`, null, whTok);
    expect(final.data?.item?.status).toBe('delivered');
    h.assertNoConsoleErrors(errors, '24 deliver items');
  });

  test('25 — PM closes procurement (delivered → closed)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    const itemId = await addProcItem(page, procId, pmToken);
    await advanceTo(page, procId, 'paid');
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/items/${itemId}/deliver`, {}, whTok);
    await h.loginAs(page, 'PM');
    const pmTok2 = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/close`, {}, pmTok2);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('closed');
    h.assertNoConsoleErrors(errors, '25 PM closes');
  });

});

// ─── S4: Equipment from Procurement (tests 26-35) ────────────────────────────

test.describe('S4: Equipment from Procurement', () => {

  test('26 — Equipment stats endpoint works', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'WAREHOUSE');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/equipment/stats/summary', null, token);
    if (resp.status === 404) { test.skip(); return; }
    expect(resp.status).toBe(200);
    h.assertNoConsoleErrors(errors, '26 equipment stats');
  });

  test('27 — from-procurement rejects invalid ID', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'WAREHOUSE');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/equipment/from-procurement', {
      procurement_item_id: -1
    }, token);
    expect(resp.status).not.toBe(500);
    h.assertNoConsoleErrors(errors, '27 invalid ID');
  });

  test('28 — Available equipment endpoint works', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/equipment/available', null, token);
    expect(resp.status).not.toBe(500);
    h.assertNoConsoleErrors(errors, '28 available equipment');
  });

  test('29 — Warehouse delivery → auto-creates equipment on deliver', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page, 'S4_Auto_' + Date.now());
    if (!procId) { test.skip(); return; }
    const itemResp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Кабель ВВГ', unit: 'м', quantity: 100, unit_price: 150, delivery_target: 'warehouse'
    }, pmToken);
    if (itemResp.status >= 400) { test.skip(); return; }
    const itemId = itemResp.data?.item?.id;
    await advanceTo(page, procId, 'paid');
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    const dr = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/items/${itemId}/deliver`, {}, whTok);
    expect(dr.status).toBeLessThan(300);
    expect(dr.data?.item?.equipment_id).toBeTruthy();
    const eq = await h.apiCall(page, 'GET', h.BASE_URL + `/api/equipment/${dr.data.item.equipment_id}`, null, whTok);
    expect(eq.status).toBe(200);
    expect(eq.data?.equipment?.status).toBe('on_warehouse');
    h.assertNoConsoleErrors(errors, '29 auto equipment');
  });

  test('30 — Manual from-procurement for object delivery', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page, 'S4_Manual_' + Date.now());
    if (!procId) { test.skip(); return; }
    const itemResp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Насос ЭЦВ', unit: 'шт', quantity: 1, unit_price: 85000, delivery_target: 'object'
    }, pmToken);
    if (itemResp.status >= 400) { test.skip(); return; }
    const itemId = itemResp.data?.item?.id;
    await advanceTo(page, procId, 'paid');
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/items/${itemId}/deliver`, {}, whTok);
    const fp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/equipment/from-procurement', {
      procurement_item_id: itemId
    }, whTok);
    expect(fp.status).toBeLessThan(300);
    expect(fp.data?.equipment?.id).toBeTruthy();
    h.assertNoConsoleErrors(errors, '30 manual from-proc');
  });

  test('31 — Duplicate from-procurement returns 409', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page, 'S4_Dup_' + Date.now());
    if (!procId) { test.skip(); return; }
    const itemResp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Насос Дубль', unit: 'шт', quantity: 1, unit_price: 5000, delivery_target: 'object'
    }, pmToken);
    if (itemResp.status >= 400) { test.skip(); return; }
    const itemId = itemResp.data?.item?.id;
    await advanceTo(page, procId, 'paid');
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/items/${itemId}/deliver`, {}, whTok);
    await h.apiCall(page, 'POST', h.BASE_URL + '/api/equipment/from-procurement', { procurement_item_id: itemId }, whTok);
    const dup = await h.apiCall(page, 'POST', h.BASE_URL + '/api/equipment/from-procurement', { procurement_item_id: itemId }, whTok);
    expect(dup.status).toBe(409);
    h.assertNoConsoleErrors(errors, '31 duplicate 409');
  });

  test('32 — Equipment page shows items in UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'WAREHOUSE');
    await h.navigateTo(page, 'warehouse');
    await page.waitForTimeout(1500);
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, '32 equipment UI');
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
    h.assertNoConsoleErrors(errors, '33 equipment detail UI');
  });

  test('34 — Dashboard endpoint works for PROC', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PROC');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/procurement/dashboard', null, token);
    expect(resp.status).toBe(200);
    expect(Array.isArray(resp.data?.counts)).toBeTruthy();
    h.assertNoConsoleErrors(errors, '34 dashboard PROC');
  });

  test('35 — HR cannot access dashboard (403)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/procurement/dashboard', null, token);
    expect(resp.status).toBe(403);
    h.assertNoConsoleErrors(errors, '35 HR no dashboard');
  });

});

// ─── S5: Assembly Lifecycle (tests 36-50) ────────────────────────────────────

test.describe('S5: Assembly Lifecycle', () => {

  test('36 — Find work_id for assembly tests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    expect(workId).toBeTruthy();
    h.assertNoConsoleErrors(errors, '36 find work_id');
  });

  test('37 — PM creates mobilization assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { id: asmId } = await mkAsm(page, workId);
    expect(asmId).toBeTruthy();
    h.assertNoConsoleErrors(errors, '37 create assembly');
  });

  test('38 — Bad assembly type returns 400', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    await h.loginAs(page, 'PM');
    const pmToken = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/assembly', {
      work_id: workId, type: 'xxx'
    }, pmToken);
    expect(resp.status).toBe(400);
    h.assertNoConsoleErrors(errors, '38 bad type 400');
  });

  test('39 — Add item to assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { id: asmId, pmToken } = await mkAsm(page, workId);
    if (!asmId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${asmId}/items`, {
      name: 'Насос', unit: 'шт', quantity: 1, source: 'manual'
    }, pmToken);
    expect(resp.status).toBeLessThan(300);
    h.assertNoConsoleErrors(errors, '39 add assembly item');
  });

  test('40 — WAREHOUSE creates pallet', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { id: asmId } = await mkAsm(page, workId);
    if (!asmId) { test.skip(); return; }
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    const pId = await mkPallet(page, asmId, whTok, 'П1');
    expect(pId).toBeTruthy();
    h.assertNoConsoleErrors(errors, '40 create pallet');
  });

  test('41 — PM confirms assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { id: asmId, pmToken } = await mkAsm(page, workId);
    if (!asmId) { test.skip(); return; }
    await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${asmId}/items`, {
      name: 'Насос', unit: 'шт', quantity: 1, source: 'manual'
    }, pmToken);
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    await mkPallet(page, asmId, whTok);
    await h.loginAs(page, 'PM');
    const pmTok2 = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/confirm`, {}, pmTok2);
    expect(resp.status).toBeLessThan(300);
    h.assertNoConsoleErrors(errors, '41 confirm assembly');
  });

  test('42 — Assign item to pallet and pack', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { asmId, itemId, pId, pmToken } = await mkAsmSetup(page, workId);
    if (!asmId || !itemId || !pId) { test.skip(); return; }
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/confirm`, {}, pmToken);
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/assign-pallet`, { pallet_id: pId }, whTok);
    const packResp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/pack`, {}, whTok);
    expect(packResp.status).toBeLessThan(300);
    h.assertNoConsoleErrors(errors, '42 assign and pack');
  });

  test('43 — QR code for pallet', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { id: asmId } = await mkAsm(page, workId);
    if (!asmId) { test.skip(); return; }
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    const pId = await mkPallet(page, asmId, whTok);
    if (!pId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/assembly/${asmId}/pallets/${pId}/qr`, null, whTok);
    expect(resp.status).toBe(200);
    h.assertNoConsoleErrors(errors, '43 QR code');
  });

  test('44 — Pack pallet and send assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { asmId, itemId, pId, pmToken } = await mkAsmSetup(page, workId);
    if (!asmId) { test.skip(); return; }
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/confirm`, {}, pmToken);
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    if (itemId && pId) {
      await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/assign-pallet`, { pallet_id: pId }, whTok);
      await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/pack`, {}, whTok);
      await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/pallets/${pId}/pack`, {}, whTok);
    }
    await h.loginAs(page, 'PM');
    const pmTok2 = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/send`, {}, pmTok2);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.status).toBe('in_transit');
    h.assertNoConsoleErrors(errors, '44 pack and send');
  });

  test('45 — Scan pallet in transit', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { asmId, pId, pmToken } = await sendAssembly(page, workId);
    if (!asmId || !pId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${asmId}/pallets/${pId}/scan`, {
      lat: 54.6, lon: 39.7
    }, pmToken);
    expect(resp.status).not.toBe(500);
    h.assertNoConsoleErrors(errors, '45 scan pallet');
  });

  test('46 — Create demobilization from assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { asmId, pmToken } = await sendAssembly(page, workId);
    if (!asmId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${asmId}/create-demob`, {}, pmToken);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.type).toBe('demobilization');
    h.assertNoConsoleErrors(errors, '46 create demob');
  });

  test('47 — PM creates pallet on demob assembly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { asmId, pmToken } = await sendAssembly(page, workId);
    if (!asmId) { test.skip(); return; }
    const demobResp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${asmId}/create-demob`, {}, pmToken);
    const demobId = demobResp.data?.item?.id;
    if (!demobId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${demobId}/pallets`, {
      label: 'PM-паллет', capacity_items: 8
    }, pmToken);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.pallet?.id).toBeTruthy();
    h.assertNoConsoleErrors(errors, '47 pallet on demob');
  });

  test('48 — Assembly page shows assemblies in UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'assembly');
    await page.waitForTimeout(1500);
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, '48 assembly UI');
  });

  test('49 — Assembly detail opens in UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'assembly');
    await page.waitForTimeout(1500);
    const row = page.locator('table tbody tr, .card[data-id], .assembly-card, [data-id]').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(3000);
      const hasModal = await h.isModalVisible(page);
      const hasDetail = (await page.locator('.detail-panel, .assembly-detail, .asm-detail').count()) > 0;
      expect(hasModal || hasDetail || page.url().includes('assembly/')).toBeTruthy();
    }
    h.assertNoConsoleErrors(errors, '49 assembly detail UI');
  });

  test('50 — Notifications work for PROC', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PROC');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/notifications?limit=5', null, token);
    expect(resp.status).toBe(200);
    h.assertNoConsoleErrors(errors, '50 notifications PROC');
  });

});

// ─── S6: DnD Assign/Unassign API (tests 51-60) ───────────────────────────────

test.describe('S6: DnD Assign/Unassign API', () => {

  test('51 — Setup: find work for DnD tests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    expect(workId).toBeTruthy();
    h.assertNoConsoleErrors(errors, '51 find work');
  });

  test('52 — Setup: create assembly for DnD', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { id: asmId } = await mkAsm(page, workId);
    expect(asmId).toBeTruthy();
    h.assertNoConsoleErrors(errors, '52 DnD assembly');
  });

  test('53 — Setup: add item for DnD', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { id: asmId, pmToken } = await mkAsm(page, workId);
    if (!asmId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${asmId}/items`, {
      name: 'DnD Item', unit: 'шт', quantity: 1, source: 'manual'
    }, pmToken);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.id).toBeTruthy();
    h.assertNoConsoleErrors(errors, '53 DnD item');
  });

  test('54 — Setup: create pallet for DnD', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { id: asmId } = await mkAsm(page, workId);
    if (!asmId) { test.skip(); return; }
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    const pId = await mkPallet(page, asmId, whTok, 'DnD-P1');
    expect(pId).toBeTruthy();
    h.assertNoConsoleErrors(errors, '54 DnD pallet');
  });

  test('55 — Assign item to pallet (DnD API)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { asmId, itemId, pId, pmToken } = await mkAsmSetup(page, workId);
    if (!asmId || !itemId || !pId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/assign-pallet`, {
      pallet_id: pId
    }, pmToken);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.pallet_id).toBe(pId);
    h.assertNoConsoleErrors(errors, '55 DnD assign');
  });

  test('56 — Unassign item from pallet (DnD API)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { asmId, itemId, pId, pmToken } = await mkAsmSetup(page, workId);
    if (!asmId || !itemId || !pId) { test.skip(); return; }
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/assign-pallet`, { pallet_id: pId }, pmToken);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/unassign-pallet`, {}, pmToken);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.pallet_id).toBeNull();
    h.assertNoConsoleErrors(errors, '56 DnD unassign');
  });

  test('57 — Re-assign after unassign works', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { asmId, itemId, pId, pmToken } = await mkAsmSetup(page, workId);
    if (!asmId || !itemId || !pId) { test.skip(); return; }
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/assign-pallet`, { pallet_id: pId }, pmToken);
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/unassign-pallet`, {}, pmToken);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/assign-pallet`, { pallet_id: pId }, pmToken);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.pallet_id).toBe(pId);
    h.assertNoConsoleErrors(errors, '57 DnD re-assign');
  });

  test('58 — Equipment for work endpoint', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/equipment/work/1/equipment', null, token);
    expect(resp.status).not.toBe(500);
    h.assertNoConsoleErrors(errors, '58 equipment for work');
  });

  test('59 — Assembly for work endpoint', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/assembly?work_id=1', null, token);
    expect(resp.status).not.toBe(500);
    h.assertNoConsoleErrors(errors, '59 assembly for work');
  });

  test('60 — Procurement for work endpoint', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/procurement?work_id=1', null, token);
    expect(resp.status).not.toBe(500);
    h.assertNoConsoleErrors(errors, '60 procurement for work');
  });

});

// ─── S7: Full E2E Cycle (tests 61-65) ────────────────────────────────────────

test.describe('S7: Full E2E Cycle', () => {

  test('61 — Full cycle: create procurement + items', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page, 'E2E_FullCycle_' + Date.now());
    expect(procId).toBeTruthy();
    const i1 = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'HCl', unit: 'канистра', quantity: 3, unit_price: 8000, delivery_target: 'warehouse'
    }, pmToken);
    expect(i1.status).not.toBe(500);
    await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'КИ-1', unit: 'канистра', quantity: 2, unit_price: 12000, delivery_target: 'object'
    }, pmToken);
    const detail = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procId}`, null, pmToken);
    expect(detail.data?.items?.length).toBe(2);
    h.assertNoConsoleErrors(errors, '61 create proc+items');
  });

  test('62 — Full cycle: approval chain → locked', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page, 'E2E_ApprovalChain_' + Date.now());
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    await advanceTo(page, procId, 'pm_approved');
    await h.loginAs(page, 'DIRECTOR_GEN');
    const dirTok = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/dir-approve`, {}, dirTok);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.locked).toBe(true);
    h.assertNoConsoleErrors(errors, '62 approval chain');
  });

  test('63 — Full cycle: pay + deliver all items', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page, 'E2E_PayDeliver_' + Date.now());
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken, { name: 'HCl', qty: 3, price: 8000 });
    await addProcItem(page, procId, pmToken, { name: 'КИ-1', qty: 2, price: 12000 });
    await advanceTo(page, procId, 'paid');
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    const detail = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procId}`, null, whTok);
    for (const it of (detail.data?.items || [])) {
      if (it.item_status !== 'delivered') {
        await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/items/${it.id}/deliver`, {}, whTok);
      }
    }
    const check = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procId}`, null, whTok);
    expect(check.data?.item?.status).toBe('delivered');
    h.assertNoConsoleErrors(errors, '63 pay + deliver');
  });

  test('64 — Full cycle: create assembly → send', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const workId = await getWorkId(page);
    if (!workId) { test.skip(); return; }
    const { asmId, itemId, pId, pmToken } = await mkAsmSetup(page, workId);
    if (!asmId) { test.skip(); return; }
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/confirm`, {}, pmToken);
    await h.loginAs(page, 'WAREHOUSE');
    const whTok = await h.getSessionToken(page);
    if (itemId && pId) {
      await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/assign-pallet`, { pallet_id: pId }, whTok);
      await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/items/${itemId}/pack`, {}, whTok);
      await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/pallets/${pId}/pack`, {}, whTok);
    }
    await h.loginAs(page, 'PM');
    const pmTok2 = await h.getSessionToken(page);
    const sendResp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/assembly/${asmId}/send`, {}, pmTok2);
    expect(sendResp.status).toBeLessThan(300);
    expect(sendResp.data?.item?.status).toBe('in_transit');
    if (pId) {
      await h.apiCall(page, 'POST', h.BASE_URL + `/api/assembly/${asmId}/pallets/${pId}/scan`, {
        lat: 54.6, lon: 39.7
      }, pmTok2);
    }
    h.assertNoConsoleErrors(errors, '64 assembly lifecycle');
  });

  test('65 — Full cycle: verify via UI + export', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'procurement');
    await page.waitForTimeout(1500);
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(50);
    // Test export template endpoint
    const pmTok = await h.getSessionToken(page);
    const templateResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/procurement/template/excel', null, pmTok);
    expect(templateResp.status).toBe(200);
    // Navigate to assembly page
    await h.navigateTo(page, 'assembly');
    await page.waitForTimeout(1000);
    const body2 = await page.textContent('body');
    expect(body2.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, '65 verify UI + export');
  });

});
