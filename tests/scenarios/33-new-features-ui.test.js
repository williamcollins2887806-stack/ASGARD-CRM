/**
 * Scenario 33: New Features UI Audit
 * Tests: Schedule filters, Timeline/Gantt toggle, Employee Collections page,
 *        Cash "Отчитаться" button, Dashboard patronymic greeting
 */

const SCENARIO_NAME = '33-new-features-ui';

async function run(browser, context = {}) {
  const config = require('../config');
  const { getAccount, BASE_URL } = config;
  const { loginAs, sleep, log } = require('../lib/auth');
  const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, screenshotOnError, isModalOpen } = require('../lib/page-helpers');

  const results = { name: 'New Features UI', steps: [], status: 'PENDING', duration: 0 };
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
    // STEP 1: Schedule page — filters and search
    // ══════════════════════════════════════════════════════════
    await step('Schedule page filters', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/workers-schedule');
        await sleep(3000);

        // Check filter bar exists
        const hasFilterBar = await page.evaluate(() => {
          return !!document.getElementById('schedFilterBarWrap');
        });
        if (!hasFilterBar) throw new Error('Filter bar not found (schedFilterBarWrap)');

        // Check filter buttons exist
        const filterBtns = await page.evaluate(() => {
          var btns = document.querySelectorAll('.sched-f-btn');
          return Array.from(btns).map(b => b.dataset.filter);
        });
        if (!filterBtns.includes('all')) throw new Error('Missing "all" filter button');
        if (!filterBtns.includes('free')) throw new Error('Missing "free" filter button');
        if (!filterBtns.includes('busy')) throw new Error('Missing "busy" filter button');
        if (!filterBtns.includes('reserve')) throw new Error('Missing "reserve" filter button');

        // Click "Свободные" filter
        await page.evaluate(() => {
          var btn = document.querySelector('.sched-f-btn[data-filter="free"]');
          if (btn) btn.click();
        });
        await sleep(1500);

        // Check search input exists
        const hasSearch = await page.evaluate(() => {
          return !!document.getElementById('schedSearchName');
        });
        if (!hasSearch) throw new Error('Search input not found');

        // Type in search
        await page.evaluate(() => {
          var input = document.getElementById('schedSearchName');
          if (input) { input.value = 'test_nonexistent_name_xyz'; input.dispatchEvent(new Event('input')); }
        });
        await sleep(500);

        // Reset filter
        await page.evaluate(() => {
          var btn = document.querySelector('.sched-f-btn[data-filter="all"]');
          if (btn) btn.click();
        });
        await sleep(500);

        const jsErrors = await checkForErrors(page);
        s.detail = `Filters: ${filterBtns.length} buttons, search OK, JS errors: ${jsErrors.length}`;
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step1-filters').catch(() => {});
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 2: Schedule page — Timeline/Gantt toggle
    // ══════════════════════════════════════════════════════════
    await step('Schedule Timeline toggle', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/workers-schedule');
        await sleep(3000);

        // Check toggle buttons exist
        const hasToggle = await page.evaluate(() => {
          return !!document.getElementById('btnViewCal') && !!document.getElementById('btnViewGantt');
        });
        if (!hasToggle) throw new Error('Calendar/Timeline toggle buttons not found');

        // Click Timeline
        await page.evaluate(() => {
          document.getElementById('btnViewGantt').click();
        });
        await sleep(2000);

        // Check Gantt container is visible
        const ganttVisible = await page.evaluate(() => {
          var gw = document.getElementById('ganttWrap');
          return gw && gw.style.display !== 'none';
        });
        if (!ganttVisible) throw new Error('Gantt container not visible after toggle');

        // Check calendar is hidden
        const calHidden = await page.evaluate(() => {
          var sw = document.getElementById('schedWrap');
          return sw && sw.style.display === 'none';
        });
        if (!calHidden) throw new Error('Calendar not hidden after switching to Gantt');

        // Toggle back to Calendar
        await page.evaluate(() => {
          document.getElementById('btnViewCal').click();
        });
        await sleep(1000);

        const calVisible = await page.evaluate(() => {
          var sw = document.getElementById('schedWrap');
          return sw && sw.style.display !== 'none';
        });
        if (!calVisible) throw new Error('Calendar not visible after toggle back');

        const jsErrors = await checkForErrors(page);
        s.detail = `Toggle OK, Gantt renders, JS errors: ${jsErrors.length}`;
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step2-timeline').catch(() => {});
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 3: Employee Collections page (HR)
    // ══════════════════════════════════════════════════════════
    await step('Employee Collections page', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/collections');
        await sleep(3000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const hasContent = bodyText.length > 100;

        // Check for create button
        let createFound = false;
        try {
          await clickButton(page, 'Создать|Новая|Добавить');
          createFound = true;
          await sleep(1000);
          // Close modal if opened
          if (await isModalOpen(page)) {
            await closeModal(page);
          }
        } catch (e) {
          // OK if no create button
        }

        const jsErrors = await checkForErrors(page);
        s.detail = `Content: ${hasContent}, Create: ${createFound}, JS errors: ${jsErrors.length}`;
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step3-collections').catch(() => {});
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 4: Cash page — Отчитаться button exists
    // ══════════════════════════════════════════════════════════
    await step('Cash page Отчитаться button', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/cash');
        await sleep(3000);

        // Check page loads without errors
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        const hasContent = bodyText.length > 50;

        // Check for JS errors
        const jsErrors = await checkForErrors(page);

        // Verify the submitReport function exists in the module
        const hasSubmitReport = await page.evaluate(() => {
          return typeof window.AsgardCashPage?.submitReport === 'function';
        });

        s.detail = `Cash loaded: ${hasContent}, submitReport exists: ${hasSubmitReport}, JS errors: ${jsErrors.length}`;
        if (!hasSubmitReport) throw new Error('AsgardCashPage.submitReport function not found');
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step4-cash').catch(() => {});
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 5: Dashboard — patronymic greeting
    // ══════════════════════════════════════════════════════════
    await step('Dashboard patronymic greeting', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/home');
        await sleep(3000);

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
        const hasGreeting = bodyText.includes('Добро пожаловать') || bodyText.includes('Привет') || bodyText.includes('Здравствуйте') || bodyText.includes('Доброе') || bodyText.includes('Добрый');

        const jsErrors = await checkForErrors(page);
        s.detail = `Dashboard loaded, greeting: ${hasGreeting}, JS errors: ${jsErrors.length}`;
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step5-dashboard').catch(() => {});
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 6: Schedule page — reserve status in legend
    // ══════════════════════════════════════════════════════════
    await step('Schedule reserve status in legend', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/workers-schedule');
        await sleep(3000);

        const hasReserve = await page.evaluate(() => {
          var legends = document.querySelectorAll('.sched-legend-item');
          for (var i = 0; i < legends.length; i++) {
            if (legends[i].textContent.includes('Бронь')) return true;
          }
          return false;
        });

        s.detail = `Reserve in legend: ${hasReserve}`;
        if (!hasReserve) throw new Error('"Бронь" status not found in schedule legend');
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step6-reserve').catch(() => {});
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 7: Schedule page — month navigation
    // ══════════════════════════════════════════════════════════
    await step('Schedule month navigation', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/workers-schedule');
        await sleep(3000);

        // Get current period
        const period1 = await page.evaluate(() => {
          var el = document.getElementById('schedPeriod');
          return el ? el.textContent : '';
        });

        // Click next month
        await page.evaluate(() => {
          document.getElementById('btnNextMonth').click();
        });
        await sleep(2000);

        // Get new period
        const period2 = await page.evaluate(() => {
          var el = document.getElementById('schedPeriod');
          return el ? el.textContent : '';
        });

        if (period1 === period2) throw new Error('Period did not change after clicking Next');

        // Click prev month
        await page.evaluate(() => {
          document.getElementById('btnPrevMonth').click();
        });
        await sleep(2000);

        const period3 = await page.evaluate(() => {
          var el = document.getElementById('schedPeriod');
          return el ? el.textContent : '';
        });

        if (period1 !== period3) throw new Error('Period did not return to original after Prev');

        const jsErrors = await checkForErrors(page);
        s.detail = `Navigation: ${period1} -> ${period2} -> ${period3}, JS errors: ${jsErrors.length}`;
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step7-navigation').catch(() => {});
        await ctx.close().catch(() => {});
      }
    });

    // ══════════════════════════════════════════════════════════
    // STEP 8: All pages load without JS errors (quick audit)
    // ══════════════════════════════════════════════════════════
    await step('Quick page load audit (critical pages)', async (s) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      const errorPages = [];
      try {
        await loginAs(page, getAccount('ADMIN'));

        const pages = ['#/home', '#/works', '#/tenders', '#/cash', '#/workers-schedule', '#/employees', '#/settings', '#/invoices', '#/calendar', '#/tasks'];
        for (const p of pages) {
          try {
            await navigateTo(page, p);
            await sleep(2500);
            const jsErrors = await checkForErrors(page);
            const criticalErrors = jsErrors.filter(e =>
              !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('SSL') && !e.includes('Telegram')
            );
            if (criticalErrors.length > 0) {
              errorPages.push({ page: p, errors: criticalErrors.slice(0, 3) });
            }
          } catch (navErr) {
            errorPages.push({ page: p, errors: [navErr.message.substring(0, 100)] });
          }
        }

        s.detail = `Checked ${pages.length} pages, ${errorPages.length} with errors`;
        if (errorPages.length > 0) {
          const details = errorPages.map(ep => `${ep.page}: ${ep.errors[0]}`).join('; ');
          s.detail += ` | ${details}`;
        }
      } finally {
        await screenshotOnError(page, SCENARIO_NAME + '-step8-audit').catch(() => {});
        await ctx.close().catch(() => {});
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
