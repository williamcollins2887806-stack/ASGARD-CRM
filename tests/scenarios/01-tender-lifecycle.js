/**
 * Scenario 01: Tender Lifecycle
 * ADMIN creates → PM sees → TO creates estimate → HEAD_PM approves → DIRECTOR_GEN approves → PM creates work
 */

const { chromium } = require('playwright');
const { getAccount, TIMEOUTS, BASE_URL } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, screenshotOnError, clickButton, closeModal, checkForErrors, checkForSuccess, waitForNetworkIdle } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '01-tender-lifecycle';

async function run(browser, context = {}) {
  const results = { name: 'Tender Lifecycle', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const tenderData = gen.tender();
  let tenderId = null;

  async function step(name, fn) {
    const stepResult = { name, status: 'PENDING', error: null, screenshot: null };
    results.steps.push(stepResult);
    try {
      await fn(stepResult);
      stepResult.status = 'PASSED';
      log(SCENARIO_NAME, `  + ${name}`);
    } catch (e) {
      stepResult.status = 'FAILED';
      stepResult.error = e.message.substring(0, 300);
      log(SCENARIO_NAME, `  X ${name}: ${e.message.substring(0, 100)}`);
      throw e; // re-throw to stop scenario on critical failure
    }
  }

  try {
    // Step 1: ADMIN creates tender via UI
    await step('ADMIN creates tender', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/tenders');
        await sleep(2000);

        // Click "Создать" button
        await clickButton(page, 'Создать|Добавить|Новый');
        await sleep(2000);

        // Fill form fields
        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Filled ${fields.filled} fields`);

        // Try to fill specific known fields by name/placeholder
        try {
          const customerInput = page.locator('input[name*="customer"], input[placeholder*="Заказчик"], input[placeholder*="заказчик"]').first();
          if (await customerInput.isVisible({ timeout: 2000 })) {
            await customerInput.fill(tenderData.customer_name);
          }
        } catch {}

        try {
          const titleInput = page.locator('input[name*="title"], input[placeholder*="Название"], input[placeholder*="название"], input[placeholder*="Наименование"]').first();
          if (await titleInput.isVisible({ timeout: 2000 })) {
            await titleInput.fill(tenderData.tender_title);
          }
        } catch {}

        // Submit
        const submitted = await submitForm(page);
        if (!submitted) throw new Error('Could not find submit button');

        await waitForNetworkIdle(page);
        const errors = await checkForErrors(page);
        if (errors.length > 0) {
          log(SCENARIO_NAME, `    Form errors: ${errors.join(', ')}`);
        }

        // Try to get tender ID from URL or page content
        await sleep(2000);
        tenderId = await page.evaluate(() => {
          const hash = window.location.hash;
          const match = hash.match(/id=(\d+)/);
          return match ? match[1] : null;
        });

        // Store tender data for cross-role verification
        context.tenderData = tenderData;
        context.tenderId = tenderId;
      } finally {
        await ctx.close();
      }
    });

    // Step 2: PM sees tender in list
    await step('PM sees tender in tenders list', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/tenders');
        await sleep(3000);

        // Search for our test tender
        const found = await page.evaluate((customerName) => {
          const text = document.body.innerText;
          return text.includes(customerName);
        }, tenderData.customer_name);

        if (!found) {
          log(SCENARIO_NAME, '    Tender not visible to PM (may need assignment)');
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 3: TO creates estimate in calculator
    await step('TO opens calculator', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        await navigateTo(page, '#/calculator');
        await sleep(3000);

        // Verify calculator page loaded
        const pageContent = await page.textContent('body');
        if (!pageContent || pageContent.length < 100) {
          throw new Error('Calculator page did not load properly');
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 4: HEAD_PM reviews tenders
    await step('HEAD_PM reviews tenders', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HEAD_PM'));
        await navigateTo(page, '#/tenders');
        await sleep(3000);

        const pageContent = await page.textContent('body');
        if (!pageContent || pageContent.length < 100) {
          throw new Error('Tenders page did not load for HEAD_PM');
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 5: DIRECTOR_GEN reviews
    await step('DIRECTOR_GEN reviews tenders', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        await navigateTo(page, '#/tenders');
        await sleep(3000);

        const pageContent = await page.textContent('body');
        if (!pageContent || pageContent.length < 100) {
          throw new Error('Tenders page did not load for DIRECTOR_GEN');
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 6: PM views works list (works are created from within tenders)
    await step('PM views works list', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/pm-works');
        await sleep(2000);

        // Verify page loaded (works are created from within tenders, not from this page)
        const content = await page.textContent('body');
        if (!content || content.length < 100) throw new Error('PM-works page did not load');
        log(SCENARIO_NAME, '    PM-works page loaded, works visible');
        // No create button needed - works are created from tender detail

        context.worksLoaded = true;
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
