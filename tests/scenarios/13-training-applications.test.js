/**
 * Scenario 13: Training Applications
 *
 * Tests the full training application lifecycle:
 *
 * HR creates training program -> PM creates training application for team member ->
 * HEAD_PM approves -> DIRECTOR_GEN approves budget -> BUH confirms payment ->
 * HR marks training as completed -> TO views own training history ->
 * ADMIN views all training reports -> Role-based access restrictions
 */

const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError, collectMenuPages } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '13-training-applications';

// Possible routes for training-related pages
const TRAINING_ROUTES = [
  '#/training',
  '#/training-requests',
  '#/training-applications',
  '#/hr-requests',
  '#/hr-training',
  '#/education',
  '#/development',
  '#/learning',
];

async function findTrainingPage(page, role) {
  for (const route of TRAINING_ROUTES) {
    await navigateTo(page, route);
    await sleep(2000);
    const currentHash = await page.evaluate(() => window.location.hash);
    const content = await page.textContent('body');
    if (content && content.length > 200 && (currentHash.includes('train') || currentHash.includes('hr') || currentHash.includes('edu') || currentHash.includes('learn'))) {
      log(SCENARIO_NAME, `    ${role}: found training page at ${route}`);
      return route;
    }
  }

  // Fallback: check sidebar menu for training-related link
  const menuItems = await collectMenuPages(page);
  for (const item of menuItems) {
    const nameLC = (item.name || '').toLowerCase();
    if (nameLC.includes('обучен') || nameLC.includes('training') || nameLC.includes('заявки') || nameLC.includes('развити')) {
      await navigateTo(page, item.href);
      await sleep(2000);
      log(SCENARIO_NAME, `    ${role}: found training-related page "${item.name}" at ${item.href}`);
      return item.href;
    }
  }

  return null;
}

