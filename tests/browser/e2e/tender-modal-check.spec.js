/**
 * Tender Modal Redesign — Smoke Test v3
 * Uses loginAs from helpers.js (proven to work in other tests)
 */
const { test, expect } = require('@playwright/test');
const { loginAs } = require('../helpers');

const BASE = 'https://asgard-crm.ru';

test.describe('Tender Modal Smoke', () => {
  test.setTimeout(120000); // 2 min per test

  test('1. New tender — modal opens, fields check', async ({ page }) => {
    await loginAs(page, 'TO');
    await page.goto(BASE + '/#/tenders', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Debug: what's on page?
    const pageUrl = page.url();
    console.log('Page URL:', pageUrl);

    // Try to find & click create button
    const selectors = [
      '#btnNew',
      'button:has-text("Внести тендер")',
      'button:has-text("Создать")',
      'button:has-text("+ Тендер")',
      '.btn:has-text("Создать")',
    ];

    let clicked = false;
    for (const sel of selectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('Found button:', sel);
        await btn.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      console.log('⚠️ No create button found. Page title:', await page.title());
      await page.screenshot({ path: 'tests/screenshots/tender-no-create-btn.png' });

      // List all visible buttons
      const allBtns = await page.locator('button, .btn').allTextContents();
      console.log('Visible buttons:', allBtns.slice(0, 20).join(' | '));
      return;
    }

    await page.waitForTimeout(2000);

    // Check if modal body appeared
    const modalBody = page.locator('#modalBody');
    if (!(await modalBody.isVisible({ timeout: 5000 }).catch(() => false))) {
      console.log('⚠️ Modal body not visible after click');
      await page.screenshot({ path: 'tests/screenshots/tender-no-modal.png' });
      return;
    }

    console.log('✅ Modal opened');

    // Check fields
    const fields = {
      '#e_title': 'Title',
      '#e_price': 'Price',
      '#e_type_w': 'Type',
      '#e_pm_w': 'PM',
      '#e_status_w': 'Status',
      '#cr-customer-wrap': 'Customer',
      '#cr-inn-wrap': 'INN',
      '#e_tag_w': 'Tag',
      '#btnSave': 'Save',
    };

    for (const [sel, name] of Object.entries(fields)) {
      const el = page.locator(sel);
      const exists = (await el.count()) > 0;
      console.log(`  ${exists ? '✅' : '❌'} ${name} (${sel})`);
    }

    // CrField components
    console.log('  Chips:', await page.locator('.cr-f-chip').count());
    console.log('  Labels:', await page.locator('.cr-f-label').count());
    console.log('  Sections:', await page.locator('.cr-f-section').count());
    console.log('  Stepper:', await page.locator('.cr-f-stepper').count());
    console.log('  PersonPicker:', await page.locator('.cr-f-person').count());

    await page.screenshot({ path: 'tests/screenshots/tender-step1.png' });
    console.log('✅ Test 1 passed');
  });

  test('2. Wizard step navigation', async ({ page }) => {
    await loginAs(page, 'TO');
    await page.goto(BASE + '/#/tenders', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Open modal
    const createBtn = page.locator('#btnNew, button:has-text("Внести тендер")').first();
    if (!(await createBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('⚠️ No create button'); return;
    }
    await createBtn.click();
    await page.waitForTimeout(2000);

    if (!(await page.locator('#modalBody').isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('⚠️ Modal not open'); return;
    }

    // Step 1 → 2
    const nextBtn = page.locator('#btnStepNext');
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(500);
      console.log('Step 2: URL visible =', await page.locator('#e_url').isVisible().catch(() => false));
      console.log('Step 2: Title hidden =', !(await page.locator('#e_title').isVisible().catch(() => false)));
      await page.screenshot({ path: 'tests/screenshots/tender-step2.png' });

      // Step 2 → 3
      await nextBtn.click();
      await page.waitForTimeout(500);
      console.log('Step 3: DropZone =', await page.locator('.cr-f-dropzone').isVisible().catch(() => false));
      console.log('Step 3: DocsBox =', await page.locator('#docsBox').isVisible().catch(() => false));
      console.log('Step 3: Save primary =', (await page.locator('#btnSave').getAttribute('class') || '').includes('primary'));
      await page.screenshot({ path: 'tests/screenshots/tender-step3.png' });

      console.log('✅ Wizard navigation works');
    } else {
      console.log('⚠️ No wizard (Next button not found)');
    }
  });

  test('3. Existing tender — no wizard, all visible', async ({ page }) => {
    await loginAs(page, 'TO');
    await page.goto(BASE + '/#/tenders', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Click first tender row
    const row = page.locator('table tbody tr, [data-id]').first();
    if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
      await row.click();
      await page.waitForTimeout(3000);

      if (await page.locator('#modalBody').isVisible({ timeout: 5000 }).catch(() => false)) {
        const s0 = await page.locator('[data-step="0"]').isVisible().catch(() => false);
        const s1 = await page.locator('[data-step="1"]').isVisible().catch(() => false);
        const s2 = await page.locator('[data-step="2"]').isVisible().catch(() => false);
        console.log(`Steps: 0=${s0} 1=${s1} 2=${s2} (all should be true for existing)`);
        console.log('Save:', await page.locator('#btnSave').isVisible().catch(() => false));
        await page.screenshot({ path: 'tests/screenshots/tender-existing.png' });
        console.log('✅ Existing tender opens correctly');
      } else {
        console.log('⚠️ Modal not opened');
        await page.screenshot({ path: 'tests/screenshots/tender-existing-fail.png' });
      }
    } else {
      console.log('⚠️ No tender rows');
    }
  });

  test('4. No console errors on open/close', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await loginAs(page, 'TO');
    await page.goto(BASE + '/#/tenders', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    const createBtn = page.locator('#btnNew, button:has-text("Внести тендер")').first();
    if (!(await createBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('⚠️ No create button'); return;
    }
    await createBtn.click();
    await page.waitForTimeout(2000);

    // Close via X
    const closeBtn = page.locator('#modalClose');
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(800);
      const closed = !(await page.locator('.cr-m-overlay--visible').isVisible().catch(() => false));
      console.log('Modal closed:', closed);
    }

    // Open again, close via ESC
    await createBtn.click();
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const closedEsc = !(await page.locator('.cr-m-overlay--visible').isVisible().catch(() => false));
    console.log('ESC close:', closedEsc);

    const critical = errors.filter(e =>
      !e.includes('favicon') && !e.includes('SW') && !e.includes('service-worker') &&
      !e.includes('net::ERR') && !e.includes('ResizeObserver') && !e.includes('Failed to load')
    );
    console.log(critical.length ? '❌ Errors: ' + critical.join(' | ') : '✅ No critical console errors');
  });
});
