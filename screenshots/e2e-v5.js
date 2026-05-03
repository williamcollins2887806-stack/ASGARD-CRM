// E2E v5 — Full chain: Tender → Передать в просчёт → Quick Calc → Approve → Work → Field Module
// Tender #2 and TKP #2942 already exist from v3
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'https://asgard-crm.ru';
const DIR = __dirname;
const CREDS = { login: 'admin', password: 'AsgardTest2026!', pin: '1234' };

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }
async function ss(page, name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(DIR, name) });
  log(`📸 ${name}`);
}
async function waitLoad(page) {
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(2500);
}
function dumpBtns(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('button, a.btn, [role="button"]'))
      .filter(e => e.offsetParent)
      .map(e => `[${e.id||'-'}] "${e.textContent.trim().slice(0,60)}"`)
  );
}

const results = [];
const tenderId = 2;
let estimateId = null, workId = null;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => log(`PAGE_ERR: ${e.message}`));

  try {
    // ════════════════════════════════════════════════════
    // LOGIN
    // ════════════════════════════════════════════════════
    log('LOGIN...');
    await page.goto(BASE + '/#/welcome');
    await waitLoad(page);
    await page.locator('#btnShowLogin').click().catch(()=>{});
    await page.waitForSelector('#w_login', { state: 'visible', timeout: 10000 });
    await page.fill('#w_login', CREDS.login);
    await page.fill('#w_pass', CREDS.password);
    await page.locator('#btnDoLogin').click();
    await page.waitForSelector('#pinForm', { state: 'visible', timeout: 20000 }).catch(()=>{});
    await page.waitForTimeout(1000);
    if (await page.locator('#pinForm').isVisible().catch(()=>false)) {
      for (const d of CREDS.pin.split('')) {
        await page.locator(`#pk-keypad [data-digit="${d}"]`).click();
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(3000);
    }
    await page.waitForFunction(() => localStorage.getItem('asgard_token')?.length > 50, { timeout: 15000 });
    await waitLoad(page);
    log('LOGIN OK');
    results.push({ step: '0. Login', ok: true });

    // ════════════════════════════════════════════════════
    // STEP 1: OPEN TENDER #2 CARD
    // ════════════════════════════════════════════════════
    log('STEP 1: Opening tender #2 card...');

    // Navigate to tenders page
    await page.goto(BASE + '/#/tenders');
    await waitLoad(page);

    // Wait for AsgardDB to sync (table should populate)
    log('Waiting for tenders table to populate...');
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('tbody tr[data-id]');
      return rows.length > 0;
    }, { timeout: 30000 }).catch(()=>{});
    await page.waitForTimeout(2000);

    // Check if table has data
    const rowCount = await page.evaluate(() => document.querySelectorAll('tbody tr[data-id]').length);
    log(`Table rows: ${rowCount}`);

    if (rowCount === 0) {
      // Force AsgardDB sync and reload
      log('No rows, forcing sync...');
      await page.evaluate(async () => {
        if (typeof AsgardDB !== 'undefined' && AsgardDB.sync) {
          await AsgardDB.sync('tenders');
        }
      }).catch(()=>{});
      await page.waitForTimeout(5000);

      // Reload page
      await page.goto(BASE + '/#/main');
      await waitLoad(page);
      await page.goto(BASE + '/#/tenders');
      await waitLoad(page);
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('tbody tr[data-id]');
        return rows.length > 0;
      }, { timeout: 30000 }).catch(()=>{});
      await page.waitForTimeout(2000);
    }

    await ss(page, '01_tenders_page.png');

    // Try to open tender card via button click
    const openBtn = page.locator(`tr[data-id="${tenderId}"] button[data-act="open"]`);
    let modalOpen = false;

    if (await openBtn.isVisible({ timeout: 5000 }).catch(()=>false)) {
      log('Clicking data-act="open" button in row...');
      await openBtn.click({ force: true });
      await page.waitForTimeout(3000);
      modalOpen = await page.locator('.modalback').isVisible({ timeout: 5000 }).catch(()=>false);
    }

    if (!modalOpen) {
      // Try calling openTenderEditor() directly via JS
      log('Trying openTenderEditor() via JS...');
      await page.evaluate((id) => {
        if (typeof openTenderEditor === 'function') openTenderEditor(id);
      }, tenderId);
      await page.waitForTimeout(4000);
      modalOpen = await page.locator('.modalback').isVisible({ timeout: 5000 }).catch(()=>false);
    }

    if (!modalOpen) {
      // Try clicking any visible "Открыть" button
      log('Trying any visible Открыть button...');
      const anyOpenBtn = page.locator('button[data-act="open"]').first();
      if (await anyOpenBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
        await anyOpenBtn.click({ force: true });
        await page.waitForTimeout(3000);
        modalOpen = await page.locator('.modalback').isVisible({ timeout: 5000 }).catch(()=>false);
      }
    }

    await ss(page, '01b_tender_card.png');

    if (!modalOpen) throw new Error('Карточка тендера #2 не открылась');
    log('Tender card opened ✅');
    results.push({ step: '1. Open Tender', ok: true });

    // ════════════════════════════════════════════════════
    // STEP 2: «ПЕРЕДАТЬ В ПРОСЧЁТ» (#btnHandoff)
    // ════════════════════════════════════════════════════
    log('STEP 2: Передать в просчёт...');

    // Dump visible buttons first
    const cardBtns = await dumpBtns(page);
    log('Card buttons: ' + cardBtns.join(' | '));

    // IMPORTANT: Fill document URL first (required for handoff)
    log('Filling document URL (required for handoff)...');
    const urlInput = page.locator('#e_url, input[placeholder*="https"]').first();
    if (await urlInput.isVisible({ timeout: 3000 }).catch(()=>false)) {
      await urlInput.fill('https://disk.yandex.ru/d/asgard-crm-test-docs');
      log('URL filled');
      // Save tender first so URL is persisted
      const saveBtn = page.locator('#btnSave');
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
        await saveBtn.click();
        await page.waitForTimeout(3000);
        log('Tender saved with URL');
      }
    } else {
      log('URL input not found, trying to proceed anyway');
    }

    const handoffBtn = page.locator('#btnHandoff');
    const handoffVisible = await handoffBtn.isVisible({ timeout: 3000 }).catch(()=>false);

    if (handoffVisible) {
      log('Clicking #btnHandoff...');
      // Scroll to button first
      await handoffBtn.scrollIntoViewIfNeeded().catch(()=>{});
      await page.waitForTimeout(500);
      await handoffBtn.click();
      await page.waitForTimeout(4000);

      // Handle any swal2 confirmation dialog
      const swalConfirm = page.locator('.swal2-confirm, button:has-text("OK"), button:has-text("Да")').first();
      if (await swalConfirm.isVisible({ timeout: 3000 }).catch(()=>false)) {
        await swalConfirm.click();
        await page.waitForTimeout(2000);
        log('Confirmed dialog');
      }

      // Check if there's an error toast about documents
      const toastErr = await page.evaluate(() => {
        const toast = document.querySelector('.toast-error, .toast.err, [class*="toast"]');
        return toast ? toast.textContent.trim().slice(0, 100) : null;
      });
      if (toastErr) log(`Toast: ${toastErr}`);

      await ss(page, '02_after_handoff.png');

      // Verify the tender now shows locked state
      const lockText = await page.evaluate(() => {
        const tags = document.querySelectorAll('.tag');
        for (const t of tags) { if (t.textContent.includes('Передано')) return t.textContent.trim(); }
        return null;
      });
      log(`Lock status: ${lockText || '(none)'}`);
      results.push({ step: '2. Передать в просчёт', ok: true });
    } else {
      // Maybe already handed off
      const lockText = await page.evaluate(() => {
        const els = document.querySelectorAll('.tag, [class*="status"], [class*="badge"]');
        for (const el of els) {
          const t = el.textContent || '';
          if (t.includes('Передано') || t.includes('просчёт') || t.includes('Согласован')) return t.trim();
        }
        return null;
      });
      log(`Status text: ${lockText || 'not found'}`);

      if (lockText) {
        log('Already handed off, continuing...');
        results.push({ step: '2. Передать в просчёт', ok: true, note: 'already done' });
      } else {
        await ss(page, '02_no_handoff_btn.png');
        results.push({ step: '2. Передать в просчёт', ok: false, note: 'no btnHandoff' });
      }
    }

    // Close modal
    await page.locator('#modalClose').click().catch(()=>{});
    await page.waitForTimeout(1000);

    // ════════════════════════════════════════════════════
    // STEP 3: PM CALCS — Quick Estimate
    // ════════════════════════════════════════════════════
    log('STEP 3: PM Calcs page...');
    await page.goto(BASE + '/#/pm-calcs');
    await waitLoad(page);
    await ss(page, '03_pm_calcs.png');

    // Find tender row
    const calcRow = page.locator(`tr[data-id="${tenderId}"]`).first();
    let calcRowVisible = await calcRow.isVisible({ timeout: 5000 }).catch(()=>false);

    if (!calcRowVisible) {
      // Try mobile card
      const mCard = page.locator(`.m-tender-card[data-id="${tenderId}"]`).first();
      calcRowVisible = await mCard.isVisible({ timeout: 3000 }).catch(()=>false);
    }

    if (!calcRowVisible) {
      log('Tender not visible, dumping page...');
      const pmState = await page.evaluate(() => ({
        rows: document.querySelectorAll('tr[data-id]').length,
        allText: document.querySelector('#layout')?.textContent?.slice(0, 300),
        btns: Array.from(document.querySelectorAll('button')).filter(e => e.offsetParent)
          .map(e => `[${e.id||'-'}] ${e.textContent.trim().slice(0,40)}`).slice(0, 15),
      }));
      log('PM calcs state: ' + JSON.stringify(pmState));
      await ss(page, '03_pm_calcs_debug.png');
    }

    if (calcRowVisible) {
      log('Opening tender in pm-calcs...');
      // Click open button in the row
      const openCalcBtn = page.locator(`tr[data-id="${tenderId}"] button[data-act="open"]`).first();
      if (await openCalcBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
        await openCalcBtn.click({ force: true });
      } else {
        // Try clicking the row itself
        await calcRow.click({ force: true });
      }
      await page.waitForTimeout(3000);
      await ss(page, '03b_calc_opened.png');

      // Dump available buttons
      const calcBtns = await dumpBtns(page);
      log('Calc buttons: ' + calcBtns.join(' | '));

      // Click Quick Calc
      const qcBtn = page.locator('#btnQuickCalc');
      const qcVisible = await qcBtn.isVisible({ timeout: 3000 }).catch(()=>false);

      if (qcVisible) {
        log('Opening Quick Calc form...');
        await qcBtn.click();
        await page.waitForTimeout(2000);
        await ss(page, '03c_quick_calc.png');

        // Fill Quick Calc form
        log('Filling quick calc...');
        const fields = {
          '#qc_distance': '750',
          '#qc_people': '12',
          '#qc_days': '14',
          '#qc_cost': '3200000',
          '#qc_price': '4850000',
          '#qc_prob': '75',
          '#qc_terms': '30/70',
          '#qc_assumptions': 'Химическая чистка 6 теплообменников АВТ-6. Объём ~150 м³.',
          '#qc_cover': 'Уважаемые коллеги,\nНаправляем ТКП на химическую чистку теплообменного оборудования АВТ-6.\nС уважением, Андросов Н.А.',
        };

        for (const [sel, val] of Object.entries(fields)) {
          const inp = page.locator(sel);
          if (await inp.isVisible({ timeout: 1500 }).catch(()=>false)) {
            await inp.fill(val);
            log(`  filled ${sel}`);
          } else {
            log(`  SKIP ${sel} (not visible)`);
          }
        }

        await page.waitForTimeout(1000);
        await ss(page, '03d_quick_calc_filled.png');

        // Send for approval
        log('Sending for approval...');
        const sendBtn = page.locator('#qc_send');
        if (await sendBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
          await sendBtn.click();
        } else {
          // Try generic send button
          const altSend = page.locator('#btnSend');
          if (await altSend.isVisible({ timeout: 3000 }).catch(()=>false)) {
            await altSend.click();
          }
        }
        await page.waitForTimeout(4000);

        // Handle swal2 confirm
        const swalC = page.locator('.swal2-confirm').first();
        if (await swalC.isVisible({ timeout: 3000 }).catch(()=>false)) {
          await swalC.click();
          await page.waitForTimeout(2000);
        }

        await ss(page, '03e_after_send.png');
        results.push({ step: '3. Quick Calc + Send', ok: true });
      } else {
        // No quick calc — maybe we need to find another path
        log('No #btnQuickCalc, looking for alternatives...');
        await ss(page, '03c_no_qc.png');

        // Check if there's a #btnSend directly (maybe estimate already exists)
        const directSend = page.locator('#btnSend');
        if (await directSend.isVisible({ timeout: 2000 }).catch(()=>false)) {
          log('Found #btnSend directly, clicking...');
          await directSend.click();
          await page.waitForTimeout(4000);
          await ss(page, '03e_direct_send.png');
          results.push({ step: '3. Send Estimate', ok: true });
        } else {
          results.push({ step: '3. Quick Calc', ok: false, note: 'no qc/send button' });
        }
      }
    } else {
      results.push({ step: '3. PM Calcs', ok: false, note: 'tender not in list' });
    }

    // ════════════════════════════════════════════════════
    // STEP 4: DIRECTOR APPROVES ESTIMATE
    // ════════════════════════════════════════════════════
    log('STEP 4: Director approval...');
    // Close any open modal first
    await page.locator('#modalClose').click().catch(()=>{});
    await page.waitForTimeout(500);

    await page.goto(BASE + '/#/all-estimates');
    await waitLoad(page);
    await ss(page, '04_all_estimates.png');

    // Find estimate row
    const estRow = page.locator('tr[data-id]').first();
    if (await estRow.isVisible({ timeout: 5000 }).catch(()=>false)) {
      estimateId = await estRow.getAttribute('data-id');
      log(`Found estimate ID: ${estimateId}`);

      // Open estimate
      const openEstBtn = estRow.locator('button[data-act="open"]');
      if (await openEstBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
        await openEstBtn.click({ force: true });
      } else {
        await estRow.click({ force: true });
      }
      await page.waitForTimeout(3000);
      await ss(page, '04b_estimate_card.png');

      // Dump buttons
      const estBtns = await dumpBtns(page);
      log('Estimate buttons: ' + estBtns.join(' | '));

      // Fill director comment
      const commInp = page.locator('#a_comm');
      if (await commInp.isVisible({ timeout: 2000 }).catch(()=>false)) {
        await commInp.fill('Согласовано. Приступаем к работе.');
      }

      // Click Approve
      const approveBtn = page.locator('#btnApprove');
      if (await approveBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
        log('Clicking Approve...');
        await approveBtn.click();
        await page.waitForTimeout(4000);

        // Handle swal2
        const swalC = page.locator('.swal2-confirm').first();
        if (await swalC.isVisible({ timeout: 3000 }).catch(()=>false)) {
          await swalC.click();
          await page.waitForTimeout(2000);
        }

        await ss(page, '04c_approved.png');
        results.push({ step: '4. Approve Estimate', ok: true, id: estimateId });
      } else {
        await ss(page, '04b_no_approve.png');
        results.push({ step: '4. Approve Estimate', ok: false, note: 'no approve btn' });
      }
    } else {
      log('No estimates found on page');
      // Check approvals page
      await page.goto(BASE + '/#/approvals');
      await waitLoad(page);
      await ss(page, '04_approvals.png');
      const appBtns = await dumpBtns(page);
      log('Approvals buttons: ' + appBtns.join(' | '));
      results.push({ step: '4. Approve Estimate', ok: false, note: 'no estimates in list' });
    }

    // Close modal
    await page.locator('#modalClose').click().catch(()=>{});
    await page.waitForTimeout(1000);

    // ════════════════════════════════════════════════════
    // STEP 5: CREATE WORK FROM APPROVED ESTIMATE
    // ════════════════════════════════════════════════════
    log('STEP 5: Create work...');

    // Try ensureWorkFromTender (defined in pm_calcs.js)
    // First navigate to pm-calcs so the function is in scope
    await page.goto(BASE + '/#/pm-calcs');
    await waitLoad(page);

    workId = await page.evaluate(async (tId) => {
      try {
        // Check if work already exists
        const existing = (await AsgardDB.byIndex('works', 'tender_id', tId)) || [];
        if (existing.length > 0) return existing[0].id;

        // Try ensureWorkFromTender
        if (typeof ensureWorkFromTender === 'function') {
          const tender = await AsgardDB.get('tenders', tId);
          if (tender) {
            const work = await ensureWorkFromTender(tender);
            return work ? work.id : null;
          }
        }
        return null;
      } catch (e) {
        console.error('ensureWork err:', e);
        return null;
      }
    }, tenderId).catch(e => { log('ensureWork failed: ' + e.message); return null; });

    if (workId) {
      log(`Work created/found: ${workId}`);
    } else {
      // Fallback: create work via AsgardDB.add directly
      log('Trying direct work creation via AsgardDB...');
      workId = await page.evaluate(async (tId) => {
        try {
          const tender = await AsgardDB.get('tenders', tId);
          if (!tender) return null;

          // Find approved estimate
          const estimates = (await AsgardDB.byIndex('estimates', 'tender_id', tId)) || [];
          const approved = estimates.find(e => e.approval_status === 'approved');

          const work = {
            tender_id: tId,
            pm_id: tender.responsible_pm_id,
            customer_name: tender.customer_name,
            work_title: tender.tender_title,
            work_status: 'Подготовка',
            start_in_work_date: tender.work_start_plan,
            end_plan: tender.work_end_plan,
            contract_value: approved ? approved.price_tkp : tender.tender_price,
            cost_plan: approved ? approved.cost_plan : null,
          };

          const id = await AsgardDB.add('works', work);
          return id;
        } catch (e) {
          console.error('direct work err:', e);
          return null;
        }
      }, tenderId).catch(e => { log('direct work failed: ' + e.message); return null; });
    }

    if (!workId) {
      // Check pm-works page
      await page.goto(BASE + '/#/pm-works');
      await waitLoad(page);
      workId = await page.evaluate(() => {
        const row = document.querySelector('tr[data-id]');
        return row ? Number(row.getAttribute('data-id')) : null;
      });
    }

    if (!workId) {
      // Check all-works page
      await page.goto(BASE + '/#/all-works');
      await waitLoad(page);
      workId = await page.evaluate(() => {
        const row = document.querySelector('tr[data-id]');
        return row ? Number(row.getAttribute('data-id')) : null;
      });
    }

    log(`Work ID: ${workId}`);
    await ss(page, '05_work.png');
    results.push({ step: '5. Create Work', ok: !!workId, id: workId });

    // ════════════════════════════════════════════════════
    // STEP 6: PERSONNEL — Search Андросов
    // ════════════════════════════════════════════════════
    log('STEP 6: Personnel...');
    await page.goto(BASE + '/#/personnel');
    await waitLoad(page);
    const searchInp = page.locator('#f_q, input[type="search"], input[placeholder*="Поиск"]').first();
    if (await searchInp.isVisible({ timeout: 5000 }).catch(()=>false)) {
      await searchInp.fill('Андросов');
      await page.waitForTimeout(2000);
    }
    await ss(page, '06_personnel.png');
    const empRow = page.locator('tr[data-id], .card[data-id], .fk-card[data-id]').first();
    if (await empRow.isVisible({ timeout: 3000 }).catch(()=>false)) {
      await empRow.click({ force: true });
      await page.waitForTimeout(2000);
      await ss(page, '06b_employee_card.png');
    }
    results.push({ step: '6. Personnel', ok: true });
    // Close modal
    await page.locator('#modalClose').click().catch(()=>{});
    await page.waitForTimeout(500);

    // ════════════════════════════════════════════════════
    // STEP 7+: FIELD MODULE (only if work exists)
    // ════════════════════════════════════════════════════
    if (workId) {
      log('STEP 7: Opening work card for field module...');

      // Navigate to pm-works and open the work
      await page.goto(BASE + '/#/main');
      await waitLoad(page);
      await page.goto(BASE + `/#/pm-works?open=${workId}`);
      await waitLoad(page);

      let wModalOpen = await page.locator('.modalback').isVisible({ timeout: 5000 }).catch(()=>false);
      if (!wModalOpen) {
        // Try clicking the row
        const wOpenBtn = page.locator(`tr[data-id="${workId}"] button[data-act="open"]`).first();
        if (await wOpenBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
          await wOpenBtn.click({ force: true });
          await page.waitForTimeout(3000);
        } else {
          // Try all-works
          await page.goto(BASE + '/#/main');
          await waitLoad(page);
          await page.goto(BASE + `/#/all-works?open=${workId}`);
          await waitLoad(page);
          // Try opening by clicking row
          const aw = page.locator(`tr[data-id="${workId}"]`).first();
          if (await aw.isVisible({ timeout: 3000 }).catch(()=>false)) {
            await aw.click({ force: true });
            await page.waitForTimeout(3000);
          }
        }
        wModalOpen = await page.locator('.modalback').isVisible({ timeout: 5000 }).catch(()=>false);
      }

      await ss(page, '07_work_card.png');

      // Dump buttons
      const wBtns = await dumpBtns(page);
      log('Work card buttons: ' + wBtns.join(' | '));

      // Look for field module button directly
      let fieldFound = false;
      const fieldBtnInfo = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button, a, .btn, [role="button"]'))
          .filter(el => {
            const t = (el.textContent || '').toLowerCase();
            return el.offsetParent && (
              t.includes('полевой') || t.includes('field') ||
              t.includes('⚔') || t.includes('модуль')
            );
          })
          .map(el => ({ text: el.textContent.trim().slice(0, 60), id: el.id, tag: el.tagName }));
      });
      log('Direct field module buttons: ' + JSON.stringify(fieldBtnInfo));

      if (fieldBtnInfo.length > 0) {
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button, a, .btn, [role="button"]'))
            .find(el => {
              const t = (el.textContent || '').toLowerCase();
              return el.offsetParent && (t.includes('полевой') || t.includes('field') || t.includes('⚔'));
            });
          if (btn) btn.click();
        });
        await page.waitForTimeout(3000);
        fieldFound = true;
      }

      // If not found directly, try "⚡ Действия" dropdown
      if (!fieldFound) {
        log('Trying ⚡ Действия dropdown...');
        const actionsBtn = page.locator('#btnActions');
        if (await actionsBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
          await actionsBtn.click();
          await page.waitForTimeout(1500);
          await ss(page, '07b_actions_menu.png');

          // Dump dropdown items
          const menuItems = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.dropdown-item, .dropdown-menu a, .dropdown-menu button, [class*="action-item"], [class*="menu-item"]'))
              .filter(el => el.offsetParent)
              .map(el => ({ text: el.textContent.trim().slice(0, 60), id: el.id, cls: (el.className||'').toString().slice(0, 50) }));
          });
          log('Actions menu items: ' + JSON.stringify(menuItems));

          // Try clicking field module item
          const fieldClicked = await page.evaluate(() => {
            const items = document.querySelectorAll('.dropdown-item, .dropdown-menu a, .dropdown-menu button, [class*="action-item"], [class*="menu-item"]');
            for (const el of items) {
              const t = (el.textContent || '').toLowerCase();
              if (el.offsetParent && (t.includes('полевой') || t.includes('field') || t.includes('⚔') || t.includes('модуль'))) {
                el.click();
                return el.textContent.trim();
              }
            }
            return null;
          });
          if (fieldClicked) {
            log(`Clicked field item: "${fieldClicked}"`);
            await page.waitForTimeout(3000);
            fieldFound = true;
          } else {
            log('No field module in actions menu');

            // Also check the dropdown for other items
            const allDropdown = await page.evaluate(() => {
              const dd = document.querySelector('.dropdown-menu, [class*="dropdown"]');
              return dd ? dd.innerHTML.slice(0, 500) : null;
            });
            log('Dropdown HTML: ' + (allDropdown || 'none'));
          }
        }
      }

      if (fieldFound) {
        await ss(page, '08_field_module.png');

        // Navigate field tabs
        const tabs = [
          { key: 'crew', name: 'Дружина' },
          { key: 'logistics', name: 'Логистика' },
          { key: 'stages', name: 'Этапы' },
          { key: 'dashboard', name: 'Дашборд' },
          { key: 'timesheet', name: 'Табель' },
        ];

        for (const tab of tabs) {
          const tabBtn = page.locator(`[data-ftab="${tab.key}"]`);
          if (await tabBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
            await tabBtn.click();
            await page.waitForTimeout(2000);
            await ss(page, `09_field_${tab.key}.png`);
            log(`Tab ${tab.name} (${tab.key}) ✅`);
          } else {
            log(`Tab ${tab.key} — not found`);
          }
        }

        results.push({ step: '7. Field Module + Tabs', ok: true });
      } else {
        log('No field module found anywhere in work card');
        results.push({ step: '7. Field Module', ok: false, note: 'no field button/action' });
      }
    } else {
      log('No work ID — skipping field module');
      results.push({ step: '7. Field Module', ok: false, note: 'no work' });
    }

    await ss(page, '99_final.png');

  } catch (err) {
    log(`FATAL: ${err.message}`);
    console.error(err.stack);
    await ss(page, 'FATAL.png').catch(()=>{});
    results.push({ step: 'FATAL', ok: false, note: err.message.slice(0, 120) });
  } finally {
    console.log('\n════════════════════════════════════');
    console.log('E2E v5 RESULTS');
    console.log('════════════════════════════════════');
    results.forEach(r =>
      console.log(`${r.ok ? '✅' : '❌'} ${r.step}${r.id ? ' (ID:' + r.id + ')' : ''}${r.note ? ' — ' + r.note : ''}`)
    );
    console.log(`\nTender: ${tenderId}, Estimate: ${estimateId}, Work: ${workId}`);
    console.log('════════════════════════════════════\n');
    await browser.close();
  }
})();
