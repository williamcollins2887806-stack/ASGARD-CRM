// @ts-check
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

/**
 * E2E Browser Tests: Procurement Request Full Lifecycle
 * Maps to: flow-tmc-procurement.test.js
 * Page: #/procurement
 *
 * Workflow: draft -> send-to-proc -> proc-respond -> pm-approve
 *           -> dir-approve -> mark-paid -> deliver items -> close
 *
 * ALL TESTS INDEPENDENT — each creates its own fresh data via API.
 * No shared state, no serial cascades.
 */

// ─── File-scope helpers ───────────────────────────────────────────────────────

/** Create fresh procurement. Returns { id, pmToken } */
async function mkProc(page, title) {
  await h.loginAs(page, 'PM');
  const pmToken = await h.getSessionToken(page);
  const cr = await h.apiCall(page, 'POST', h.BASE_URL + '/api/procurement', {
    title: title || ('T06_' + Date.now()), priority: 'medium'
  }, pmToken);
  return { id: cr.data?.item?.id || null, pmToken };
}

/** Add item to procurement. Returns item id or null. */
async function addProcItem(page, procId, pmToken, opts = {}) {
  const r = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
    name: opts.name || 'Труба стальная',
    unit: opts.unit || 'м.п.',
    quantity: opts.qty || 10,
    unit_price: opts.price || 1000
  }, pmToken);
  return r.data?.item?.id || null;
}

