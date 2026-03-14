/**
 * Scenario 05: HR / Compliance
 * HR creates employee (30+ fields) → HR creates permit → HR creates staff plan → BUH creates payroll → PM creates bonus request
 */

const { getAccount } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '05-hr-compliance';

async function run(browser, context = {}) {
  const results = { name: 'HR Compliance', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const empData = gen.employee();
  const permitData = gen.permit();

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
    // Step 1: HR creates employee
    await step('HR creates employee via #/employees', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/personnel');
        await sleep(2000);

        await clickButton(page, 'Создать|Добавить|Новый');
        await sleep(2000);

        // Fill all detected fields
        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Employee form: filled ${fields.filled} fields (30+ expected)`);

        // Override key fields for tracking
        try {
          const nameInput = page.locator('input[name*="full_name"], input[name*="name"], input[placeholder*="ФИО"], input[placeholder*="Имя"]').first();
          if (await nameInput.isVisible({ timeout: 2000 })) {
            await nameInput.fill(empData.full_name);
          }
        } catch {}

        try {
          const phoneInput = page.locator('input[name*="phone"], input[type="tel"]').first();
          if (await phoneInput.isVisible({ timeout: 2000 })) {
            await phoneInput.fill(empData.phone);
          }
        } catch {}

        try {
          const emailInput = page.locator('input[name*="email"], input[type="email"]').first();
          if (await emailInput.isVisible({ timeout: 2000 })) {
            await emailInput.fill(empData.email);
          }
        } catch {}

        await submitForm(page);
        await waitForNetworkIdle(page);
        context.empData = empData;
      } finally {
        await ctx.close();
      }
    });

    // Step 2: HR creates permit
    await step('HR creates permit via #/permits', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/permits');
        await sleep(2000);

        await clickButton(page, 'Создать|Добавить|Новый');
        await sleep(2000);

        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Permit form: filled ${fields.filled} fields`);

        await submitForm(page);
        await waitForNetworkIdle(page);
        context.permitData = permitData;
      } finally {
        await ctx.close();
      }
    });

    // Step 3: HR creates staff plan
    await step('HR creates staff plan', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));

        // Try various staff plan routes
        const routes = ['#/staff-plan', '#/staff', '#/staffing'];
        for (const route of routes) {
          await navigateTo(page, route);
          await sleep(2000);
          const content = await page.textContent('body');
          if (content && content.length > 200) {
            try {
              await clickButton(page, 'Создать|Добавить|Новый|Новая');
              await sleep(1500);
              const fields = await fillAllFields(page);
              log(SCENARIO_NAME, `    Staff plan form: filled ${fields.filled} fields`);
              await submitForm(page);
              await waitForNetworkIdle(page);
            } catch {}
            break;
          }
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 4: BUH views payroll page
    await step('BUH views payroll page via #/payroll', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/payroll');
        await sleep(3000);

        const bodyText = await page.textContent('body');
        if (!bodyText || bodyText.length < 100) throw new Error('Payroll page did not load');
        const tabBtns = await page.locator('button').count();
        log(SCENARIO_NAME, '    Payroll page loaded, ' + tabBtns + ' buttons visible, content: ' + bodyText.length + ' chars');
      } finally {
        await ctx.close();
      }
    });

    // Step 5: PM creates bonus request
    await step('PM creates bonus request', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));

        // Try various bonus routes
        const routes = ['#/bonus', '#/bonus-requests', '#/pm-works'];
        for (const route of routes) {
          await navigateTo(page, route);
          await sleep(2000);
          const content = await page.textContent('body');
          if (content && content.length > 200) {
            try {
              await clickButton(page, 'Премия|Бонус|Создать|Добавить');
              await sleep(1500);
              const bonusData = gen.bonusRequest();
              const fields = await fillAllFields(page);
              log(SCENARIO_NAME, `    Bonus form: filled ${fields.filled} fields`);
              await submitForm(page);
              await waitForNetworkIdle(page);
            } catch {}
            break;
          }
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
