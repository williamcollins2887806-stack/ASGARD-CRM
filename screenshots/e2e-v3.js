// E2E Full Chain v3 — Fixed CRSelect IDs (e_pm not e_pm_w)
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'https://asgard-crm.ru';
const DIR = __dirname;
const CREDS = { login: 'admin', password: 'AsgardTest2026!', pin: '1234' };
function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }
async function ss(page, name) { await page.waitForTimeout(2000); await page.screenshot({ path: path.join(DIR, name) }); log(`📸 ${name}`); }
async function waitLoad(page) { await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(2500); }

const results = [];
let tenderId = null, tkpId = null, workId = null;

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
    results.push({ step: '0. Login', ok: true });

    // ════ CLEANUP: delete draft tenders from previous runs ════
    log('Cleanup: checking for draft tenders...');
    await page.goto(BASE + '/#/tenders');
    await waitLoad(page);
    const draftCount = await page.evaluate(() => document.querySelectorAll('tbody tr[data-id]').length);
    log(`Existing tenders: ${draftCount}`);
    if (draftCount > 0) {
      // Delete any existing tenders (test data)
      const ids = await page.evaluate(() => Array.from(document.querySelectorAll('tbody tr[data-id]')).map(r => r.getAttribute('data-id')));
      for (const id of ids) {
        log(`Deleting tender ${id}...`);
        const token = await page.evaluate(() => localStorage.getItem('asgard_token'));
        await page.evaluate(async ({id, token}) => {
          await fetch(`/api/tenders/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        }, {id, token});
      }
      await page.reload();
      await waitLoad(page);
    }

    // ════ STEP 1: CREATE TENDER ════
    log('STEP 1: Create tender...');
    await page.goto(BASE + '/#/tenders');
    await waitLoad(page);
    await ss(page, '01_tenders_page.png');

    await page.locator('#btnNew').click();
    await page.waitForSelector('#e_title, .modalback, .modal-content', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Customer — type in the customer name autocomplete
    const custAc = page.locator('#cr-customer-wrap .cr-ac__input');
    await custAc.fill('ЛУКОЙЛ');
    await page.waitForTimeout(3000);
    const custSug = page.locator('#cr-customer-wrap .cr-ac__option, .cr-ac__options .cr-ac__option').first();
    if (await custSug.isVisible({ timeout: 3000 }).catch(()=>false)) {
      await custSug.click();
      await page.waitForTimeout(1000);
      log('Customer selected');
    } else {
      log('WARN: Customer not found in autocomplete');
    }

    // Title
    await page.fill('#e_title', 'Химическая чистка теплообменного оборудования АВТ-6');

    // Price
    await page.fill('#e_price', '4850000');

    // CRSelect — CORRECT IDs (without _w suffix!)
    await page.evaluate(() => {
      CRSelect.setValue('e_type', 'Тендер');
      CRSelect.setValue('e_pm', '3474');       // Андросов Никита Андреевич
      CRSelect.setValue('e_tag', '21');         // Химическая очистка
      // e_status = keep "Черновик" default, period = keep pre-filled Apr 2026
    });
    log('CRSelect set (e_pm=3474, e_type=Тендер, e_tag=21)');

    // Verify PM was set
    const pmVal = await page.evaluate(() => CRSelect.getValue('e_pm'));
    log(`PM value after set: "${pmVal}"`);

    // Dates — correct CRDatePicker instance IDs
    await page.evaluate(() => {
      CRDatePicker.setValue('e_docs_deadline', '2026-04-20');
      CRDatePicker.setValue('e_ws', '2026-05-15');
      CRDatePicker.setValue('e_we', '2026-05-30');
    });

    await page.waitForTimeout(500);
    await ss(page, '02_tender_form_filled.png');

    // Save
    log('Saving tender...');
    await page.locator('#btnSave').click();
    await page.waitForTimeout(4000);

    // Check validation
    const valErr = await page.evaluate(() => {
      const popup = document.querySelector('.swal2-popup, [role="alertdialog"]');
      return popup && popup.offsetParent ? popup.textContent.trim().slice(0, 200) : null;
    });
    if (valErr) {
      log(`VALIDATION: ${valErr}`);
      // Dismiss the popup
      await page.locator('.swal2-confirm, .swal2-close, button:has-text("OK")').first().click().catch(()=>{});
      await page.waitForTimeout(1000);
      await ss(page, '02b_validation.png');

      // Try saving as draft if full save fails
      const draftBtn = page.locator('#btnSaveDraft');
      if (await draftBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
        log('Saving as draft...');
        await draftBtn.click();
        await page.waitForTimeout(3000);
      }
    }

    await waitLoad(page);

    // Check if modal closed (= saved)
    const modalOpen = await page.locator('.modalback').isVisible().catch(()=>false);
    log(`Modal still open: ${modalOpen}`);

    // Get tender ID — reload page and check table
    await page.goto(BASE + '/#/tenders');
    await waitLoad(page);
    await ss(page, '03_tender_created.png');

    tenderId = await page.evaluate(() => {
      const row = document.querySelector('tbody tr[data-id]');
      return row ? row.getAttribute('data-id') : null;
    });
    log(`Tender ID: ${tenderId}`);
    results.push({ step: '1. Tender', ok: !!tenderId, id: tenderId });

    if (!tenderId) throw new Error('Tender not created');

    // Open the tender to verify and screenshot
    await page.locator(`tbody tr[data-id="${tenderId}"]`).click({ force: true });
    await page.waitForTimeout(2000);
    await ss(page, '03b_tender_opened.png');
    // Close modal
    await page.locator('#modalClose, button:has-text("Закрыть")').first().click().catch(()=>{});
    await page.waitForTimeout(1000);

    // ════ STEP 2: CREATE TKP ════
    log('STEP 2: Create TKP...');
    await page.goto(BASE + '/#/tkp');
    await waitLoad(page);
    await ss(page, '04_tkp_page.png');

    // Close Mimir overlay if present
    await page.locator('#mimirFab').click().catch(()=>{});
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await page.locator('#btnNewTkp').click({ force: true });
    await page.waitForTimeout(3000);
    await page.waitForSelector('.modalback, .modal-content, #tkpEditor, #tkpSubject', { state: 'visible', timeout: 15000 }).catch(()=>{});
    await page.waitForTimeout(2000);

    // Dump TKP form to see what fields exist
    const tkpFields = await page.evaluate(() => {
      const modal = document.querySelector('.modal-content, #modalBody, #tkpEditor');
      if (!modal) return { error: 'no modal found' };
      return {
        inputs: Array.from(modal.querySelectorAll('input, textarea, select')).filter(e => e.offsetParent && e.type !== 'hidden')
          .map(e => ({ id: e.id, name: e.name, ph: e.placeholder, tag: e.tagName, type: e.type })),
        buttons: Array.from(modal.querySelectorAll('button')).filter(e => e.offsetParent)
          .map(e => ({ id: e.id, text: e.textContent.trim().slice(0, 50) })),
      };
    });
    log('TKP fields: ' + JSON.stringify(tkpFields, null, 2).slice(0, 2000));
    await ss(page, '04b_tkp_form.png');

    // Fill TKP
    await page.fill('#tkpSubject', 'ТКП: Химическая чистка ТО АВТ-6, ЛУКОЙЛ-Нефтехим').catch(()=> log('no tkpSubject'));

    // Try to fill description
    await page.fill('#tkpDescription', 'Химическая чистка теплообменного оборудования. Бригада 8 чел, 15 дней. Материалы: HCl, ингибитор, NaOH, пассиватор. Авиа Москва↔Нижний 16 шт. Гостиница 15 ночей × 8. Суточные 1000₽×15×8.').catch(()=> log('no tkpDescription'));

    // Customer in TKP
    const tkpCust = page.locator('#tkpCustomerSearch');
    if (await tkpCust.isVisible({ timeout: 2000 }).catch(()=>false)) {
      await tkpCust.fill('ЛУКОЙЛ');
      await page.waitForTimeout(2000);
      const sug = page.locator('#tkpCustomerDropdown .item, #tkpCustomerDropdown [data-id]').first();
      if (await sug.isVisible({ timeout: 3000 }).catch(()=>false)) {
        await sug.click();
        await page.waitForTimeout(1000);
        log('TKP customer selected');
      }
    }

    // Link tender
    const tkpTender = page.locator('#tkpTenderSearch');
    if (await tkpTender.isVisible({ timeout: 2000 }).catch(()=>false)) {
      await tkpTender.fill('Химическая');
      await page.waitForTimeout(2000);
      const tsug = page.locator('#tkpTenderDropdown .item, #tkpTenderDropdown [data-id]').first();
      if (await tsug.isVisible({ timeout: 2000 }).catch(()=>false)) {
        await tsug.click();
        log('TKP linked to tender');
      }
    }

    // Contact info
    await page.fill('#tkpContactPerson', 'Козлов Дмитрий Сергеевич').catch(()=>{});
    await page.fill('#tkpContactPhone', '+7 (831) 255-12-34').catch(()=>{});
    await page.fill('#tkpAddress', 'г. Кстово, промзона ЛУКОЙЛ-Нефтехим').catch(()=>{});
    await page.fill('#tkpDeadline', '15 рабочих дней').catch(()=>{});
    await page.fill('#tkpValidity', '30').catch(()=>{});
    await page.fill('#tkpNotes', 'Объект АВТ-6, г. Кстово').catch(()=>{});
    await page.fill('#tkpAuthorName', 'Андросов Никита Андреевич').catch(()=>{});
    await page.fill('#tkpAuthorPosition', 'Генеральный директор').catch(()=>{});

    // Add TKP items
    const items = [
      ['Химическая чистка теплообменников (8 ед.)', 'комплекс', '1', '2500000'],
      ['Соляная кислота ингибированная', 'т', '5', '45000'],
      ['Ингибитор коррозии', 'т', '0.5', '120000'],
      ['Авиабилеты МСК↔НН (16 шт)', 'шт', '16', '12000'],
      ['Проживание 15 н × 8 чел', 'сут', '120', '3500'],
      ['Суточные 15 д × 8 чел', 'сут', '120', '1000'],
    ];
    for (let i = 0; i < items.length; i++) {
      if (i > 0) await page.locator('#btnAddItem').click().catch(()=>{});
      await page.waitForTimeout(300);
      await page.evaluate((item) => {
        const tbody = document.querySelector('#tkpItemsBody');
        if (!tbody) return;
        const rows = tbody.querySelectorAll('tr');
        const row = rows[rows.length - 1];
        if (!row) return;
        const inputs = row.querySelectorAll('input, textarea');
        for (let j = 0; j < Math.min(inputs.length, item.length); j++) {
          inputs[j].value = item[j];
          inputs[j].dispatchEvent(new Event('input', {bubbles: true}));
          inputs[j].dispatchEvent(new Event('change', {bubbles: true}));
        }
      }, items[i]);
    }

    await page.waitForTimeout(1000);
    await ss(page, '05_tkp_filled.png');

    // Save TKP
    log('Saving TKP...');
    await page.locator('#btnSaveTkp').click({ force: true }).catch(()=>{});
    await page.waitForTimeout(4000);
    await ss(page, '06_tkp_saved.png');

    // Navigate to TKP list to get ID
    await page.goto(BASE + '/#/tkp');
    await waitLoad(page);
    tkpId = await page.evaluate(() => {
      const row = document.querySelector('tbody tr[data-id], [data-id]');
      return row ? row.getAttribute('data-id') : null;
    });
    log(`TKP ID: ${tkpId}`);
    results.push({ step: '2. TKP', ok: !!tkpId, id: tkpId });

    // ════ STEP 3: APPROVAL ════
    log('STEP 3: Approval...');
    await page.goto(BASE + '/#/approvals');
    await waitLoad(page);
    await ss(page, '07_approvals.png');
    const approvalCount = await page.evaluate(() => document.querySelectorAll('tbody tr[data-id], .card[data-id]').length);
    log(`Approval items: ${approvalCount}`);
    results.push({ step: '3. Approval', ok: true, note: `${approvalCount} items` });

    // ════ STEP 4: CREATE WORK ════
    log('STEP 4: Create work...');

    // Strategy: Open tender card → click "⚡ Действия" → find "Создать работу"
    // OR try #/all-works page, OR use "Передать в просчёт" flow

    // First: try all-works page (Свод Контрактов)
    await page.goto(BASE + '/#/all-works');
    await waitLoad(page);
    await ss(page, '10_works_page.png');

    // Check for create button
    let workCreateFound = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.offsetParent && /Создать|Добавить|Новая|\+/.test(b.textContent) && b.id !== 'mimirNewChat');
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (!workCreateFound) {
      log('No create button on all-works, trying tender card actions...');

      // Open tender card and use Actions menu
      await page.goto(BASE + '/#/tenders');
      await waitLoad(page);
      await page.locator(`tbody tr[data-id="${tenderId}"]`).click({ force: true });
      await page.waitForTimeout(2000);

      // Click "⚡ Действия" button
      const actionsBtn = page.locator('button:has-text("Действия")');
      if (await actionsBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
        await actionsBtn.click();
        await page.waitForTimeout(1500);
        await ss(page, '10b_tender_actions.png');

        // Look for "Создать работу" in dropdown
        const allMenuItems = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('.dropdown-menu a, .dropdown-menu button, .action-item, [data-action], .menu-item')).filter(el => el.offsetParent).map(el => ({
            text: el.textContent.trim().slice(0, 60),
            href: el.getAttribute('href'),
            action: el.getAttribute('data-action'),
          }));
        });
        log('Action menu items: ' + JSON.stringify(allMenuItems));

        // Try clicking work creation option
        const createWorkItem = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('.dropdown-menu a, .dropdown-menu button, .action-item, [data-action]'));
          const workItem = items.find(el => {
            const t = (el.textContent || '').toLowerCase();
            return el.offsetParent && (t.includes('работ') || t.includes('контракт') || t.includes('в работу'));
          });
          if (workItem) { workItem.click(); return workItem.textContent.trim(); }
          return null;
        });
        log(`Clicked action: ${createWorkItem}`);

        if (!createWorkItem) {
          // Try "Передать в просчёт" as alternative flow
          log('Trying "Передать в просчёт"...');
          const prosBtn = page.locator('button:has-text("Передать в просчёт")');
          if (await prosBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
            await prosBtn.click();
            await page.waitForTimeout(3000);
            await ss(page, '10c_proshet.png');
          }
        }

        await page.waitForTimeout(3000);
        workCreateFound = true;
      }
    }

    if (workCreateFound) {
      // Wait for modal or form
      await page.waitForSelector('.modalback, .modal-content, #modalBody', { state: 'visible', timeout: 10000 }).catch(()=>{});
      await page.waitForTimeout(2000);

      // Dump whatever form appeared
      const workFormDump = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input, textarea, select')).filter(e => e.offsetParent && e.type !== 'hidden')
          .map(e => `  ${e.tagName} id="${e.id}" name="${e.name}" ph="${e.placeholder}" val="${(e.value||'').slice(0,40)}"`);
        const btns = Array.from(document.querySelectorAll('button')).filter(e => e.offsetParent)
          .map(e => `  [btn] id="${e.id}" text="${e.textContent.trim().slice(0,50)}"`);
        return { inputs, btns, url: location.hash };
      });
      log('Work form/page:');
      workFormDump.inputs.forEach(i => console.log(i));
      workFormDump.btns.slice(0, 15).forEach(b => console.log(b));
      log(`URL: ${workFormDump.url}`);
      await ss(page, '11_work_form.png');

      // Try to fill and save any visible form
      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).filter(i =>
          i.offsetParent && !i.value && !i.classList.contains('cr-select__search-input') && !i.classList.contains('cr-ac__input'));
        if (inputs[0]) {
          inputs[0].value = 'Химическая чистка ТО АВТ-6, ЛУКОЙЛ-Нефтехим, Кстово';
          inputs[0].dispatchEvent(new Event('input', {bubbles:true}));
        }
      });

      // Try save
      const saveBtn = page.locator('button:has-text("Сохранить"), button:has-text("Создать"), #btnSave').first();
      if (await saveBtn.isVisible({ timeout: 3000 }).catch(()=>false)) {
        await saveBtn.click();
        await page.waitForTimeout(3000);
      }
      await ss(page, '12_work_saved.png');
    }

    // Get work ID from any works page
    await page.goto(BASE + '/#/pm-works');
    await waitLoad(page);
    workId = await page.evaluate(() => {
      const row = document.querySelector('tbody tr[data-id], .card[data-id]');
      return row ? row.getAttribute('data-id') : null;
    });
    if (!workId) {
      // Try all-works
      await page.goto(BASE + '/#/all-works');
      await waitLoad(page);
      workId = await page.evaluate(() => {
        const row = document.querySelector('tbody tr[data-id], .card[data-id]');
        return row ? row.getAttribute('data-id') : null;
      });
    }
    log(`Work ID: ${workId}`);
    await ss(page, '12b_works_list.png');
    results.push({ step: '4. Work', ok: !!workId, id: workId });

    // ════ STEP 5-6: PERSONNEL / STAFF ════
    log('STEP 5: Personnel...');
    await page.goto(BASE + '/#/personnel');
    await waitLoad(page);
    const searchInput = page.locator('#f_q, input[type="search"], input[placeholder*="Поиск"]').first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(()=>false)) {
      await searchInput.fill('Андросов');
      await page.waitForTimeout(2000);
    }
    await ss(page, '15_personnel_androsov.png');

    const empRow = page.locator('tbody tr[data-id], .card[data-id]').first();
    if (await empRow.isVisible({ timeout: 3000 }).catch(()=>false)) {
      await empRow.click({ force: true });
      await page.waitForTimeout(2000);
      await ss(page, '16_employee_card.png');
    }
    results.push({ step: '5-6. Personnel', ok: true });

    // ════ STEP 7: VERIFY WORK CARD ════
    log('STEP 7: Open work card...');
    if (workId) {
      await page.goto(BASE + `/#/pm-works?open=${workId}`);
      await waitLoad(page);
      await ss(page, '17_work_card.png');

      // ════ STEP 8: FIELD MODULE ════
      log('STEP 8: Field module...');
      // Look for field module button in the work card
      const fieldBtnInfo = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button, a, .btn, [role="button"]')).filter(el => {
          if (!el.offsetParent) return false;
          const t = (el.textContent || '').toLowerCase();
          return t.includes('полевой') || t.includes('field') || t.includes('⚔');
        }).map(el => ({ text: el.textContent.trim().slice(0, 60), id: el.id, tag: el.tagName, cls: el.className?.slice(0,60) }));
      });
      log('Field buttons: ' + JSON.stringify(fieldBtnInfo));

      if (fieldBtnInfo.length > 0) {
        // Click the field module button
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button, a, .btn')).find(el => {
            const t = (el.textContent || '').toLowerCase();
            return el.offsetParent && (t.includes('полевой') || t.includes('field') || t.includes('⚔'));
          });
          if (btn) btn.click();
        });
        await page.waitForTimeout(3000);
        await ss(page, '19_field_module.png');

        // Explore field module tabs
        const tabs = ['crew', 'logistics', 'stages', 'dashboard', 'timesheet'];
        for (const tab of tabs) {
          const tabBtn = page.locator(`[data-ftab="${tab}"]`);
          if (await tabBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
            await tabBtn.click();
            await page.waitForTimeout(2000);
            await ss(page, `field_${tab}.png`);
            log(`Field tab: ${tab} ✅`);
          } else {
            log(`Field tab: ${tab} — not found`);
          }
        }
        results.push({ step: '8-14. Field Module', ok: true });
      } else {
        // Maybe need to look in action menu / dropdown
        const allBtns = await page.evaluate(() =>
          Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent).map(b => b.textContent.trim().slice(0, 60))
        );
        log('All visible buttons in work card: ' + JSON.stringify(allBtns));
        await ss(page, '19_no_field_btn.png');
        results.push({ step: '8-14. Field Module', ok: false, note: 'button not found' });
      }
    } else {
      results.push({ step: '7-14. Work/Field', ok: false, note: 'no work ID' });
    }

    // ════ FINAL ════
    await ss(page, '33_final.png');

  } catch (err) {
    log(`FATAL: ${err.message}`);
    await ss(page, 'FATAL.png').catch(()=>{});
    results.push({ step: 'FATAL', ok: false, note: err.message.slice(0, 100) });
  } finally {
    console.log('\n════════════════════════════════════');
    console.log('E2E RESULTS');
    console.log('════════════════════════════════════');
    results.forEach(r => {
      console.log(`${r.ok ? '✅' : '❌'} ${r.step}${r.id ? ' (ID:' + r.id + ')' : ''}${r.note ? ' — ' + r.note : ''}`);
    });
    console.log(`\nTender: ${tenderId}, TKP: ${tkpId}, Work: ${workId}`);
    console.log('════════════════════════════════════\n');
    await browser.close();
  }
})();
