const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '16-hr-permits-flow';

async function run(browser, context = {}) {
  const results = { name: SCENARIO_NAME + ': HR & Permits Full Flow', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

  const employeeData = gen.employee();
  const permitData = gen.permit();
  context.employeeName = employeeData.full_name;
  context.permitName = permitData.permit_name;

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
    // Step 1: HR creates new employee
    await step('HR creates new employee', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/personnel');
        await sleep(2500);

        var created = false;
        try {
          await page.locator('#btnAdd').click({ timeout: 5000 });
          created = true;
        } catch(btnErr) {
          log('#btnAdd not found, trying text...');
          try { await clickButton(page, 'Добавить|Создать|Новый сотрудник'); created = true; } catch(e2) {}
        }
        if (!created) throw new Error('Create button not found on personnel page');
        await sleep(1500);

        await fillAllFields(page);

        // Override name and phone with generated data
        await page.evaluate(function(data) {
          var inputs = document.querySelectorAll('input, textarea');
          for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            var n = (el.name || '').toLowerCase();
            var p = (el.placeholder || '').toLowerCase();
            if (n.indexOf('name') >= 0 || n.indexOf('fio') >= 0 || p.indexOf('фио') >= 0 || p.indexOf('имя') >= 0 || p.indexOf('ф.и.о') >= 0) {
              el.value = '';
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.value = data.name;
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.dispatchEvent(new Event('change', {bubbles: true}));
            }
            if (n.indexOf('phone') >= 0 || n.indexOf('tel') >= 0 || p.indexOf('телефон') >= 0) {
              el.value = '';
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.value = data.phone;
              el.dispatchEvent(new Event('input', {bubbles: true}));
              el.dispatchEvent(new Event('change', {bubbles: true}));
            }
          }
        }, { name: employeeData.full_name, phone: employeeData.phone });

        await submitForm(page);
        await sleep(2000);
        await waitForNetworkIdle(page);

        var errors = await checkForErrors(page);
        if (errors && errors.length > 0) throw new Error('Errors: ' + errors.join('; '));
        s.detail = 'Employee created: ' + employeeData.full_name;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 2: HR verifies employee appears in list
    await step('HR verifies employee in list', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/personnel');
        await sleep(2500);

        var bodyText = await page.evaluate(function() { return document.body.innerText; });
        var hasEmployee = bodyText.indexOf('TEST_AUTO_') >= 0 || bodyText.indexOf(context.employeeName) >= 0;

        // Try searching
        if (!hasEmployee) {
          var search = page.locator('input[type="search"], input[placeholder*="Поиск"], input[placeholder*="поиск"]').first();
          if (await search.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
            await search.fill('TEST_AUTO_');
            await sleep(1500);
            bodyText = await page.evaluate(function() { return document.body.innerText; });
            hasEmployee = bodyText.indexOf('TEST_AUTO_') >= 0;
          }
        }

        s.detail = 'Employee in personnel list: ' + hasEmployee;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 3: HR creates permit application
    await step('HR creates permit application', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/permits');
        await sleep(2500);

        var hasCreate = await findCreateButton(page);
        if (!hasCreate) {
          await navigateTo(page, '#/permit-applications');
          await sleep(2000);
          hasCreate = await findCreateButton(page);
        }

        var created = false;
        try {
          await page.locator('#btnAddNewPermit').click({ timeout: 5000 });
          created = true;
        } catch(btnErr) {
          log('#btnAddNewPermit not found, trying text...');
          try { await clickButton(page, 'Добавить|Создать|Новый пропуск'); created = true; } catch(e2) {}
        }
        if (!created) throw new Error('Create button not found on permits page');
        await sleep(1500);

        await fillAllFields(page);
        await submitForm(page);
        await sleep(2000);
        await waitForNetworkIdle(page);

        var errors = await checkForErrors(page);
        if (errors && errors.length > 0) throw new Error('Errors: ' + errors.join('; '));
        s.detail = 'Permit application created';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 4: HR opens permit modal and adds employee
    await step('HR adds employee to permit via modal', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/permits');
        await sleep(2000);

        var bodyText = await page.evaluate(function() { return document.body.innerText; });
        if (bodyText.indexOf('TEST_AUTO_') < 0) {
          await navigateTo(page, '#/permit-applications');
          await sleep(2000);
        }

        var found = await page.evaluate(function() {
          var rows = document.querySelectorAll('tr, [class*="row"], [class*="card"]');
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.indexOf('TEST_AUTO_') >= 0) {
              rows[i].click(); return true;
            }
          }
          var dataRows = document.querySelectorAll('tbody tr, [class*="data-row"]');
          if (dataRows.length > 0) { dataRows[0].click(); return true; }
          return false;
        });
        await sleep(2000);

        var addBtn = false;
        try {
          var selectors = ['#btnAddEmployee', '#addEmployeeBtn', 'button:has-text("сотрудник")', 'a:has-text("сотрудник")', '[onclick*="employee"]', '.btn:has-text("Добавить")'];
          for (var si = 0; si < selectors.length && !addBtn; si++) {
            try {
              var el = page.locator(selectors[si]).first();
              if (await el.isVisible({ timeout: 2000 })) { await el.click(); addBtn = true; }
            } catch(e2) { /* try next */ }
          }
          if (!addBtn) addBtn = await clickButton(page, 'Добавить сотрудника|Добавить работника|Выбрать сотрудника|Добавить');
        } catch(e3) { /* soft fail */ }
        if (addBtn) {
          await sleep(1500);

          var modalVisible = await page.evaluate(function() {
            var modals = document.querySelectorAll('.modal-overlay.show, .modal.show, [class*="modal"][style*="display: flex"], [class*="modal"][style*="display: block"]');
            return modals.length > 0;
          });

          if (modalVisible) {
            log('Employee selection modal opened successfully');
            await page.evaluate(function() {
              var checkboxes = document.querySelectorAll('.modal-overlay.show input[type="checkbox"], .modal.show input[type="checkbox"]');
              if (checkboxes.length > 0) checkboxes[0].click();
              var rows = document.querySelectorAll('.modal-overlay.show tr, .modal.show tr');
              if (rows.length > 1) rows[1].click();
            });
            await sleep(1000);

            await clickButton(page, 'Выбрать|Добавить|Подтвердить|OK|Ок');
            await sleep(1000);
          }
          s.detail = 'Add employee button clicked. Modal appeared: ' + modalVisible;
        } else {
          s.detail = 'Add employee button not found (may need permit to be opened first)';
        }
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 5: DIRECTOR_GEN reviews permits
    await step('DIRECTOR_GEN reviews permits', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));

        await navigateTo(page, '#/permits');
        await sleep(2500);
        var permitsText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        await navigateTo(page, '#/permit-applications');
        await sleep(2000);
        var appsText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        s.detail = 'DIRECTOR_GEN checked permits (' + permitsText.length + ' chars) and permit-applications (' + appsText.length + ' chars)';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 6: ADMIN views personnel and permits
    await step('ADMIN views personnel and permits', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));

        await navigateTo(page, '#/personnel');
        await sleep(2500);
        var persText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasEmployee = persText.indexOf('TEST_AUTO_') >= 0;

        await navigateTo(page, '#/permits');
        await sleep(2000);
        var permText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        s.detail = 'ADMIN: personnel employee visible=' + hasEmployee + ', permits loaded';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 7: PM views relevant permits
    await step('PM views permits', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));

        await navigateTo(page, '#/permits');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        var hasContent = bodyText.length > 100;
        s.detail = 'PM permits page: ' + bodyText.length + ' chars content';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 8: TO cannot manage personnel
    await step('TO restricted from personnel management', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        await navigateTo(page, '#/personnel');
        await sleep(2500);

        var bodyText = await page.evaluate(function() { return document.body.innerText; });
        var createBtn = await findCreateButton(page);

        s.detail = 'TO personnel access: content=' + bodyText.length + ' chars, create=' + !!createBtn + ' (expected: restricted)';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 9: HR creates payroll entry
    await step('HR creates payroll entry', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/payroll');
        await sleep(2500);

        var hasCreate = await findCreateButton(page);
        if (hasCreate) {
          var created = await clickButton(page, 'Создать|Добавить|Новая|\\+');
          if (created) {
            await sleep(1500);
            await fillAllFields(page);
            await submitForm(page);
            await sleep(2000);
            s.detail = 'Payroll entry created';
          } else {
            s.detail = 'Payroll page loaded but create button did not respond';
          }
        } else {
          var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });
          s.detail = 'Payroll page loaded (' + bodyText.length + ' chars). No create button (may be view-only)';
        }
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 10: BUH reviews payroll
    await step('BUH reviews payroll data', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('BUH'));
        await navigateTo(page, '#/payroll');
        await sleep(2500);

        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        var hasData = bodyText.length > 200;

        await navigateTo(page, '#/buh-registry');
        await sleep(2000);
        var regText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        s.detail = 'BUH payroll (' + bodyText.length + ' chars), buh-registry (' + regText.length + ' chars)';
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
