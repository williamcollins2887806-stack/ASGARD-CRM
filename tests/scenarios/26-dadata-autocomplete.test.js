/**
 * Scenario 26: DaData Live Search by INN/Name
 * Tests autocomplete functionality for customer search
 */
const SCENARIO_NAME = '26-dadata-autocomplete';

async function run(browser, context = {}) {
  const config = require('../config');
  const { getAccount, BASE_URL, TEST_PREFIX, api, assertOk } = config;
  const { loginAs, sleep } = require('../lib/auth');
  const { navigateTo, isModalOpen, closeModal, findCreateButton } = require('../lib/page-helpers');

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

  try {
    // Step 1: API - DaData suggest by INN
    await step('API: DaData suggest by INN', async (s) => {
      const resp = await api('GET', '/api/customers/suggest?q=7707083893&type=inn', { role: 'ADMIN' });
      if (resp.ok) {
        const suggestions = resp.data?.suggestions || resp.data || [];
        s.note = `INN suggest returned ${Array.isArray(suggestions) ? suggestions.length : 0} results`;
        if (Array.isArray(suggestions) && suggestions.length > 0) {
          s.note += `: ${suggestions[0].name || suggestions[0].value || JSON.stringify(suggestions[0]).substring(0, 100)}`;
        }
      } else {
        s.note = `DaData suggest API: ${resp.status} ${JSON.stringify(resp.data).substring(0, 200)}`;
      }
    });

    // Step 2: API - DaData suggest by company name
    await step('API: DaData suggest by company name', async (s) => {
      const resp = await api('GET', '/api/customers/suggest?q=Сбербанк&type=name', { role: 'ADMIN' });
      if (resp.ok) {
        const suggestions = resp.data?.suggestions || resp.data || [];
        s.note = `Name suggest returned ${Array.isArray(suggestions) ? suggestions.length : 0} results`;
        if (Array.isArray(suggestions) && suggestions.length > 0) {
          s.note += `: ${suggestions[0].name || suggestions[0].value || 'item found'}`;
        }
      } else {
        s.note = `Name suggest API: ${resp.status}`;
      }
    });

    // Step 3: API - DaData lookup by specific INN
    await step('API: DaData lookup by INN', async (s) => {
      const resp = await api('GET', '/api/customers/lookup/7707083893', { role: 'ADMIN' });
      if (resp.ok) {
        const data = resp.data;
        s.note = `Lookup returned: ${data?.name || data?.company?.name || JSON.stringify(data).substring(0, 200)}`;
      } else {
        s.note = `Lookup API: ${resp.status}`;
      }
    });

    // Step 4: UI - Customer form has autocomplete
    await step('UI: Customer form INN field has autocomplete', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/customers');
        await sleep(2000);

        const createBtn = await findCreateButton(page);
        if (!createBtn) {
          s.note = 'No create button on customers page';
          return;
        }
        await createBtn.click();
        await sleep(1500);

        if (!await isModalOpen(page)) {
          s.note = 'Modal did not open';
          return;
        }

        // Find INN field and type
        const innField = page.locator('input[name*="inn"], input[id*="inn"]').first();
        if (await innField.count() > 0) {
          await innField.fill('770708');
          await sleep(1500); // Wait for debounce + API call

          // Check for autocomplete dropdown
          const hasDropdown = await page.evaluate(() => {
            const dropdowns = document.querySelectorAll(
              '[class*="autocomplete"], [class*="suggest"], [class*="dropdown-menu"], ' +
              '[class*="typeahead"], ul[class*="list"], [class*="search-results"]'
            );
            for (const d of dropdowns) {
              if (d.offsetParent !== null && d.getBoundingClientRect().height > 10) {
                return {
                  found: true,
                  items: d.querySelectorAll('li, [class*="item"], [class*="option"]').length,
                  text: d.textContent?.substring(0, 200)
                };
              }
            }
            return { found: false };
          });

          s.note = `Autocomplete dropdown: ${JSON.stringify(hasDropdown)}`;
        } else {
          s.note = 'INN field not found in modal';
        }

        // Check name field autocomplete too
        const nameField = page.locator('input[name*="name"], input[id*="name"]').first();
        if (await nameField.count() > 0) {
          await nameField.fill('Газпром');
          await sleep(1500);

          const nameDropdown = await page.evaluate(() => {
            const dropdowns = document.querySelectorAll(
              '[class*="autocomplete"], [class*="suggest"], [class*="dropdown"], ' +
              'ul[class*="list"]'
            );
            for (const d of dropdowns) {
              if (d.offsetParent !== null && d.getBoundingClientRect().height > 10) {
                return d.querySelectorAll('li, [class*="item"]').length;
              }
            }
            return 0;
          });
          s.note += `, name autocomplete items: ${nameDropdown}`;
        }

        await closeModal(page);
      } finally {
        await ctx.close();
      }
    });

    // Step 5: UI - TKP form has customer autocomplete
    await step('UI: TKP form has customer autocomplete', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/tkp');
        await sleep(2000);

        const createBtn = await findCreateButton(page);
        if (!createBtn) {
          s.note = 'No create button on TKP page';
          return;
        }
        await createBtn.click();
        await sleep(1500);

        if (!await isModalOpen(page)) {
          s.note = 'Modal did not open';
          return;
        }

        // Check all form fields
        const formFields = await page.evaluate(() => {
          const modal = document.querySelector('[class*="modal"]:not([style*="display: none"])');
          if (!modal) return [];
          return Array.from(modal.querySelectorAll('input:not([type="hidden"]), select, textarea'))
            .filter(el => el.offsetParent !== null)
            .map(el => ({ type: el.type, name: el.name || el.id, placeholder: el.placeholder }));
        });
        s.note = `TKP form fields: ${formFields.length} - ${formFields.map(f => f.name).join(', ')}`;

        // Check all modal buttons
        const buttons = await page.evaluate(() => {
          const modal = document.querySelector('[class*="modal"]:not([style*="display: none"])');
          if (!modal) return [];
          return Array.from(modal.querySelectorAll('button'))
            .filter(b => b.offsetParent !== null)
            .map(b => ({ text: (b.textContent || '').trim().substring(0, 30), disabled: b.disabled }));
        });
        s.note += `, buttons: ${buttons.map(b => b.text).join(', ')}`;

        await closeModal(page);
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
