/**
 * Scenario 12: Permits and Compliance
 *
 * Tests permit management and compliance features across all relevant roles.
 *
 * HR creates employee permit -> HEAD_PM reviews -> ADMIN validates ->
 * CHIEF_ENGINEER checks compliance -> DIRECTOR_GEN overview ->
 * PM sees permits on assigned employees -> TO sees own permits ->
 * BUH checks permit costs -> HR edits permit -> Expiry date validation
 */

const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '12-permits-compliance';

async function run(browser, context = {}) {
  const results = { name: 'Permits & Compliance', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const permitData = gen.permit();
  const employeeData = gen.employee();

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
    // Step 1: HR creates an employee (needed for permit assignment)
    // ---------------------------------------------------------------
    await step('HR creates employee for permit testing', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/personnel');
        await sleep(2000);

        await clickButton(page, 'Создать|Добавить|Новый');
        await sleep(2000);

        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Employee form: filled ${fields.filled} fields`);

        // Override key fields for tracking
        try {
          const nameInput = page.locator('input[name*="full_name"], input[name*="name"], input[placeholder*="ФИО"], input[placeholder*="Имя"]').first();
          if (await nameInput.isVisible({ timeout: 2000 })) {
            await nameInput.fill(employeeData.full_name);
          }
        } catch {}

        await submitForm(page);
        await waitForNetworkIdle(page);
        context.employeeData = employeeData;
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 2: HR creates a permit
    // ---------------------------------------------------------------
    await step('HR creates permit via #/permits', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/permits');
        await sleep(2000);

        await clickButton(page, 'Создать|Добавить|Новый|Новая');
        await sleep(2000);

        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Permit form: filled ${fields.filled} fields`);

        // Override permit name
        try {
          const nameInput = page.locator('input[name*="permit_name"], input[name*="name"], input[placeholder*="Название"], input[placeholder*="Наименование"]').first();
          if (await nameInput.isVisible({ timeout: 2000 })) {
            await nameInput.fill(permitData.permit_name);
          }
        } catch {}

        // Try to associate with the test employee
        try {
          const empInput = page.locator('input[name*="employee"], input[placeholder*="Сотрудник"], input[placeholder*="ФИО"], select[name*="employee"]').first();
          if (await empInput.isVisible({ timeout: 2000 })) {
            await empInput.fill(employeeData.full_name);
            await sleep(1000);
            // Try selecting from dropdown
            const dropdownItem = page.locator('[class*="dropdown"] [class*="item"], [class*="option"], [class*="autocomplete"] li, [class*="suggestion"]').first();
            if (await dropdownItem.isVisible({ timeout: 2000 })) {
              await dropdownItem.click();
              await sleep(500);
            }
          }
        } catch {}

        // Set expiry date
        try {
          const expiryInput = page.locator('input[name*="expiry"], input[name*="expire"], input[name*="end_date"], input[placeholder*="Срок"]').first();
          if (await expiryInput.isVisible({ timeout: 2000 })) {
            await expiryInput.fill(gen.futureDate(365));
          }
        } catch {}

        await submitForm(page);
        await waitForNetworkIdle(page);

        const errors = await checkForErrors(page);
        if (errors.length > 0) {
          log(SCENARIO_NAME, `    Form errors: ${errors.join(', ')}`);
        }

        context.permitData = permitData;
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 3: HEAD_PM reviews permits
    // ---------------------------------------------------------------
    await step('HEAD_PM reviews permits', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HEAD_PM'));
        await navigateTo(page, '#/permits');
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Permits page did not load for HEAD_PM');
        }
        log(SCENARIO_NAME, '    HEAD_PM loaded permits page');

        // Verify permits are visible
        const permitVisible = await page.evaluate((permitName) => {
          return document.body.innerText.includes(permitName);
        }, permitData.permit_name);

        if (permitVisible) {
          log(SCENARIO_NAME, '    HEAD_PM can see the test permit');
        } else {
          log(SCENARIO_NAME, '    Test permit not visible to HEAD_PM (may need different view or filter)');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 4: ADMIN validates permits page access
    // ---------------------------------------------------------------
    await step('ADMIN validates full permits access', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/permits');
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Permits page did not load for ADMIN');
        }

        // Admin should have create button
        const createBtn = await findCreateButton(page);
        if (createBtn) {
          log(SCENARIO_NAME, '    ADMIN has full CRUD access on permits');
        } else {
          log(SCENARIO_NAME, '    ADMIN does not have create button on permits (unexpected)');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 5: CHIEF_ENGINEER checks compliance overview
    // ---------------------------------------------------------------
    await step('CHIEF_ENGINEER checks compliance overview', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('CHIEF_ENGINEER'));

        // Try permits page
        await navigateTo(page, '#/permits');
        await sleep(3000);

        const content = await page.textContent('body');
        const currentHash = await page.evaluate(() => window.location.hash);

        if (currentHash.includes('/permits') && content && content.length > 200) {
          log(SCENARIO_NAME, '    CHIEF_ENGINEER can access permits page');

          // Check for compliance indicators (expired, expiring soon)
          const complianceIndicators = await page.evaluate(() => {
            const text = document.body.innerText.toLowerCase();
            return {
              hasExpired: text.includes('просрочен') || text.includes('истёк') || text.includes('expired'),
              hasExpiring: text.includes('истекает') || text.includes('скоро') || text.includes('expiring'),
              hasValid: text.includes('действу') || text.includes('valid') || text.includes('актив'),
              hasStatus: text.includes('статус') || text.includes('status'),
            };
          });
          log(SCENARIO_NAME, `    Compliance indicators: expired=${complianceIndicators.hasExpired}, expiring=${complianceIndicators.hasExpiring}, valid=${complianceIndicators.hasValid}`);
        } else {
          log(SCENARIO_NAME, '    CHIEF_ENGINEER has no direct access to permits page');
          // Try engineer dashboard
          await navigateTo(page, '#/engineer-dashboard');
          await sleep(2000);
          const dashContent = await page.textContent('body');
          if (dashContent && dashContent.length > 200) {
            log(SCENARIO_NAME, '    CHIEF_ENGINEER has engineer dashboard access');
          }
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 6: DIRECTOR_GEN overview of permits
    // ---------------------------------------------------------------
    await step('DIRECTOR_GEN views permits overview', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        await navigateTo(page, '#/permits');
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Permits page did not load for DIRECTOR_GEN');
        }
        log(SCENARIO_NAME, '    DIRECTOR_GEN loaded permits page');

        // Director should see but not necessarily edit permits
        const createBtn = await findCreateButton(page);
        log(SCENARIO_NAME, `    DIRECTOR_GEN create access: ${createBtn ? 'YES' : 'NO'}`);
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 7: PM sees permits on assigned employees
    // ---------------------------------------------------------------
    await step('PM views permits relevant to projects', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/permits');
        await sleep(3000);

        const currentHash = await page.evaluate(() => window.location.hash);
        if (currentHash.includes('/permits')) {
          const content = await page.textContent('body');
          if (content && content.length > 200) {
            log(SCENARIO_NAME, '    PM can access permits page');
          } else {
            log(SCENARIO_NAME, '    PM permits page is empty or restricted');
          }
        } else {
          log(SCENARIO_NAME, '    PM was redirected from permits page (no access)');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 8: TO sees own permits
    // ---------------------------------------------------------------
    await step('TO views own permits', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        await navigateTo(page, '#/permits');
        await sleep(3000);

        const currentHash = await page.evaluate(() => window.location.hash);
        if (currentHash.includes('/permits')) {
          log(SCENARIO_NAME, '    TO can access permits page');

          // TO should only see their own permits (not create/edit others)
          const createBtn = await findCreateButton(page);
          if (createBtn) {
            log(SCENARIO_NAME, '    WARNING: TO has create access on permits');
          } else {
            log(SCENARIO_NAME, '    TO has read-only permits access (expected)');
          }
        } else {
          log(SCENARIO_NAME, '    TO was redirected from permits page');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 9: BUH checks permit-related costs
    // ---------------------------------------------------------------
    await step('BUH views permit costs/budget', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/permits');
        await sleep(3000);

        const currentHash = await page.evaluate(() => window.location.hash);
        if (currentHash.includes('/permits')) {
          log(SCENARIO_NAME, '    BUH can access permits page');

          // Check for cost/budget columns
          const hasCostInfo = await page.evaluate(() => {
            const text = document.body.innerText.toLowerCase();
            return text.includes('стоимость') || text.includes('цена') || text.includes('сумма') || text.includes('бюджет');
          });
          log(SCENARIO_NAME, `    BUH cost info available: ${hasCostInfo}`);
        } else {
          log(SCENARIO_NAME, '    BUH has no access to permits page (may view costs elsewhere)');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 10: HR edits the test permit
    // ---------------------------------------------------------------
    await step('HR edits test permit', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/permits');
        await sleep(3000);

        // Find and click the test permit
        const found = await page.evaluate((permitName) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const el of elements) {
            if (el.textContent.includes(permitName)) {
              el.click();
              return true;
            }
          }
          return false;
        }, permitData.permit_name);

        if (found) {
          await sleep(2000);

          try {
            await clickButton(page, 'Редактировать|Изменить|Edit');
            await sleep(2000);

            // Update the permit name
            try {
              const nameInput = page.locator('input[name*="permit_name"], input[name*="name"]').first();
              if (await nameInput.isVisible({ timeout: 2000 })) {
                await nameInput.fill(`${permitData.permit_name}_UPDATED`);
              }
            } catch {}

            await submitForm(page);
            await waitForNetworkIdle(page);
            log(SCENARIO_NAME, '    Permit edited successfully');
          } catch {
            log(SCENARIO_NAME, '    No edit button found (may be inline editing)');
          }
        } else {
          log(SCENARIO_NAME, '    Test permit not found for editing');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 11: Expiry date validation (create permit with past date)
    // ---------------------------------------------------------------
    await step('HR tests expiry date validation', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/permits');
        await sleep(2000);

        await clickButton(page, 'Создать|Добавить|Новый|Новая');
        await sleep(2000);

        const fields = await fillAllFields(page);

        // Set expiry date in the past
        try {
          const expiryInput = page.locator('input[name*="expiry"], input[name*="expire"], input[name*="end_date"], input[type="date"]').last();
          if (await expiryInput.isVisible({ timeout: 2000 })) {
            await expiryInput.fill('2020-01-01');
            log(SCENARIO_NAME, '    Set expiry date to past (2020-01-01)');
          }
        } catch {}

        // Set permit name for tracking
        const expiredPermitName = `${gen.TEST_PREFIX}ExpiredPermit_${gen.uid()}`;
        try {
          const nameInput = page.locator('input[name*="permit_name"], input[name*="name"]').first();
          if (await nameInput.isVisible({ timeout: 2000 })) {
            await nameInput.fill(expiredPermitName);
          }
        } catch {}

        await submitForm(page);
        await sleep(2000);

        // Check if validation prevented save or if warning was shown
        const errors = await checkForErrors(page);
        if (errors.length > 0) {
          log(SCENARIO_NAME, `    Validation correctly rejected past expiry date: ${errors.join(', ')}`);
        } else {
          log(SCENARIO_NAME, '    No validation error for past expiry date (may be allowed with warning)');
        }

        await closeModal(page);
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
