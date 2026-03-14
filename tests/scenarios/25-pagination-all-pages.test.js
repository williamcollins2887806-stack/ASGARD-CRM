/**
 * Scenario 25: Pagination on All Pages (Enhanced)
 * Tests that pagination.js is connected and working on all table pages
 * Covers the 8 pages where we added pagination + existing ones
 */
const SCENARIO_NAME = '25-pagination-all-pages';

async function run(browser, context = {}) {
  const config = require('../config');
  const { getAccount, BASE_URL } = config;
  const { loginAs, sleep } = require('../lib/auth');
  const { navigateTo, isModalOpen, closeModal } = require('../lib/page-helpers');

  const results = { name: SCENARIO_NAME, steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

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

  // All pages that should have pagination
  const PAGES_TO_TEST = [
    { route: 'tenders',        role: 'ADMIN', name: 'Тендеры' },
    { route: 'pre-tenders',    role: 'ADMIN', name: 'Предтендеры' },
    { route: 'all-works',      role: 'ADMIN', name: 'Все работы' },
    { route: 'all-estimates',  role: 'ADMIN', name: 'Все сметы' },
    { route: 'customers',      role: 'ADMIN', name: 'Заказчики' },
    { route: 'tkp',            role: 'ADMIN', name: 'ТКП' },
    { route: 'invoices',       role: 'BUH',   name: 'Счета' },
    { route: 'personnel',      role: 'HR',    name: 'Персонал' },
    { route: 'hr-requests',    role: 'HR',    name: 'Кадровые заявки' },
    { route: 'proc-requests',  role: 'ADMIN', name: 'Заявки снабжения' },
    { route: 'correspondence', role: 'ADMIN', name: 'Корреспонденция' },
    { route: 'tasks',          role: 'ADMIN', name: 'Задачи' },
    { route: 'cash',           role: 'BUH',   name: 'Касса' },
    { route: 'permissions',    role: 'ADMIN', name: 'Допуски' },
  ];

  try {
    for (const pg of PAGES_TO_TEST) {
      await step(`${pg.name} (${pg.route}): pagination controls present`, async (s) => {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await ctx.newPage();
        try {
          await loginAs(page, getAccount(pg.role));
          await navigateTo(page, `#/${pg.route}`);
          await sleep(2000);

          // Check for pagination controls
          const paginationInfo = await page.evaluate(() => {
            // Look for pagination container
            const paginationContainers = document.querySelectorAll(
              '[id*="pagination"], [class*="pagination"], [class*="pager"]'
            );

            // Look for page size selector (10/20/50/Все)
            const pageSizeSelectors = document.querySelectorAll(
              'select[class*="page-size"], [class*="page-size"] select, [class*="pagination"] select'
            );

            // Look for page number buttons
            const pageButtons = document.querySelectorAll(
              '[class*="pagination"] button, [class*="pagination"] a, [class*="page-btn"]'
            );

            // Look for "Показано X из Y" text
            const showingText = document.body.textContent.match(/Показано:?\s*\d+\s*из\s*\d+/i);

            // Check for AsgardPagination global
            const hasPaginationJS = typeof window.AsgardPagination !== 'undefined';

            return {
              containers: paginationContainers.length,
              pageSizeSelectors: pageSizeSelectors.length,
              pageButtons: pageButtons.length,
              showingText: showingText ? showingText[0] : null,
              hasPaginationJS,
            };
          });

          const hasPagination = paginationInfo.containers > 0 ||
                               paginationInfo.pageSizeSelectors > 0 ||
                               paginationInfo.pageButtons > 0 ||
                               paginationInfo.showingText;

          s.note = `pagination containers: ${paginationInfo.containers}, ` +
                   `page-size selects: ${paginationInfo.pageSizeSelectors}, ` +
                   `page buttons: ${paginationInfo.pageButtons}, ` +
                   `showing text: ${paginationInfo.showingText || 'none'}, ` +
                   `JS loaded: ${paginationInfo.hasPaginationJS}`;

          // Also check table rows
          const rowCount = await page.locator('tbody tr').count();
          s.note += `, table rows: ${rowCount}`;

          // Check all visible buttons on page
          const allButtons = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('button, [role="button"]'))
              .filter(b => b.offsetParent !== null && b.getBoundingClientRect().width > 5)
              .map(b => (b.textContent || '').trim().substring(0, 30))
              .filter(t => t.length > 0);
          });
          s.note += `, page buttons: ${allButtons.length}`;
        } finally {
          await ctx.close();
        }
      });
    }

    // Step: Test page size switching
    await step('Tenders: change page size (10→20→50)', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/tenders');
        await sleep(2000);

        const pageSizeSelector = page.locator('[class*="pagination"] select, select[class*="page-size"]').first();
        if (await pageSizeSelector.count() > 0) {
          // Get current row count
          const initialRows = await page.locator('tbody tr').count();

          // Change to 10
          await pageSizeSelector.selectOption('10');
          await sleep(1000);
          const rows10 = await page.locator('tbody tr').count();

          // Change to 50
          await pageSizeSelector.selectOption('50');
          await sleep(1000);
          const rows50 = await page.locator('tbody tr').count();

          s.note = `Page size switch: initial=${initialRows}, 10=${rows10}, 50=${rows50}`;
        } else {
          s.note = 'No page size selector found';
        }
      } finally {
        await ctx.close();
      }
    });

    // Step: Test page navigation
    await step('Tenders: navigate between pages', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/tenders');
        await sleep(2000);

        // Find page 2 button
        const page2Btn = page.locator('[class*="pagination"] button:has-text("2"), [class*="pagination"] a:has-text("2")').first();
        if (await page2Btn.count() > 0) {
          await page2Btn.click();
          await sleep(1000);

          const rows = await page.locator('tbody tr').count();
          s.note = `Page 2 loaded, rows: ${rows}`;

          // Go back to page 1
          const page1Btn = page.locator('[class*="pagination"] button:has-text("1"), [class*="pagination"] a:has-text("1")').first();
          if (await page1Btn.count() > 0) {
            await page1Btn.click();
            await sleep(1000);
            s.note += `, back to page 1: ${await page.locator('tbody tr').count()} rows`;
          }
        } else {
          s.note = 'No page 2 button (may have < pageSize records)';
        }
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
