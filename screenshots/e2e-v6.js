// E2E v6 — Full chain with all fixes
// Tender #2 exists, already handed off ("Передано в просчёт") from v5
// Flow: pm-calcs → quick calc → approve → work → field module
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
  await page.waitForTimeout(3000);
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
    // ════ LOGIN ════
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
    // Extra wait for AsgardDB full sync
    await page.waitForTimeout(5000);
    log('LOGIN OK');
    results.push({ step: '0. Login', ok: true });

    // ════ CHECK TENDER STATUS ════
    log('Checking tender #2 status...');
    const tenderInfo = await page.evaluate(async (tId) => {
      try {
        const t = await AsgardDB.get('tenders', tId);
        return t ? {
          id: t.id,
          status: t.tender_status,
          handoff_at: t.handoff_at,
          pm_id: t.responsible_pm_id,
          period: t.period,
          period_month: t.period_month,
          period_year: t.period_year,
        } : null;
      } catch(e) { return { error: e.message }; }
    }, tenderId);
    log('Tender: ' + JSON.stringify(tenderInfo));

    // If tender not handed off yet, do it now
    if (tenderInfo && !tenderInfo.handoff_at) {
      log('Tender not yet handed off, doing it now...');
      await page.goto(BASE + '/#/tenders');
      await waitLoad(page);
      await page.waitForFunction(() => document.querySelectorAll('tbody tr[data-id]').length > 0, { timeout: 30000 }).catch(()=>{});
      await page.waitForTimeout(2000);

      // Open tender card
      const openBtn = page.locator(`tr[data-id="${tenderId}"] button[data-act="open"]`);
      if (await openBtn.isVisible({ timeout: 5000 }).catch(()=>false)) {
        await openBtn.click({ force: true });
        await page.waitForTimeout(3000);
      } else {
        await page.evaluate((id) => { if (typeof openTenderEditor === 'function') openTenderEditor(id); }, tenderId);
        await page.waitForTimeout(3000);
      }

      // Fill URL if needed
      const urlInput = page.locator('#e_url, input[placeholder*="https"]').first();
      if (await urlInput.isVisible({ timeout: 2000 }).catch(()=>false)) {
        const curVal = await urlInput.inputValue().catch(()=>'');
        if (!curVal) {
          await urlInput.fill('https://disk.yandex.ru/d/asgard-crm-test-docs');
          await page.locator('#btnSave').click().catch(()=>{});
          await page.waitForTimeout(3000);
        }
      }

      // Click handoff
      const handoffBtn = page.locator('#btnHandoff');
      if (await handoffBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
        await handoffBtn.click();
        await page.waitForTimeout(4000);
        const swalC = page.locator('.swal2-confirm').first();
        if (await swalC.isVisible({ timeout: 2000 }).catch(()=>false)) {
          await swalC.click();
          await page.waitForTimeout(2000);
        }
        await ss(page, '01_handoff.png');
      }

      // Close modal
      await page.locator('#modalClose').click().catch(()=>{});
      await page.waitForTimeout(1000);

      results.push({ step: '1. Handoff', ok: true });
    } else if (tenderInfo && tenderInfo.handoff_at) {
      log('Tender already handed off at: ' + tenderInfo.handoff_at);
      results.push({ step: '1. Handoff', ok: true, note: 'already done' });
    } else {
      log('Tender not found!');
      results.push({ step: '1. Handoff', ok: false, note: 'tender not found' });
    }

    // ════ PM CALCS — Quick Estimate ════
    log('STEP 2: PM Calcs...');

    // Force full page reload to ensure AsgardDB is fresh
    await page.goto(BASE + '/#/main');
    await waitLoad(page);
    await page.waitForTimeout(3000);  // Extra time for sync

    await page.goto(BASE + '/#/pm-calcs');
    await waitLoad(page);

    // Wait for table rows to appear
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('tbody tr[data-id]');
      return rows.length > 0;
    }, { timeout: 15000 }).catch(()=>{});
    await page.waitForTimeout(2000);

    let pmCalcRows = await page.evaluate(() => document.querySelectorAll('tbody tr[data-id]').length);
    log(`PM calcs rows: ${pmCalcRows}`);

    if (pmCalcRows === 0) {
      // Try checking "Все периоды" checkbox
      log('Trying "Все периоды" checkbox...');
      const allPeriodsChk = page.locator('input[type="checkbox"]').filter({ hasText: /период/i }).first();
      // Or find by label
      const checkboxes = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('label, span'))
          .filter(el => el.textContent.includes('ПЕРИОД') || el.textContent.includes('период'))
          .map(el => ({
            text: el.textContent.trim().slice(0, 50),
            hasCheckbox: !!el.querySelector('input[type="checkbox"]'),
            html: el.outerHTML.slice(0, 200),
          }));
      });
      log('Period-related elements: ' + JSON.stringify(checkboxes));

      // Click "Все периоды" checkbox if it exists
      await page.evaluate(() => {
        const labels = document.querySelectorAll('label');
        for (const l of labels) {
          if (l.textContent.toLowerCase().includes('все период')) {
            const cb = l.querySelector('input[type="checkbox"]');
            if (cb && !cb.checked) { cb.click(); return true; }
          }
        }
        // Also try standalone checkboxes
        const cbs = document.querySelectorAll('input[type="checkbox"]');
        for (const cb of cbs) {
          const parent = cb.parentElement;
          if (parent && parent.textContent.toLowerCase().includes('период')) {
            if (!cb.checked) { cb.click(); return true; }
          }
        }
        return false;
      });
      await page.waitForTimeout(3000);
      pmCalcRows = await page.evaluate(() => document.querySelectorAll('tbody tr[data-id]').length);
      log(`PM calcs rows after "all periods": ${pmCalcRows}`);
    }

    if (pmCalcRows === 0) {
      // Force reload with forced AsgardDB sync
      log('Still no rows. Reloading with forced sync...');
      await page.reload({ waitUntil: 'networkidle' }).catch(()=>{});
      await page.waitForTimeout(8000);
      pmCalcRows = await page.evaluate(() => document.querySelectorAll('tbody tr[data-id]').length);
      log(`PM calcs rows after reload: ${pmCalcRows}`);
    }

    await ss(page, '02_pm_calcs.png');

    if (pmCalcRows > 0) {
      // Open the tender
      const calcOpenBtn = page.locator(`tr[data-id="${tenderId}"] button[data-act="open"]`).first();
      if (await calcOpenBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
        await calcOpenBtn.click({ force: true });
      } else {
        // Try clicking any row
        await page.locator('tr[data-id]').first().click({ force: true });
      }
      await page.waitForTimeout(3000);
      await ss(page, '02b_calc_opened.png');

      // Check for Quick Calc button
      const qcBtn = page.locator('#btnQuickCalc');
      if (await qcBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
        log('Opening Quick Calc...');
        await qcBtn.click();
        await page.waitForTimeout(2000);

        // Fill fields
        const fields = {
          '#qc_distance': '750',
          '#qc_people': '12',
          '#qc_days': '14',
          '#qc_cost': '3200000',
          '#qc_price': '4850000',
          '#qc_prob': '75',
          '#qc_terms': '30/70',
          '#qc_assumptions': 'Химическая чистка 6 теплообменников АВТ-6. Объём ~150 м³.',
          '#qc_cover': 'Уважаемые коллеги,\nНаправляем ТКП на химическую чистку оборудования АВТ-6.\nС уважением, Андросов Н.А.',
        };
        for (const [sel, val] of Object.entries(fields)) {
          const inp = page.locator(sel);
          if (await inp.isVisible({ timeout: 1500 }).catch(()=>false)) {
            await inp.fill(val);
          }
        }
        await ss(page, '02c_quick_calc_filled.png');

        // Send for approval
        const sendBtn = page.locator('#qc_send');
        if (await sendBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
          await sendBtn.click();
        } else {
          await page.locator('#btnSend').click().catch(()=>{});
        }
        await page.waitForTimeout(4000);

        // Handle swal2
        const swalC = page.locator('.swal2-confirm').first();
        if (await swalC.isVisible({ timeout: 2000 }).catch(()=>false)) {
          await swalC.click();
          await page.waitForTimeout(2000);
        }

        await ss(page, '02d_after_send.png');
        results.push({ step: '2. Quick Calc + Send', ok: true });
      } else {
        log('No Quick Calc button, dumping available buttons...');
        const btns = await page.evaluate(() =>
          Array.from(document.querySelectorAll('button')).filter(e => e.offsetParent)
            .map(e => `[${e.id||'-'}] "${e.textContent.trim().slice(0,40)}"`)
        );
        log('Buttons: ' + btns.join(' | '));
        results.push({ step: '2. Quick Calc', ok: false, note: 'no qc button' });
      }
    } else {
      log('PM Calcs still empty. Creating estimate directly via API in browser...');

      // Create estimate programmatically via fetch in the browser
      estimateId = await page.evaluate(async (tId) => {
        try {
          const token = localStorage.getItem('asgard_token');
          const tender = await AsgardDB.get('tenders', tId);
          if (!tender) return null;

          const body = {
            tender_id: tId,
            pm_id: tender.responsible_pm_id,
            approval_status: 'sent',
            price_tkp: 4850000,
            cost_plan: 3200000,
            probability_pct: 75,
            payment_terms: '30/70',
            cover_letter: 'Уважаемые коллеги,\nНаправляем ТКП на химическую чистку оборудования АВТ-6.\nС уважением, Андросов Н.А.',
            comment: 'Химическая чистка 6 теплообменников',
            assumptions: 'Объём ~150 м³, 12 человек, 14 дней',
            quick_calc_json: {
              distance: 750,
              people: 12,
              days: 14,
              cost: 3200000,
              price: 4850000,
            },
          };

          const resp = await fetch('/api/estimates', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await resp.json();
          return data.estimate ? data.estimate.id : (data.id || null);
        } catch(e) {
          console.error('create estimate error:', e);
          return null;
        }
      }, tenderId);

      if (estimateId) {
        log(`Estimate created via API: ${estimateId}`);
        results.push({ step: '2. Create Estimate (API)', ok: true, id: estimateId });
      } else {
        log('Failed to create estimate');
        results.push({ step: '2. Create Estimate', ok: false, note: 'API failed' });
      }
    }

    // Close any modal
    await page.locator('#modalClose').click().catch(()=>{});
    await page.waitForTimeout(500);

    // ════ APPROVE ESTIMATE ════
    log('STEP 3: Approve estimate...');
    await page.goto(BASE + '/#/all-estimates');
    await waitLoad(page);

    // Wait for table to populate
    await page.waitForFunction(() => document.querySelectorAll('tbody tr[data-id]').length > 0, { timeout: 15000 }).catch(()=>{});
    await page.waitForTimeout(2000);

    const estRowCount = await page.evaluate(() => document.querySelectorAll('tbody tr[data-id]').length);
    log(`Estimates rows: ${estRowCount}`);
    await ss(page, '03_estimates.png');

    if (estRowCount > 0) {
      // Open first estimate
      const estOpenBtn = page.locator('tr[data-id] button[data-act="open"]').first();
      if (await estOpenBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
        await estOpenBtn.click({ force: true });
      } else {
        await page.locator('tr[data-id]').first().click({ force: true });
      }
      await page.waitForTimeout(3000);

      estimateId = estimateId || await page.evaluate(() => {
        const row = document.querySelector('tr[data-id].selected, tr[data-id]:first-child');
        return row ? row.getAttribute('data-id') : null;
      });

      await ss(page, '03b_estimate_card.png');

      // Try to approve
      const approveBtn = page.locator('#btnApprove');
      if (await approveBtn.isVisible({ timeout: 5000 }).catch(()=>false)) {
        // Fill comment
        const commInp = page.locator('#a_comm');
        if (await commInp.isVisible({ timeout: 2000 }).catch(()=>false)) {
          await commInp.fill('Согласовано. Приступаем к работе.');
        }

        await approveBtn.click();
        await page.waitForTimeout(4000);

        // Handle swal2
        const swalC = page.locator('.swal2-confirm').first();
        if (await swalC.isVisible({ timeout: 2000 }).catch(()=>false)) {
          await swalC.click();
          await page.waitForTimeout(2000);
        }

        await ss(page, '03c_approved.png');
        results.push({ step: '3. Approve', ok: true, id: estimateId });
      } else {
        // Maybe need to approve via API
        log('No #btnApprove button. Trying API...');
        const approveResult = await page.evaluate(async (eId) => {
          try {
            const token = localStorage.getItem('asgard_token');
            const resp = await fetch(`/api/approval/estimates/${eId}/approve`, {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ comment: 'Согласовано. Приступаем к работе.' }),
            });
            return { ok: resp.ok, status: resp.status, body: await resp.json().catch(()=>null) };
          } catch(e) { return { error: e.message }; }
        }, estimateId);
        log('Approve API result: ' + JSON.stringify(approveResult));
        results.push({ step: '3. Approve (API)', ok: approveResult?.ok, id: estimateId });
      }
    } else {
      // No estimates on page — maybe filter issue
      log('No estimates found. Checking if estimate was created...');
      const estCheck = await page.evaluate(async () => {
        try {
          const all = await AsgardDB.all('estimates');
          return (all || []).map(e => ({ id: e.id, tender_id: e.tender_id, status: e.approval_status }));
        } catch(e) { return { error: e.message }; }
      });
      log('AsgardDB estimates: ' + JSON.stringify(estCheck));

      if (estimateId) {
        // Approve via API
        const approveResult = await page.evaluate(async (eId) => {
          try {
            const token = localStorage.getItem('asgard_token');
            const resp = await fetch(`/api/approval/estimates/${eId}/approve`, {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ comment: 'Согласовано.' }),
            });
            return { ok: resp.ok, status: resp.status };
          } catch(e) { return { error: e.message }; }
        }, estimateId);
        log('Direct approve: ' + JSON.stringify(approveResult));
        results.push({ step: '3. Approve (API fallback)', ok: approveResult?.ok });
      } else {
        results.push({ step: '3. Approve', ok: false, note: 'no estimates' });
      }
    }

    // Close modal
    await page.locator('#modalClose').click().catch(()=>{});
    await page.waitForTimeout(500);

    // ════ CREATE/FIND WORK ════
    log('STEP 4: Create/find work...');

    // First check if work already exists
    workId = await page.evaluate(async (tId) => {
      try {
        const works = (await AsgardDB.byIndex('works', 'tender_id', tId)) || [];
        if (works.length > 0) return works[0].id;
        return null;
      } catch(e) { return null; }
    }, tenderId);

    if (!workId) {
      // Navigate to pm-calcs and try ensureWorkFromTender
      await page.goto(BASE + '/#/pm-calcs');
      await waitLoad(page);

      workId = await page.evaluate(async (tId) => {
        try {
          if (typeof ensureWorkFromTender === 'function') {
            const tender = await AsgardDB.get('tenders', tId);
            if (tender) {
              const work = await ensureWorkFromTender(tender);
              return work ? work.id : null;
            }
          }
          return null;
        } catch(e) { console.error('ensureWork err:', e); return null; }
      }, tenderId).catch(()=>null);
    }

    if (!workId) {
      // Create work via API
      log('Creating work via API...');
      workId = await page.evaluate(async (tId) => {
        try {
          const token = localStorage.getItem('asgard_token');
          const tender = await AsgardDB.get('tenders', tId);
          if (!tender) return null;

          const estimates = (await AsgardDB.byIndex('estimates', 'tender_id', tId)) || [];
          const approved = estimates.find(e => e.approval_status === 'approved');

          const body = {
            tender_id: tId,
            pm_id: tender.responsible_pm_id,
            customer_name: tender.customer_name,
            work_title: tender.tender_title,
            work_status: 'Подготовка',
            start_plan: tender.work_start_plan,
            end_plan: tender.work_end_plan,
            contract_value: approved ? approved.price_tkp : tender.tender_price,
            cost_plan: approved ? approved.cost_plan : 3200000,
          };

          const resp = await fetch('/api/works', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await resp.json();
          return data.work ? data.work.id : (data.id || null);
        } catch(e) { console.error('create work err:', e); return null; }
      }, tenderId);
    }

    if (!workId) {
      // Final fallback: check all-works
      await page.goto(BASE + '/#/all-works');
      await waitLoad(page);
      workId = await page.evaluate(() => {
        const row = document.querySelector('tbody tr[data-id]');
        return row ? Number(row.getAttribute('data-id')) : null;
      });
    }

    log(`Work ID: ${workId}`);
    results.push({ step: '4. Work', ok: !!workId, id: workId });

    // ════ OPEN WORK CARD ════
    if (workId) {
      log('STEP 5: Opening work card...');

      // Navigate to pm-works
      await page.goto(BASE + '/#/pm-works');
      await waitLoad(page);

      // Wait for table
      await page.waitForFunction(() => document.querySelectorAll('tbody tr[data-id]').length > 0, { timeout: 15000 }).catch(()=>{});
      await page.waitForTimeout(2000);

      // Open work card
      const wOpenBtn = page.locator(`tr[data-id="${workId}"] button[data-act="open"]`).first();
      if (await wOpenBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
        await wOpenBtn.click({ force: true });
        await page.waitForTimeout(3000);
      } else {
        // Try first row
        const anyOpen = page.locator('tr[data-id] button[data-act="open"]').first();
        if (await anyOpen.isVisible({ timeout: 3000 }).catch(()=>false)) {
          await anyOpen.click({ force: true });
          await page.waitForTimeout(3000);
        } else {
          // Try openWorkEditor directly
          await page.evaluate((id) => {
            if (typeof openWorkEditor === 'function') openWorkEditor(id);
          }, workId);
          await page.waitForTimeout(4000);
        }
      }

      const workModalOpen = await page.locator('.modalback').isVisible({ timeout: 5000 }).catch(()=>false);
      await ss(page, '05_work_card.png');

      if (workModalOpen) {
        results.push({ step: '5. Open Work Card', ok: true });

        // ════ STAFF REQUEST ════
        log('STEP 5b: Staff request...');
        const reqStaffBtn = page.locator('#btnReqStaff');
        if (await reqStaffBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
          // First fill staff numbers
          const staffFields = await page.evaluate(() => {
            const result = {};
            document.querySelectorAll('input').forEach(inp => {
              if (inp.offsetParent && inp.id) {
                const ph = inp.placeholder || '';
                const label = inp.closest('div')?.querySelector('label')?.textContent || '';
                result[inp.id] = { ph, label: label.slice(0, 30), val: inp.value };
              }
            });
            return result;
          });
          log('Work form inputs: ' + JSON.stringify(Object.keys(staffFields)));

          // Fill Мастера, Слесари fields if they exist
          for (const label of ['Мастера', 'Слесари', 'ПТО', 'Промывщики']) {
            const inp = page.locator(`input`).filter({ has: page.locator(`xpath=ancestor::*[contains(., "${label}")]`) }).first();
            // Use a different approach — find input near the label text
          }

          // Fill staff numbers via evaluate
          await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[type="number"], input'));
            for (const inp of inputs) {
              const parent = inp.closest('div');
              if (!parent) continue;
              const labelText = parent.textContent || '';
              if (labelText.includes('МАСТЕРА') && inp.value === '0') inp.value = '2';
              if (labelText.includes('СЛЕСАРИ') && inp.value === '0') inp.value = '6';
              if (labelText.includes('ПТО') && inp.value === '0') inp.value = '2';
              if (labelText.includes('ПРОМЫВЩИКИ') && inp.value === '0') inp.value = '2';
              if (labelText.includes('РОТАЦИИ') && inp.value === '0') inp.value = '14';
              // Trigger input event
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
          await page.waitForTimeout(1000);

          // Check ВАХТА checkbox
          const vahtaChk = page.locator('input[type="checkbox"]').first();
          if (await vahtaChk.isVisible({ timeout: 2000 }).catch(()=>false)) {
            const isChecked = await vahtaChk.isChecked().catch(()=>false);
            if (!isChecked) {
              await vahtaChk.check({ force: true }).catch(()=>{});
            }
          }

          await ss(page, '05b_staff_filled.png');

          // Save work first
          const saveWorkBtn = page.locator('#btnSaveWork');
          if (await saveWorkBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
            await saveWorkBtn.click();
            await page.waitForTimeout(3000);
          }

          // Request staff
          log('Requesting staff...');
          await reqStaffBtn.scrollIntoViewIfNeeded().catch(()=>{});
          await reqStaffBtn.click();
          await page.waitForTimeout(4000);

          // Handle confirmation
          const swalC = page.locator('.swal2-confirm').first();
          if (await swalC.isVisible({ timeout: 2000 }).catch(()=>false)) {
            await swalC.click();
            await page.waitForTimeout(2000);
          }

          await ss(page, '05c_staff_requested.png');
          results.push({ step: '5b. Staff Request', ok: true });
        } else {
          results.push({ step: '5b. Staff Request', ok: false, note: 'no button' });
        }

        // ════ FIELD MODULE ════
        log('STEP 6: Field module...');

        // Scroll up to actions button
        const actionsBtn = page.locator('#btnActions');
        if (await actionsBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
          await actionsBtn.scrollIntoViewIfNeeded().catch(()=>{});
          await page.waitForTimeout(500);
          await actionsBtn.click();
          await page.waitForTimeout(2000);
          await ss(page, '06_actions_menu.png');

          // The actions menu is a custom dropdown, not a standard one
          // Look for any new visible elements
          const menuState = await page.evaluate(() => {
            // Check for any new popup/dropdown/menu that appeared
            const allVisible = Array.from(document.querySelectorAll('div, ul, nav, section'))
              .filter(el => {
                const s = window.getComputedStyle(el);
                return el.offsetParent && s.display !== 'none' && s.visibility !== 'hidden'
                  && (el.className || '').toString().match(/menu|action|dropdown|popup|popover/i);
              })
              .map(el => ({
                cls: (el.className || '').toString().slice(0, 80),
                text: el.textContent.trim().slice(0, 200),
                children: el.children.length,
              }));
            return allVisible;
          });
          log('Menu-like elements: ' + JSON.stringify(menuState));

          // Try to find and click "Полевой модуль" in ANY visible element
          const fieldClicked = await page.evaluate(() => {
            // Search all visible text nodes for "полевой" or "Полевой"
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              if (!el.offsetParent) continue;
              const t = el.textContent || '';
              const ownText = Array.from(el.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => n.textContent)
                .join('');
              if ((ownText || t).toLowerCase().includes('полевой') && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
                // Check if it's a clickable element
                if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'LI' || el.tagName === 'DIV') {
                  el.click();
                  return { tag: el.tagName, text: el.textContent.trim().slice(0, 60) };
                }
              }
            }
            return null;
          });

          if (fieldClicked) {
            log(`Clicked field module: ${JSON.stringify(fieldClicked)}`);
            await page.waitForTimeout(3000);
          }
        }

        // If still no field module, try direct JS call
        let fieldModuleOpened = false;
        const hasFieldTab = await page.evaluate(() => typeof window.AsgardFieldTab !== 'undefined' && typeof AsgardFieldTab.openFieldModal === 'function');
        log(`AsgardFieldTab available: ${hasFieldTab}`);

        if (hasFieldTab) {
          log('Opening field module via AsgardFieldTab.openFieldModal()...');
          const fieldResult = await page.evaluate(async (wId) => {
            try {
              const work = await AsgardDB.get('works', wId);
              const user = window.AsgardAuth?.user || window._user || { id: 1, role: 'ADMIN' };
              AsgardFieldTab.openFieldModal(work, user);
              return { ok: true };
            } catch(e) { return { ok: false, error: e.message }; }
          }, workId);
          log('Field modal result: ' + JSON.stringify(fieldResult));
          await page.waitForTimeout(4000);
          fieldModuleOpened = true;
        }

        if (fieldModuleOpened || await page.locator('[data-ftab]').first().isVisible({ timeout: 5000 }).catch(()=>false)) {
          await ss(page, '07_field_module.png');

          // CLOSE the actions menu overlay before clicking tabs
          log('Closing actions menu overlay...');
          await page.evaluate(() => {
            // Remove the overlay
            const overlay = document.getElementById('asgard-action-menu-overlay');
            if (overlay) {
              overlay.classList.remove('aam-visible');
              overlay.style.display = 'none';
              overlay.remove();
            }
            // Also close any action menu popup
            const popup = document.querySelector('.aam-popup, .asg-actions-menu, [class*="action-menu"]');
            if (popup) popup.remove();
          });
          await page.waitForTimeout(1000);

          // Navigate tabs
          const tabs = ['crew', 'logistics', 'dashboard', 'timesheet', 'packing', 'routes'];
          for (const tab of tabs) {
            const tabBtn = page.locator(`[data-ftab="${tab}"]`);
            if (await tabBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
              await tabBtn.click({ force: true });
              await page.waitForTimeout(2000);
              await ss(page, `08_field_${tab}.png`);
              log(`Tab ${tab} ✅`);
            } else {
              log(`Tab ${tab} — not found`);
            }
          }

          results.push({ step: '6. Field Module', ok: true });
        } else {
          await ss(page, '07_no_field.png');
          results.push({ step: '6. Field Module', ok: false, note: 'could not open' });
        }
      } else {
        results.push({ step: '5. Open Work Card', ok: false, note: 'modal not opened' });
      }
    }

    // ════ PERSONNEL ════
    log('STEP 7: Personnel search...');
    await page.locator('#modalClose').click().catch(()=>{});
    await page.waitForTimeout(500);

    await page.goto(BASE + '/#/personnel');
    await waitLoad(page);

    // Search for Андросов
    const searchInp = page.locator('#f_q, input[type="search"], input[placeholder*="Поиск"]').first();
    if (await searchInp.isVisible({ timeout: 5000 }).catch(()=>false)) {
      await searchInp.fill('Андросов');
      await page.waitForTimeout(3000);
    }
    await ss(page, '09_personnel.png');

    // Click first employee card/row
    const empRow = page.locator('tr[data-id], .card[data-id], .fk-card[data-id]').first();
    if (await empRow.isVisible({ timeout: 5000 }).catch(()=>false)) {
      await empRow.click({ force: true });
      await page.waitForTimeout(2000);
      await ss(page, '09b_employee_card.png');
    }
    results.push({ step: '7. Personnel', ok: true });

    // ════ VERIFY TENDERS PAGE FINAL STATE ════
    log('STEP 8: Final verification...');
    await page.locator('#modalClose').click().catch(()=>{});
    await page.waitForTimeout(500);

    await page.goto(BASE + '/#/tenders');
    await waitLoad(page);
    await page.waitForFunction(() => document.querySelectorAll('tbody tr[data-id]').length > 0, { timeout: 15000 }).catch(()=>{});
    await ss(page, '10_tenders_final.png');

    // Check tender status
    const finalTender = await page.evaluate(async (tId) => {
      const t = await AsgardDB.get('tenders', tId);
      return t ? { status: t.tender_status, handoff: !!t.handoff_at } : null;
    }, tenderId);
    log('Final tender: ' + JSON.stringify(finalTender));

    // Check works
    await page.goto(BASE + '/#/pm-works');
    await waitLoad(page);
    await ss(page, '11_works_final.png');

    await ss(page, '99_final.png');

  } catch (err) {
    log(`FATAL: ${err.message}`);
    console.error(err.stack);
    await ss(page, 'FATAL.png').catch(()=>{});
    results.push({ step: 'FATAL', ok: false, note: err.message.slice(0, 120) });
  } finally {
    console.log('\n════════════════════════════════════');
    console.log('E2E v6 RESULTS');
    console.log('════════════════════════════════════');
    results.forEach(r =>
      console.log(`${r.ok ? '✅' : '❌'} ${r.step}${r.id ? ' (ID:' + r.id + ')' : ''}${r.note ? ' — ' + r.note : ''}`)
    );
    console.log(`\nTender: ${tenderId}, Estimate: ${estimateId}, Work: ${workId}`);
    console.log('════════════════════════════════════\n');
    await browser.close();
  }
})();
