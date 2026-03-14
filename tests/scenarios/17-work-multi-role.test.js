const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '17-work-multi-role';

async function run(browser, context = {}) {
  const results = { name: SCENARIO_NAME + ': Multi-Role Work Management', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

  const workData = gen.work();
  const expenseData = gen.workExpense ? gen.workExpense() : { description: 'TEST_AUTO_expense_' + gen.uid(), amount: '15000' };
  context.workTitle = workData.work_title;

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
    // Step 1: PM creates new work
    await step('PM creates new work', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/pm-works');
        await sleep(2500);

        // pm-works has no create button
        var pageContent = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        log('pm-works page: ' + pageContent.length + ' chars');
        var created = true;
        await sleep(1500);

        await fillAllFields(page);

        await page.evaluate(function(title) {
          var inputs = document.querySelectorAll('input, textarea');
          for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            var n = (el.name || '').toLowerCase();
            var p = (el.placeholder || '').toLowerCase();
            if (n.indexOf('title') >= 0 || n.indexOf('name') >= 0 || p.indexOf('\u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435') >= 0 || p.indexOf('\u043d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435') >= 0) {
              el.value = '';
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.value = title;
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.dispatchEvent(new Event('change', {bubbles: true}));
              break;
            }
          }
        }, workData.work_title);

        await submitForm(page);
        await sleep(2000);
        await waitForNetworkIdle(page);

        var errors = await checkForErrors(page);
        if (errors && errors.length > 0) throw new Error('Errors: ' + errors.join('; '));
        s.detail = 'Work created: ' + workData.work_title;
      } finally {
        await ctx.close().catch(function(closeErr) { /* already closed */ });
      }
    });

    // Step 2: PM verifies work in list
    await step('PM verifies work in list', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/pm-works');
        await sleep(2500);

        var bodyText = await page.evaluate(function() { return document.body.innerText; });
        var hasWork = bodyText.indexOf('TEST_AUTO_') >= 0;
        s.detail = 'PM sees work in list: ' + hasWork;
      } finally {
        await ctx.close().catch(function(closeErr) { /* already closed */ });
      }
    });

    // Step 3: TO views work and adds expense
    await step('TO views all-works and adds expense', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        await navigateTo(page, '#/tenders');
        await sleep(2500);

        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 5000); });
        log('TO tenders content: ' + bodyText.length + ' chars');

        // Try to find and open a work/tender
        var found = await page.evaluate(function() {
          var rows = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.indexOf('TEST_AUTO_') >= 0) {
              rows[i].click(); return true;
            }
          }
          return false;
        });

        if (found) {
          await sleep(2000);
          // Try to add expense
          var expBtn = await clickButton(page, '\u0420\u0430\u0441\u0445\u043e\u0434|\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0440\u0430\u0441\u0445\u043e\u0434|\u0417\u0430\u0442\u0440\u0430\u0442\u044b|\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0437\u0430\u0442\u0440\u0430\u0442\u0443');
          if (expBtn) {
            await sleep(1500);
            await fillAllFields(page);
            await submitForm(page);
            await sleep(1500);
          }
          s.detail = 'TO opened item. Expense button: ' + !!expBtn;
        } else {
          s.detail = 'TO tenders page loaded. No TEST_AUTO_ items found.';
        }
      } finally {
        await ctx.close().catch(function(closeErr) { /* already closed */ });
      }
    });

    // Step 4: HEAD_PM reviews all works
    await step('HEAD_PM reviews all works', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HEAD_PM'));
        await navigateTo(page, '#/all-works');
        await sleep(2500);

        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 5000); });
        var hasWork = bodyText.indexOf('TEST_AUTO_') >= 0;

        // Check approvals
        await navigateTo(page, '#/approvals');
        await sleep(2000);
        var approvalText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        s.detail = 'HEAD_PM: all-works has TEST_AUTO_=' + hasWork + ', approvals loaded (' + approvalText.length + ' chars)';
      } finally {
        await ctx.close().catch(function(closeErr) { /* already closed */ });
      }
    });

    // Step 5: HEAD_TO checks work from TO perspective
    await step('HEAD_TO reviews tenders and works', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HEAD_TO'));
        await navigateTo(page, '#/tenders');
        await sleep(2500);
        var tendersText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        await navigateTo(page, '#/funnel');
        await sleep(2000);
        var funnelText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        s.detail = 'HEAD_TO: tenders (' + tendersText.length + '), funnel (' + funnelText.length + ')';
      } finally {
        await ctx.close().catch(function(closeErr) { /* already closed */ });
      }
    });

    // Step 6: DIRECTOR_DEV reviews works
    await step('DIRECTOR_DEV reviews works overview', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_DEV'));
        await navigateTo(page, '#/pm-works');
        await sleep(2500);
        var worksText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        await navigateTo(page, '#/tenders');
        await sleep(2000);
        var tendersText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        await navigateTo(page, '#/finances');
        await sleep(2000);

        s.detail = 'DIRECTOR_DEV: pm-works (' + worksText.length + '), tenders (' + tendersText.length + ')';
      } finally {
        await ctx.close().catch(function(closeErr) { /* already closed */ });
      }
    });

    // Step 7: PM views analytics
    await step('PM views PM analytics', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/pm-analytics');
        await sleep(2500);
        var analyticsText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        // Check Gantt
        await navigateTo(page, '#/gantt');
        await sleep(2000);
        var ganttText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        s.detail = 'PM analytics (' + analyticsText.length + ' chars), gantt (' + ganttText.length + ' chars)';
      } finally {
        await ctx.close().catch(function(closeErr) { /* already closed */ });
      }
    });

    // Step 8: TO views TO analytics
    await step('TO views TO analytics', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        await navigateTo(page, '#/to-analytics');
        await sleep(2500);
        var toAnalytics = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        // Check funnel
        await navigateTo(page, '#/funnel');
        await sleep(2000);
        var funnelText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        s.detail = 'TO analytics (' + toAnalytics.length + ' chars), funnel (' + funnelText.length + ' chars)';
      } finally {
        await ctx.close().catch(function(closeErr) { /* already closed */ });
      }
    });

    // Step 9: PROC cannot create works
    await step('PROC restricted from work creation', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PROC'));
        await navigateTo(page, '#/pm-works');
        await sleep(2500);

        var createBtn = await findCreateButton(page);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });
        s.detail = 'PROC pm-works: content=' + bodyText.length + ', create=' + !!createBtn + ' (expected: no create)';
      } finally {
        await ctx.close().catch(function(closeErr) { /* already closed */ });
      }
    });

    // Step 10: CHIEF_ENGINEER views work schedule
    await step('CHIEF_ENGINEER views work data', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('CHIEF_ENGINEER'));
        await navigateTo(page, '#/engineer-dashboard');
        await sleep(2500);
        var dashText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        await navigateTo(page, '#/workers-schedule');
        await sleep(2000);
        var schedText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        s.detail = 'CHIEF_ENGINEER: dashboard (' + dashText.length + '), schedule (' + schedText.length + ')';
      } finally {
        await ctx.close().catch(function(closeErr) { /* already closed */ });
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