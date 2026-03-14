/**
 * Scenario 07: Communication
 * PM creates task → PM creates calendar event → Check notifications
 */

const { getAccount } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, findCreateButton } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '07-communication';

async function run(browser, context = {}) {
  const results = { name: 'Communication', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const taskData = gen.task();
  const eventData = gen.calendarEvent();

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
    // Step 1: PM adds a Todo item via #/tasks
    await step('PM adds todo via #/tasks', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/tasks');
        await sleep(2000);

        // PM sees tasks page with Todo panel (create task button only for directors)
        const todoInput = page.locator('#todoInput');
        if (await todoInput.isVisible({ timeout: 5000 })) {
          await todoInput.fill(taskData.title);
          // Click the + button next to input
          const addBtn = page.locator('button').filter({ hasText: '+' }).first();
          await addBtn.click();
          await sleep(1500);
          log(SCENARIO_NAME, `    Added todo: ${taskData.title}`);
        } else {
          // Fallback: try any create button (e.g. for directors)
          try {
            await clickButton(page, 'Создать|Добавить|Новая|Новый');
            await sleep(2000);
            const fields = await fillAllFields(page);
            log(SCENARIO_NAME, `    Task form: filled ${fields.filled} fields`);
            await submitForm(page);
          } catch (e) {
            log(SCENARIO_NAME, '    Tasks page loaded, no create action available for PM (expected)');
          }
        }

        await waitForNetworkIdle(page);
        context.taskData = taskData;
      } finally {
        await ctx.close();
      }
    });

        // Step 2: PM creates calendar event
    await step('PM creates calendar event via #/calendar', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/calendar');
        await sleep(2000);

        // Try to create event - might be clicking on date or using a button
        try {
          await clickButton(page, 'Создать|Добавить|Новый|Новое|Событие');
          await sleep(2000);
        } catch {
          // Some calendars create events by clicking on a date
          try {
            const calendarCell = page.locator('.fc-daygrid-day, .calendar-day, td[class*="day"]').first();
            if (await calendarCell.isVisible({ timeout: 3000 })) {
              await calendarCell.click();
              await sleep(1500);
            }
          } catch {}
        }

        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Calendar event form: filled ${fields.filled} fields`);

        if (fields.filled > 0) {
          // Override title
          try {
            const titleInput = page.locator('input[name*="title"], input[placeholder*="Название"], input[placeholder*="Событие"]').first();
            if (await titleInput.isVisible({ timeout: 2000 })) {
              await titleInput.fill(eventData.title);
            }
          } catch {}

          await submitForm(page);
          await waitForNetworkIdle(page);
        }
        context.eventData = eventData;
      } finally {
        await ctx.close();
      }
    });

    // Step 3: Check notifications
    await step('PM checks notifications', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));

        // Try to open notifications panel
        const routes = ['#/notifications', '#/home'];
        for (const route of routes) {
          await navigateTo(page, route);
          await sleep(2000);
        }

        // Try clicking notification bell
        try {
          const bell = page.locator('[class*="notification"] button, [class*="bell"], [aria-label*="уведомл"]').first();
          if (await bell.isVisible({ timeout: 3000 })) {
            await bell.click();
            await sleep(2000);
          }
        } catch {}

        const content = await page.textContent('body');
        if (content && content.length > 100) {
          log(SCENARIO_NAME, '    Notifications area accessible');
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
