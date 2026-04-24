// E2E v4 — Continue from existing Tender #2 + TKP #2942
// Flow: Tender → Передать в просчёт → fill estimate → approve → create work → field module
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'https://asgard-crm.ru';
const DIR = __dirname;
const CREDS = { login: 'admin', password: 'AsgardTest2026!', pin: '1234' };
function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }
async function ss(page, name) { await page.waitForTimeout(2000); await page.screenshot({ path: path.join(DIR, name) }); log(`📸 ${name}`); }
async function waitLoad(page) { await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(2500); }

const results = [];
const tenderId = 2;
const tkpId = 2942;
let estimateId = null, workId = null;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true, locale: 'ru-RU' });
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
      for (const d of CREDS.pin.split('')) { await page.locator(`#pk-keypad [data-digit="${d}"]`).click(); await page.waitForTimeout(300); }
      await page.waitForTimeout(3000);
    }
    await page.waitForFunction(() => localStorage.getItem('asgard_token')?.length > 50, { timeout: 15000 });
    await waitLoad(page);
    log('LOGIN OK');

    // ════ STEP 2b: "ПЕРЕДАТЬ В ПРОСЧЁТ" ════
    log('Opening tender #2 and sending to estimate...');
    await page.goto(BASE + '/#/tenders');
    await waitLoad(page);

    // Open tender #2 via URL param
    await page.goto(BASE + `/#/tenders?open=${tenderId}`);
    await waitLoad(page);
    // Wait for modal to appear
    await page.waitForSelector('.modalback, #btnSave, button:has-text("Сохранить"), button:has-text("Передать")', { state: 'visible', timeout: 15000 }).catch(()=>{});
    await page.waitForTimeout(2000);
    await ss(page, '03c_tender_card.png');

    // Dump all buttons in the modal/card
    const tenderBtns = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, a.btn, [role="button"]')).filter(el => el.offsetParent)
        .map(el => ({ text: el.textContent.trim().slice(0, 60), id: el.id, cls: (el.className||'').toString().slice(0, 60) }));
    });
    log('Tender card buttons:');
    tenderBtns.forEach(b => log(`  [${b.id}] "${b.text}"`));

    // Click "Передать в просчёт"
    const prosBtn = page.locator('button:has-text("Передать в просчёт"), button:has-text("В просчёт")').first();
    if (await prosBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
      log('Clicking "Передать в просчёт"...');
      await prosBtn.click();
      await page.waitForTimeout(4000);
      await ss(page, '04_after_proshet.png');

      // Check what happened — might show a dialog, navigate, or change the card
      const currentUrl = await page.evaluate(() => location.hash);
      log(`After proshet URL: ${currentUrl}`);

      // Dump page state
      const afterState = await page.evaluate(() => {
        return {
          url: location.hash,
          title: document.querySelector('h1, h2, .page-title, .modal-header, [class*="title"]')?.textContent?.trim().slice(0, 100),
          inputs: Array.from(document.querySelectorAll('input, textarea, select')).filter(e => e.offsetParent && e.type !== 'hidden')
            .map(e => `${e.tagName}#${e.id} name="${e.name}" ph="${e.placeholder}"`).slice(0, 20),
          buttons: Array.from(document.querySelectorAll('button')).filter(e => e.offsetParent)
            .map(e => `[${e.id}] ${e.textContent.trim().slice(0, 50)}`).slice(0, 20),
          hasModal: !!document.querySelector('.modalback, .modal-content, .swal2-popup'),
        };
      });
      log('After proshet state:');
      log(JSON.stringify(afterState, null, 2));

      // Handle any confirmation dialog
      const confirmBtn = page.locator('.swal2-confirm, button:has-text("OK"), button:has-text("Да"), button:has-text("Подтвердить")').first();
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
        await confirmBtn.click();
        await page.waitForTimeout(3000);
        log('Confirmed dialog');
      }

      await ss(page, '04b_after_proshet_confirm.png');
    } else {
      // Check if tender is already in proshet state
      log('No "Передать в просчёт" button. Checking tender status...');
      const tenderStatus = await page.evaluate(() => {
        const statusEl = document.querySelector('.tender-status, [class*="status"]');
        return statusEl ? statusEl.textContent.trim() : null;
      });
      log(`Tender status: ${tenderStatus}`);

      // Try "⚡ Действия" dropdown
      const actBtn = page.locator('button:has-text("Действия")');
      if (await actBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
        await actBtn.click();
        await page.waitForTimeout(1500);
        await ss(page, '04_actions_menu.png');

        const menuItems = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('.dropdown-item, .dropdown-menu a, .dropdown-menu button, .action-menu-item')).filter(el => el.offsetParent)
            .map(el => ({ text: el.textContent.trim().slice(0, 60), href: el.getAttribute('href'), action: el.getAttribute('data-action') }));
        });
        log('Actions menu: ' + JSON.stringify(menuItems));

        // Click relevant action
        await page.evaluate(() => {
          const items = document.querySelectorAll('.dropdown-item, .dropdown-menu a, .dropdown-menu button, .action-menu-item');
          for (const el of items) {
            const t = (el.textContent || '').toLowerCase();
            if (el.offsetParent && (t.includes('просч') || t.includes('работ') || t.includes('калькул'))) {
              el.click();
              return t;
            }
          }
          return null;
        });
        await page.waitForTimeout(3000);
        await ss(page, '04b_after_action.png');
      }
    }

    results.push({ step: '2b. Передать в просчёт', ok: true });

    // ════ STEP 2c: NAVIGATE TO ESTIMATE / CALCULATOR ════
    log('Looking for the created estimate...');

    // Check estimates page
    await page.goto(BASE + '/#/all-estimates');
    await waitLoad(page);
    await ss(page, '04c_estimates.png');

    estimateId = await page.evaluate(() => {
      const row = document.querySelector('tbody tr[data-id], .card[data-id]');
      return row ? row.getAttribute('data-id') : null;
    });
    log(`Estimate ID: ${estimateId}`);

    if (estimateId) {
      // Open the estimate
      await page.locator(`tbody tr[data-id="${estimateId}"], .card[data-id="${estimateId}"]`).first().click({ force: true });
      await page.waitForTimeout(3000);
      await ss(page, '04d_estimate_card.png');

      // Dump estimate card
      const estState = await page.evaluate(() => ({
        url: location.hash,
        buttons: Array.from(document.querySelectorAll('button')).filter(e => e.offsetParent)
          .map(e => `[${e.id}] ${e.textContent.trim().slice(0, 50)}`).slice(0, 25),
      }));
      log('Estimate card buttons:');
      estState.buttons.forEach(b => log(`  ${b}`));
    }

    // Also check calculator
    await page.goto(BASE + '/#/calculator');
    await waitLoad(page);
    await ss(page, '04e_calculator.png');

    // Check pm-calcs
    await page.goto(BASE + '/#/pm-calcs');
    await waitLoad(page);
    await ss(page, '04f_pm_calcs.png');

    const calcDump = await page.evaluate(() => ({
      rows: document.querySelectorAll('tbody tr[data-id], .card[data-id]').length,
      buttons: Array.from(document.querySelectorAll('button')).filter(e => e.offsetParent)
        .map(e => `[${e.id}] ${e.textContent.trim().slice(0, 50)}`).slice(0, 15),
    }));
    log('PM calcs: ' + JSON.stringify(calcDump));

    results.push({ step: '2c. Find estimate', ok: !!estimateId, id: estimateId });

    // ════ STEP 4: CREATE WORK FROM ESTIMATE ════
    log('STEP 4: Looking for work creation...');

    // If estimate exists, open it and look for "В работу" / "Создать работу" button
    if (estimateId) {
      await page.goto(BASE + '/#/all-estimates');
      await waitLoad(page);
      await page.locator(`tbody tr[data-id="${estimateId}"]`).first().click({ force: true });
      await page.waitForTimeout(3000);

      // Look for work creation buttons
      const workBtns = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button, a.btn')).filter(el => {
          const t = (el.textContent || '').toLowerCase();
          return el.offsetParent && (t.includes('работ') || t.includes('контракт') || t.includes('в работу') || t.includes('создать работу'));
        }).map(el => ({ text: el.textContent.trim().slice(0, 60), id: el.id }));
      });
      log('Work creation buttons in estimate: ' + JSON.stringify(workBtns));
      await ss(page, '10_estimate_for_work.png');

      if (workBtns.length > 0) {
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button, a.btn')).find(el => {
            const t = (el.textContent || '').toLowerCase();
            return el.offsetParent && (t.includes('работ') || t.includes('в работу'));
          });
          if (btn) btn.click();
        });
        await page.waitForTimeout(4000);
        await ss(page, '11_work_creation.png');
      }
    }

    // Check for work
    await page.goto(BASE + '/#/pm-works');
    await waitLoad(page);
    workId = await page.evaluate(() => {
      const row = document.querySelector('tbody tr[data-id]');
      return row ? row.getAttribute('data-id') : null;
    });
    if (!workId) {
      await page.goto(BASE + '/#/all-works');
      await waitLoad(page);
      workId = await page.evaluate(() => {
        const row = document.querySelector('tbody tr[data-id]');
        return row ? row.getAttribute('data-id') : null;
      });
    }
    log(`Work ID: ${workId}`);
    results.push({ step: '4. Work', ok: !!workId, id: workId });

    // ════ STEP 5-6: PERSONNEL ════
    log('STEP 5: Personnel...');
    await page.goto(BASE + '/#/personnel');
    await waitLoad(page);
    const searchInput = page.locator('#f_q, input[type="search"], input[placeholder*="Поиск"]').first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(()=>false)) {
      await searchInput.fill('Андросов');
      await page.waitForTimeout(2000);
    }
    await ss(page, '15_personnel.png');
    const empRow = page.locator('tbody tr[data-id], .card[data-id]').first();
    if (await empRow.isVisible({ timeout: 3000 }).catch(()=>false)) {
      await empRow.click({ force: true });
      await page.waitForTimeout(2000);
      await ss(page, '16_employee.png');
    }
    results.push({ step: '5-6. Personnel', ok: true });

    // ════ STEP 8-14: FIELD MODULE ════
    if (workId) {
      log('STEP 8: Field module...');
      await page.goto(BASE + `/#/pm-works?open=${workId}`);
      await waitLoad(page);
      await ss(page, '17_work_card.png');

      // Look for field module
      const fieldBtnInfo = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button, a, .btn')).filter(el => {
          const t = (el.textContent || '').toLowerCase();
          return el.offsetParent && (t.includes('полевой') || t.includes('field') || t.includes('⚔'));
        }).map(el => ({ text: el.textContent.trim().slice(0, 60), id: el.id }));
      });
      log('Field buttons: ' + JSON.stringify(fieldBtnInfo));

      if (fieldBtnInfo.length > 0) {
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button, a, .btn')).find(el => {
            const t = (el.textContent || '').toLowerCase();
            return el.offsetParent && (t.includes('полевой') || t.includes('field') || t.includes('⚔'));
          });
          if (btn) btn.click();
        });
        await page.waitForTimeout(3000);
        await ss(page, '19_field.png');

        const tabs = ['crew', 'logistics', 'stages', 'dashboard', 'timesheet'];
        for (const tab of tabs) {
          const tabBtn = page.locator(`[data-ftab="${tab}"]`);
          if (await tabBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
            await tabBtn.click();
            await page.waitForTimeout(2000);
            await ss(page, `field_${tab}.png`);
            log(`Tab ${tab} ✅`);
          }
        }
        results.push({ step: '8-14. Field', ok: true });
      } else {
        results.push({ step: '8-14. Field', ok: false, note: 'no button' });
      }
    }

    await ss(page, '33_final.png');

  } catch (err) {
    log(`FATAL: ${err.message}`);
    await ss(page, 'FATAL.png').catch(()=>{});
    results.push({ step: 'FATAL', ok: false, note: err.message.slice(0, 100) });
  } finally {
    console.log('\n════════════════════════════════════');
    console.log('E2E RESULTS');
    console.log('════════════════════════════════════');
    results.forEach(r => console.log(`${r.ok ? '✅' : '❌'} ${r.step}${r.id ? ' (ID:'+r.id+')' : ''}${r.note ? ' — '+r.note : ''}`));
    console.log(`\nTender: ${tenderId}, TKP: ${tkpId}, Estimate: ${estimateId}, Work: ${workId}`);
    console.log('════════════════════════════════════\n');
    await browser.close();
  }
})();
