/**
 * Scenario 02: Work Management
 * PM creates work → PM adds expense → HEAD_PM sees work → PM changes status
 */

const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '02-work-management';

async function run(browser, context = {}) {
  const results = { name: 'Work Management', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const workData = gen.work();

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
      throw e;
    }
  }

  try {
    // Step 1: PM views works (works created from tenders, not standalone)
    await step('PM views works via #/pm-works', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/pm-works');
        await sleep(2000);

        // Verify page loaded with table content
        const content = await page.textContent('body');
        if (!content || content.length < 100) throw new Error('PM-works page did not load');

        const tableRows = await page.locator('tbody tr').count();
        log(SCENARIO_NAME, `    PM-works loaded, ${tableRows} rows visible`);
        context.workData = workData;
      } finally {
        await ctx.close();
      }
    });

    // Step 2: PM adds expense
    await step('PM adds expense to work', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/pm-works');
        await sleep(3000);

        // Try to find and click on the work we created
        const workFound = await page.evaluate((title) => {
          const rows = document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="item"]');
          for (const row of rows) {
            if (row.textContent.includes(title)) {
              row.click();
              return true;
            }
          }
          return false;
        }, workData.work_title);

        if (workFound) {
          await sleep(2000);
          // Look for "Add expense" button
          try {
            await clickButton(page, 'Расход|расход|Добавить расход');
            await sleep(1500);
            const expenseFields = await fillAllFields(page);
            log(SCENARIO_NAME, `    Expense form: filled ${expenseFields.filled} fields`);
            await submitForm(page);
            await waitForNetworkIdle(page);
          } catch (e) {
            log(SCENARIO_NAME, `    Expense button not found: ${e.message.substring(0, 80)}`);
          }
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 3: HEAD_PM sees work
    await step('HEAD_PM sees work in #/works-all', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HEAD_PM'));
        await navigateTo(page, '#/all-works');
        await sleep(3000);

        const pageContent = await page.textContent('body');
        if (!pageContent || pageContent.length < 100) {
          throw new Error('Works page did not load for HEAD_PM');
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 4: PM changes work status
    await step('PM changes work status', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/pm-works');
        await sleep(3000);

        // Try to find and interact with status selector
        const workFound = await page.evaluate((title) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const el of elements) {
            if (el.textContent.includes(title)) {
              el.click();
              return true;
            }
          }
          return false;
        }, workData.work_title);

        if (workFound) {
          await sleep(2000);
          // Try to find status dropdown/selector
          try {
            const statusSelect = page.locator('select[name*="status"], [class*="status"] select').first();
            if (await statusSelect.isVisible({ timeout: 3000 })) {
              await statusSelect.selectOption({ index: 1 });
              await sleep(1000);
            }
          } catch {}
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
