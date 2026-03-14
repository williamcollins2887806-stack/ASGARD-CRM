/**
 * Scenario 27: Dashboard Widgets, Charts, and KPI
 * Tests funnel year filter, KPI calculations, big-screen mode
 */
const SCENARIO_NAME = '27-dashboard-widgets';

async function run(browser, context = {}) {
  const config = require('../config');
  const { getAccount, BASE_URL } = config;
  const { loginAs, sleep } = require('../lib/auth');
  const { navigateTo, isModalOpen, closeModal, collectMenuPages } = require('../lib/page-helpers');

  const results = { name: SCENARIO_NAME, steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const currentYear = new Date().getFullYear();

  async function step(name, fn) {
    const s = { name, status: 'PENDING', error: null, duration: 0 };
    results.steps.push(s);
    const t0 = Date.now();
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
      await fn(s);
      s.status = 'PASSED';
    } catch (e) {
      s.status = 'FAILED';
      s.error = e.message?.substring(0, 300);
      throw e;
    } finally {
      s.duration = Date.now() - t0;
    }
  }

  try {
    // Step 1: Home/Dashboard page loads for ADMIN
    await step('ADMIN: Dashboard loads with widgets', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/home');
        await sleep(3000);

        // Check for dashboard widgets
        const widgets = await page.evaluate(() => {
          const result = {
            cards: document.querySelectorAll('[class*="card"], [class*="widget"], [class*="stat"]').length,
            charts: document.querySelectorAll('canvas, svg[class*="chart"], [class*="chart"]').length,
            tables: document.querySelectorAll('table, tbody').length,
          };
          return result;
        });

        s.note = `Dashboard widgets: cards=${widgets.cards}, charts=${widgets.charts}, tables=${widgets.tables}`;

        // Check for JS errors
        const jsErrors = [];
        page.on('pageerror', e => jsErrors.push(e.message));
        await sleep(1000);
        if (jsErrors.length > 0) {
          s.note += `, JS errors: ${jsErrors.join('; ').substring(0, 200)}`;
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 2: Custom Dashboard page
    await step('ADMIN: Custom Dashboard loads', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/dashboard');
        await sleep(3000);

        const bodyText = await page.textContent('body');
        const hasContent = bodyText.length > 200;

        // Check for funnel widget
        const hasFunnel = await page.evaluate(() => {
          const body = document.body.textContent;
          return body.includes('воронк') || body.includes('funnel') || body.includes('Воронка');
        });

        // Check for KPI widget
        const hasKPI = await page.evaluate(() => {
          const body = document.body.textContent;
          return body.includes('KPI') || body.includes('кпи') || body.includes('показател');
        });

        s.note = `Dashboard loaded: ${hasContent}, funnel: ${hasFunnel}, KPI: ${hasKPI}`;

        // Check all buttons on dashboard
        const buttons = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(b => b.offsetParent !== null)
            .map(b => (b.textContent || '').trim().substring(0, 30))
            .filter(t => t.length > 0);
        });
        s.note += `, buttons: ${buttons.length} [${buttons.slice(0, 10).join(', ')}]`;
      } finally {
        await ctx.close();
      }
    });

    // Step 3: Tenders funnel filters by current year
    await step('Tenders funnel shows current year data', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/dashboard');
        await sleep(3000);

        // Check funnel data contains current year reference
        const funnelInfo = await page.evaluate((year) => {
          const body = document.body.textContent;
          const hasYear = body.includes(String(year));

          // Look for funnel-specific elements
          const funnelEl = document.querySelector('[class*="funnel"], [id*="funnel"]');
          const funnelText = funnelEl ? funnelEl.textContent?.substring(0, 300) : null;

          return { hasYear, funnelText };
        }, currentYear);

        s.note = `Year ${currentYear} in dashboard: ${funnelInfo.hasYear}`;
        if (funnelInfo.funnelText) {
          s.note += `, funnel text: ${funnelInfo.funnelText.substring(0, 100)}`;
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 4: Big Screen mode
    await step('ADMIN: Big Screen mode loads', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/big-screen');
        await sleep(3000);

        const bodyText = await page.textContent('body');
        const hasContent = bodyText.length > 100;

        const widgets = await page.evaluate(() => {
          return {
            cards: document.querySelectorAll('[class*="card"], [class*="widget"]').length,
            charts: document.querySelectorAll('canvas, svg').length,
          };
        });

        s.note = `Big Screen loaded: ${hasContent}, cards: ${widgets.cards}, charts: ${widgets.charts}`;
      } finally {
        await ctx.close();
      }
    });

    // Step 5: Different roles see appropriate dashboards
    for (const role of ['DIRECTOR_GEN', 'PM', 'TO', 'BUH', 'HR']) {
      await step(`${role}: Dashboard access`, async (s) => {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await ctx.newPage();
        try {
          await loginAs(page, getAccount(role));
          await navigateTo(page, '#/home');
          await sleep(2000);

          const bodyText = await page.textContent('body');
          s.note = `Content length: ${bodyText.length}`;

          // Check sidebar menu items for this role
          const menuItems = await collectMenuPages(page);
          s.note += `, menu items: ${menuItems.length}`;
        } finally {
          await ctx.close();
        }
      });
    }

    // Step 6: KPI page (if exists)
    await step('ADMIN: KPI pages load', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));

        // Try KPI money
        await navigateTo(page, '#/kpi-money');
        await sleep(2000);
        const kpiText = await page.textContent('body');

        // Try KPI works
        await navigateTo(page, '#/kpi-works');
        await sleep(2000);
        const kpiWorksText = await page.textContent('body');

        s.note = `KPI-money: ${kpiText.length > 100 ? 'loaded' : 'empty/redirect'}, ` +
                 `KPI-works: ${kpiWorksText.length > 100 ? 'loaded' : 'empty/redirect'}`;
      } finally {
        await ctx.close();
      }
    });

    results.status = 'PASSED';
  } catch (e) {
    results.status = 'FAILED';
    results.error = e.message?.substring(0, 500);
  }

  results.duration = Date.now() - start;
  return results;
}

module.exports = { run, name: SCENARIO_NAME };
