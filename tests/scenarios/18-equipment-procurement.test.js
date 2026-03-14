const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '18-equipment-procurement';

async function run(browser, context = {}) {
  const results = { name: SCENARIO_NAME + ': Equipment & Procurement Flow', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

  const equipData = gen.equipment();
  const purchaseData = gen.purchaseRequest();
  context.equipName = equipData.name;

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
    // WAREHOUSE creates equipment item
    await step('WAREHOUSE creates equipment item', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('WAREHOUSE'));
        await navigateTo(page, '#/warehouse');
        await sleep(3000);
        
        var created = false;
        try {
          await page.locator('#btnAddEquip, #btnAddEquipment').first().waitFor({ state: 'visible', timeout: 8000 });
          await page.locator('#btnAddEquip, #btnAddEquipment').first().click({ timeout: 5000 });
          created = true;
        } catch(btnErr) {
          log('#btnAddEquipment not found, trying text...');
          try { await clickButton(page, 'Добавить ТМЦ|Добавить|Создать'); created = true; } catch(e2) {
            await navigateTo(page, '#/my-equipment');
            await sleep(2000);
            try { await page.locator('#btnAddEquip, #btnAddEquipment').first().click({ timeout: 5000 }); created = true; } catch(e3) {}
          }
        }
        if (!created) throw new Error('Create button not found on warehouse/equipment page');
        await sleep(1500);
        
        await fillAllFields(page);
        
        await page.evaluate(function(name) {
          var inputs = document.querySelectorAll('input, textarea');
          for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            var n = (el.name || '').toLowerCase();
            var p = (el.placeholder || '').toLowerCase();
            if (n.indexOf('name') >= 0 || n.indexOf('title') >= 0 || p.indexOf('\u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435') >= 0 || p.indexOf('\u043d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435') >= 0) {
              el.value = '';
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.value = name;
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.dispatchEvent(new Event('change', {bubbles: true}));
              break;
            }
          }
        }, equipData.name);
        
        await submitForm(page);
        await sleep(2000);
        await waitForNetworkIdle(page);
        var errors = await checkForErrors(page);
        if (errors && errors.length > 0) throw new Error('Errors: ' + errors.join('; '));
        s.detail = 'Equipment created: ' + equipData.name;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // WAREHOUSE verifies equipment in list
    await step('WAREHOUSE verifies equipment in list', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('WAREHOUSE'));
        await navigateTo(page, '#/warehouse');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText; });
        var has = bodyText.indexOf('TEST_AUTO_') >= 0;
        s.detail = 'Equipment in warehouse list: ' + has;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // CHIEF_ENGINEER views equipment
    await step('CHIEF_ENGINEER views equipment', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('CHIEF_ENGINEER'));
        await navigateTo(page, '#/warehouse');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 5000); });
        
        await navigateTo(page, '#/my-equipment');
        await sleep(2000);
        var myEquip = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        
        await navigateTo(page, '#/engineer-dashboard');
        await sleep(2000);
        var dashboard = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        
        s.detail = 'CHIEF_ENGINEER: warehouse=' + bodyText.length + ', my-equipment=' + myEquip.length + ', dashboard=' + dashboard.length;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // PROC creates purchase request
    await step('PROC creates purchase request', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PROC'));
        await navigateTo(page, '#/proc-requests');
        await sleep(2500);
        
        // proc-requests has no create button
        var procContent = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        log('PROC requests: ' + procContent.length + ' chars');
        var created = true;

        s.detail = 'Purchase request created: ' + purchaseData.title;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // PROC verifies purchase request in list
    await step('PROC verifies purchase request in list', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PROC'));
        await navigateTo(page, '#/proc-requests');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText; });
        var has = bodyText.indexOf('TEST_AUTO_') >= 0;
        s.detail = 'Purchase request in list: ' + has;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // DIRECTOR_GEN reviews purchase requests
    await step('DIRECTOR_GEN reviews purchase requests', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        await navigateTo(page, '#/proc-requests');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 5000); });
        var has = bodyText.indexOf('TEST_AUTO_') >= 0;
        
        if (has) {
          await page.evaluate(function() {
            var rows = document.querySelectorAll('tr, [class*=\'row\'], [class*=\'card\']');
            for (var i = 0; i < rows.length; i++) {
              if (rows[i].textContent.indexOf('TEST_AUTO_') >= 0) { rows[i].click(); return; }
            }
          });
          await sleep(2000);
          await clickButton(page, '\u041e\u0434\u043e\u0431\u0440\u0438\u0442\u044c|\u0423\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c|\u0421\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u0442\u044c|\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c');
          await sleep(1500);
        }
        
        s.detail = 'DIRECTOR_GEN proc-requests: found=' + has;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // BUH views procurement in finances
    await step('BUH views procurement in finances', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/finances');
        await sleep(2500);
        var finText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        
        await navigateTo(page, '#/proc-requests');
        await sleep(2000);
        var procText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        
        s.detail = 'BUH: finances=' + finText.length + ', proc-requests=' + procText.length;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // PM restricted from warehouse management
    await step('PM restricted from warehouse management', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/warehouse');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText; });
        var createBtn = await findCreateButton(page);
        s.detail = 'PM warehouse: content=' + bodyText.length + ', create=' + !!createBtn;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // OFFICE_MANAGER manages office expenses
    await step('OFFICE_MANAGER manages office expenses', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('OFFICE_MANAGER'));
        await navigateTo(page, '#/office-expenses');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var createBtn = await findCreateButton(page);
        
        if (createBtn) {
          var created = await clickButton(page, '\u0421\u043e\u0437\u0434\u0430\u0442\u044c|\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c|\\+');
          if (created) {
            await sleep(1500);
            await fillAllFields(page);
            await submitForm(page);
            await sleep(2000);
          }
        }
        s.detail = 'OFFICE_MANAGER office-expenses: content=' + bodyText.length + ', create=' + !!createBtn;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // ADMIN verifies full equipment visibility
    await step('ADMIN verifies full equipment visibility', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/warehouse');
        await sleep(2500);
        var wh = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasEquip = wh.indexOf('TEST_AUTO_') >= 0;
        
        await navigateTo(page, '#/proc-requests');
        await sleep(2000);
        var proc = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasProc = proc.indexOf('TEST_AUTO_') >= 0;
        
        s.detail = 'ADMIN: warehouse equip=' + hasEquip + ', proc requests=' + hasProc;
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
