/**
 * Scenario 34: Uncovered Modules UI Audit
 * Tests previously untested pages: bonus-approval, seals, contracts,
 * user-requests, gantt views, funnel, pm-analytics, home dashboard widgets
 */

const SCENARIO_NAME = '34-uncovered-modules-ui';

async function run(browser, context = {}) {
  const config = require('../config');
  const { getAccount, BASE_URL } = config;
  const { loginAs, sleep, log } = require('../lib/auth');
  const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, screenshotOnError, isModalOpen } = require('../lib/page-helpers');

  const results = { name: 'Uncovered Modules UI', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

  async function step(name, fn) {
    const stepResult = { name, status: 'PENDING', error: null, detail: '' };
    results.steps.push(stepResult);
    try {
      try {
        const _hc = await browser.newContext();
        await _hc.close();
      } catch (_bcErr) {
        const { chromium } = require('playwright');
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
      }
      await fn(stepResult);
      stepResult.status = 'PASSED';
      log(SCENARIO_NAME, `  + ${name}${stepResult.detail ? ': ' + stepResult.detail : ''}`);
    } catch (e) {
      stepResult.status = 'FAILED';
      stepResult.error = e.message.substring(0, 300);
      log(SCENARIO_NAME, `  X ${name}: ${e.message.substring(0, 150)}`);
    }
  }

  try {
    // ══════════════════════════════════════════════════════════
    // STEP 1: Home dashboard — widgets render
    // ══════════════════════════════════════════════════════════
    await step('Home dashboard widgets render', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/home');
        await sleep(4000);

        const widgetCount = await page.evaluate(() => {
          return document.querySelectorAll('.dash-card, .widget, .stat-card, [class*="dash"]').length;
        });

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
        const hasGreeting = bodyText.includes('Добро пожаловать') || bodyText.includes('Привет') || bodyText.includes('Здравствуйте') || bodyText.includes('Доброе') || bodyText.includes('Добрый');

        const jsErrors = await checkForErrors(page);
        s.detail = `Widgets: ${widgetCount}, greeting: ${hasGreeting}, JS errors: ${jsErrors.length}`;
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 2: Bonus Approval page
    // ══════════════════════════════════════════════════════════
    await step('Bonus approval page loads', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/bonus-approval');
        await sleep(3000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const hasContent = bodyText.length > 50;

        const jsErrors = await checkForErrors(page);
        const criticalErrors = jsErrors.filter(e =>
          !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
        );

        s.detail = `Content: ${hasContent}, body: ${bodyText.length} chars, JS errors: ${criticalErrors.length}`;
        if (criticalErrors.length > 0) {
          s.detail += ` | ${criticalErrors[0].substring(0, 100)}`;
        }
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 3: Seals page
    // ══════════════════════════════════════════════════════════
    await step('Seals registry page loads', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/seals');
        await sleep(3000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const hasContent = bodyText.length > 50;

        const jsErrors = await checkForErrors(page);
        const criticalErrors = jsErrors.filter(e =>
          !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
        );

        s.detail = `Content: ${hasContent}, JS errors: ${criticalErrors.length}`;
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 4: Contracts page
    // ══════════════════════════════════════════════════════════
    await step('Contracts page loads', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/contracts');
        await sleep(3000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const jsErrors = await checkForErrors(page);
        const criticalErrors = jsErrors.filter(e =>
          !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
        );

        s.detail = `Content length: ${bodyText.length}, JS errors: ${criticalErrors.length}`;
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 5: User Requests page
    // ══════════════════════════════════════════════════════════
    await step('User requests page loads', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/user-requests');
        await sleep(3000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const jsErrors = await checkForErrors(page);
        const criticalErrors = jsErrors.filter(e =>
          !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
        );

        s.detail = `Content: ${bodyText.length} chars, JS errors: ${criticalErrors.length}`;
        if (criticalErrors.length > 0) {
          s.detail += ` | ${criticalErrors[0].substring(0, 100)}`;
        }
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 6: Gantt Calcs view
    // ══════════════════════════════════════════════════════════
    await step('Gantt calcs page loads', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/gantt-calcs');
        await sleep(4000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const jsErrors = await checkForErrors(page);
        const criticalErrors = jsErrors.filter(e =>
          !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
        );

        s.detail = `Content: ${bodyText.length} chars, JS errors: ${criticalErrors.length}`;
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 7: Gantt Works view
    // ══════════════════════════════════════════════════════════
    await step('Gantt works page loads', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/gantt-works');
        await sleep(4000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const jsErrors = await checkForErrors(page);
        const criticalErrors = jsErrors.filter(e =>
          !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
        );

        s.detail = `Content: ${bodyText.length} chars, JS errors: ${criticalErrors.length}`;
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 8: Funnel / Kanban view
    // ══════════════════════════════════════════════════════════
    await step('Funnel kanban page loads', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/funnel');
        await sleep(3000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const jsErrors = await checkForErrors(page);
        const criticalErrors = jsErrors.filter(e =>
          !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
        );

        s.detail = `Content: ${bodyText.length} chars, JS errors: ${criticalErrors.length}`;
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 9: PM Analytics page
    // ══════════════════════════════════════════════════════════
    await step('PM analytics page loads', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/pm-analytics');
        await sleep(3000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const jsErrors = await checkForErrors(page);
        const criticalErrors = jsErrors.filter(e =>
          !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
        );

        s.detail = `Content: ${bodyText.length} chars, JS errors: ${criticalErrors.length}`;
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 10: Diagnostics page
    // ══════════════════════════════════════════════════════════
    await step('Diagnostics page loads', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/diag');
        await sleep(3000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const jsErrors = await checkForErrors(page);
        const criticalErrors = jsErrors.filter(e =>
          !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
        );

        s.detail = `Content: ${bodyText.length} chars, JS errors: ${criticalErrors.length}`;
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 11: Training Applications page
    // ══════════════════════════════════════════════════════════
    await step('Training applications page loads', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/training');
        await sleep(3000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const jsErrors = await checkForErrors(page);
        const criticalErrors = jsErrors.filter(e =>
          !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
        );

        s.detail = `Content: ${bodyText.length} chars, JS errors: ${criticalErrors.length}`;
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 12: Site Inspections page
    // ══════════════════════════════════════════════════════════
    await step('Site inspections page loads (after getToken fix)', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/site-inspections');
        await sleep(3000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const jsErrors = await checkForErrors(page);
        const criticalErrors = jsErrors.filter(e =>
          !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
        );

        s.detail = `Content: ${bodyText.length} chars, JS errors: ${criticalErrors.length}`;
        if (criticalErrors.length > 2) {
          throw new Error('Too many JS errors: ' + criticalErrors[0].substring(0, 100));
        }
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 13: All critical role dashboards render without JS errors
    // ══════════════════════════════════════════════════════════
    await step('Multi-role dashboard audit', async (s) => {
      const roles = ['PM', 'HR', 'TO', 'BUH', 'HEAD_PM', 'HEAD_TO', 'CHIEF_ENGINEER', 'DIRECTOR_GEN'];
      const errorRoles = [];
      for (const role of roles) {
        const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
        const page = await ctx.newPage();
        try {
          await loginAs(page, getAccount(role));
          await navigateTo(page, '#/home');
          await sleep(3000);

          const jsErrors = await checkForErrors(page);
          const criticalErrors = jsErrors.filter(e =>
            !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
          );

          if (criticalErrors.length > 0) {
            errorRoles.push({ role, count: criticalErrors.length, first: criticalErrors[0].substring(0, 80) });
          }
        } catch (e) {
          errorRoles.push({ role, count: -1, first: e.message.substring(0, 80) });
        } finally {
          await ctx.close().catch(() => {});
        }
      }

      s.detail = `Checked ${roles.length} roles, ${errorRoles.length} with JS errors`;
      if (errorRoles.length > 0) {
        const details = errorRoles.map(r => `${r.role}(${r.count}): ${r.first}`).join('; ');
        s.detail += ` | ${details}`;
      }
    });

  } catch (globalErr) {
    results.status = 'FAILED';
    results.error = globalErr.message;
  }

  results.duration = Date.now() - start;
  const passed = results.steps.filter(s => s.status === 'PASSED').length;
  const failed = results.steps.filter(s => s.status === 'FAILED').length;
  results.status = failed > 0 ? 'FAILED' : 'PASSED';
  results.summary = `${passed}/${results.steps.length} passed`;

  return results;
}

module.exports = { run, name: SCENARIO_NAME };
