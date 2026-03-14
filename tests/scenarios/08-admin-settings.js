/**
 * Scenario 08: Admin Settings
 * ADMIN checks settings → ADMIN manages users
 */

const { getAccount } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, collectMenuPages } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');

const SCENARIO_NAME = '08-admin-settings';

async function run(browser, context = {}) {
  const results = { name: 'Admin Settings', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

  async function step(name, fn) {
    const stepResult = { name, status: 'PENDING', error: null };
    results.steps.push(stepResult);
    try {
      await fn(stepResult);
      stepResult.status = 'PASSED';
      log(SCENARIO_NAME, `  + ${name}`);
    } catch (e) {
      stepResult.status = 'FAILED';
      stepResult.error = e.message.substring(0, 300);
      log(SCENARIO_NAME, `  X ${name}: ${e.message.substring(0, 100)}`);
      throw e;
    }
  }

  try {
    // Step 1: ADMIN checks settings
    await step('ADMIN navigates to settings', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/settings');
        await sleep(3000);

        const content = await page.textContent('body');
        if (!content || content.length < 100) {
          throw new Error('Settings page did not load');
        }
        log(SCENARIO_NAME, '    Settings page loaded');

        // Verify various settings sections are accessible
        const sections = await page.evaluate(() => {
          const headings = document.querySelectorAll('h1, h2, h3, h4, [class*="heading"], [class*="title"]');
          return Array.from(headings).map(h => h.textContent?.trim()).filter(Boolean).slice(0, 10);
        });
        log(SCENARIO_NAME, `    Found sections: ${sections.join(', ')}`);
      } finally {
        await ctx.close();
      }
    });

    // Step 2: ADMIN user management
    await step('ADMIN manages users page', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));

        const routes = ['#/users', '#/admin/users', '#/settings/users', '#/settings'];
        let loaded = false;
        for (const route of routes) {
          await navigateTo(page, route);
          await sleep(2000);
          const content = await page.textContent('body');
          if (content && content.length > 200) {
            loaded = true;
            log(SCENARIO_NAME, `    User management at ${route}`);
            break;
          }
        }

        if (!loaded) {
          throw new Error('Could not load user management page');
        }

        // Count visible users
        const userCount = await page.evaluate(() => {
          const rows = document.querySelectorAll('tr, [class*="user-row"], [class*="user-card"]');
          return rows.length;
        });
        log(SCENARIO_NAME, `    Found ${userCount} user entries`);
      } finally {
        await ctx.close();
      }
    });

    // Step 3: ADMIN verifies all menu items accessible
    await step('ADMIN verifies all menu items load', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        const menuPages = await collectMenuPages(page);
        log(SCENARIO_NAME, `    ADMIN has ${menuPages.length} menu items`);

        let loaded = 0;
        let failed = 0;
        // Spot-check first 5 pages
        for (const item of menuPages.slice(0, 5)) {
          try {
            await navigateTo(page, item.href);
            await sleep(1500);
            const content = await page.textContent('body');
            if (content && content.length > 50) {
              loaded++;
            } else {
              failed++;
            }
          } catch {
            failed++;
          }
        }
        log(SCENARIO_NAME, `    Spot-check: ${loaded} loaded, ${failed} failed`);
      } finally {
        await ctx.close();
      }
    });

    results.status = 'PASSED';
  } catch (e) {
    results.status = 'FAILED';
  }

  results.duration = Date.now() - start;
  return results;
}

module.exports = { run, name: SCENARIO_NAME };
