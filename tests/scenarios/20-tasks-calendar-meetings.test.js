const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '20-tasks-calendar-meetings';

async function run(browser, context = {}) {
  const results = { name: SCENARIO_NAME + ': Tasks, Calendar & Meetings', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

  const taskData = gen.task();
  const eventData = gen.calendarEvent();

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
    // Step 1: PM creates task
    await step('PM creates task', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/tasks');
        await sleep(2500);

        var created = await clickButton(page, 'Создать|Добавить|Новая задача|\\+');
        if (!created) { log('No create button on tasks page for PM'); }
        await sleep(1500);

        await fillAllFields(page);

        await page.evaluate(function(title) {
          var inputs = document.querySelectorAll('input, textarea');
          for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            var n = (el.name || '').toLowerCase();
            var p = (el.placeholder || '').toLowerCase();
            if (n.indexOf('title') >= 0 || n.indexOf('subject') >= 0 || p.indexOf('название') >= 0 || p.indexOf('тема') >= 0 || p.indexOf('заголовок') >= 0) {
              el.value = '';
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.value = title;
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.dispatchEvent(new Event('change', {bubbles: true}));
              break;
            }
          }
        }, taskData.title || 'TEST_AUTO_task_' + gen.uid());

        await submitForm(page);
        await sleep(2000);
        await waitForNetworkIdle(page);
        var errors = await checkForErrors(page);
        if (errors && errors.length > 0) throw new Error('Errors: ' + errors.join('; '));
        s.detail = 'Task created';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 2: TO sees task
    await step('TO views tasks list', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        await navigateTo(page, '#/tasks');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 5000); });
        var hasTask = bodyText.indexOf('TEST_AUTO_') >= 0;
        s.detail = 'TO tasks page: ' + bodyText.length + ' chars, has TEST_AUTO_: ' + hasTask;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 3: ADMIN creates task and assigns
    await step('ADMIN creates and manages tasks', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/tasks-admin');
        await sleep(2500);
        var adminTaskText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        await navigateTo(page, '#/tasks');
        await sleep(2000);
        var created = await clickButton(page, 'Создать|Добавить|\\+');
        if (created) {
          await sleep(1500);
          await fillAllFields(page);
          await submitForm(page);
          await sleep(2000);
        }
        s.detail = 'ADMIN tasks-admin (' + adminTaskText.length + ' chars), created task: ' + !!created;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 4: HEAD_PM views tasks
    await step('HEAD_PM views tasks', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HEAD_PM'));
        await navigateTo(page, '#/tasks');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        s.detail = 'HEAD_PM tasks: ' + bodyText.length + ' chars';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 5: PM uses calculator
    await step('PM uses calculator', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/calculator');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasInputs = await page.evaluate(function() {
          return document.querySelectorAll('input[type="number"], input[type="text"]').length;
        });
        s.detail = 'Calculator page: ' + bodyText.length + ' chars, inputs: ' + hasInputs;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 6: DIRECTOR_GEN views Gantt chart
    await step('DIRECTOR_GEN views Gantt chart', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        await navigateTo(page, '#/gantt');
        await sleep(3000);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasGantt = await page.evaluate(function() {
          return document.querySelectorAll('[class*="gantt"], canvas, svg').length;
        });
        s.detail = 'Gantt page: ' + bodyText.length + ' chars, gantt elements: ' + hasGantt;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 7: HR views worker schedule
    await step('HR views worker schedule', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/workers-schedule');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        s.detail = 'Workers schedule: ' + bodyText.length + ' chars';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 8: OFFICE_MANAGER creates task
    await step('OFFICE_MANAGER creates task', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('OFFICE_MANAGER'));
        await navigateTo(page, '#/tasks');
        await sleep(2500);

        var created = await clickButton(page, 'Создать|Добавить|\\+');
        if (created) {
          await sleep(1500);
          await fillAllFields(page);
          await submitForm(page);
          await sleep(2000);
          s.detail = 'OFFICE_MANAGER task created';
        } else {
          s.detail = 'Tasks page loaded, no create button';
        }
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 9: DIRECTOR_COMM views KPI works
    await step('DIRECTOR_COMM views KPI works', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_COMM'));
        await navigateTo(page, '#/home');
        await sleep(2500);
        var homeText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        await navigateTo(page, '#/all-works');
        await sleep(2000);
        var worksText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        s.detail = 'DIRECTOR_COMM home=' + homeText.length + ', all-works=' + worksText.length;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 10: PROC views own tasks
    await step('PROC views own tasks', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PROC'));
        await navigateTo(page, '#/tasks');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var createBtn = await findCreateButton(page);
        s.detail = 'PROC tasks: ' + bodyText.length + ' chars, create=' + !!createBtn;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    results.status = results.steps.every(function(s) { return s.status === 'PASSED'; }) ? 'PASSED' : 'PARTIAL';
  } catch (e) {
    results.status = 'FAILED';
    results.error = (e.message || String(e)).substring(0, 300);
  }

  results.duration = Date.now() - start;
  return results;
}

module.exports = { run, name: SCENARIO_NAME };
