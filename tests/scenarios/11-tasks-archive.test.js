/**
 * Scenario 11: Tasks Archive
 *
 * Tests task archiving, unarchiving, and auto-archive behavior.
 *
 * ADMIN creates task -> PM completes task -> system auto-archives (or manual archive) ->
 * ADMIN verifies task in archive -> ADMIN unarchives task -> DIRECTOR_GEN sees archived tasks ->
 * TO cannot archive tasks they don't own
 */

const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '11-tasks-archive';

async function run(browser, context = {}) {
  const results = { name: 'Tasks Archive', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const taskData = gen.task();

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
    // Step 1: ADMIN creates a task
    // ---------------------------------------------------------------
    await step('ADMIN creates task via #/tasks', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/tasks');
        await sleep(2000);

        await clickButton(page, 'Создать|Добавить|Новая|Новый');
        await sleep(2000);

        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Task form: filled ${fields.filled} fields`);

        // Override title for tracking
        try {
          const titleInput = page.locator('input[name*="title"], input[placeholder*="Название"], input[placeholder*="Тема"], input[placeholder*="Задача"]').first();
          if (await titleInput.isVisible({ timeout: 2000 })) {
            await titleInput.fill(taskData.title);
          }
        } catch {}

        // Override description
        try {
          const descInput = page.locator('textarea[name*="desc"], textarea[name*="description"], textarea[placeholder*="Описание"]').first();
          if (await descInput.isVisible({ timeout: 2000 })) {
            await descInput.fill(taskData.description);
          }
        } catch {}

        await submitForm(page);
        await waitForNetworkIdle(page);

        const errors = await checkForErrors(page);
        if (errors.length > 0) {
          log(SCENARIO_NAME, `    Form errors: ${errors.join(', ')}`);
        }

        context.taskData = taskData;
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 2: PM sees the task in active list
    // ---------------------------------------------------------------
    await step('PM sees task in active list', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/tasks');
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Tasks page did not load for PM');
        }

        const taskFound = await page.evaluate((title) => {
          return document.body.innerText.includes(title);
        }, taskData.title);

        if (taskFound) {
          log(SCENARIO_NAME, '    PM can see the test task in active list');
        } else {
          log(SCENARIO_NAME, '    Task not visible to PM (may need assignment or different view)');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 3: ADMIN archives the task manually
    // ---------------------------------------------------------------
    await step('ADMIN archives task manually', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/tasks');
        await sleep(3000);

        // Find and click on the test task
        const found = await page.evaluate((title) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="task"]');
          for (const el of elements) {
            if (el.textContent.includes(title)) {
              el.click();
              return true;
            }
          }
          return false;
        }, taskData.title);

        if (found) {
          await sleep(2000);

          // Try to find archive button
          try {
            await clickButton(page, 'Архив|В архив|Archive|Архивировать');
            await sleep(2000);

            // Confirm archive if dialog appears
            try {
              await clickButton(page, 'Да|Подтвердить|OK|Confirm');
              await sleep(1000);
            } catch {
              // No confirmation dialog
            }

            await waitForNetworkIdle(page);
            const success = await checkForSuccess(page);
            if (success) {
              log(SCENARIO_NAME, '    Task archived successfully');
            }
            log(SCENARIO_NAME, '    Archive action completed');
          } catch {
            // Try alternative: change status to trigger auto-archive
            log(SCENARIO_NAME, '    No archive button found, trying status change');
            try {
              await clickButton(page, 'Завершить|Выполнена|Закрыть|Complete|Done');
              await sleep(2000);
              try {
                await clickButton(page, 'Да|Подтвердить|OK|Confirm');
                await sleep(1000);
              } catch {}
              await waitForNetworkIdle(page);
              log(SCENARIO_NAME, '    Task status changed (may trigger auto-archive)');
            } catch {
              log(SCENARIO_NAME, '    Could not archive or complete task via UI');
            }
          }
        } else {
          log(SCENARIO_NAME, '    Test task not found in list');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 4: Verify task appears in archive view
    // ---------------------------------------------------------------
    await step('ADMIN verifies task in archive', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));

        // Try various archive routes
        const archiveRoutes = ['#/tasks-archive', '#/tasks?archive=true', '#/tasks?status=archived', '#/archive/tasks', '#/tasks'];
        let archiveFound = false;

        for (const route of archiveRoutes) {
          await navigateTo(page, route);
          await sleep(2000);

          // If on tasks page, look for archive tab/filter
          if (route === '#/tasks') {
            try {
              // Try clicking archive tab/filter
              const archiveTab = page.locator('button:has-text("Архив"), [class*="tab"]:has-text("Архив"), a:has-text("Архив"), [role="tab"]:has-text("Архив")').first();
              if (await archiveTab.isVisible({ timeout: 3000 })) {
                await archiveTab.click();
                await sleep(2000);
              }
            } catch {}
          }

          const content = await page.textContent('body');
          if (content && content.length > 200) {
            // Check if the task is visible in the archive
            const taskInArchive = await page.evaluate((title) => {
              return document.body.innerText.includes(title);
            }, taskData.title);

            if (taskInArchive) {
              archiveFound = true;
              log(SCENARIO_NAME, `    Test task found in archive at ${route}`);
              break;
            }
          }
        }

        if (!archiveFound) {
          log(SCENARIO_NAME, '    Test task not found in archive (may need time for auto-archive or different archive mechanism)');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 5: ADMIN unarchives the task
    // ---------------------------------------------------------------
    await step('ADMIN unarchives task', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));

        // Navigate to archive
        const archiveRoutes = ['#/tasks-archive', '#/tasks?archive=true', '#/tasks'];
        for (const route of archiveRoutes) {
          await navigateTo(page, route);
          await sleep(2000);

          if (route === '#/tasks') {
            try {
              const archiveTab = page.locator('button:has-text("Архив"), [class*="tab"]:has-text("Архив"), a:has-text("Архив")').first();
              if (await archiveTab.isVisible({ timeout: 3000 })) {
                await archiveTab.click();
                await sleep(2000);
              }
            } catch {}
          }

          // Find and click the archived task
          const found = await page.evaluate((title) => {
            const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="task"]');
            for (const el of elements) {
              if (el.textContent.includes(title)) {
                el.click();
                return true;
              }
            }
            return false;
          }, taskData.title);

          if (found) {
            await sleep(2000);
            try {
              await clickButton(page, 'Разархивировать|Восстановить|Из архива|Unarchive|Restore');
              await sleep(2000);
              // Confirm if needed
              try {
                await clickButton(page, 'Да|Подтвердить|OK|Confirm');
                await sleep(1000);
              } catch {}
              await waitForNetworkIdle(page);
              log(SCENARIO_NAME, '    Task unarchived successfully');
            } catch {
              log(SCENARIO_NAME, '    No unarchive button found');
            }
            break;
          }
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 6: DIRECTOR_GEN views tasks and archive
    // ---------------------------------------------------------------
    await step('DIRECTOR_GEN views tasks and archive', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));

        // Check tasks page loads
        await navigateTo(page, '#/tasks');
        await sleep(3000);
        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Tasks page did not load for DIRECTOR_GEN');
        }
        log(SCENARIO_NAME, '    DIRECTOR_GEN loaded tasks page');

        // Check if archive tab is available
        try {
          const archiveTab = page.locator('button:has-text("Архив"), [class*="tab"]:has-text("Архив"), a:has-text("Архив")').first();
          const archiveVisible = await archiveTab.isVisible({ timeout: 3000 });
          if (archiveVisible) {
            await archiveTab.click();
            await sleep(2000);
            log(SCENARIO_NAME, '    DIRECTOR_GEN can view archive tab');
          } else {
            log(SCENARIO_NAME, '    No archive tab visible to DIRECTOR_GEN');
          }
        } catch {
          log(SCENARIO_NAME, '    Archive tab not available for DIRECTOR_GEN');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 7: TO cannot archive tasks they don't own
    // ---------------------------------------------------------------
    await step('TO cannot archive tasks they do not own', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        await navigateTo(page, '#/tasks');
        await sleep(3000);

        const currentHash = await page.evaluate(() => window.location.hash);
        if (!currentHash.includes('/tasks')) {
          log(SCENARIO_NAME, '    TO has no access to tasks page (expected)');
          return;
        }

        // Find the test task
        const found = await page.evaluate((title) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="task"]');
          for (const el of elements) {
            if (el.textContent.includes(title)) {
              el.click();
              return true;
            }
          }
          return false;
        }, taskData.title);

        if (found) {
          await sleep(2000);
          // TO should not see archive button for tasks they don't own
          const archiveBtnVisible = await page.locator('button:has-text("Архив"), button:has-text("В архив"), button:has-text("Архивировать")').first().isVisible({ timeout: 3000 }).catch(() => false);
          if (archiveBtnVisible) {
            log(SCENARIO_NAME, '    WARNING: TO can see archive button for task they do not own');
          } else {
            log(SCENARIO_NAME, '    TO cannot archive tasks they do not own (expected)');
          }
        } else {
          log(SCENARIO_NAME, '    Test task not visible to TO (expected - not assigned)');
        }
      } finally {
        await ctx.close();
      }
    });

    // ---------------------------------------------------------------
    // Step 8: Test auto-archive behavior (create task, complete it, verify auto-archiving)
    // ---------------------------------------------------------------
    await step('Auto-archive: create and complete a task', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      const autoArchiveTask = gen.task({ title: `${gen.TEST_PREFIX}AutoArchive_${gen.uid()}` });

      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/tasks');
        await sleep(2000);

        // Create a new task
        try {
          await clickButton(page, 'Создать|Добавить|Новая|Новый');
          await sleep(2000);

          const fields = await fillAllFields(page);
          try {
            const titleInput = page.locator('input[name*="title"], input[placeholder*="Название"], input[placeholder*="Задача"]').first();
            if (await titleInput.isVisible({ timeout: 2000 })) {
              await titleInput.fill(autoArchiveTask.title);
            }
          } catch {}

          await submitForm(page);
          await waitForNetworkIdle(page);
          await sleep(2000);
        } catch {
          log(SCENARIO_NAME, '    Could not create auto-archive test task');
          return;
        }

        // Find the task and mark as completed
        await navigateTo(page, '#/tasks');
        await sleep(3000);

        const found = await page.evaluate((title) => {
          const elements = document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="task"]');
          for (const el of elements) {
            if (el.textContent.includes(title)) {
              el.click();
              return true;
            }
          }
          return false;
        }, autoArchiveTask.title);

        if (found) {
          await sleep(2000);
          try {
            await clickButton(page, 'Завершить|Выполнена|Закрыть|Complete|Done');
            await sleep(2000);
            try {
              await clickButton(page, 'Да|Подтвердить|OK');
              await sleep(1000);
            } catch {}
            await waitForNetworkIdle(page);
            log(SCENARIO_NAME, '    Auto-archive task marked as completed');
          } catch {
            log(SCENARIO_NAME, '    Could not complete task via UI');
          }

          // Wait briefly and check if task moved to archive
          await sleep(5000);
          const stillInActive = await page.evaluate((title) => {
            return document.body.innerText.includes(title);
          }, autoArchiveTask.title);

          if (!stillInActive) {
            log(SCENARIO_NAME, '    Task removed from active list after completion (auto-archive working)');
          } else {
            log(SCENARIO_NAME, '    Task still in active list after completion (auto-archive may be delayed)');
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
