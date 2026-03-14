const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '21-director-reports';

async function run(browser, context = {}) {
  const results = { name: SCENARIO_NAME + ': Director Reports & Full Overview', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

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
    // Step 1: DIRECTOR_GEN full overview - all key pages
    await step('DIRECTOR_GEN full overview', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        var pages = ['#/home', '#/tenders', '#/all-works', '#/finances', '#/dashboard'];
        var report = [];
        for (var i = 0; i < pages.length; i++) {
          await navigateTo(page, pages[i]);
          await sleep(2000);
          var text = await page.evaluate(function() { return document.body.innerText.substring(0, 1000); });
          var errors = await checkForErrors(page);
          report.push(pages[i] + '=' + text.length + (errors && errors.length ? ' ERR' : ' OK'));
        }
        s.detail = report.join(', ');
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 2: DIRECTOR_GEN views cash and approvals
    await step('DIRECTOR_GEN reviews cash and approvals', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));

        await navigateTo(page, '#/cash');
        await sleep(2500);
        var cashText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        await navigateTo(page, '#/approvals');
        await sleep(2000);
        var approvalText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        await navigateTo(page, '#/invoices');
        await sleep(2000);
        var invText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        s.detail = 'Cash=' + cashText.length + ', approvals=' + approvalText.length + ', invoices=' + invText.length;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 3: DIRECTOR_COMM full overview
    await step('DIRECTOR_COMM full overview', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_COMM'));
        var pages = ['#/home', '#/tenders', '#/all-works', '#/finances', '#/funnel'];
        var report = [];
        for (var i = 0; i < pages.length; i++) {
          await navigateTo(page, pages[i]);
          await sleep(2000);
          var text = await page.evaluate(function() { return document.body.innerText.substring(0, 1000); });
          var errors = await checkForErrors(page);
          report.push(pages[i] + '=' + text.length + (errors && errors.length ? ' ERR' : ' OK'));
        }
        s.detail = report.join(', ');
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 4: DIRECTOR_DEV full overview
    await step('DIRECTOR_DEV full overview', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_DEV'));
        var pages = ['#/home', '#/tenders', '#/pm-works', '#/finances'];
        var report = [];
        for (var i = 0; i < pages.length; i++) {
          await navigateTo(page, pages[i]);
          await sleep(2000);
          var text = await page.evaluate(function() { return document.body.innerText.substring(0, 1000); });
          var errors = await checkForErrors(page);
          report.push(pages[i] + '=' + text.length + (errors && errors.length ? ' ERR' : ' OK'));
        }
        s.detail = report.join(', ');
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 5: All 3 directors can view personnel
    await step('Directors view personnel section', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      var report = [];
      try {
        var directors = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
        for (var i = 0; i < directors.length; i++) {
          await loginAs(page, getAccount(directors[i]));
          await navigateTo(page, '#/personnel');
          await sleep(2000);
          var text = await page.evaluate(function() { return document.body.innerText.substring(0, 1500); });
          report.push(directors[i] + '=' + text.length);
          // Navigate away before next login
          await navigateTo(page, '#/home');
          await sleep(1000);
        }
        s.detail = 'Personnel access: ' + report.join(', ');
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 6: DIRECTOR_GEN views permits and procurement
    await step('DIRECTOR_GEN views permits and procurement', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));

        await navigateTo(page, '#/permits');
        await sleep(2000);
        var permText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        await navigateTo(page, '#/proc-requests');
        await sleep(2000);
        var procText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        await navigateTo(page, '#/warehouse');
        await sleep(2000);
        var whText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        s.detail = 'Permits=' + permText.length + ', proc=' + procText.length + ', warehouse=' + whText.length;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 7: ADMIN views settings and manages users
    await step('ADMIN settings and user management', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/settings');
        await sleep(2500);
        var settingsText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        // Count menu items available to admin
        var menuItems = await page.evaluate(function() {
          var links = document.querySelectorAll('aside a[href^="#/"]');
          return links.length;
        });

        s.detail = 'Settings=' + settingsText.length + ' chars, menu items=' + menuItems;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 8: Compare menu items across all director roles
    await step('Compare menu items across roles', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      var report = [];
      try {
        var roles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'HEAD_TO', 'PM', 'TO', 'HR', 'BUH'];
        for (var i = 0; i < roles.length; i++) {
          await loginAs(page, getAccount(roles[i]));
          await sleep(1500);
          var menuCount = await page.evaluate(function() {
            var links = document.querySelectorAll('aside a[href^="#/"]');
            return links.length;
          });
          report.push(roles[i] + '=' + menuCount);
          await navigateTo(page, '#/home');
          await sleep(500);
        }
        s.detail = 'Menu items: ' + report.join(', ');
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 9: DIRECTOR_GEN views big-screen mode
    await step('DIRECTOR_GEN big-screen presentation mode', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        await navigateTo(page, '#/big-screen');
        await sleep(3000);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasCharts = await page.evaluate(function() {
          return document.querySelectorAll('canvas, svg, [class*="chart"], [class*="graph"]').length;
        });
        s.detail = 'Big-screen: ' + bodyText.length + ' chars, chart elements: ' + hasCharts;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 10: Full page load verification for all 14 roles
    await step('All 14 roles can login and load home', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      var passed = 0;
      var failed = [];
      try {
        var roles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'HEAD_TO', 'PM', 'TO', 'HR', 'BUH', 'OFFICE_MANAGER', 'PROC', 'WAREHOUSE', 'CHIEF_ENGINEER'];
        for (var i = 0; i < roles.length; i++) {
          try {
            await loginAs(page, getAccount(roles[i]));
            await sleep(1500);
            var url = page.url();
            if (url.indexOf('#/home') >= 0 || url.indexOf('#/') >= 0) {
              passed++;
            } else {
              failed.push(roles[i] + ':bad_url');
            }
            await navigateTo(page, '#/home');
            await sleep(500);
          } catch (loginErr) {
            failed.push(roles[i] + ':' + loginErr.message.substring(0, 50));
          }
        }
        if (failed.length > 0) throw new Error('Failed logins: ' + failed.join(', '));
        s.detail = 'All ' + passed + '/14 roles logged in successfully';
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
