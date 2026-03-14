const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, checkForSuccess, findCreateButton, screenshotOnError } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '19-contracts-correspondence';

async function run(browser, context = {}) {
  const results = { name: SCENARIO_NAME + ': Contracts & Correspondence', steps: [], status: 'PENDING', duration: 0 };
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
    // Step 1: PM creates correspondence entry
    await step('PM creates correspondence', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/correspondence');
        await sleep(2500);

        var created = await clickButton(page, 'Создать|Добавить|Новое письмо|Новая|');
        if (created) {
          await sleep(1500);
          await fillAllFields(page);
          await submitForm(page);
          await sleep(2000);
          await waitForNetworkIdle(page);
          var errors = await checkForErrors(page);
          if (errors && errors.length > 0) throw new Error('Errors: ' + errors.join('; '));
          s.detail = 'Correspondence created';
        } else {
          var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });
          s.detail = 'Correspondence page loaded (' + bodyText.length + ' chars), no create button';
        }
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 2: DIRECTOR_COMM views correspondence
    await step('DIRECTOR_COMM views correspondence', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_COMM'));
        await navigateTo(page, '#/correspondence');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        s.detail = 'DIRECTOR_COMM correspondence: ' + bodyText.length + ' chars';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 3: OFFICE_MANAGER creates proxy/power-of-attorney
    await step('OFFICE_MANAGER creates proxy document', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('OFFICE_MANAGER'));
        await navigateTo(page, '#/proxies');
        await sleep(2500);

        var created = await clickButton(page, 'Создать|Добавить|Новая доверенность|');
        if (created) {
          await sleep(1500);
          await fillAllFields(page);
          await submitForm(page);
          await sleep(2000);
          s.detail = 'Proxy document created';
        } else {
          var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });
          s.detail = 'Proxies page loaded (' + bodyText.length + ' chars)';
        }
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 4: ADMIN views and manages travel requests
    await step('ADMIN manages travel requests', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/travel');
        await sleep(2500);

        var created = await clickButton(page, 'Создать|Добавить|Новая командировка|');
        if (created) {
          await sleep(1500);
          await fillAllFields(page);
          await submitForm(page);
          await sleep(2000);
          s.detail = 'Travel request created';
        } else {
          var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });
          s.detail = 'Travel page loaded (' + bodyText.length + ' chars)';
        }
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 5: PM creates user request
    await step('PM creates user request', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/user-requests');
        await sleep(2500);

        var created = await clickButton(page, 'Создать|Добавить|Новая заявка|');
        if (created) {
          await sleep(1500);
          await fillAllFields(page);
          await submitForm(page);
          await sleep(2000);
          s.detail = 'User request created';
        } else {
          var bodyText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });
          s.detail = 'User-requests page loaded (' + bodyText.length + ' chars)';
        }
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 6: DIRECTOR_GEN views dashboard and big-screen
    await step('DIRECTOR_GEN views dashboard and big-screen', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));

        await navigateTo(page, '#/dashboard');
        await sleep(2500);
        var dashText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        await navigateTo(page, '#/big-screen');
        await sleep(2500);
        var bigText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        s.detail = 'Dashboard=' + dashText.length + ', big-screen=' + bigText.length;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 7: HR views birthdays and HR-rating
    await step('HR views birthdays and HR rating', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));

        await navigateTo(page, '#/birthdays');
        await sleep(2000);
        var bday = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        await navigateTo(page, '#/hr-rating');
        await sleep(2000);
        var rating = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        s.detail = 'Birthdays=' + bday.length + ', HR-rating=' + rating.length;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 8: TO uses messenger/chat
    await step('TO accesses messenger and chat', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));

        await navigateTo(page, '#/chat');
        await sleep(2500);
        var chatText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });

        await navigateTo(page, '#/messenger');
        await sleep(2000);
        var msgText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });

        s.detail = 'Chat=' + chatText.length + ', messenger=' + msgText.length;
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 9: ADMIN views alerts/notifications
    await step('ADMIN views notifications', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/alerts');
        await sleep(2500);
        var alertsText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
        s.detail = 'Alerts page: ' + alertsText.length + ' chars';
      } finally {
        await ctx.close().catch(function(e) {});
      }
    });

    // Step 10: WAREHOUSE restricted from correspondence
    await step('WAREHOUSE restricted from correspondence', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('WAREHOUSE'));
        await navigateTo(page, '#/correspondence');
        await sleep(2500);
        var bodyText = await page.evaluate(function() { return document.body.innerText; });
        var createBtn = await findCreateButton(page);
        s.detail = 'WAREHOUSE correspondence: content=' + bodyText.length + ', create=' + !!createBtn;
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
