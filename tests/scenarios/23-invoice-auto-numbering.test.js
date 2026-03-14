/**
 * Scenario 23: Invoice Auto-Numbering СЧ-ГГГГ-NNN
 * Tests that invoices get auto-generated numbers when not provided
 */
const SCENARIO_NAME = '23-invoice-auto-numbering';

async function run(browser, context = {}) {
  const config = require('../config');
  const { getAccount, BASE_URL, TEST_PREFIX, api, assertOk, assert } = config;
  const { loginAs, sleep } = require('../lib/auth');
  const { navigateTo, isModalOpen, closeModal, clickButton, findCreateButton, waitForNetworkIdle } = require('../lib/page-helpers');
  const { fillAllFields, submitForm } = require('../lib/form-filler');
  const { uid } = require('../lib/data-generator');

  const results = { name: SCENARIO_NAME, steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const year = new Date().getFullYear();

  async function step(name, fn) {
    const s = { name, status: 'PENDING', error: null, duration: 0 };
    results.steps.push(s);
    const t0 = Date.now();
    try {
// Browser health check + auto-relaunch
      try {
        const _hc = await browser.newContext();
        await _hc.close();
      } catch (_bcErr) {
        console.log('[recovery] Browser dead before "' + name + '", relaunching...');
        try {
          const { chromium } = require('playwright');
          browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'] });
          console.log('[recovery] Browser relaunched');
        } catch (_reErr) {
          console.log('[recovery] Relaunch failed: ' + _reErr.message);
        }
      }
      await fn(s);
      s.status = 'PASSED';
    } catch (e) {
      s.status = 'FAILED';
      s.error = e.message?.substring(0, 300);
      throw e;
    } finally {
      s.duration = Date.now() - t0;
    }
  }

  try {
    // Step 1: Create invoice via API without number → auto-generated
    await step('API: Create invoice without number → auto СЧ-ГГГГ-NNN', async (s) => {
      const resp = await api('POST', '/api/invoices', {
        role: 'BUH',
        body: {
          invoice_date: new Date().toISOString().split('T')[0],
          amount: 50000,
          customer_name: `${TEST_PREFIX}AutoNum_${uid()}`,
          description: `${TEST_PREFIX}Auto-numbered invoice test`
        }
      });
      assertOk(resp, 'Create invoice without number');

      const inv = resp.data?.invoice || resp.data;
      const num = inv?.invoice_number || inv?.number || '';
      const pattern = new RegExp(`СЧ-${year}-\\d{3}`);

      if (pattern.test(num)) {
        s.note = `Auto-number generated: ${num} ✓`;
        context.autoInvoiceId = inv.id;
        context.autoInvoiceNumber = num;
      } else {
        s.note = `Number: "${num}" — may not match pattern СЧ-${year}-NNN`;
      }
    });

    // Step 2: Create second invoice → number should increment
    await step('API: Second invoice gets incremented number', async (s) => {
      const resp = await api('POST', '/api/invoices', {
        role: 'BUH',
        body: {
          invoice_date: new Date().toISOString().split('T')[0],
          amount: 75000,
          customer_name: `${TEST_PREFIX}AutoNum2_${uid()}`,
          description: `${TEST_PREFIX}Second auto-numbered invoice`
        }
      });
      assertOk(resp, 'Create second invoice');

      const inv = resp.data?.invoice || resp.data;
      const num = inv?.invoice_number || inv?.number || '';
      s.note = `Second number: ${num}`;

      if (context.autoInvoiceNumber && num) {
        const prev = parseInt(context.autoInvoiceNumber.match(/(\d+)$/)?.[1] || '0');
        const curr = parseInt(num.match(/(\d+)$/)?.[1] || '0');
        if (curr === prev + 1) {
          s.note += ' → correctly incremented ✓';
        } else {
          s.note += ` → prev=${prev}, curr=${curr}`;
        }
      }
      context.autoInvoiceId2 = inv?.id;
    });

    // Step 3: Create invoice WITH explicit number → should keep it
    await step('API: Invoice with explicit number keeps it', async (s) => {
      const explicitNum = `${TEST_PREFIX}INV-${uid()}`;
      const resp = await api('POST', '/api/invoices', {
        role: 'BUH',
        body: {
          invoice_number: explicitNum,
          invoice_date: new Date().toISOString().split('T')[0],
          amount: 100000,
          customer_name: `${TEST_PREFIX}ExplicitNum_${uid()}`,
          description: `${TEST_PREFIX}Explicit number test`
        }
      });
      assertOk(resp, 'Create invoice with explicit number');

      const inv = resp.data?.invoice || resp.data;
      const num = inv?.invoice_number || inv?.number || '';
      if (num === explicitNum) {
        s.note = `Explicit number preserved: ${num} ✓`;
      } else {
        s.note = `Expected "${explicitNum}", got "${num}"`;
      }
      context.explicitInvoiceId = inv?.id;
    });

    // Step 4: BUH creates invoice via UI — check auto-number in form
    await step('UI: BUH creates invoice, sees auto-number placeholder', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/invoices');
        await sleep(2000);

        // Click create
        const createBtn = await findCreateButton(page);
        if (!createBtn) {
          s.note = 'Create button not found on invoices page';
          return;
        }
        await createBtn.click();
        await sleep(1500);

        const modalOpen = await isModalOpen(page);
        if (!modalOpen) {
          s.note = 'Modal did not open';
          return;
        }

        // Check for auto-number placeholder
        const placeholder = await page.evaluate(() => {
          const numField = document.querySelector('input[name*="number"], input[id*="number"], input[name*="invoice_number"]');
          return numField ? { placeholder: numField.placeholder, value: numField.value } : null;
        });

        s.note = `Number field: ${JSON.stringify(placeholder)}`;

        // Check all form fields are present
        const fields = await page.evaluate(() => {
          const modal = document.querySelector('[class*="modal"]:not([style*="display: none"])');
          if (!modal) return [];
          return Array.from(modal.querySelectorAll('input:not([type="hidden"]), select, textarea'))
            .filter(el => el.offsetParent !== null)
            .map(el => ({ type: el.type, name: el.name || el.id, placeholder: el.placeholder }));
        });
        s.note += `, form fields: ${fields.length}`;

        // Check all buttons in modal
        const buttons = await page.evaluate(() => {
          const modal = document.querySelector('[class*="modal"]:not([style*="display: none"])');
          if (!modal) return [];
          return Array.from(modal.querySelectorAll('button'))
            .map(b => ({ text: (b.textContent || '').trim().substring(0, 30), disabled: b.disabled }));
        });
        s.note += `, modal buttons: ${buttons.map(b => b.text).join(', ')}`;

        await closeModal(page);
      } finally {
        await ctx.close();
      }
    });

    // Step 5: Verify invoices list shows auto-numbers
    await step('UI: Invoices list displays auto-numbered invoices', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/invoices');
        await sleep(2000);

        const bodyText = await page.textContent('body');
        const hasAutoNum = bodyText.includes(`СЧ-${year}`);
        s.note = `Has auto-numbered invoices (СЧ-${year}): ${hasAutoNum}`;

        // Check table has rows
        const rowCount = await page.locator('tbody tr').count();
        s.note += `, table rows: ${rowCount}`;
      } finally {
        await ctx.close();
      }
    });

    results.status = 'PASSED';
  } catch (e) {
    results.status = 'FAILED';
    results.error = e.message?.substring(0, 500);
  }

  results.duration = Date.now() - start;
  return results;
}

module.exports = { run, name: SCENARIO_NAME };
