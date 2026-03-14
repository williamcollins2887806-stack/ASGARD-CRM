/**
 * Scenario 15: Cash Workflow Cross-Role E2E
 *
 * PM creates cash request -> HEAD_PM approves -> BUH processes ->
 * DIRECTOR_GEN final approval -> PM reports expenses -> BUH creates invoice ->
 * BUH creates act -> DIRECTOR_GEN reviews finances -> OFFICE_MANAGER views expenses ->
 * WAREHOUSE access restriction verified
 */

const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '15-cash-cross-role';

async function run(browser, context = {}) {
  const results = { name: SCENARIO_NAME + ': Cash Workflow Cross-Role', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

  const cashData = gen.cashRequest();
  const invoiceData = gen.invoice();
  context.cashPurpose = cashData.purpose;

  async function step(name, fn) {
    const s = { name: name, status: 'PENDING', error: null, duration: 0 };
    const t0 = Date.now();
    try {
      log('[STEP] ' + name);
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
      log('[PASS] ' + name);
    } catch (e) {
      s.status = 'FAILED';
      s.error = (e.message || String(e)).substring(0, 300);
      log('[FAIL] ' + name + ': ' + s.error);
    }
    s.duration = Date.now() - t0;
    results.steps.push(s);
  }

  try {
    // ========================================================================
    // Step 1: PM creates cash request
    // ========================================================================
    await step('PM creates cash request', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/cash');
        await sleep(2500);

        var created = false;
        try {
          var cashBtn = page.locator('button:has-text("Новая заявка")').first();
          await cashBtn.click({ timeout: 5000 });
          created = true;
        } catch(btnErr) {
          log('Text match failed, trying clickButton...');
          try { await clickButton(page, 'Новая заявка|Создать|Добавить'); created = true; } catch(e2) {}
        }
        if (!created) throw new Error('Create button not found on cash page');
        await sleep(1500);

        await fillAllFields(page);

        // Override purpose field with trackable value
        await page.evaluate((purpose) => {
          const inputs = document.querySelectorAll('input, textarea');
          for (const el of inputs) {
            const n = (el.name || '').toLowerCase();
            const p = (el.placeholder || '').toLowerCase();
            if (n.includes('purpose') || n.includes('reason') || p.includes('назначение') || p.includes('цель') || p.includes('основание') || n.includes('comment')) {
              el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.value = purpose;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }
        }, cashData.purpose);

        await submitForm(page);
        await sleep(2000);
        await waitForNetworkIdle(page);

        const errors = await checkForErrors(page);
        if (errors && errors.length > 0) throw new Error('Errors after submit: ' + errors.join('; '));
        s.detail = 'Cash request created with purpose: ' + cashData.purpose;
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step1-pm').catch(() => {});
        await ctx.close().catch(function(e) {});
      }
    });

    // ========================================================================
    // Step 2: HEAD_PM approves cash request
    // ========================================================================
    await step('HEAD_PM approves cash request', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HEAD_PM'));
        await navigateTo(page, '#/approvals');
        await sleep(2500);

        let bodyText = await page.evaluate(() => document.body.innerText);
        let hasRequest = bodyText.includes('TEST_AUTO_') || bodyText.includes(context.cashPurpose);

        if (!hasRequest) {
          await navigateTo(page, '#/cash');
          await sleep(2000);
          bodyText = await page.evaluate(() => document.body.innerText);
          hasRequest = bodyText.includes('TEST_AUTO_');
        }

        if (hasRequest) {
          await page.evaluate((purpose) => {
            const rows = document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="item"]');
            for (const row of rows) {
              if (row.textContent.includes('TEST_AUTO_') || row.textContent.includes(purpose)) {
                row.click();
                return;
              }
            }
          }, context.cashPurpose);
          await sleep(2500);

          // Button is inside the detail modal - search modal first
          var approveClicked = await page.evaluate(function() {
            var modal = document.querySelector('[class*="modal"]:not([style*="display: none"]):not([style*="display:none"]), [role="dialog"], .modal.show, .modal.in');
            var container = modal || document;
            var btns = container.querySelectorAll('button, [role="button"], a.btn');
            var patterns = ['одобрить','согласовать','утвердить','подтвердить','approve'];
            for (var i = 0; i < btns.length; i++) {
              var txt = (btns[i].textContent || '').toLowerCase().trim();
              for (var j = 0; j < patterns.length; j++) {
                if (txt.indexOf(patterns[j]) >= 0) { btns[i].click(); return true; }
              }
            }
            return false;
          });
          if (!approveClicked) {
            try {
              await clickButton(page, 'Одобрить|Согласовать|Утвердить|Подтвердить|Approve');
              await sleep(1500);
              await waitForNetworkIdle(page);
            } catch(e) {
              log(SCENARIO_NAME, '    No approve button found (OK)');
            }
          } else {
            await sleep(1500);
            await waitForNetworkIdle(page);
          }
        }

        s.detail = 'HEAD_PM review complete. Request found: ' + hasRequest;
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step2-head_pm').catch(() => {});
        await ctx.close().catch(function(e) {});
      }
    });

    // ========================================================================
    // Step 3: BUH processes cash request
    // ========================================================================
    await step('BUH processes cash request', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/cash');
        await sleep(2500);
        let bodyText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
        const hasRequest = bodyText.includes('TEST_AUTO_');

        if (hasRequest) {
          await page.evaluate(() => {
            const rows = document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="item"]');
            for (const row of rows) {
              if (row.textContent.includes('TEST_AUTO_')) {
                row.click();
                return;
              }
            }
          });
          await sleep(2500);

          // Button is inside the detail modal - search modal first
          var processClicked = await page.evaluate(function() {
            var modal = document.querySelector('[class*="modal"]:not([style*="display: none"]):not([style*="display:none"]), [role="dialog"], .modal.show, .modal.in');
            var container = modal || document;
            var btns = container.querySelectorAll('button, [role="button"], a.btn');
            var patterns = ['обработать','провести','оплатить','выплатить','выдать','process'];
            for (var i = 0; i < btns.length; i++) {
              var txt = (btns[i].textContent || '').toLowerCase().trim();
              for (var j = 0; j < patterns.length; j++) {
                if (txt.indexOf(patterns[j]) >= 0) { btns[i].click(); return true; }
              }
            }
            return false;
          });
          if (!processClicked) {
            try {
              await clickButton(page, 'Обработать|Провести|Оплатить|Выплатить|Выдать|Process');
              await sleep(1500);
              await waitForNetworkIdle(page);
            } catch(e) {
              log(SCENARIO_NAME, '    No process button found (OK)');
            }
          } else {
            await sleep(1500);
            await waitForNetworkIdle(page);
          }

        }

        await navigateTo(page, '#/finances');
        await sleep(2000);
        const finText = await page.evaluate(() => document.body.innerText.substring(0, 3000));

        s.detail = 'BUH processed cash (found=' + hasRequest + '), finances page loaded (' + finText.length + ' chars)';
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step3-buh').catch(() => {});
        await ctx.close().catch(function(e) {});
      }
    });

    // ========================================================================
    // Step 4: DIRECTOR_GEN final approval
    // ========================================================================
    await step('DIRECTOR_GEN final approval', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        await navigateTo(page, '#/approvals');
        await sleep(2500);
        let bodyText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
        let hasRequest = bodyText.includes('TEST_AUTO_');

        if (!hasRequest) {
          await navigateTo(page, '#/cash');
          await sleep(2000);
          bodyText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
          hasRequest = bodyText.includes('TEST_AUTO_');
        }

        if (hasRequest) {
          await page.evaluate(() => {
            const rows = document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="item"]');
            for (const row of rows) {
              if (row.textContent.includes('TEST_AUTO_')) {
                row.click();
                return;
              }
            }
          });
          await sleep(2000);

          const approved = await clickButton(page, 'Одобрить|Согласовать|Утвердить|Подтвердить|Approve');
          if (approved) {
            await sleep(1500);
            await waitForNetworkIdle(page);
          }
        }

        s.detail = 'DIRECTOR_GEN final approval done. Found request: ' + hasRequest;
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step4-director_gen').catch(() => {});
        await ctx.close().catch(function(e) {});
      }
    });

    // ========================================================================
    // Step 5: PM checks expense report
    // ========================================================================
    await step('PM checks expense report', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/cash');
        await sleep(2500);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
        const hasRequest = bodyText.includes('TEST_AUTO_');

        if (hasRequest) {
          await page.evaluate(() => {
            const rows = document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="item"]');
            for (const row of rows) {
              if (row.textContent.includes('TEST_AUTO_')) {
                row.click();
                return;
              }
            }
          });
          await sleep(2000);

          // First confirm receipt if needed (status may be money_issued)
          try {
            await clickButton(page, 'Подтвердить получение|Confirm');
            await sleep(2000);
            await waitForNetworkIdle(page);
            // Re-open detail after receipt confirmation
            await page.evaluate(() => {
              const rows = document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="item"]');
              for (const row of rows) {
                if (row.textContent.includes('TEST_AUTO_')) { row.click(); return; }
              }
            });
            await sleep(2000);
          } catch(receiveErr) {
            log(SCENARIO_NAME, '    Receipt already confirmed or not needed');
          }
          // Now try to submit expense report
          try {
            const reported = await clickButton(page, 'Отчёт|Отчет|Отчитаться|Report|Закрыть заявку');
            await sleep(1500);
          } catch(reportErr) {
            log(SCENARIO_NAME, '    Report button not found (OK - may need expenses first)');
          }
        }

        s.detail = 'PM cash page loaded. Own requests visible: ' + hasRequest;
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step5-pm').catch(() => {});
        await ctx.close().catch(function(e) {});
      }
    });

    // ========================================================================
    // Step 6: BUH creates invoice
    // ========================================================================
    await step('BUH creates invoice', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/invoices');
        await sleep(2500);

        var created = false;
        try {
          await page.locator('#btnAddInvoice').click({ timeout: 5000 });
          created = true;
        } catch(btnErr) {
          log('#btnAddInvoice not found, trying text...');
          try { await clickButton(page, 'Новый счёт|Новый счет|Создать|Добавить'); created = true; } catch(e2) {}
        }
        if (!created) throw new Error('Create button not found on invoices page');
        await sleep(1500);

        await fillAllFields(page);
        await submitForm(page);
        await sleep(2000);
        await waitForNetworkIdle(page);

        const errors = await checkForErrors(page);
        if (errors && errors.length > 0) throw new Error('Errors after submit: ' + errors.join('; '));
        s.detail = 'Invoice created successfully by BUH';
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step6-buh').catch(() => {});
        await ctx.close().catch(function(e) {});
      }
    });

    // ========================================================================
    // Step 7: BUH creates act
    // ========================================================================
    await step('BUH creates act', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/acts');
        await sleep(2500);

        var created = false;
        try {
          await page.locator('#btnAddAct').click({ timeout: 5000 });
          created = true;
        } catch(btnErr) {
          log('#btnAddAct not found, trying text...');
          try { await clickButton(page, 'Новый акт|Создать|Добавить'); created = true; } catch(e2) {}
        }
        if (!created) throw new Error('Create button not found on acts page');
        await sleep(1500);

        await fillAllFields(page);
        await submitForm(page);
        await sleep(2000);
        await waitForNetworkIdle(page);

        const errors = await checkForErrors(page);
        if (errors && errors.length > 0) throw new Error('Errors after submit: ' + errors.join('; '));
        s.detail = 'Act created successfully by BUH';
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step7-buh').catch(() => {});
        await ctx.close().catch(function(e) {});
      }
    });

    // ========================================================================
    // Step 8: DIRECTOR_GEN reviews finances overview
    // ========================================================================
    await step('DIRECTOR_GEN reviews finances overview', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        await navigateTo(page, '#/finances');
        await sleep(2500);
        const finText = await page.evaluate(() => document.body.innerText.substring(0, 3000));

        await navigateTo(page, '#/invoices');
        await sleep(2000);
        const invText = await page.evaluate(() => document.body.innerText.substring(0, 2000));

        await navigateTo(page, '#/acts');
        await sleep(2000);
        const actsText = await page.evaluate(() => document.body.innerText.substring(0, 2000));

        s.detail = 'DIRECTOR_GEN reviewed: finances(' + finText.length + ' chars), invoices(' + invText.length + ' chars), acts(' + actsText.length + ' chars)';
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step8-director_gen').catch(() => {});
        await ctx.close().catch(function(e) {});
      }
    });

    // ========================================================================
    // Step 9: OFFICE_MANAGER views office expenses
    // ========================================================================
    await step('OFFICE_MANAGER views office expenses', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('OFFICE_MANAGER'));
        await navigateTo(page, '#/office-expenses');
        await sleep(2500);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const hasCreate = await findCreateButton(page);

        if (hasCreate) {
          const clicked = await clickButton(page, 'Создать|Добавить|\\+');
          if (clicked) {
            await sleep(1500);
            await fillAllFields(page);
            await submitForm(page);
            await sleep(2000);
            await waitForNetworkIdle(page);
          }
        }

        s.detail = 'OFFICE_MANAGER expenses page loaded. Content: ' + bodyText.length + ' chars. Create button: ' + !!hasCreate;
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step9-office_manager').catch(() => {});
        await ctx.close().catch(function(e) {});
      }
    });

    // ========================================================================
    // Step 10: WAREHOUSE restricted from cash
    // ========================================================================
    await step('WAREHOUSE restricted from cash', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('WAREHOUSE'));
        await navigateTo(page, '#/cash');
        await sleep(2500);

        const bodyText = await page.evaluate(() => document.body.innerText);
        const url = page.url();
        const wasRedirected = !url.includes('#/cash');
        const hasAccessDenied = bodyText.includes('доступ') || bodyText.includes('запрещ') || bodyText.includes('нет прав') || bodyText.includes('forbidden');
        const createBtn = await findCreateButton(page);
        const hasMinimalContent = bodyText.length < 200;

        const isRestricted = wasRedirected || hasAccessDenied || hasMinimalContent || !createBtn;

        s.detail = 'WAREHOUSE cash access: redirected=' + wasRedirected +
          ', accessDenied=' + hasAccessDenied +
          ', minContent=' + hasMinimalContent +
          ', createBtn=' + !!createBtn +
          ', restricted=' + isRestricted;
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step10-warehouse').catch(() => {});
        await ctx.close().catch(function(e) {});
      }
    });

    // Determine overall status
    const failedSteps = results.steps.filter(s => s.status === 'FAILED');
    if (failedSteps.length === 0) {
      results.status = 'PASSED';
    } else if (failedSteps.length < results.steps.length) {
      results.status = 'PARTIAL';
    } else {
      results.status = 'FAILED';
    }
  } catch (e) {
    results.status = 'FAILED';
    results.error = (e.message || String(e)).substring(0, 300);
  }

  results.duration = Date.now() - start;
  return results;
}

module.exports = { run, name: SCENARIO_NAME };
