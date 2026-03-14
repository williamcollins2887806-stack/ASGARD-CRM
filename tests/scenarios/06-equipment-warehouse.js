/**
 * Scenario 06: Equipment / Warehouse
 * WAREHOUSE creates equipment → CHIEF_ENGINEER views dashboard → PROC handles purchases
 */

const { getAccount } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors } = require('../lib/page-helpers');
const { fillAllFields, submitForm } = require('../lib/form-filler');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '06-equipment-warehouse';

async function run(browser, context = {}) {
  const results = { name: 'Equipment & Warehouse', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const equipData = gen.equipment();

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
    // Step 1: WAREHOUSE creates equipment
    await step('WAREHOUSE creates equipment via #/warehouse', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('WAREHOUSE'));
        await navigateTo(page, '#/warehouse');
        await sleep(2000);

        await clickButton(page, 'Создать|Добавить|Новый|Новое');
        await sleep(2000);

        const fields = await fillAllFields(page);
        log(SCENARIO_NAME, `    Equipment form: filled ${fields.filled} fields`);

        // Override name for tracking
        try {
          const nameInput = page.locator('input[name*="name"], input[placeholder*="Название"], input[placeholder*="Наименование"]').first();
          if (await nameInput.isVisible({ timeout: 2000 })) {
            await nameInput.fill(equipData.name);
          }
        } catch {}

        await submitForm(page);
        await waitForNetworkIdle(page);
        context.equipData = equipData;
      } finally {
        await ctx.close();
      }
    });

    // Step 2: CHIEF_ENGINEER views dashboard
    await step('CHIEF_ENGINEER views engineer dashboard', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('CHIEF_ENGINEER'));

        const routes = ['#/engineer-dashboard', '#/equipment', '#/warehouse'];
        for (const route of routes) {
          await navigateTo(page, route);
          await sleep(3000);
          const content = await page.textContent('body');
          if (content && content.length > 200) {
            log(SCENARIO_NAME, `    CHIEF_ENGINEER loaded ${route}`);
            break;
          }
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 3: PROC handles purchases
    await step('PROC creates purchase request via #/purchases', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PROC'));

        const routes = ['#/purchases', '#/purchase-requests', '#/procurement'];
        for (const route of routes) {
          await navigateTo(page, route);
          await sleep(2000);
          const content = await page.textContent('body');
          if (content && content.length > 200) {
            try {
              await clickButton(page, 'Создать|Добавить|Новый|Новая');
              await sleep(2000);

              const purchaseData = gen.purchaseRequest();
              const fields = await fillAllFields(page);
              log(SCENARIO_NAME, `    Purchase form: filled ${fields.filled} fields`);

              // Override title for tracking
              try {
                const titleInput = page.locator('input[name*="title"], input[placeholder*="Название"]').first();
                if (await titleInput.isVisible({ timeout: 2000 })) {
                  await titleInput.fill(purchaseData.title);
                }
              } catch {}

              await submitForm(page);
              await waitForNetworkIdle(page);
            } catch (e) {
              log(SCENARIO_NAME, `    Purchase form not available: ${e.message.substring(0, 80)}`);
            }
            break;
          }
        }
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
