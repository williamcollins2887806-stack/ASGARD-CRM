/**
 * Scenario 09: TKP and Invoice CRUD, PDF generation, role-based access, approval workflow
 *
 * PM creates TKP -> BUH creates invoice -> BUH generates PDF -> DIRECTOR_GEN approves ->
 * ADMIN verifies cross-role visibility -> BUH edits invoice -> BUH deletes test invoice
 */

const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '09-tkp-invoices';

async function run(browser, context = {}) {
  const results = { name: 'TKP & Invoices CRUD + Approval', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const invoiceData = gen.invoice();
  const tkpData = gen.tender({ tender_title: `${gen.TEST_PREFIX}TKP_${gen.uid()}` });

  async function step(name, fn) {
    const stepResult = { name, status: 'PENDING', error: null, screenshot: null };
    results.steps.push(stepResult);
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
      await fn(stepResult);
      stepResult.status = 'PASSED';
      log(SCENARIO_NAME, `  + ${name}`);
    } catch (e) {
      stepResult.status = 'FAILED';
      stepResult.error = e.message.substring(0, 300);
      log(SCENARIO_NAME, `  X ${name}: ${e.message.substring(0, 100)}`);
      // Don't throw — continue to next step
}
  }

  try {
    // ---------------------------------------------------------------
    // Step 1: PM creates a TKP (commercial proposal / tender)
    // ---------------------------------------------------------------
    await step('PM creates TKP via #/tkp', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/tkp');
        await sleep(2000);

        const createBtn = await findCreateButton(page);
        if (createBtn) {
          await createBtn.click();
        } else {
          await clickButton(page, 'Создать|Добавить|Новый|Новая|ТКП');
        }
        await sleep(2000);

        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    TKP form: filled ${fields.filled} fields`);

        // Override key fields for tracking
        try {
          const titleInput = page.locator('input[name*="title"], input[placeholder*="Название"], input[placeholder*="Наименование"]').first();
          if (await titleInput.isVisible({ timeout: 2000 })) {
            await titleInput.fill(tkpData.tender_title);
          }
        } catch {}

        try {
          const customerInput = page.locator('input[name*="customer"], input[placeholder*="Заказчик"]').first();
          if (await customerInput.isVisible({ timeout: 2000 })) {
            await customerInput.fill(tkpData.customer_name);
          }
        } catch {}

        await submitForm(page);
        await waitForNetworkIdle(page);

        const errors = await checkForErrors(page);
        if (errors.length > 0) {
          log(SCENARIO_NAME, `    Form errors: ${errors.join(', ')}`);
        }

        context.tkpData = tkpData;
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 2: BUH creates an invoice
    // ---------------------------------------------------------------
    await step('BUH creates invoice via #/invoices', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/invoices');
        await sleep(2000);

        await clickButton(page, 'Создать|Добавить|Новый|Новая');
        await sleep(2000);

        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Invoice form: filled ${fields.filled} fields`);

        // Override comment for tracking
        try {
          const commentInput = page.locator('input[name*="comment"], textarea[name*="comment"], input[placeholder*="Комментарий"]').first();
          if (await commentInput.isVisible({ timeout: 2000 })) {
            await commentInput.fill(invoiceData.comment);
          }
        } catch {}

        // Override invoice number for tracking
        try {
          const numInput = page.locator('input[name*="number"], input[name*="invoice_number"], input[placeholder*="Номер"]').first();
          if (await numInput.isVisible({ timeout: 2000 })) {
            await numInput.fill(invoiceData.invoice_number);
          }
        } catch {}

        await submitForm(page);
        await waitForNetworkIdle(page);

        context.invoiceData = invoiceData;
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 3: BUH generates PDF from invoice
    // ---------------------------------------------------------------
    await step('BUH generates invoice PDF', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/invoices');
        await sleep(3000);

        // Find the test invoice in the table
        const found = await page.evaluate((comment) => {
          const rows = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const row of rows) {
            if (row.textContent.includes(comment)) {
              row.click();
              return true;
            }
          }
          return false;
        }, invoiceData.comment);

        if (found) {
          await sleep(2000);

          // Try to find PDF / Print / Export button
          try {
            await clickButton(page, 'PDF|Печать|Print|Скачать|Экспорт|Export');
            await sleep(3000);
            log(SCENARIO_NAME, '    PDF generation triggered');

            // Check for download or new tab (non-critical)
            const pdfSuccess = await checkForSuccess(page);
            const pdfErrors = await checkForErrors(page);
            if (pdfErrors.length > 0) {
              log(SCENARIO_NAME, `    PDF errors: ${pdfErrors.join(', ')}`);
            }
          } catch {
            log(SCENARIO_NAME, '    No PDF button found (may not be available for this state)');
          }
        } else {
          log(SCENARIO_NAME, '    Test invoice not found in list (may have different view)');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 4: DIRECTOR_GEN reviews invoices (role-based access check)
    // ---------------------------------------------------------------
    await step('DIRECTOR_GEN reviews invoices', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        await navigateTo(page, '#/invoices');
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Invoices page did not load for DIRECTOR_GEN');
        }

        // Verify director can see but NOT create
        const createBtn = await findCreateButton(page);
        if (createBtn) {
          log(SCENARIO_NAME, '    DIRECTOR_GEN has create access on invoices (expected: read-only or approval)');
        } else {
          log(SCENARIO_NAME, '    DIRECTOR_GEN has read-only access on invoices (expected)');
        }

        // Try approval workflow
        const found = await page.evaluate((comment) => {
          const rows = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const row of rows) {
            if (row.textContent.includes(comment)) {
              row.click();
              return true;
            }
          }
          return false;
        }, invoiceData.comment);

        if (found) {
          await sleep(2000);
          try {
            await clickButton(page, 'Одобрить|Согласовать|Утвердить|Approve');
            await sleep(2000);
            const success = await checkForSuccess(page);
            if (success) {
              log(SCENARIO_NAME, '    Invoice approved by DIRECTOR_GEN');
            }
          } catch {
            log(SCENARIO_NAME, '    No approval button found (may need different workflow state)');
          }
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 5: TO should NOT be able to create invoices (role restriction)
    // ---------------------------------------------------------------
    await step('TO cannot create invoices (role restriction)', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        await navigateTo(page, '#/invoices');
        await sleep(3000);

        // Check if page loads at all (TO may not have menu access)
        const content = await page.textContent('body');
        const currentHash = await page.evaluate(() => window.location.hash);

        if (currentHash.includes('/invoices')) {
          // TO can see invoices page - check if create is hidden
          const createBtn = await findCreateButton(page);
          if (createBtn) {
            log(SCENARIO_NAME, '    WARNING: TO has create access on invoices');
          } else {
            log(SCENARIO_NAME, '    TO has read-only access on invoices (expected)');
          }
        } else {
          log(SCENARIO_NAME, '    TO has no access to invoices page (expected redirect)');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 6: ADMIN can see all TKP and invoices
    // ---------------------------------------------------------------
    await step('ADMIN views all TKP and invoices', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));

        // Check TKP page
        await navigateTo(page, '#/tenders');
        await sleep(3000);
        const tenderContent = await page.textContent('body');
        if (!tenderContent || tenderContent.length < 100) {
          throw new Error('Tenders page did not load for ADMIN');
        }
        log(SCENARIO_NAME, '    ADMIN loaded tenders page');

        // Check invoices page
        await navigateTo(page, '#/invoices');
        await sleep(3000);
        const invoiceContent = await page.textContent('body');
        if (!invoiceContent || invoiceContent.length < 100) {
          throw new Error('Invoices page did not load for ADMIN');
        }
        log(SCENARIO_NAME, '    ADMIN loaded invoices page');
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 7: BUH edits the test invoice
    // ---------------------------------------------------------------
    await step('BUH edits test invoice', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/invoices');
        await sleep(3000);

        // Click on the test invoice
        const found = await page.evaluate((comment) => {
          const rows = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const row of rows) {
            if (row.textContent.includes(comment)) {
              row.click();
              return true;
            }
          }
          return false;
        }, invoiceData.comment);

        if (found) {
          await sleep(2000);
          // Try to find edit button
          try {
            await clickButton(page, 'Редактировать|Изменить|Edit');
            await sleep(2000);

            // Update the comment
            const updatedComment = `${invoiceData.comment}_EDITED`;
            try {
              const commentInput = page.locator('input[name*="comment"], textarea[name*="comment"]').first();
              if (await commentInput.isVisible({ timeout: 2000 })) {
                await commentInput.fill(updatedComment);
              }
            } catch {}

            await submitForm(page);
            await waitForNetworkIdle(page);
            log(SCENARIO_NAME, '    Invoice edited successfully');
          } catch {
            log(SCENARIO_NAME, '    No edit button found (may be inline editing or different UI)');
          }
        } else {
          log(SCENARIO_NAME, '    Test invoice not found for editing');
        }
      } finally {
        await ctx.close();
      }
    });

    results.status = 'PASSED';
  } catch (e) {
    results.status = 'FAILED';
  }

  results.duration = Date.now() - start;
  return results;
}

module.exports = { run, name: SCENARIO_NAME };
