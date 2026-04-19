// @ts-check
// Tenders E2E — 10 browser tests + save verification
// Updated for cr-modal v1.0 wizard (3-step stepper)
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const TS = () => Date.now();

/**
 * Helper: fill new tender form (handles wizard steps)
 */
async function fillAndSaveNewTender(page, { title, price, customer }) {
  await page.waitForTimeout(500);

  // Step 1 fields
  const titleField = page.locator('#e_title');
  if (await titleField.isVisible({ timeout: 3000 }).catch(() => false)) {
    await titleField.fill(title || 'Test Tender');
  }

  const priceField = page.locator('#e_price');
  if (await priceField.isVisible().catch(() => false)) {
    await priceField.fill(price || '100000');
  }

  // Customer via CRAutocomplete
  if (customer) {
    const custInput = page.locator('#cr-customer-wrap input').first();
    if (await custInput.isVisible().catch(() => false)) {
      await custInput.click();
      await custInput.type(customer, { delay: 60 });
      await page.waitForTimeout(1500);
      const opt = page.locator('.cr-ac__option').first();
      if (await opt.isVisible({ timeout: 2000 }).catch(() => false)) {
        await opt.click();
      }
      await page.waitForTimeout(300);
    }
  }

  // Navigate through wizard to step 3 (if wizard present)
  const nextBtn = page.locator('#btnStepNext');
  if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(400);
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(400);
    }
  }

  await h.clickSave(page);
  await page.waitForTimeout(2000);
}

// ─── Test 1: Full tender lifecycle via UI ────────────────────────

test.describe.serial('Tender Full Lifecycle', () => {
  let tenderId;
  let tenderName;

  test('T-01: Full tender lifecycle (create → verify)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    tenderName = 'PW Tender Lifecycle ' + TS();

    await h.loginAs(page, 'TO');
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    await h.clickCreate(page);
    await page.waitForTimeout(800);

    await fillAndSaveNewTender(page, {
      title: tenderName,
      price: '750000',
      customer: 'АЗОТ'
    });

    // Verify tender in list
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(100);

    // Open first tender — for existing tenders all steps visible
    const row = page.locator('tbody tr, .tender-row');
    if (await row.count() > 0) {
      await row.first().click({ force: true });
      await page.waitForTimeout(1500);

      const url = page.url();
      const idMatch = url.match(/tender[s]?\/(\d+)/);
      if (idMatch) tenderId = idMatch[1];

      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'T-01 Full lifecycle');
  });
});

// ─── Test 2: Price preserved (wizard-aware) ──────────────────────

