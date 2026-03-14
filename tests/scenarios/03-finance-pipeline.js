/**
 * Scenario 03: Finance Pipeline
 * BUH creates invoice → BUH creates act → BUH records payment → DIRECTOR_GEN reviews
 */

const { getAccount } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '03-finance-pipeline';

async function run(browser, context = {}) {
  const results = { name: 'Finance Pipeline', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const invoiceData = gen.invoice();
  const actData = gen.act();

  async function step(name, fn) {
    const stepResult = { name, status: 'PENDING', error: null };
    results.steps.push(stepResult);
    try {
      await fn(stepResult);
      stepResult.status = 'PASSED';
      log(SCENARIO_NAME, `  + ${name}`);
    } catch (e) {
      stepResult.status = 'FAILED';
      stepResult.error = e.message.substring(0, 300);
      log(SCENARIO_NAME, `  X ${name}: ${e.message.substring(0, 100)}`);
      throw e;
    }
  }

  try {
    // Step 1: BUH creates invoice
    await step('BUH creates invoice via #/invoices', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/invoices');
        await sleep(2000);

        await clickButton(page, 'Создать|Добавить|Новый');
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

        await submitForm(page);
        await waitForNetworkIdle(page);
        context.invoiceData = invoiceData;
      } finally {
        await ctx.close();
      }
    });

    // Step 2: BUH creates act
    await step('BUH creates act via #/acts', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/acts');
        await sleep(2000);

        await clickButton(page, 'Создать|Добавить|Новый');
        await sleep(2000);

        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Act form: filled ${fields.filled} fields`);

        // Override name for tracking
        try {
          const nameInput = page.locator('input[name*="name"], input[placeholder*="Название"], input[placeholder*="Наименование"]').first();
          if (await nameInput.isVisible({ timeout: 2000 })) {
            await nameInput.fill(actData.name);
          }
        } catch {}

        await submitForm(page);
        await waitForNetworkIdle(page);
        context.actData = actData;
      } finally {
        await ctx.close();
      }
    });

    // Step 3: BUH records payment
    await step('BUH navigates to payment section', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));

        // Try various payment-related pages
        const pages = ['#/payments', '#/payment-registry', '#/invoices'];
        for (const route of pages) {
          await navigateTo(page, route);
          await sleep(2000);
          const content = await page.textContent('body');
          if (content && content.length > 100) {
            log(SCENARIO_NAME, `    Navigated to ${route}`);
            break;
          }
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 4: DIRECTOR_GEN reviews finance
    await step('DIRECTOR_GEN reviews finance pages', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));

        // Check invoices page
        await navigateTo(page, '#/invoices');
        await sleep(3000);
        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Invoices page did not load for DIRECTOR_GEN');
        }

        // Check acts page
        await navigateTo(page, '#/acts');
        await sleep(2000);
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
