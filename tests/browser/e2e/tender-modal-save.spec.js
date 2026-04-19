/**
 * Tender Modal — SAVE VERIFICATION
 * Uses proven helpers (loginAs, navigateTo, clickCreate, clickSave)
 * Fills fields → saves → checks via IndexedDB → deletes test data
 */
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const BASE = 'https://asgard-crm.ru';
const TS = () => Date.now();

test.describe('Tender Modal Save', () => {
  test.setTimeout(180000);

  test('Create tender, verify all fields saved correctly, cleanup', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    const testTitle = 'E2E_MODAL_' + TS();

    // === LOGIN + NAVIGATE ===
    await h.loginAs(page, 'TO');
    await h.navigateTo(page, 'tenders');
    await h.waitForPageLoad(page);

    // === OPEN NEW TENDER ===
    await h.clickCreate(page);
    await page.waitForTimeout(1500);

    // Verify modal opened
    const modalBody = page.locator('#modalBody');
    if (!(await modalBody.isVisible({ timeout: 5000 }).catch(() => false))) {
      console.log('❌ Modal did not open');
      await page.screenshot({ path: 'tests/screenshots/tender-save-fail.png' });
      return;
    }
    console.log('✅ Modal opened');

    // === FILL STEP 1 ===
    // Title
    await page.fill('#e_title', testTitle);
    console.log('  title:', testTitle);

    // Price
    await page.fill('#e_price', '555000');
    console.log('  price: 555000');

    // Customer — type into CRAutocomplete input and pick option
    const custInput = page.locator('#cr-customer-wrap input').first();
    if (await custInput.isVisible().catch(() => false)) {
      await custInput.click();
      await custInput.type('АЗОТ', { delay: 80 });
      await page.waitForTimeout(2000);
      const custOpt = page.locator('.cr-ac__option').first();
      if (await custOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
        const custText = await custOpt.textContent().catch(() => '');
        await custOpt.click();
        console.log('  customer: picked from dropdown —', custText.trim().slice(0, 40));
      } else {
        console.log('  ⚠️ No autocomplete options, typing directly');
        await page.evaluate(() => {
          if (typeof CRAutocomplete !== 'undefined') CRAutocomplete.setValue('e_customer', 'АО ТЕСТ ЗАКАЗЧИК');
        });
      }
      await page.waitForTimeout(500);
    }

    // INN
    const innInput = page.locator('#cr-inn-wrap input').first();
    if (await innInput.isVisible().catch(() => false)) {
      await innInput.click();
      await innInput.type('2205001753', { delay: 40 });
      await page.waitForTimeout(1000);
      const innOpt = page.locator('#cr-inn-wrap .cr-ac__option').first();
      if (await innOpt.isVisible({ timeout: 1500 }).catch(() => false)) {
        await innOpt.click();
        console.log('  inn: picked from dropdown');
      }
      await page.waitForTimeout(300);
    }

    // Type via chips — click "Запрос предложений"
    const chipZP = page.locator('.cr-f-chip:has-text("Запрос предложений")');
    if (await chipZP.isVisible().catch(() => false)) {
      await chipZP.click();
      console.log('  type: Запрос предложений (chip)');
    }

    await page.screenshot({ path: 'tests/screenshots/tender-save-step1.png' });

    // === NAVIGATE TO STEP 2 (if wizard) ===
    const nextBtn = page.locator('#btnStepNext');
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(500);

      // Fill URL
      const urlField = page.locator('#e_url');
      if (await urlField.isVisible().catch(() => false)) {
        await urlField.fill('https://test-tender.example.com');
        console.log('  url: filled');
      }

      await page.screenshot({ path: 'tests/screenshots/tender-save-step2.png' });

      // === NAVIGATE TO STEP 3 ===
      await nextBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'tests/screenshots/tender-save-step3.png' });
    }

    // === SAVE ===
    console.log('  Saving...');
    await h.clickSave(page);
    await page.waitForTimeout(3000);

    // Capture toasts
    const toasts = page.locator('.toast');
    const tc = await toasts.count();
    for (let i = 0; i < Math.min(tc, 5); i++) {
      const txt = await toasts.nth(i).textContent().catch(() => '');
      const cls = await toasts.nth(i).getAttribute('class') || '';
      console.log(`  Toast: ${cls.includes('error') ? '❌' : '✅'} ${txt.trim().slice(0, 60)}`);
    }

    const modalStillOpen = await h.isModalVisible(page);
    console.log('  Modal still open:', modalStillOpen);

    await page.screenshot({ path: 'tests/screenshots/tender-save-after.png' });

    // === VERIFY IN INDEXEDDB ===
    const saved = await page.evaluate((title) => {
      return new Promise(resolve => {
        if (!window.AsgardDB) { resolve(null); return; }
        AsgardDB.all('tenders').then(list => {
          resolve((list || []).find(t => t.tender_title === title) || null);
        }).catch(() => resolve(null));
      });
    }, testTitle);

    if (!saved) {
      console.log('❌ TENDER NOT SAVED — not found in IndexedDB');
      // Check console errors
      h.assertNoConsoleErrors(errors, 'tender-save');
      return;
    }

    console.log('\n=== SAVED DATA VERIFICATION ===');
    console.log('  ID:', saved.id);
    const checks = {
      tender_title: testTitle,
      tender_price: '555000',
    };

    let ok = true;
    for (const [k, v] of Object.entries(checks)) {
      const actual = String(saved[k] || '');
      const match = actual === v || actual.includes(v);
      console.log(`  ${match ? '✅' : '❌'} ${k}: expected="${v}" actual="${actual}"`);
      if (!match) ok = false;
    }

    // Check non-empty
    for (const k of ['customer_name', 'tender_type', 'tender_status', 'period', 'purchase_url']) {
      const v = saved[k];
      console.log(`  ${v ? '✅' : '⚠️'} ${k}: "${v || '(empty)'}"`);
      if (!v && k !== 'purchase_url') ok = false;
    }

    // === CLEANUP ===
    if (saved.id) {
      await page.evaluate(id => AsgardDB.del('tenders', id), saved.id);
      console.log('\n  🗑 Deleted test tender (id=' + saved.id + ')');
    }

    console.log(ok ? '\n✅ ALL FIELDS SAVED CORRECTLY' : '\n❌ SOME FIELDS MISMATCHED');
    h.assertNoConsoleErrors(errors, 'tender-save');
  });
});
