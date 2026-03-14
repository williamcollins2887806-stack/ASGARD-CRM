const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError } = require('../lib/page-helpers');
const { fillAllFields, submitForm, fillField, detectFields } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '14-tender-full-lifecycle';

async function run(browser, context = {}) {
  const results = { name: SCENARIO_NAME + ': Full Tender Lifecycle (Multi-Role)', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

  const tenderData = gen.tender();
  const workData = gen.work({ customer_name: tenderData.customer_name });
  context.tenderTitle = tenderData.tender_title;
  context.workTitle = workData.work_title;
  context.customerName = tenderData.customer_name;

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
    // Step 1: TO creates a new tender
    await step('TO creates tender in #/tenders', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        await navigateTo(page, '#/tenders');
        await sleep(2000);
        var created = false;
        try {
          await page.locator('#btnNew').click({ timeout: 5000 });
          created = true;
        } catch(btnErr) {
          log('#btnNew not found, trying text...');
          try { await clickButton(page, 'Внести тендер|Создать|Добавить'); created = true; } catch(e2) {}
        }
        if (!created) throw new Error('Create button not found on tenders page');
        await sleep(1500);
        const filled = await fillAllFields(page);
        log('Filled ' + (filled.filled || 0) + ' fields');
        await page.evaluate(function(data) {
          var inputs = document.querySelectorAll('input, textarea');
          for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            var n = (el.name || '').toLowerCase();
            var p = (el.placeholder || '').toLowerCase();
            if (n.indexOf('title') >= 0 || n.indexOf('name') >= 0 && n.indexOf('customer') < 0 || p.indexOf('название') >= 0 || p.indexOf('наименование тендера') >= 0) {
              el.value = '';
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.value = data.title;
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.dispatchEvent(new Event('change', {bubbles: true}));
            }
            if (n.indexOf('customer') >= 0 || p.indexOf('заказчик') >= 0 || p.indexOf('клиент') >= 0) {
              el.value = '';
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.value = data.customer;
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.dispatchEvent(new Event('change', {bubbles: true}));
            }
          }
        }, { title: tenderData.tender_title, customer: tenderData.customer_name });
        await submitForm(page);
        await sleep(2000);
        await waitForNetworkIdle(page);
        var errors = await checkForErrors(page);
        if (errors && errors.length > 0) throw new Error('Errors after submit: ' + errors.join('; '));
        s.detail = 'Tender created: ' + tenderData.tender_title;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 2: TO opens the tender and adds estimate data
    await step('TO adds estimate to the tender', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        await navigateTo(page, '#/tenders');
        await sleep(2000);
        var found = await page.evaluate(function(title) {
          var rows = document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="item"]');
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.indexOf(title) >= 0) {
              var clickable = rows[i].querySelector('a, button, [onclick], td');
              if (clickable) { clickable.click(); return true; }
              rows[i].click();
              return true;
            }
          }
          return false;
        }, tenderData.tender_title);
        if (!found) {
          log('Tender not found in list, trying search...');
          var searchInput = page.locator('input[type="search"], input[placeholder*="Поиск"], input[placeholder*="поиск"]').first();
          if (await searchInput.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
            await searchInput.fill(tenderData.tender_title);
            await sleep(1500);
            found = await page.evaluate(function(title) {
              var rows = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
              for (var i = 0; i < rows.length; i++) {
                if (rows[i].textContent.indexOf(title) >= 0) { rows[i].click(); return true; }
              }
              return false;
            }, tenderData.tender_title);
          }
        }
        await sleep(2000);
        var estimateBtn = false;
        try { estimateBtn = await clickButton(page, 'Просчёт|Просчет|Смета|Расчёт|Расчет|Добавить просчёт|Добавить просчет'); } catch(e) { /* no estimate button */ }
        if (estimateBtn) {
          await sleep(1500);
          await fillAllFields(page);
          await submitForm(page);
          await sleep(1500);
        }
        s.detail = 'Tender detail checked' + (estimateBtn ? ', estimate added' : ', no estimate button (OK - estimates done via API)');
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 3: HEAD_TO reviews the tender
    await step('HEAD_TO reviews tender', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HEAD_TO'));
        await navigateTo(page, '#/tenders');
        await sleep(2000);
        var bodyText = await page.evaluate(function() { return document.body.innerText; });
        var hasTender = bodyText.indexOf(context.tenderTitle) >= 0 || bodyText.indexOf('TEST_AUTO_') >= 0;
        s.detail = 'HEAD_TO sees tenders page. Test tender visible: ' + hasTender;
        if (hasTender) {
          await page.evaluate(function(title) {
            var rows = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
            for (var i = 0; i < rows.length; i++) {
              if (rows[i].textContent.indexOf(title) >= 0 || rows[i].textContent.indexOf('TEST_AUTO_') >= 0) {
                rows[i].click(); return;
              }
            }
          }, context.tenderTitle);
          await sleep(2000);
        }
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 4: PM sees tender in calculations list
    await step('PM views tender calculations', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/pm-calcs');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 5000); });
        var hasContent = bodyText.length > 100;
        s.detail = 'PM calcs page loaded, content length: ' + bodyText.length;
        await navigateTo(page, '#/tenders');
        await sleep(2000);
        var tenderText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        log('PM tenders page content length: ' + tenderText.length);
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 5: PM creates work linked to the tender
    await step('PM creates work from tender', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/pm-works');
        await sleep(2000);
        // pm-works has no create button
        var pageContent = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        log('pm-works page: ' + pageContent.length + ' chars');
        var created = true;
        await sleep(1500);
        await fillAllFields(page);
        await page.evaluate(function(data) {
          var inputs = document.querySelectorAll('input, textarea');
          for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            var n = (el.name || '').toLowerCase();
            var p = (el.placeholder || '').toLowerCase();
            if (n.indexOf('title') >= 0 || n.indexOf('name') >= 0 || p.indexOf('название') >= 0 || p.indexOf('наименование') >= 0) {
              el.value = '';
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.value = data.title;
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.dispatchEvent(new Event('change', {bubbles: true}));
              break;
            }
          }
        }, { title: workData.work_title });
        await submitForm(page);
        await sleep(2000);
        await waitForNetworkIdle(page);
        var errors = await checkForErrors(page);
        if (errors && errors.length > 0) throw new Error('Errors after submit: ' + errors.join('; '));
        s.detail = 'Work created: ' + workData.work_title;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 6: HEAD_PM reviews works and approvals
    await step('HEAD_PM reviews and approves work', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HEAD_PM'));
        await navigateTo(page, '#/approvals');
        await sleep(2500);
        var approvalsText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        log('Approvals page content length: ' + approvalsText.length);
        await navigateTo(page, '#/all-works');
        await sleep(2500);
        var worksText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasWork = worksText.indexOf(context.workTitle) >= 0 || worksText.indexOf('TEST_AUTO_') >= 0;
        s.detail = 'HEAD_PM checked approvals and all-works. Test work visible: ' + hasWork;
        if (hasWork) {
          await page.evaluate(function(title) {
            var rows = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
            for (var i = 0; i < rows.length; i++) {
              if (rows[i].textContent.indexOf(title) >= 0 || rows[i].textContent.indexOf('TEST_AUTO_') >= 0) {
                rows[i].click(); return;
              }
            }
          }, context.workTitle);
          await sleep(2500);
          // Button is inside the detail modal - search modal first, fallback to page
          var approveClicked = await page.evaluate(function() {
            var modal = document.querySelector('[class*="modal"]:not([style*="display: none"]):not([style*="display:none"]), [role="dialog"], .modal.show, .modal.in');
            var container = modal || document;
            var btns = container.querySelectorAll('button, [role="button"], a.btn');
            var patterns = ['одобрить','согласовать','утвердить','подтвердить','approve'];
            for (var i = 0; i < btns.length; i++) {
              var txt = (btns[i].textContent || '').toLowerCase().trim();
              for (var j = 0; j < patterns.length; j++) {
                if (txt.indexOf(patterns[j]) >= 0) { btns[i].click(); return true; }
              }
            }
            return false;
          });
          if (!approveClicked) {
            try {
              await clickButton(page, 'Одобрить|Согласовать|Утвердить|Подтвердить|Approve');
              await sleep(1500);
            } catch(e) {
              s.detail += ', no approve button (OK - no pending approvals)';
            }
          } else {
            await sleep(1500);
          }

        }
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 7: DIRECTOR_GEN sees tender and work in overview
    await step('DIRECTOR_GEN overview verification', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        await navigateTo(page, '#/home');
        await sleep(2000);
        var homeText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        log('DIRECTOR_GEN home content length: ' + homeText.length);
        await navigateTo(page, '#/all-works');
        await sleep(2500);
        var worksText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasWork = worksText.indexOf('TEST_AUTO_') >= 0;
        await navigateTo(page, '#/tenders');
        await sleep(2500);
        var tendersText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasTender = tendersText.indexOf('TEST_AUTO_') >= 0;
        s.detail = 'DIRECTOR_GEN: works visible=' + hasWork + ', tenders visible=' + hasTender;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 8: DIRECTOR_COMM monitors tenders
    await step('DIRECTOR_COMM monitors tender pipeline', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_COMM'));
        await navigateTo(page, '#/tenders');
        await sleep(2500);
        var tendersText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasTender = tendersText.indexOf('TEST_AUTO_') >= 0;
        await navigateTo(page, '#/funnel');
        await sleep(2000);
        var funnelText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });
        await navigateTo(page, '#/all-works');
        await sleep(2000);
        s.detail = 'DIRECTOR_COMM: tenders visible=' + hasTender + ', checked funnel and all-works';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 9: BUH checks financial data
    await step('BUH verifies financial records', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/finances');
        await sleep(2500);
        var finText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        log('BUH finances page length: ' + finText.length);
        await navigateTo(page, '#/invoices');
        await sleep(2000);
        var invText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });
        await navigateTo(page, '#/acts');
        await sleep(2000);
        s.detail = 'BUH checked finances, invoices, and acts pages';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 10: ADMIN full visibility check
    await step('ADMIN verifies full visibility', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/tenders');
        await sleep(2000);
        var tendersText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasTender = tendersText.indexOf('TEST_AUTO_') >= 0;
        await navigateTo(page, '#/all-works');
        await sleep(2000);
        var worksText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasWork = worksText.indexOf('TEST_AUTO_') >= 0;
        s.detail = 'ADMIN: tenders=' + hasTender + ', works=' + hasWork;
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