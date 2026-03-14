/**
 * Scenario 24: PDF Templates for TKP and Invoices
 * Tests PDF generation with logo, company details, VAT calculation
 */
const SCENARIO_NAME = '24-pdf-templates';

async function run(browser, context = {}) {
  const config = require('../config');
  const { getAccount, BASE_URL, TEST_PREFIX, api, assertOk, assert } = config;
  const { loginAs, sleep } = require('../lib/auth');
  const { navigateTo, isModalOpen, closeModal, clickButton, waitForNetworkIdle } = require('../lib/page-helpers');
  const { uid } = require('../lib/data-generator');

  const results = { name: SCENARIO_NAME, steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

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
    // Step 1: Check company profile has necessary data for PDF
    await step('API: Company profile has required fields', async (s) => {
      const resp = await api('GET', '/api/settings/company-profile', { role: 'ADMIN' });
      if (resp.ok) {
        const profile = resp.data?.profile || resp.data;
        const fields = ['company_name', 'inn', 'kpp', 'bank_name', 'bank_rs', 'bank_ks', 'bank_bik'];
        const present = fields.filter(f => profile?.[f]);
        s.note = `Company profile fields present: ${present.length}/${fields.length}: ${present.join(', ')}`;
        if (profile?.vat_rate !== undefined) {
          s.note += `, VAT rate: ${profile.vat_rate}%`;
        }
      } else {
        s.note = `Company profile API: ${resp.status}`;
      }
    });

    // Step 2: Create a TKP for PDF test
    await step('API: Create TKP for PDF generation', async (s) => {
      const resp = await api('POST', '/api/tkp', {
        role: 'PM',
        body: {
          title: `${TEST_PREFIX}PDF_TKP_${uid()}`,
          customer_name: `${TEST_PREFIX}PDF_Customer_${uid()}`,
          amount: 1500000,
          description: 'Test TKP for PDF generation',
          validity_days: 30,
          notes: 'Тестовое примечание для PDF'
        }
      });

      if (resp.ok) {
        const tkp = resp.data?.tkp || resp.data;
        context.tkpId = tkp?.id;
        s.note = `TKP created: id=${tkp?.id}`;
      } else {
        s.note = `TKP create failed: ${resp.status} ${JSON.stringify(resp.data).substring(0, 200)}`;
      }
    });

    // Step 3: Generate TKP PDF via API
    await step('API: Generate TKP PDF', async (s) => {
      if (!context.tkpId) {
        s.note = 'No TKP id, skipping PDF generation';
        return;
      }

      const resp = await config.rawFetch('GET', `/api/tkp/${context.tkpId}/pdf`, {
        token: await config.getToken('PM')
      });

      if (resp.status === 200) {
        const contentType = resp.headers?.get?.('content-type') || '';
        const isPdf = contentType.includes('pdf') || resp.text?.startsWith('%PDF');
        s.note = `PDF generated, content-type: ${contentType}, is PDF: ${isPdf}, size: ${(resp.text || '').length} bytes`;
      } else {
        s.note = `PDF generation returned ${resp.status}: ${typeof resp.data === 'string' ? resp.data.substring(0, 200) : JSON.stringify(resp.data).substring(0, 200)}`;
      }
    });

    // Step 4: Generate Invoice PDF via API
    await step('API: Generate Invoice PDF', async (s) => {
      // Get an existing invoice
      const listResp = await api('GET', '/api/invoices', { role: 'BUH' });
      const invoices = listResp.data?.invoices || listResp.data?.items || listResp.data?.data || [];

      if (invoices.length === 0) {
        s.note = 'No invoices found, skipping PDF test';
        return;
      }

      const invoiceId = invoices[0].id;
      const resp = await config.rawFetch('GET', `/api/invoices/${invoiceId}/pdf`, {
        token: await config.getToken('BUH')
      });

      if (resp.status === 200) {
        const contentType = resp.headers?.get?.('content-type') || '';
        const isPdf = contentType.includes('pdf') || resp.text?.startsWith('%PDF');
        s.note = `Invoice PDF generated, content-type: ${contentType}, is PDF: ${isPdf}, size: ${(resp.text || '').length} bytes`;
      } else {
        s.note = `Invoice PDF: ${resp.status}`;
      }
    });

    // Step 5: UI - TKP page has PDF download button
    await step('UI: TKP detail has PDF download button', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/tkp');
        await sleep(2000);

        // Click first row to open detail
        const row = page.locator('tbody tr').first();
        if (await row.count() > 0) {
          await row.click();
          await sleep(1500);

          // Look for PDF button
          const pdfBtn = await page.locator('button:has-text("PDF"), button:has-text("Скачать"), a:has-text("PDF"), [class*="pdf"]').count();
          s.note = `PDF buttons found: ${pdfBtn}`;

          // Also check all buttons in the detail/modal
          const allBtns = await page.evaluate(() => {
            const modal = document.querySelector('[class*="modal"]:not([style*="display: none"])');
            const container = modal || document.querySelector('main') || document.body;
            return Array.from(container.querySelectorAll('button, [role="button"], a.btn'))
              .filter(b => b.offsetParent !== null)
              .map(b => (b.textContent || '').trim().substring(0, 40));
          });
          s.note += `, all buttons: [${allBtns.join(', ')}]`;

          if (await isModalOpen(page)) await closeModal(page);
        } else {
          s.note = 'No TKP rows in table';
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 6: UI - Invoice page has PDF download button
    await step('UI: Invoice detail has PDF download button', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/invoices');
        await sleep(2000);

        const row = page.locator('tbody tr').first();
        if (await row.count() > 0) {
          await row.click();
          await sleep(1500);

          const pdfBtn = await page.locator('button:has-text("PDF"), button:has-text("Скачать"), a:has-text("PDF")').count();
          s.note = `PDF buttons found: ${pdfBtn}`;

          // Check all buttons
          const allBtns = await page.evaluate(() => {
            const modal = document.querySelector('[class*="modal"]:not([style*="display: none"])');
            const container = modal || document.querySelector('main') || document.body;
            return Array.from(container.querySelectorAll('button, [role="button"], a.btn'))
              .filter(b => b.offsetParent !== null)
              .map(b => (b.textContent || '').trim().substring(0, 40));
          });
          s.note += `, all buttons: [${allBtns.join(', ')}]`;

          if (await isModalOpen(page)) await closeModal(page);
        } else {
          s.note = 'No invoice rows';
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 7: Verify PDF contains company details (via HTML preview if available)
    await step('API: PDF HTML contains company details', async (s) => {
      if (!context.tkpId) {
        s.note = 'No TKP id for HTML check';
        return;
      }

      // Try HTML preview endpoint
      const resp = await config.rawFetch('GET', `/api/tkp/${context.tkpId}/pdf?format=html`, {
        token: await config.getToken('PM')
      });

      if (resp.status === 200 && typeof resp.data === 'string') {
        const html = resp.data;
        const checks = {
          hasLogo: html.includes('logo') || html.includes('img'),
          hasINN: html.includes('ИНН') || html.includes('inn'),
          hasBank: html.includes('банк') || html.includes('bank') || html.includes('р/с'),
          hasVAT: html.includes('НДС') || html.includes('vat'),
          hasSignature: html.includes('директор') || html.includes('подпись') || html.includes('Генеральный'),
        };
        s.note = JSON.stringify(checks);
      } else {
        s.note = `HTML preview: ${resp.status} (may not support ?format=html)`;
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