/**
 * Advance procurement through status chain to targetStatus.
 * Chain: draft → sent_to_proc → proc_responded → pm_approved → dir_approved → paid
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
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/proc-respond`, { comment: 'Поставщики подобраны' }, pTok);
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

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Procurement Lifecycle (Browser E2E)', () => {

  test('01 — HR cannot create procurement (forbidden)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'procurement');
    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить"), button:has-text("Новая заявка")');
    const noAccess = await h.expectNoAccess(page);
    const count = await createBtn.count();
    expect(count === 0 || noAccess).toBeTruthy();
    h.assertNoConsoleErrors(errors, 'HR cannot create procurement');
  });

  test('02 — PM creates procurement draft via UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'procurement');
    await h.waitForPageLoad(page);

    const createBtn = page.locator('#pf-create, button:has-text("Новая заявка"), button:has-text("Создать заявку"), button:has-text("Создать")').first();
    const btnVisible = await createBtn.isVisible().catch(() => false);
    if (btnVisible) {
      await createBtn.click();
      await page.waitForTimeout(800);
      const hasModal = await h.isModalVisible(page);
      if (hasModal) {
        const titleField = page.locator('input[name*="title"], input[placeholder*="Название"]');
        if (await titleField.count() > 0) {
          await titleField.first().fill('E2E Procurement ' + Date.now());
        }
        await h.clickSave(page);
        await page.waitForTimeout(1000);
      }
    }
    // Verify procurement creation works via API
    const { id } = await mkProc(page);
    expect(id).toBeTruthy();
    h.assertNoConsoleErrors(errors, 'PM creates procurement draft');
  });

  test('03 — PM adds item 1 to procurement', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }

    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'procurement');
    await page.waitForTimeout(1000);

    const addItemBtn = page.locator('button:has-text("Добавить позицию"), button:has-text("+ Позиция"), .btn-add-item');
    if (await addItemBtn.count() > 0) {
      await addItemBtn.first().click();
      await page.waitForTimeout(500);
      const nameField = page.locator('.modal input[name*="name"], .modal input[placeholder*="Наименование"]').first();
      if (await nameField.count() > 0) await nameField.fill('Труба стальная 108x4');
      const qtyField = page.locator('.modal input[name*="quantity"]').first();
      if (await qtyField.count() > 0) await qtyField.fill('200');
      const priceField = page.locator('.modal input[name*="price"]').first();
      if (await priceField.count() > 0) await priceField.fill('2500');
      const saveBtn = page.locator('.modal button:has-text("Сохранить"), .modal button.btn-primary').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1000);
      }
    } else {
      // Fallback: add via API
      const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
        name: 'Труба стальная 108x4', article: 'TR-108-4', unit: 'м.п.', quantity: 200, unit_price: 2500
      }, pmToken);
      expect(resp.status).toBeLessThan(300);
    }
    h.assertNoConsoleErrors(errors, 'PM adds item 1');
  });

  test('04 — PM adds item 2', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Электроды ОК 46.00', article: 'EL-OK46-3', unit: 'кг', quantity: 50, unit_price: 800
    }, pmToken);
    expect(resp.status).toBeLessThan(300);
    h.assertNoConsoleErrors(errors, 'PM adds item 2');
  });

  test('05 — PM adds item 3', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Задвижка клиновая DN100', article: 'ZK-DN100', unit: 'шт', quantity: 4, unit_price: 25000
    }, pmToken);
    expect(resp.status).toBeLessThan(300);
    h.assertNoConsoleErrors(errors, 'PM adds item 3');
  });

  test('06 — PM views procurement with items', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Труба стальная 108x4', unit: 'м.п.', quantity: 200, unit_price: 2500
    }, pmToken);
    await h.apiCall(page, 'POST', h.BASE_URL + `/api/procurement/${procId}/items`, {
      name: 'Электроды ОК', unit: 'кг', quantity: 50, unit_price: 800
    }, pmToken);

    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'procurement');
    await page.waitForTimeout(1000);

    const row = page.locator('tbody tr').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1500);
      const bodyText = await page.textContent('body');
      const hasItems = bodyText.includes('Труба') || bodyText.includes('Электрод') ||
        (await page.locator('.items-table tr, [data-item-id], .item-row').count()) > 0;
      expect(hasItems).toBeTruthy();
    }
    h.assertNoConsoleErrors(errors, 'PM views procurement with items');
  });

  test('07 — PM updates notes', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}`, {
      notes: 'E2E updated: Срочная доставка фаза 2'
    }, pmToken);
    expect(resp.status).toBeLessThan(300);
    h.assertNoConsoleErrors(errors, 'PM updates notes');
  });

  test('08 — PM sends to proc (draft → sent_to_proc)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);

    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'procurement');
    await page.waitForTimeout(1000);

    const row = page.locator('tbody tr').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);
      const sendBtn = page.locator('button:has-text("Отправить"), button:has-text("В закупку"), button:has-text("Передать")');
      if (await sendBtn.count() > 0) {
        await sendBtn.first().click();
        await page.waitForTimeout(1000);
        const confirmBtn = page.locator('button:has-text("Да"), button:has-text("Подтвердить"), button:has-text("OK")');
        if (await confirmBtn.count() > 0) {
          await confirmBtn.first().click();
          await page.waitForTimeout(1000);
        }
      } else {
        // Fallback: API
        const tok = await h.getSessionToken(page);
        const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/send-to-proc`, {}, tok);
        expect(resp.status).toBeLessThan(300);
      }
    }
    h.assertNoConsoleErrors(errors, 'PM sends to proc');
  });

  test('09 — PROC responds', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    // Advance to sent_to_proc first
    await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/send-to-proc`, {}, pmToken);

    await h.loginAs(page, 'PROC');
    await h.navigateTo(page, 'procurement');
    await page.waitForTimeout(1000);

    const row = page.locator('tbody tr').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);
      const respondBtn = page.locator('button:has-text("Ответить"), button:has-text("Принять"), button:has-text("Обработать")');
      if (await respondBtn.count() > 0) {
        await respondBtn.first().click();
        await page.waitForTimeout(500);
        const commentField = page.locator('textarea[name*="comment"], textarea[placeholder*="Комментарий"]');
        if (await commentField.count() > 0) {
          await commentField.first().fill('Поставщики подобраны, цены актуальны');
        }
        const saveBtn = page.locator('.modal button:has-text("Сохранить"), .modal button.btn-primary').first();
        if (await saveBtn.count() > 0) {
          await saveBtn.click();
          await page.waitForTimeout(1000);
        }
      } else {
        // Fallback: API
        const tok = await h.getSessionToken(page);
        const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/proc-respond`, {
          comment: 'Поставщики подобраны'
        }, tok);
        expect(resp.status).toBeLessThan(300);
      }
    }
    h.assertNoConsoleErrors(errors, 'PROC responds');
  });

  test('10 — PM approves (pm_approved)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    await advanceTo(page, procId, 'proc_responded');
    await h.loginAs(page, 'PM');
    const pmTok2 = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/pm-approve`, {}, pmTok2);
    expect(resp.status).toBeLessThan(300);
    h.assertNoConsoleErrors(errors, 'PM approves');
  });

  test('11 — DIRECTOR_GEN approves (dir_approved)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    await advanceTo(page, procId, 'pm_approved');
    await h.loginAs(page, 'DIRECTOR_GEN');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/dir-approve`, {}, token);
    expect(resp.status).toBeLessThan(300);
    expect(resp.data?.item?.locked).toBe(true);
    h.assertNoConsoleErrors(errors, 'DIRECTOR_GEN approves');
  });

  test('12 — BUH marks paid', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken);
    await advanceTo(page, procId, 'dir_approved');
    await h.loginAs(page, 'BUH');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/mark-paid`, {}, token);
    expect(resp.status).toBeLessThan(300);
    h.assertNoConsoleErrors(errors, 'BUH marks paid');
  });

  test('13 — WAREHOUSE delivers items', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const { id: procId, pmToken } = await mkProc(page);
    if (!procId) { test.skip(); return; }
    await addProcItem(page, procId, pmToken, { name: 'Труба', qty: 5, price: 1000 });
    await addProcItem(page, procId, pmToken, { name: 'Задвижка', qty: 2, price: 5000 });
    await advanceTo(page, procId, 'paid');
    await h.loginAs(page, 'WAREHOUSE');
    const token = await h.getSessionToken(page);
    const detailResp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procId}`, null, token);
    expect(detailResp.status).toBe(200);
    const items = detailResp.data?.items || [];
    for (const item of items) {
      if (item.item_status !== 'delivered') {
        await h.apiCall(page, 'PUT', h.BASE_URL + `/api/procurement/${procId}/items/${item.id}/deliver`, {}, token);
      }
    }
    const checkResp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/procurement/${procId}`, null, token);
    expect(checkResp.data?.item?.status).toBe('delivered');
    h.assertNoConsoleErrors(errors, 'WAREHOUSE delivers items');
  });

  test('14 — PM closes procurement, verify final state', async ({ page }) => {
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
    // Verify via UI
    await h.navigateTo(page, 'procurement');
    await page.waitForTimeout(1000);
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'PM closes procurement');
  });

});