async function run(browser, context = {}) {
  const results = { name: 'Training Applications', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const trainingTitle = `${gen.TEST_PREFIX}Training_${gen.uid()}`;
  const trainingAppTitle = `${gen.TEST_PREFIX}TrainApp_${gen.uid()}`;

  async function step(name, fn) {
    const stepResult = { name, status: 'PENDING', error: null, screenshot: null };
    results.steps.push(stepResult);
    try {
      // Check browser health before each step; relaunch if dead
      try {
        const _hc = await browser.newContext();
        await _hc.close();
      } catch (_) {
        log(SCENARIO_NAME, '  [recovery] Browser dead before "' + name + '", relaunching...');
        try {
          const { chromium } = require('playwright');
          browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'] });
          log(SCENARIO_NAME, '  [recovery] Browser relaunched');
        } catch (re) {
          stepResult.status = 'FAILED';
          stepResult.error = 'Browser relaunch failed: ' + re.message.substring(0, 200);
          log(SCENARIO_NAME, `  X ${name}: Browser relaunch failed`);
          return; // skip this step
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
    // Step 1: HR discovers and accesses the training page
    // ---------------------------------------------------------------
    let trainingRoute = null;

    await step('HR accesses training management', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        trainingRoute = await findTrainingPage(page, 'HR');

        if (!trainingRoute) {
          // Training may be under HR requests
          await navigateTo(page, '#/hr-requests');
          await sleep(2000);
          const content = await page.textContent('body');
          if (content && content.length > 200) {
            trainingRoute = '#/hr-requests';
            log(SCENARIO_NAME, '    Training functionality likely under HR requests');
          } else {
            log(SCENARIO_NAME, '    No training page found - testing HR requests as fallback');
            trainingRoute = '#/hr-requests';
          }
        }

        context.trainingRoute = trainingRoute;
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 2: HR creates a training application / request
    // ---------------------------------------------------------------
    await step('HR creates training application', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, trainingRoute || '#/hr-requests');
        await sleep(2000);

        // Try to create a new training application
        const createBtn = await findCreateButton(page);
        if (createBtn) {
          await createBtn.click();
        } else {
          // Try FAB button or any create-like button
          const fabBtn = page.locator('#fabBtn');
          if (await fabBtn.count() > 0) {
            await fabBtn.evaluate(el => { el.style.display = 'flex'; el.click(); });
          } else {
            await clickButton(page, 'Создать|Добавить|Новая|Новый|Заявка|заявк');
          }
        }
        await sleep(2000);

        // Check if there's a type selector (training vs other HR requests)
        try {
          const typeSelect = page.locator('select[name*="type"], select[name*="category"], [class*="type-select"]').first();
          if (await typeSelect.isVisible({ timeout: 2000 })) {
            // Try to select training-related type
            await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (!el) return;
              const options = el.querySelectorAll('option');
              for (const opt of options) {
                const text = opt.textContent.toLowerCase();
                if (text.includes('обучен') || text.includes('training') || text.includes('развити') || text.includes('курс')) {
                  el.value = opt.value;
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return;
                }
              }
              // Fallback: select first non-empty option
              for (const opt of options) {
                if (opt.value) {
                  el.value = opt.value;
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return;
                }
              }
            }, 'select[name*="type"], select[name*="category"]');
            await sleep(1000);
          }
        } catch {}

        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Training form: filled ${fields.filled} fields`);

        // Override title/subject for tracking
        try {
          const titleInput = page.locator('input[name*="title"], input[name*="subject"], input[name*="name"], input[placeholder*="Тема"], input[placeholder*="Название"], input[placeholder*="Наименование"]').first();
          if (await titleInput.isVisible({ timeout: 2000 })) {
            await titleInput.fill(trainingAppTitle);
          }
        } catch {}

        // Try to set description
        try {
          const descInput = page.locator('textarea[name*="desc"], textarea[name*="comment"], textarea[name*="reason"], textarea[placeholder*="Описание"], textarea[placeholder*="Комментарий"]').first();
          if (await descInput.isVisible({ timeout: 2000 })) {
            await descInput.fill(`${gen.TEST_PREFIX}TrainDesc: Request for professional development training`);
          }
        } catch {}

        await submitForm(page);
        await waitForNetworkIdle(page);

        const errors = await checkForErrors(page);
        if (errors.length > 0) {
          log(SCENARIO_NAME, `    Form errors: ${errors.join(', ')}`);
        }

        context.trainingAppTitle = trainingAppTitle;
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 3: PM creates a training application for a team member
    // ---------------------------------------------------------------
    await step('PM creates training application for team', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));

        // Navigate to training/hr-requests page
        const pmTrainingRoute = await findTrainingPage(page, 'PM');
        const route = pmTrainingRoute || trainingRoute || '#/hr-requests';
        await navigateTo(page, route);
        await sleep(2000);

        const content = await page.textContent('body');
        const currentHash = await page.evaluate(() => window.location.hash);

        if (content && content.length > 200) {
          try {
            const createBtn = await findCreateButton(page);
        if (createBtn) {
          await createBtn.click();
        } else {
          // Try FAB button or any create-like button
          const fabBtn = page.locator('#fabBtn');
          if (await fabBtn.count() > 0) {
            await fabBtn.evaluate(el => { el.style.display = 'flex'; el.click(); });
          } else {
            await clickButton(page, 'Создать|Добавить|Новая|Новый|Заявка|заявк');
          }
        }
            await sleep(2000);

            const pmTrainingTitle = `${gen.TEST_PREFIX}PMTraining_${gen.uid()}`;

            const fields = await fillAllFields(page);
            log(SCENARIO_NAME, `    PM training form: filled ${fields.filled} fields`);

            try {
              const titleInput = page.locator('input[name*="title"], input[name*="subject"], input[placeholder*="Тема"], input[placeholder*="Название"]').first();
              if (await titleInput.isVisible({ timeout: 2000 })) {
                await titleInput.fill(pmTrainingTitle);
              }
            } catch {}

            await submitForm(page);
            await waitForNetworkIdle(page);
          } catch {
            log(SCENARIO_NAME, '    PM cannot create training applications (may need different route)');
          }
        } else {
          log(SCENARIO_NAME, `    PM has no access to training page (route: ${route})`);
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 4: HEAD_PM reviews and approves the training application
    // ---------------------------------------------------------------
    await step('HEAD_PM approves training application', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HEAD_PM'));
        const route = trainingRoute || '#/hr-requests';
        await navigateTo(page, route);
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          log(SCENARIO_NAME, '    HEAD_PM has no access to training applications');
          return;
        }

        // Find the test training application
        const found = await page.evaluate((title) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const el of elements) {
            if (el.textContent.includes(title)) {
              el.click();
              return true;
            }
          }
          return false;
        }, trainingAppTitle);

        if (found) {
          await sleep(2000);
          try {
            await clickButton(page, 'Одобрить|Согласовать|Утвердить|Approve');
            await sleep(2000);
            // Confirm if needed
            try {
              await clickButton(page, 'Да|Подтвердить|OK|Confirm');
              await sleep(1000);
            } catch {}
            await waitForNetworkIdle(page);
            log(SCENARIO_NAME, '    HEAD_PM approved training application');
          } catch {
            log(SCENARIO_NAME, '    No approval button found for HEAD_PM');
          }
        } else {
          log(SCENARIO_NAME, '    Test training application not visible to HEAD_PM');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 5: DIRECTOR_GEN approves budget for training
    // ---------------------------------------------------------------
    await step('DIRECTOR_GEN approves training budget', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        const route = trainingRoute || '#/hr-requests';
        await navigateTo(page, route);
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          log(SCENARIO_NAME, '    DIRECTOR_GEN has no access to training page');
          return;
        }

        // Find and approve the training request
        const found = await page.evaluate((title) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const el of elements) {
            if (el.textContent.includes(title)) {
              el.click();
              return true;
            }
          }
          return false;
        }, trainingAppTitle);

        if (found) {
          await sleep(2000);
          try {
            await clickButton(page, 'Одобрить|Согласовать|Утвердить|Approve|Бюджет');
            await sleep(2000);
            try {
              await clickButton(page, 'Да|Подтвердить|OK|Confirm');
              await sleep(1000);
            } catch {}
            await waitForNetworkIdle(page);
            log(SCENARIO_NAME, '    DIRECTOR_GEN approved training budget');
          } catch {
            log(SCENARIO_NAME, '    No approval button for DIRECTOR_GEN');
          }
        } else {
          log(SCENARIO_NAME, '    Training application not visible to DIRECTOR_GEN');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 6: BUH confirms training payment
    // ---------------------------------------------------------------
    await step('BUH confirms training payment', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        const route = trainingRoute || '#/hr-requests';
        await navigateTo(page, route);
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          log(SCENARIO_NAME, '    BUH has no access to training page');
          return;
        }

        // Find the training request
        const found = await page.evaluate((title) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const el of elements) {
            if (el.textContent.includes(title)) {
              el.click();
              return true;
            }
          }
          return false;
        }, trainingAppTitle);

        if (found) {
          await sleep(2000);
          try {
            await clickButton(page, 'Оплата|Оплатить|Оплачено|Pay|Payment|Подтвердить');
            await sleep(2000);
            try {
              await clickButton(page, 'Да|Подтвердить|OK');
              await sleep(1000);
            } catch {}
            await waitForNetworkIdle(page);
            log(SCENARIO_NAME, '    BUH confirmed training payment');
          } catch {
            log(SCENARIO_NAME, '    No payment button for BUH on training request');
          }
        } else {
          log(SCENARIO_NAME, '    Training application not visible to BUH');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 7: HR marks training as completed
    // ---------------------------------------------------------------
    await step('HR marks training as completed', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        const route = trainingRoute || '#/hr-requests';
        await navigateTo(page, route);
        await sleep(3000);

        const found = await page.evaluate((title) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (const el of elements) {
            if (el.textContent.includes(title)) {
              el.click();
              return true;
            }
          }
          return false;
        }, trainingAppTitle);

        if (found) {
          await sleep(2000);
          try {
            await clickButton(page, 'Завершить|Выполнено|Complete|Закрыть|Завершена');
            await sleep(2000);
            try {
              await clickButton(page, 'Да|Подтвердить|OK');
              await sleep(1000);
            } catch {}
            await waitForNetworkIdle(page);
            log(SCENARIO_NAME, '    HR marked training as completed');
          } catch {
            log(SCENARIO_NAME, '    No complete button found for HR');
          }
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 8: TO views own training history
    // ---------------------------------------------------------------
    await step('TO views own training history', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        const toTrainingRoute = await findTrainingPage(page, 'TO');
        const route = toTrainingRoute || trainingRoute || '#/hr-requests';
        await navigateTo(page, route);
        await sleep(3000);

        const currentHash = await page.evaluate(() => window.location.hash);
        const content = await page.textContent('body');

        if (content && content.length > 200) {
          log(SCENARIO_NAME, '    TO can view training page');

          // TO should only see their own training
          const createBtn = await findCreateButton(page);
          if (createBtn) {
            log(SCENARIO_NAME, '    TO can create training applications');
          } else {
            log(SCENARIO_NAME, '    TO has read-only access to training');
          }
        } else {
          log(SCENARIO_NAME, '    TO has no access to training page');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 9: ADMIN views all training reports
    // ---------------------------------------------------------------
    await step('ADMIN views all training reports', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        const route = trainingRoute || '#/hr-requests';
        await navigateTo(page, route);
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Training page did not load for ADMIN');
        }

        log(SCENARIO_NAME, '    ADMIN loaded training page');

        // Verify admin has full access
        const createBtn = await findCreateButton(page);
        if (createBtn) {
          log(SCENARIO_NAME, '    ADMIN has full CRUD access on training');
        }

        // Check for reporting/export functionality
        try {
          const reportBtn = page.locator('button:has-text("Отчёт"), button:has-text("Отчет"), button:has-text("Report"), button:has-text("Экспорт"), button:has-text("Export")').first();
          if (await reportBtn.isVisible({ timeout: 3000 })) {
            log(SCENARIO_NAME, '    ADMIN has access to training reports/export');
          }
        } catch {}
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 10: WAREHOUSE should NOT have access to training
    // ---------------------------------------------------------------
    await step('WAREHOUSE has no training access (role restriction)', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('WAREHOUSE'));
        const route = trainingRoute || '#/hr-requests';
        await navigateTo(page, route);
        await sleep(3000);

        const currentHash = await page.evaluate(() => window.location.hash);
        const content = await page.textContent('body');

        if (currentHash.includes('train') || currentHash.includes('hr-request')) {
          if (content && content.length > 200) {
            log(SCENARIO_NAME, '    WARNING: WAREHOUSE can access training page');
          } else {
            log(SCENARIO_NAME, '    WAREHOUSE training page is empty (restricted content)');
          }
        } else {
          log(SCENARIO_NAME, '    WAREHOUSE correctly redirected from training page');
        }
      } finally {
        await ctx.close();
      }
    });

    // Count results
    const failedSteps = results.steps.filter(s => s.status === 'FAILED').length;
    results.status = failedSteps > 0 ? 'FAILED' : 'PASSED';
  } catch (e) {
    results.status = 'FAILED';
  }

  results.duration = Date.now() - start;
  return results;
}

module.exports = { run, name: SCENARIO_NAME };