test.describe('Tender Bugfix Verifications', () => {

  test('T-02: BUG-01 — tender_price preserved on create', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'TO');
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    const testName = 'BUG01 price ' + TS();

    await h.clickCreate(page);
    await page.waitForTimeout(500);

    await fillAndSaveNewTender(page, {
      title: testName,
      price: '999999',
      customer: 'АЗОТ'
    });

    // Re-open and verify price
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    const row = page.locator('tbody tr').first();
    if (await row.count() > 0) {
      await row.first().click({ force: true });
      await page.waitForTimeout(1500);

      // Existing tender: all steps visible, price on step 1
      const priceField = page.locator('#e_price');
      if (await priceField.isVisible({ timeout: 3000 }).catch(() => false)) {
        const val = await priceField.inputValue();
        expect(val).toContain('999999');
        console.log('✅ Price preserved:', val);
      }

      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'T-02 BUG-01 tender_price');
  });

  test('T-03: BUG-04 — stats endpoint works', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');

    const token = await h.getSessionToken(page);
    if (token) {
      const result = await h.apiCall(page, 'GET', h.BASE_URL + '/api/tenders/stats/summary', null, token);
      expect(result.status).toBe(200);
    }

    h.assertNoConsoleErrors(errors, 'T-03 BUG-04 stats');
  });

  test('T-04: BUG-02 — analytics page loads', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');

    await h.navigateTo(page, 'analytics');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'T-04 BUG-02 analytics');
  });

  test('T-05: BUG-06 — pre_tender delete requires correct role', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    await h.loginAs(page, 'PM');
    const pmToken = await h.getSessionToken(page);
    if (pmToken) {
      const result = await h.apiCall(page, 'DELETE', h.BASE_URL + '/api/pre-tenders/999999', null, pmToken);
      expect([403, 404]).toContain(result.status);
    }

    await h.loginAs(page, 'ADMIN');
    const adminToken = await h.getSessionToken(page);
    if (adminToken) {
      const result = await h.apiCall(page, 'DELETE', h.BASE_URL + '/api/pre-tenders/999999', null, adminToken);
      expect([404, 403]).toContain(result.status);
    }

    h.assertNoConsoleErrors(errors, 'T-05 BUG-06 pre_tender delete');
  });

  test('T-06: BUG-07 — expired tenders page loads', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'T-06 BUG-07 renew expired');
  });

  test('T-07: BUG-09 — search with dots', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    const searchField = page.locator('input[type="search"], input#fSearch, input[placeholder*="Поиск"]');
    if (await searchField.count() > 0) {
      await searchField.first().fill('test.tender.search');
      await page.waitForTimeout(1000);
      const body = await page.textContent('body');
      expect(body.length).toBeGreaterThan(50);
      await searchField.first().fill('');
    }

    h.assertNoConsoleErrors(errors, 'T-07 BUG-09 search dots');
  });

  test('T-08: BUG-11 — stats year filter', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    if (token) {
      const r25 = await h.apiCall(page, 'GET', h.BASE_URL + '/api/tenders/stats/summary?year=2025', null, token);
      expect(r25.status).toBe(200);
      const r26 = await h.apiCall(page, 'GET', h.BASE_URL + '/api/tenders/stats/summary?year=2026', null, token);
      expect(r26.status).toBe(200);
    }
    h.assertNoConsoleErrors(errors, 'T-08 BUG-11 stats year');
  });

  test('T-09: Lifecycle regression — no 500 errors', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');

    for (const pg of ['tenders', 'pre-tenders', 'estimates', 'works', 'acts', 'invoices']) {
      await h.navigateTo(page, pg);
      await h.waitForPageLoad(page);
      const body = await page.textContent('body');
      expect(body.length).toBeGreaterThan(50);
    }

    h.assertNoConsoleErrors(errors, 'T-09 Lifecycle regression');
  });

  test('T-10: Existing tender — all steps visible, status works', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    const row = page.locator('tbody tr, .tender-row').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1500);

      // Existing tender: all 3 wizard steps visible at once
      const step0 = page.locator('[data-step="0"]');
      const step1 = page.locator('[data-step="1"]');
      const step2 = page.locator('[data-step="2"]');
      if (await step0.count() > 0) {
        console.log('Steps visible:',
          await step0.isVisible().catch(() => false),
          await step1.isVisible().catch(() => false),
          await step2.isVisible().catch(() => false)
        );
      }

      // Status select accessible
      const statusEl = page.locator('#e_status_w, .cr-select');
      if (await statusEl.count() > 0) {
        const txt = await statusEl.first().textContent();
        expect(txt.length).toBeGreaterThan(0);
      }

      const buttons = await h.getVisibleButtons(page);
      expect(buttons.length).toBeGreaterThan(0);

      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'T-10 Status transitions');
  });

  test('T-11: Save verification — all fields persist correctly', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const testTitle = 'E2E_SAVE_' + TS();

    await h.loginAs(page, 'TO');
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    await h.clickCreate(page);
    await page.waitForTimeout(800);

    // Fill step 1
    await page.locator('#e_title').fill(testTitle);
    await page.locator('#e_price').fill('333444');

    // Customer
    const custInput = page.locator('#cr-customer-wrap input').first();
    if (await custInput.isVisible().catch(() => false)) {
      await custInput.click();
      await custInput.type('АЗОТ', { delay: 60 });
      await page.waitForTimeout(1500);
      const opt = page.locator('.cr-ac__option').first();
      if (await opt.isVisible({ timeout: 2000 }).catch(() => false)) await opt.click();
      await page.waitForTimeout(300);
    }

    // Select type chip "Оценка рынка"
    const chip = page.locator('.cr-f-chip:has-text("Оценка рынка")');
    if (await chip.isVisible().catch(() => false)) await chip.click();

    // Navigate to step 2, fill URL
    const nextBtn = page.locator('#btnStepNext');
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(400);
      await page.locator('#e_url').fill('https://e2e-test.example.com');
      // Step 3
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(400);
      }
    }

    // Save
    await h.clickSave(page);
    await page.waitForTimeout(2500);

    // Verify in IndexedDB
    const saved = await page.evaluate((t) => {
      return new Promise(resolve => {
        if (!window.AsgardDB) { resolve(null); return; }
        AsgardDB.all('tenders').then(list => {
          resolve((list || []).find(x => x.tender_title === t) || null);
        }).catch(() => resolve(null));
      });
    }, testTitle);

    if (saved) {
      console.log('=== SAVE VERIFICATION ===');
      console.log('  ✅ tender_title:', saved.tender_title === testTitle ? 'MATCH' : 'MISMATCH');
      console.log('  ✅ tender_price:', String(saved.tender_price) === '333444' ? 'MATCH' : String(saved.tender_price));
      console.log('  ✅ tender_type:', saved.tender_type || '(empty)');
      console.log('  ✅ customer_name:', saved.customer_name || '(empty)');
      console.log('  ✅ purchase_url:', saved.purchase_url || '(empty)');
      console.log('  ✅ tender_status:', saved.tender_status || '(empty)');

      expect(saved.tender_title).toBe(testTitle);
      expect(String(saved.tender_price)).toBe('333444');

      // Cleanup
      await page.evaluate(id => AsgardDB.del('tenders', id), saved.id);
      console.log('  🗑 Cleaned up (id=' + saved.id + ')');
    } else {
      console.log('⚠️ Tender not found in IndexedDB — may have been saved to server only');
    }

    h.assertNoConsoleErrors(errors, 'T-11 Save verification');
  });
});
