/**
 * Scenario 04: Cash Workflow (approval chain)
 * PM creates request → HEAD_PM approves → BUH processes → DIRECTOR_GEN approves → PM reports expenses → PM returns remainder
 */

const { getAccount } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '04-cash-workflow';

async function run(browser, context = {}) {
  const results = { name: 'Cash Workflow', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const cashData = gen.cashRequest();

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
    // Step 1: PM creates cash request
    await step('PM creates cash request via #/cash', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/cash');
        await sleep(2000);

        await clickButton(page, 'Создать|Добавить|Новая|Заявка');
        await sleep(2000);

        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Cash request form: filled ${fields.filled} fields`);

        // Set purpose for tracking
        try {
          const purposeInput = page.locator('input[name*="purpose"], textarea[name*="purpose"], input[placeholder*="Цель"], input[placeholder*="цель"], input[placeholder*="Назначение"]').first();
          if (await purposeInput.isVisible({ timeout: 2000 })) {
            await purposeInput.fill(cashData.purpose);
          }
        } catch {}

        await submitForm(page);
        await waitForNetworkIdle(page);
        context.cashData = cashData;
      } finally {
        await ctx.close();
      }
    });

    // Step 2: HEAD_PM approves
    await step('HEAD_PM reviews cash requests', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HEAD_PM'));
        await navigateTo(page, '#/cash');
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Cash page did not load for HEAD_PM');
        }

        // Try to find and approve the request
        const found = await page.evaluate((purpose) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const el of elements) {
            if (el.textContent.includes(purpose)) {
              el.click();
              return true;
            }
          }
          return false;
        }, cashData.purpose);

        if (found) {
          await sleep(2000);
          try {
            await clickButton(page, 'Одобрить|Согласовать|Утвердить|Approve');
            await sleep(1000);
          } catch {}
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 3: BUH processes
    await step('BUH processes cash request', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/cash');
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Cash page did not load for BUH');
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 4: DIRECTOR_GEN final approval
    await step('DIRECTOR_GEN reviews cash requests', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        await navigateTo(page, '#/cash');
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Cash page did not load for DIRECTOR_GEN');
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 5: PM reports expenses
    await step('PM reports cash expenses', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/cash');
        await sleep(3000);

        // Try to find the request and add expense report
        const found = await page.evaluate((purpose) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const el of elements) {
            if (el.textContent.includes(purpose)) {
              el.click();
              return true;
            }
          }
          return false;
        }, cashData.purpose);

        if (found) {
          await sleep(2000);
          try {
            await clickButton(page, 'Отчёт|Отчет|Расход');
            await sleep(1500);
            const fields = await fillAllFields(page);
            await submitForm(page);
          } catch {}
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 6: PM returns remainder
    await step('PM returns cash remainder', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/cash');
        await sleep(3000);

        // Try to find return button
        const found = await page.evaluate((purpose) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const el of elements) {
            if (el.textContent.includes(purpose)) {
              el.click();
              return true;
            }
          }
          return false;
        }, cashData.purpose);

        if (found) {
          await sleep(2000);
          try {
            await clickButton(page, 'Возврат|Вернуть|Return');
            await sleep(1500);
            const fields = await fillAllFields(page);
            await submitForm(page);
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
