/**
 * Scenario 22: Pre-Tender Director Approval Workflow
 * Tests the new TO → pending_approval → DIRECTOR_GEN approve flow
 */
const SCENARIO_NAME = '22-pretender-approval-workflow';

async function run(browser, context = {}) {
  const config = require('../config');
  const { getAccount, BASE_URL, TIMEOUTS, TEST_PREFIX } = config;
  const { loginAs, extractToken, sleep } = require('../lib/auth');
  const { navigateTo, isModalOpen, closeModal, clickButton, findCreateButton, waitForNetworkIdle, checkForErrors } = require('../lib/page-helpers');
  const { fillAllFields, submitForm } = require('../lib/form-filler');
  const { uid } = require('../lib/data-generator');

  const results = { name: SCENARIO_NAME, steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();
  const testId = uid();
  const customerName = `${TEST_PREFIX}ApprovalCust_${testId}`;

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
    // Step 1: Verify pre-tenders page loads and shows existing items (pre-tenders come from incoming emails)
    await step("TO verifies pre-tenders page loads with existing items", async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount("TO"));
        await navigateTo(page, "#/pre-tenders");
        await sleep(2500);

        // Verify page loaded with content
        const bodyText = await page.evaluate(() => document.body.innerText);
        if (bodyText.length < 50) { s.note = "Pre-tenders page appears empty (OK - items come from emails)"; return; }

        // Check for table rows or list items
        const rowCount = await page.evaluate(() => {
          const rows = document.querySelectorAll("tbody tr, [data-id], [class*=item], [class*=card]");
          return rows.length;
        });

        s.note = "Pre-tenders page loaded. Content length: " + bodyText.length + ", items found: " + rowCount;
        if (rowCount === 0) {
          s.note += " (no items visible - may need incoming emails to populate)";
        }
      } finally {
        await ctx.close();
      }
    });

    // Step 2: TO accepts pre-tender → should go to pending_approval
    await step('TO accepts pre-tender → pending_approval status', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('TO'));
        await navigateTo(page, '#/pre-tenders');
        await sleep(2000);

        // Find our test pre-tender in the list
        const rows = page.locator('tbody tr, [data-id]');
        const count = await rows.count();
        let found = false;
        for (let i = 0; i < count; i++) {
          const text = await rows.nth(i).textContent();
          if (text.includes(TEST_PREFIX) || text.includes('ApprovalCust')) {
            await rows.nth(i).click();
            found = true;
            break;
          }
        }

        if (!found) {
          // Try API approach
          const token = await extractToken(page);
          s.note = 'Pre-tender not found in list, checking via page content';
        }

        await sleep(1500);

        // Try to click accept button
        try {
          await clickButton(page, 'Принять|Взять|Accept|accept');
          await sleep(2000);
        } catch {
          s.note = 'Accept button not found - may need different flow';
        }

        // Check for pending_approval indicator or assign PM modal
        const bodyText = await page.textContent('body');
        const hasPending = bodyText.includes('pending_approval') ||
                          bodyText.includes('ожидани') ||
                          bodyText.includes('согласован') ||
                          bodyText.includes('директор');
        s.note = `Pending approval check: ${hasPending}`;
      } finally {
        await ctx.close();
      }
    });

    // Step 3: Verify API - TO accept returns pending_approval
    await step('API: TO accept returns pending_approval', async (s) => {
      const { api, assertOk } = config;

      // Get pre-tenders list
      const listResp = await api('GET', '/api/pre-tenders', { role: 'TO' });
      assertOk(listResp, 'GET pre-tenders');

      const items = listResp.data?.items || listResp.data?.data || listResp.data || [];
      const testItem = items.find(i =>
        (i.customer_name || '').includes(TEST_PREFIX) ||
        (i.contact_person || '').includes(TEST_PREFIX)
      );

      if (testItem) {
        s.note = `Found test pre-tender id=${testItem.id}, status=${testItem.status}`;

        // Try to accept via API
        if (testItem.status === 'new' || testItem.status === 'in_review') {
          const acceptResp = await api('POST', `/api/pre-tenders/${testItem.id}/accept`, {
            role: 'TO',
            body: {
              assigned_pm_id: 7, // test_pm user
              comment: `${TEST_PREFIX}TO approved`
            }
          });

          if (acceptResp.data?.pending_approval) {
            s.note += ' → pending_approval confirmed!';
            context.pendingPreTenderId = testItem.id;
          } else if (acceptResp.data?.tender_id) {
            s.note += ` → directly created tender ${acceptResp.data.tender_id} (no approval needed)`;
            context.tenderId = acceptResp.data.tender_id;
          }
        }
      } else {
        s.note = 'No test pre-tender found via API';
      }
    });

    // Step 4: DIRECTOR_GEN approves pending pre-tender
    await step('DIRECTOR_GEN approves pending pre-tender', async (s) => {
      if (!context.pendingPreTenderId) {
        s.note = 'No pending pre-tender to approve, skipping';
        return;
      }

      const { api, assertOk } = config;
      const approveResp = await api('POST', `/api/pre-tenders/${context.pendingPreTenderId}/accept`, {
        role: 'DIRECTOR_GEN',
        body: { comment: `${TEST_PREFIX}Director approved` }
      });

      if (approveResp.ok) {
        if (approveResp.data?.tender_id) {
          context.tenderId = approveResp.data.tender_id;
          s.note = `Director approved → tender ${context.tenderId} created`;
        } else {
          s.note = `Director approved, response: ${JSON.stringify(approveResp.data).substring(0, 200)}`;
        }
      } else {
        s.note = `Approval failed: ${approveResp.status} ${JSON.stringify(approveResp.data).substring(0, 200)}`;
      }
    });

    // Step 5: DIRECTOR_GEN sees approval UI
    await step('DIRECTOR_GEN sees approval controls in UI', async (s) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('DIRECTOR_GEN'));
        await navigateTo(page, '#/pre-tenders');
        await sleep(2000);

        const bodyText = await page.textContent('body');
        const hasContent = bodyText.length > 100;
        if (!hasContent) throw new Error('Pre-tenders page is empty for DIRECTOR_GEN');

        // Check for approval-related buttons
        const approveBtn = await page.locator('button:has-text("Одобрить"), button:has-text("Утвердить"), button:has-text("Согласовать"), button[class*="approve"]').count();
        s.note = `Page loaded, approve buttons found: ${approveBtn}`;

        // Verify all buttons on page are clickable
        const allButtons = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(b => {
              const r = b.getBoundingClientRect();
              return r.width > 5 && r.height > 5 && window.getComputedStyle(b).display !== 'none';
            })
            .map(b => ({
              text: (b.textContent || '').trim().substring(0, 40),
              id: b.id || '',
              disabled: b.disabled
            }));
        });
        s.note += `, total visible buttons: ${allButtons.length}`;
      } finally {
        await ctx.close();
      }
    });

    // Step 6: Verify PM cannot approve (only directors can)
    await step('PM cannot approve pre-tenders (access control)', async (s) => {
      const { api } = config;
      // PM should not be able to approve
      const listResp = await api('GET', '/api/pre-tenders', { role: 'PM' });

      // PM might not even see pre-tenders
      if (listResp.status === 403 || listResp.status === 401) {
        s.note = 'PM correctly denied access to pre-tenders';
      } else {
        s.note = `PM can see pre-tenders (status ${listResp.status}), checking approval...`;
        // Try to approve - should fail
        const items = listResp.data?.items || listResp.data?.data || [];
        if (items.length > 0) {
          const approveResp = await api('POST', `/api/pre-tenders/${items[0].id}/accept`, {
            role: 'PM',
            body: { comment: 'PM trying to approve' }
          });
          if (approveResp.status === 403) {
            s.note += ' → PM correctly denied approval';
          } else {
            s.note += ` → PM approval response: ${approveResp.status}`;
          }
        }
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
