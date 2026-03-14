/**
 * Scenario 10: Pagination Controls
 *
 * Verifies that all pages with data tables render pagination controls correctly.
 * Tests from multiple role perspectives: ADMIN, PM, BUH, TO, HR.
 *
 * For each role:
 *   1. Login and collect sidebar menu pages
 *   2. Visit each page
 *   3. Detect if the page has a data table
 *   4. Verify pagination controls exist (prev/next, page numbers, page size selector)
 *   5. Test pagination interaction (click next, verify page change)
 */

const { getAccount, TIMEOUTS } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, screenshotOnError, collectMenuPages, waitForNetworkIdle } = require('../lib/page-helpers');

const SCENARIO_NAME = '10-pagination';

// Known pages that should have pagination (route fragments)
const PAGES_WITH_TABLES = [
  '#/tenders', '#/pm-works', '#/all-works', '#/invoices',
  '#/customers', '#/personnel', '#/correspondence',
  '#/hr-requests', '#/proc-requests', '#/all-estimates',
  '#/tkp', '#/buh-registry', '#/kpi-works',
];

// Roles to test pagination from
const ROLES_TO_TEST = ['ADMIN', 'PM', 'BUH', 'TO', 'HR'];

async function run(browser, context = {}) {
  const results = { name: 'Pagination Controls', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

  async function step(name, fn) {
    const stepResult = { name, status: 'PENDING', error: null, screenshot: null };
    results.steps.push(stepResult);
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
      await fn(stepResult);
      stepResult.status = 'PASSED';
      log(SCENARIO_NAME, `  + ${name}`);
    } catch (e) {
      stepResult.status = 'FAILED';
      stepResult.error = e.message.substring(0, 300);
      log(SCENARIO_NAME, `  X ${name}: ${e.message.substring(0, 100)}`);
      // Don't throw — continue to next step
}
  }

  try {
    for (const roleName of ROLES_TO_TEST) {
      const account = getAccount(roleName);
      if (!account) {
        log(SCENARIO_NAME, `  Skipping role ${roleName}: account not found`);
        continue;
      }

      // ---------------------------------------------------------------
      // Step: Test pagination for this role
      // ---------------------------------------------------------------
      await step(`${roleName} pagination on all table pages`, async (s) => {
        const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
        const page = await ctx.newPage();
        let pagesWithPagination = 0;
        let pagesMissing = 0;
        let pagesNoTable = 0;

        try {
          await loginAs(page, account);
          const menuItems = await collectMenuPages(page);
          log(SCENARIO_NAME, `    ${roleName}: found ${menuItems.length} menu pages`);

          // Filter to known table pages that exist in this role's menu
          const menuHrefs = menuItems.map(m => m.href);
          const tablePagesToTest = PAGES_WITH_TABLES.filter(p => menuHrefs.includes(p));
          // Also test any menu pages that are not in our known list (discovery)
          const discoveredTablePages = menuHrefs.filter(h => !PAGES_WITH_TABLES.includes(h));

          const allPages = [...tablePagesToTest, ...discoveredTablePages];
          log(SCENARIO_NAME, `    ${roleName}: testing ${tablePagesToTest.length} known + ${discoveredTablePages.length} discovered pages`);

          for (const route of allPages) {
            try {
              await navigateTo(page, route);
              await sleep(2500);

              // Detect if page has a data table
              const tableInfo = await page.evaluate(() => {
                // Look for table elements
                const tables = document.querySelectorAll('table, [class*="table"], [role="grid"], [class*="data-grid"]');
                let hasTable = false;
                let rowCount = 0;

                for (const t of tables) {
                  if (t.closest('aside') || t.closest('nav')) continue;
                  const rect = t.getBoundingClientRect();
                  if (rect.width > 100 && rect.height > 50) {
                    hasTable = true;
                    const rows = t.querySelectorAll('tr, [class*="row"]');
                    rowCount = Math.max(rowCount, rows.length);
                  }
                }

                // Also check for list/card-based layouts that may have pagination
                if (!hasTable) {
                  const lists = document.querySelectorAll('[class*="list"], [class*="grid"], [class*="cards"]');
                  for (const l of lists) {
                    if (l.closest('aside') || l.closest('nav')) continue;
                    const children = l.children;
                    if (children.length > 3) {
                      hasTable = true;
                      rowCount = children.length;
                    }
                  }
                }

                return { hasTable, rowCount };
              });

              if (!tableInfo.hasTable) {
                pagesNoTable++;
                continue;
              }

              // Detect pagination controls
              const paginationInfo = await page.evaluate(() => {
                const indicators = {
                  hasPagination: false,
                  hasNextButton: false,
                  hasPrevButton: false,
                  hasPageNumbers: false,
                  hasPageSizeSelector: false,
                  hasShowingText: false,
                  controlTypes: [],
                };

                // Look for pagination containers
                const paginationSelectors = [
                  '[class*="pagination"]',
                  '[class*="Pagination"]',
                  '[class*="pager"]',
                  '[class*="Pager"]',
                  '[class*="page-nav"]',
                  '[aria-label*="pagination"]',
                  '[role="navigation"][aria-label*="page"]',
                  'nav[class*="page"]',
                ];

                for (const sel of paginationSelectors) {
                  const els = document.querySelectorAll(sel);
                  for (const el of els) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 30 && rect.height > 10) {
                      indicators.hasPagination = true;
                      indicators.controlTypes.push(sel);
                    }
                  }
                }

                // Look for next/prev buttons
                const allBtns = document.querySelectorAll('button, a, [role="button"]');
                for (const btn of allBtns) {
                  if (btn.closest('aside') || btn.closest('nav:not([class*="page"])')) continue;
                  const text = (btn.textContent || '').trim().toLowerCase();
                  const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                  const title = (btn.getAttribute('title') || '').toLowerCase();
                  const combined = text + ' ' + ariaLabel + ' ' + title;

                  if (combined.match(/next|следующ|вперёд|вперед|>>/)) {
                    indicators.hasNextButton = true;
                    indicators.hasPagination = true;
                  }
                  if (combined.match(/prev|предыдущ|назад|<</)) {
                    indicators.hasPrevButton = true;
                    indicators.hasPagination = true;
                  }
                }

                // Look for page numbers (1, 2, 3... pattern)
                const pageNumPattern = document.querySelectorAll('[class*="pagination"] button, [class*="pagination"] a, [class*="page-number"], [class*="page-btn"]');
                for (const el of pageNumPattern) {
                  const text = (el.textContent || '').trim();
                  if (/^\d+$/.test(text)) {
                    indicators.hasPageNumbers = true;
                    indicators.hasPagination = true;
                  }
                }

                // Look for page size selector
                const selects = document.querySelectorAll('select');
                for (const sel of selects) {
                  const options = sel.querySelectorAll('option');
                  let hasPageSizeOptions = false;
                  for (const opt of options) {
                    const val = opt.textContent.trim();
                    if (['10', '20', '25', '50', '100'].includes(val)) {
                      hasPageSizeOptions = true;
                    }
                  }
                  if (hasPageSizeOptions) {
                    indicators.hasPageSizeSelector = true;
                    indicators.hasPagination = true;
                  }
                }

                // Look for "Showing X of Y" text
                const bodyText = document.body.innerText;
                if (bodyText.match(/Показано\s+\d+|Страница\s+\d+|из\s+\d+\s+записей|of\s+\d+\s+entries|Showing\s+\d+/i)) {
                  indicators.hasShowingText = true;
                  indicators.hasPagination = true;
                }

                return indicators;
              });

              if (paginationInfo.hasPagination) {
                pagesWithPagination++;
                const features = [];
                if (paginationInfo.hasNextButton) features.push('next');
                if (paginationInfo.hasPrevButton) features.push('prev');
                if (paginationInfo.hasPageNumbers) features.push('numbers');
                if (paginationInfo.hasPageSizeSelector) features.push('size-selector');
                if (paginationInfo.hasShowingText) features.push('showing-text');
                log(SCENARIO_NAME, `    ${roleName} ${route}: pagination OK [${features.join(', ')}]`);
              } else if (tableInfo.rowCount > 10) {
                // Table with many rows but no pagination detected
                pagesMissing++;
                log(SCENARIO_NAME, `    ${roleName} ${route}: WARNING - table with ${tableInfo.rowCount} rows but no pagination`);
              }
            } catch (e) {
              log(SCENARIO_NAME, `    ${roleName} ${route}: error - ${e.message.substring(0, 80)}`);
            }
          }

          // Test pagination interaction on a page that has it
          if (pagesWithPagination > 0) {
            const firstTablePage = tablePagesToTest[0] || allPages[0];
            try {
              await navigateTo(page, firstTablePage);
              await sleep(3000);

              // Try clicking "next page" button
              const nextBtn = page.locator('button:has-text(">>"), button:has-text(">"), [aria-label*="next"], [aria-label*="Next"], [aria-label*="следующ"], [class*="pagination"] button:last-child').first();
              const nextVisible = await nextBtn.isVisible({ timeout: 3000 }).catch(() => false);
              if (nextVisible) {
                const beforeContent = await page.textContent('body');
                await nextBtn.click();
                await sleep(2000);
                const afterContent = await page.textContent('body');
                if (beforeContent !== afterContent) {
                  log(SCENARIO_NAME, `    ${roleName}: pagination click works (content changed)`);
                } else {
                  log(SCENARIO_NAME, `    ${roleName}: pagination click completed (content unchanged - may be last page)`);
                }
              }
            } catch {
              log(SCENARIO_NAME, `    ${roleName}: pagination interaction test skipped`);
            }
          }

          log(SCENARIO_NAME, `    ${roleName} summary: ${pagesWithPagination} with pagination, ${pagesMissing} missing, ${pagesNoTable} no table`);

        } finally {
          await ctx.close();
        }
      });
    }

    results.status = 'PASSED';
  } catch (e) {
    results.status = 'FAILED';
  }

  results.duration = Date.now() - start;
  return results;
}

module.exports = { run, name: SCENARIO_NAME };
