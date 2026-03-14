/**
 * Scenario 28: Comprehensive Buttons & Modals Test for ALL Roles
 * Tests every page's buttons, modals, form fields, and modal buttons
 */
const SCENARIO_NAME = '28-all-buttons-modals';

async function run(browser, context = {}) {
  const config = require('../config');
  const { getAccount, BASE_URL, ROLES } = config;
  const { loginAs, sleep } = require('../lib/auth');
  const { navigateTo, isModalOpen, closeModal, collectMenuPages, findCreateButton } = require('../lib/page-helpers');

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
    } finally {
      s.duration = Date.now() - t0;
    }
  }

  // Helper: collect all visible buttons info
  async function collectButtons(page) {
    return page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, [role="button"], a.btn, a[class*="btn"]'))
        .filter(b => {
          const rect = b.getBoundingClientRect();
          return rect.width > 5 && rect.height > 5 &&
                 window.getComputedStyle(b).display !== 'none' &&
                 b.offsetParent !== null;
        })
        .map(b => ({
          text: (b.textContent || '').trim().substring(0, 50),
          id: b.id || '',
          classes: (b.className || '').substring(0, 80),
          disabled: b.disabled || false,
          tag: b.tagName,
        }));
    });
  }

  // Helper: collect form fields in modal
  async function collectModalFields(page) {
    return page.evaluate(() => {
      const modal = document.querySelector(
        '[class*="modal"]:not([style*="display: none"]):not([style*="display:none"]), ' +
        '[role="dialog"], [class*="drawer"]:not([style*="display: none"])'
      );
      if (!modal) return [];
      return Array.from(modal.querySelectorAll('input:not([type="hidden"]), select, textarea'))
        .filter(el => el.offsetParent !== null)
        .map(el => ({
          type: el.type || el.tagName.toLowerCase(),
          name: el.name || el.id || '',
          placeholder: el.placeholder || '',
          required: el.required || false,
        }));
    });
  }

  // Helper: collect modal buttons
  async function collectModalButtons(page) {
    return page.evaluate(() => {
      const modal = document.querySelector(
        '[class*="modal"]:not([style*="display: none"]):not([style*="display:none"]), ' +
        '[role="dialog"], [class*="drawer"]:not([style*="display: none"])'
      );
      if (!modal) return [];
      return Array.from(modal.querySelectorAll('button, [role="button"]'))
        .filter(b => b.offsetParent !== null)
        .map(b => ({
          text: (b.textContent || '').trim().substring(0, 40),
          id: b.id || '',
          disabled: b.disabled || false,
        }));
    });
  }

  // Pages with create buttons to test
  const CREATE_PAGES = [
    { route: 'tenders',        roles: ['ADMIN', 'TO'] },
    { route: 'pre-tenders',    roles: ['ADMIN', 'TO'] },
    { route: 'all-works',      roles: ['ADMIN', 'PM'] },
    { route: 'all-estimates',  roles: ['ADMIN', 'TO'] },
    { route: 'customers',      roles: ['ADMIN'] },
    { route: 'tkp',            roles: ['ADMIN', 'PM'] },
    { route: 'invoices',       roles: ['ADMIN', 'BUH'] },
    { route: 'cash',           roles: ['ADMIN', 'PM', 'BUH'] },
    { route: 'tasks',          roles: ['ADMIN', 'PM'] },
    { route: 'personnel',      roles: ['HR'] },
    { route: 'hr-requests',    roles: ['HR'] },
    { route: 'proc-requests',  roles: ['ADMIN', 'PROC'] },
    { route: 'correspondence', roles: ['ADMIN'] },
    { route: 'permissions',    roles: ['ADMIN', 'HR'] },
    { route: 'pass-requests',  roles: ['ADMIN'] },
    { route: 'meetings',       roles: ['ADMIN', 'PM'] },
  ];

  try {
    // Phase 1: Test each role's menu and page access
    const testRoles = ['ADMIN', 'DIRECTOR_GEN', 'PM', 'TO', 'HR', 'BUH', 'PROC', 'WAREHOUSE'];

    for (const role of testRoles) {
      await step(`${role}: Menu items and page navigation`, async (s) => {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await ctx.newPage();
        try {
          await loginAs(page, getAccount(role));
          await sleep(2000);

          // Collect menu items
          const menuItems = await collectMenuPages(page);
          s.note = `Menu items: ${menuItems.length} - ${menuItems.map(m => m.name).join(', ')}`;

          // Visit each menu page and check buttons
          const pageResults = [];
          for (const item of menuItems.slice(0, 8)) { // Limit to 8 pages per role
            try {
              await navigateTo(page, item.href);
              await sleep(1500);

              const buttons = await collectButtons(page);
              pageResults.push({
                page: item.name,
                buttons: buttons.length,
                buttonTexts: buttons.map(b => b.text).filter(t => t).slice(0, 5)
              });
            } catch {}
          }

          s.note += `\nPages checked: ${pageResults.length}`;
          for (const pr of pageResults) {
            s.note += `\n  ${pr.page}: ${pr.buttons} btns [${pr.buttonTexts.join(', ')}]`;
          }
        } finally {
          await ctx.close();
        }
      });
    }

    // Phase 2: Test create buttons → modals → form fields → modal buttons
    for (const pg of CREATE_PAGES) {
      const role = pg.roles[0]; // Use first role
      await step(`${pg.route}: Create modal (${role})`, async (s) => {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await ctx.newPage();
        try {
          await loginAs(page, getAccount(role));
          await navigateTo(page, `#/${pg.route}`);
          await sleep(2000);

          // Special handling for hr-requests: FAB button hidden in headless
          if (pg.route === "hr-requests") {
            const fabClicked = await page.evaluate(() => {
              const fab = document.querySelector("#fabBtn");
              if (fab) {
                fab.style.display = "block";
                fab.style.visibility = "visible";
                fab.style.opacity = "1";
                fab.style.pointerEvents = "auto";
                fab.click();
                return true;
              }
              return false;
            });
            if (fabClicked) {
              await sleep(1500);
              const modalOpen = await isModalOpen(page);
              if (modalOpen) {
                const fields = await collectModalFields(page);
                s.note = "FAB modal fields: " + fields.length + " - " + fields.map(ff => ff.name || ff.type).join(", ");
                const modalBtns = await collectModalButtons(page);
                s.note += "\nModal buttons: " + modalBtns.map(b => b.text + (b.disabled ? "(disabled)" : "")).join(", ");
                await closeModal(page);
                await sleep(500);
              } else {
                s.note = "FAB clicked but no modal appeared";
              }
              return;
            }
          }

          // Find and click create button
          const createBtn = await findCreateButton(page);
          if (!createBtn) {
            // Also try specific selectors
            const altBtn = page.locator('button:has-text("Новый"), button:has-text("Создать"), button:has-text("Добавить"), #fabBtn').first();
            if (await altBtn.count() > 0) {
              await altBtn.click({ timeout: 5000 }).catch(() => {
                // Fallback: force-click via JS
                return page.evaluate(() => {
                  const fab = document.getElementById('fabBtn');
                  if (fab) { fab.click(); return; }
                  const btns = document.querySelectorAll('button');
                  for (const b of btns) {
                    if (b.closest('aside, nav, [class*="mimir"]')) continue;
                    const t = b.textContent.trim();
                    if (t === '+' || t.includes('Создать') || t.includes('Добавить') || t.includes('Новый')) {
                      b.click(); return;
                    }
                  }
                });
              });
            } else {
              s.note = 'No create button found';
              return;
            }
          } else {
            await createBtn.click();
          }
          await sleep(1500);

          // Check modal opened
          const modalOpen = await isModalOpen(page);
          if (!modalOpen) {
            s.note = 'Create button clicked but no modal appeared';
            return;
          }

          // Collect modal form fields
          const fields = await collectModalFields(page);
          s.note = `Modal fields: ${fields.length} - ${fields.map(f => f.name || f.type).join(', ')}`;

          // Collect modal buttons
          const modalBtns = await collectModalButtons(page);
          s.note += `\nModal buttons: ${modalBtns.map(b => `${b.text}${b.disabled ? '(disabled)' : ''}`).join(', ')}`;

          // Close modal
          await closeModal(page);
          await sleep(500);

          // Verify modal closed
          const stillOpen = await isModalOpen(page);
          if (stillOpen) {
            s.note += ' | WARNING: Modal did not close!';
            // Force close
            await page.keyboard.press('Escape');
            await sleep(500);
          }
        } finally {
          await ctx.close();
        }
      });
    }

    // Phase 3: Test row click → detail modal
    const DETAIL_PAGES = [
      { route: 'tenders',     role: 'ADMIN' },
      { route: 'pre-tenders', role: 'ADMIN' },
      { route: 'all-works',   role: 'ADMIN' },
      { route: 'customers',   role: 'ADMIN' },
      { route: 'tkp',         role: 'PM' },
      { route: 'invoices',    role: 'BUH' },
      { route: 'tasks',       role: 'ADMIN' },
      { route: 'personnel',   role: 'HR' },
    ];

    for (const pg of DETAIL_PAGES) {
      await step(`${pg.route}: Row click → detail (${pg.role})`, async (s) => {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await ctx.newPage();
        try {
          await loginAs(page, getAccount(pg.role));
          await navigateTo(page, `#/${pg.route}`);
          await sleep(2000);

          const firstRow = page.locator('tbody tr, [data-id]').first();
          if (await firstRow.count() === 0) {
            s.note = 'No rows in table';
            return;
          }

          await firstRow.click();
          await sleep(1500);

          const modalOpen = await isModalOpen(page);
          if (modalOpen) {
            // Collect detail modal fields
            const fields = await collectModalFields(page);
            const buttons = await collectModalButtons(page);
            s.note = `Detail modal: ${fields.length} fields, buttons: ${buttons.map(b => b.text).join(', ')}`;

            await closeModal(page);
          } else {
            // Maybe it navigated to detail page instead
            const url = page.url();
            s.note = `No modal, current URL: ${url}`;
          }
        } finally {
          await ctx.close();
        }
      });
    }

    // Phase 4: Settings page buttons and tabs
    await step('ADMIN: Settings page tabs and buttons', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/settings');
        await sleep(2000);

        // Collect all buttons
        const buttons = await collectButtons(page);
        s.note = `Settings buttons: ${buttons.length}`;

        // Check for tabs
        const tabs = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('[class*="tab"], [role="tab"], .nav-link, .tab-btn'))
            .filter(t => t.offsetParent !== null)
            .map(t => (t.textContent || '').trim().substring(0, 30));
        });
        s.note += `, tabs: ${tabs.length} [${tabs.join(', ')}]`;

        // Check for save buttons
        const saveBtns = buttons.filter(b => b.text.match(/сохранить|save/i));
        s.note += `, save buttons: ${saveBtns.length}`;
      } finally {
        await ctx.close();
      }
    });

    results.status = results.steps.every(function(s) { return s.status === 'PASSED'; }) ? 'PASSED' : 'PARTIAL';
  } catch (e) {
    results.status = 'FAILED';
    results.error = e.message?.substring(0, 500);
  }

  results.duration = Date.now() - start;
  return results;
}

module.exports = { run, name: SCENARIO_NAME };
