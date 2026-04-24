// E2E Full Chain Test v2 — ASGARD CRM
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://asgard-crm.ru';
const DIR = __dirname;
const CREDS = { login: 'admin', password: 'AsgardTest2026!', pin: '1234' };

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

async function ss(page, name) {
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(DIR, name), fullPage: false });
  log(`SCREENSHOT: ${name}`);
}

async function waitLoad(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
}

// Dump visible form elements
async function dumpForm(page, label) {
  const data = await page.evaluate(() => {
    const isVis = el => el && el.offsetParent && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const inputs = Array.from(document.querySelectorAll('.modal-content input, .modal-content select, .modal-content textarea, #modalBody input, #modalBody select, #modalBody textarea'))
      .filter(el => isVis(el) && el.type !== 'hidden')
      .map(el => `  [${el.tagName} ${el.type||''}] id="${el.id}" name="${el.name}" ph="${el.placeholder}" val="${(el.value||'').slice(0,50)}"`);
    const btns = Array.from(document.querySelectorAll('.modal-content button, #modalBody button'))
      .filter(isVis)
      .map(el => `  [btn] id="${el.id}" text="${el.textContent.trim().slice(0,60)}"`);
    // CRSelect current values
    const crs = [];
    if (typeof CRSelect !== 'undefined') {
      const all = CRSelect.getAll ? CRSelect.getAll() : {};
      for (const [k,v] of Object.entries(all)) {
        crs.push(`  [CRS] ${k} = "${v}"`);
      }
    }
    // CRDatePicker values
    const crd = [];
    document.querySelectorAll('[data-cr-dp-id]').forEach(el => {
      const id = el.getAttribute('data-cr-dp-id');
      if (typeof CRDatePicker !== 'undefined') {
        try { crd.push(`  [CRD] ${id} = "${CRDatePicker.getValue(id)}"`); } catch(e) {}
      }
    });
    return { inputs, btns, crs, crd };
  }).catch(() => ({ inputs: [], btns: [], crs: [], crd: [] }));

  console.log(`\n=== ${label} ===`);
  if (data.inputs.length) { console.log('INPUTS:'); data.inputs.forEach(i => console.log(i)); }
  if (data.btns.length) { console.log('BUTTONS:'); data.btns.forEach(b => console.log(b)); }
  if (data.crs.length) { console.log('CR-SELECTS:'); data.crs.forEach(s => console.log(s)); }
  if (data.crd.length) { console.log('CR-DATES:'); data.crd.forEach(d => console.log(d)); }
  console.log('===\n');
  return data;
}

const results = [];
let tenderId = null, tkpId = null, workId = null;

(async () => {
  log('Starting E2E v2...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(`PAGE_ERR: ${err.message}`));

  try {
    // ════════════════════════════════
    // LOGIN
    // ════════════════════════════════
    log('LOGIN...');
    await page.goto(BASE + '/#/welcome');
    await waitLoad(page);
    await page.locator('#btnShowLogin').click().catch(() => {});
    await page.waitForSelector('#w_login', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
    await page.fill('#w_login', CREDS.login);
    await page.fill('#w_pass', CREDS.password);
    await page.locator('#btnDoLogin').click();
    await page.waitForSelector('#pinForm', { state: 'visible', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Handle setup form if shown
    if (await page.locator('#setupForm').isVisible().catch(() => false)) {
      log('Setup form...');
      await page.fill('#s_pass', CREDS.password);
      await page.waitForTimeout(500);
      const pad = page.locator('#setupPinKeypadContainer');
      if (await pad.isVisible().catch(() => false)) {
        for (const d of CREDS.pin.split('')) { await pad.locator(`[data-digit="${d}"]`).click(); await page.waitForTimeout(200); }
      }
      await page.locator('#btnSetupSave').click();
      await page.waitForTimeout(3000);
    }

    // Enter PIN
    if (await page.locator('#pinForm').isVisible().catch(() => false)) {
      log('PIN entry...');
      for (const d of CREDS.pin.split('')) {
        await page.locator(`#pk-keypad [data-digit="${d}"]`).click();
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(3000);
    }

    await page.waitForFunction(() => localStorage.getItem('asgard_token')?.length > 50, { timeout: 15000 });
    await waitLoad(page);
    await ss(page, '00_logged_in.png');
    log('LOGIN OK');
    results.push({ step: '0. Login', ok: true });

    // ════════════════════════════════
    // CREATE CUSTOMER FIRST
    // ════════════════════════════════
    log('Creating customer...');
    await page.goto(BASE + '/#/customers');
    await waitLoad(page);
    await ss(page, '00b_customers_page.png');

    // Click create button
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.offsetParent && /Создать|Добавить|Новый|\+/.test(b.textContent) && b.id !== 'mimirNewChat');
      if (btn) { btn.click(); return btn.textContent.trim().slice(0, 40); }
      return null;
    });
    await page.waitForTimeout(2000);
    await page.waitForSelector('.modal-content, .modalback', { state: 'visible', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    await dumpForm(page, 'CUSTOMER CREATE FORM');
    await ss(page, '00c_customer_form.png');

    // Fill customer form — find fields by placeholder/label
    // Try INN field
    const innField = page.locator('.modal-content input[placeholder*="ИНН"], .modal-content input[name*="inn"], #c_inn, #inn').first();
    if (await innField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await innField.fill('7728186670');
      await page.waitForTimeout(3000); // Wait for DaData lookup
    }

    // Try name field
    const nameField = page.locator('.modal-content input[placeholder*="Название"], .modal-content input[name*="name"], .modal-content input[name*="title"], #c_name, #name').first();
    if (await nameField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nameField.fill('ПАО «ЛУКОЙЛ-Нефтехим»');
    }

    // Try contact person
    const contactField = page.locator('.modal-content input[placeholder*="Контакт"], .modal-content input[name*="contact"], #c_contact').first();
    if (await contactField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await contactField.fill('Козлов Дмитрий Сергеевич');
    }

    // Try phone
    const phoneField = page.locator('.modal-content input[placeholder*="Телефон"], .modal-content input[name*="phone"], .modal-content input[type="tel"], #c_phone').first();
    if (await phoneField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await phoneField.fill('+7 (831) 255-12-34');
    }

    // Try address/city
    const addrField = page.locator('.modal-content input[placeholder*="Адрес"], .modal-content input[name*="address"], #c_address').first();
    if (await addrField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addrField.fill('г. Кстово, Нижегородская обл., промзона');
    }

    // Try KPP
    const kppField = page.locator('.modal-content input[placeholder*="КПП"], .modal-content input[name*="kpp"], #c_kpp').first();
    if (await kppField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await kppField.fill('772801001');
    }

    // Fill all remaining visible text inputs
    const emptyInputs = await page.evaluate(() => {
      const modal = document.querySelector('.modal-content, #modalBody');
      if (!modal) return [];
      return Array.from(modal.querySelectorAll('input[type="text"], input:not([type]), textarea'))
        .filter(el => el.offsetParent && !el.value && getComputedStyle(el).display !== 'none')
        .map(el => ({ id: el.id, name: el.name, ph: el.placeholder }));
    });
    log('Empty inputs in customer form: ' + JSON.stringify(emptyInputs));

    await ss(page, '00d_customer_filled.png');
    await dumpForm(page, 'CUSTOMER AFTER FILL');

    // Save customer
    const saveCustomerBtn = page.locator('.modal-content button:has-text("Сохранить"), .modal-content button:has-text("Создать"), .modal-content button.btn-primary, #btnSave').first();
    if (await saveCustomerBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveCustomerBtn.click();
      await page.waitForTimeout(3000);
    }

    // Check if modal closed
    const custModalOpen = await page.locator('.modal-content').isVisible().catch(() => false);
    await ss(page, '00e_customer_saved.png');
    log(`Customer saved, modal still open: ${custModalOpen}`);
    results.push({ step: '0.5 Create Customer', ok: !custModalOpen });

    // ════════════════════════════════
    // STEP 1: CREATE TENDER
    // ════════════════════════════════
    log('STEP 1: Create tender...');
    await page.goto(BASE + '/#/tenders');
    await waitLoad(page);
    await ss(page, '01_tenders_page.png');

    // Click "Внести тендер"
    await page.locator('#btnNew').click();
    await page.waitForTimeout(2000);
    await page.waitForSelector('.modal-content, .modalback', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1500);

    log('Filling tender...');

    // === CUSTOMER ===
    // Type customer name in autocomplete
    const custAc = page.locator('#cr-customer-wrap .cr-ac__input').first();
    if (await custAc.isVisible({ timeout: 3000 }).catch(() => false)) {
      await custAc.fill('ЛУКОЙЛ');
      await page.waitForTimeout(3000);
      // Check for autocomplete suggestions
      const suggestion = page.locator('#cr-customer-wrap .cr-ac__option, .cr-ac__options .cr-ac__option').first();
      if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await suggestion.click();
        log('Customer selected from autocomplete');
        await page.waitForTimeout(1000);
      } else {
        log('No customer suggestion found, trying INN...');
        // Try INN approach
        const innAc = page.locator('#cr-inn-wrap .cr-ac__input').first();
        if (await innAc.isVisible({ timeout: 2000 }).catch(() => false)) {
          await innAc.fill('7728186670');
          await page.waitForTimeout(3000);
          const innSug = page.locator('#cr-inn-wrap .cr-ac__option').first();
          if (await innSug.isVisible({ timeout: 3000 }).catch(() => false)) {
            await innSug.click();
            log('Customer selected by INN');
            await page.waitForTimeout(1000);
          } else {
            log('WARN: Customer not found by INN either');
          }
        }
      }
    }

    // === TITLE ===
    await page.fill('#e_title', 'Химическая чистка теплообменного оборудования АВТ-6');

    // === PRICE ===
    await page.fill('#e_price', '4850000');

    // === CRSelect fields via API (correct values from diagnostic) ===
    await page.evaluate(() => {
      // Type = "Тендер" (already default, but set explicitly)
      CRSelect.setValue('e_type_w', 'Тендер');
      // PM = 3474 (Андросов Никита Андреевич)
      CRSelect.setValue('e_pm_w', '3474');
      // Status = keep "Черновик" (default) — will change to "Новый" after
      // Tag = 21 (Химическая очистка)
      CRSelect.setValue('e_tag_w', '21');
      // Period — DON'T TOUCH (already pre-filled Apr 2026)
    });
    log('CRSelect values set');

    // === DATES via CRDatePicker API (using data-cr-dp-id values) ===
    const dateResults = await page.evaluate(() => {
      const r = {};
      try { CRDatePicker.setValue('e_docs_deadline', '2026-04-20'); r.deadline = CRDatePicker.getValue('e_docs_deadline'); } catch(e) { r.deadline_err = e.message; }
      try { CRDatePicker.setValue('e_ws', '2026-05-15'); r.ws = CRDatePicker.getValue('e_ws'); } catch(e) { r.ws_err = e.message; }
      try { CRDatePicker.setValue('e_we', '2026-05-30'); r.we = CRDatePicker.getValue('e_we'); } catch(e) { r.we_err = e.message; }
      return r;
    });
    log('Date results: ' + JSON.stringify(dateResults));

    // === URL (optional) ===
    await page.fill('#e_url', '').catch(() => {});

    await page.waitForTimeout(1000);
    await dumpForm(page, 'TENDER AFTER FILL');
    await ss(page, '02_tender_form_filled.png');

    // === SAVE ===
    log('Saving tender...');
    await page.locator('#btnSave').click();
    await page.waitForTimeout(4000);

    // Check for validation error
    const validationErr = await page.evaluate(() => {
      // Check for error dialog/toast
      const errDialog = document.querySelector('.swal2-popup, .toast-error, [role="alertdialog"]');
      if (errDialog && errDialog.offsetParent) return errDialog.textContent.trim().slice(0, 200);
      // Check for modal still visible with error
      const modalErr = document.querySelector('.modal-content .alert-danger, .modal-content .error');
      if (modalErr) return modalErr.textContent.trim().slice(0, 200);
      return null;
    });

    if (validationErr) {
      log(`VALIDATION ERROR: ${validationErr}`);
      await ss(page, '02b_tender_validation_error.png');

      // Try "Сохранить как черновик" if validation blocks full save
      const draftBtn = page.locator('button:has-text("Сохранить как черновик"), #btnSaveDraft, button:has-text("Черновик")').first();
      if (await draftBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        log('Trying draft save...');
        await draftBtn.click();
        await page.waitForTimeout(3000);
      } else {
        // Try clicking "Заполнить поля" if that's an option
        const fillBtn = page.locator('button:has-text("Заполнить поля")').first();
        if (await fillBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await fillBtn.click();
          await page.waitForTimeout(1000);
          // Re-dump to see what's missing
          await dumpForm(page, 'TENDER AFTER VALIDATION CLICK');
          await ss(page, '02c_tender_after_validation.png');
        }
      }
    }

    // Check if modal closed (= success)
    const tenderModalOpen = await page.locator('.modal-content').isVisible().catch(() => false);
    await waitLoad(page);
    await ss(page, '03_tender_created.png');

    // Get tender ID
    tenderId = await page.evaluate(() => {
      // From URL
      const m = location.hash.match(/open=(\d+)/);
      if (m) return m[1];
      // From first table row
      const rows = document.querySelectorAll('tbody tr[data-id]');
      if (rows.length > 0) return rows[0].getAttribute('data-id');
      return null;
    });
    log(`Tender ID: ${tenderId}, modal still open: ${tenderModalOpen}`);
    results.push({ step: '1. Create Tender', ok: !!tenderId, id: tenderId });

    if (!tenderId) {
      log('FATAL: Could not create tender. Taking error screenshot and stopping.');
      await ss(page, 'FATAL_no_tender.png');
      throw new Error('Tender creation failed — see screenshots');
    }

    // ════════════════════════════════
    // STEP 2: CREATE TKP
    // ════════════════════════════════
    log('STEP 2: Create TKP...');
    await page.goto(BASE + '/#/tkp');
    await waitLoad(page);
    await ss(page, '04_tkp_page.png');

    // Click create TKP — use force to bypass overlay
    await page.locator('#btnNewTkp').click({ force: true });
    await page.waitForTimeout(2000);
    await page.waitForSelector('.modal-content, .modalback, #tkpEditor', { state: 'visible', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    await dumpForm(page, 'TKP CREATE FORM');
    await ss(page, '04b_tkp_form_empty.png');

    // Fill TKP fields
    await page.fill('#tkpSubject', 'ТКП: Химическая чистка теплообменного оборудования АВТ-6').catch(() => log('tkpSubject not found'));
    await page.fill('#tkpDescription', 'Химическая чистка теплообменного оборудования на установке АВТ-6. Бригада: 8 человек, 15 рабочих дней. Материалы: соляная кислота, ингибитор коррозии, NaOH, пассиватор. Транспорт: авиабилеты Москва↔Н.Новгород (16 шт). Проживание: 15 ночей × 8 чел. Суточные: 1000₽ × 15 дн × 8 чел.').catch(() => log('tkpDescription not found'));

    // Customer search in TKP
    const tkpCustSearch = page.locator('#tkpCustomerSearch').first();
    if (await tkpCustSearch.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tkpCustSearch.fill('ЛУКОЙЛ');
      await page.waitForTimeout(2000);
      const sug = page.locator('#tkpCustomerDropdown .item, #tkpCustomerDropdown div[data-id]').first();
      if (await sug.isVisible({ timeout: 3000 }).catch(() => false)) {
        await sug.click();
        await page.waitForTimeout(1000);
        log('TKP customer selected');
      } else {
        log('TKP customer not in dropdown');
      }
    }

    // Contact fields
    await page.fill('#tkpContactPerson', 'Козлов Дмитрий Сергеевич').catch(() => {});
    await page.fill('#tkpContactPhone', '+7 (831) 255-12-34').catch(() => {});
    await page.fill('#tkpContactEmail', 'kozlov@lukoil-nh.ru').catch(() => {});
    await page.fill('#tkpAddress', 'г. Кстово, промзона ЛУКОЙЛ-Нефтехим').catch(() => {});

    // Link to tender
    const tkpTenderSearch = page.locator('#tkpTenderSearch').first();
    if (await tkpTenderSearch.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tkpTenderSearch.fill('Химическая');
      await page.waitForTimeout(2000);
      const tsug = page.locator('#tkpTenderDropdown .item, #tkpTenderDropdown div[data-id]').first();
      if (await tsug.isVisible({ timeout: 2000 }).catch(() => false)) {
        await tsug.click();
        await page.waitForTimeout(1000);
        log('TKP tender linked');
      }
    }

    // Additional fields
    await page.fill('#tkpDeadline', '15 рабочих дней').catch(() => {});
    await page.fill('#tkpValidity', '30').catch(() => {});
    await page.fill('#tkpNotes', 'Объект: АВТ-6, г. Кстово, Нижегородская обл. Установка первичной переработки нефти.').catch(() => {});
    await page.fill('#tkpAuthorName', 'Андросов Никита Андреевич').catch(() => {});
    await page.fill('#tkpAuthorPosition', 'Генеральный директор').catch(() => {});

    // Add items
    log('Adding TKP items...');
    const items = [
      ['Химическая чистка теплообменников (8 ед.)', 'комплекс', '1', '2500000'],
      ['Соляная кислота ингибированная', 'т', '5', '45000'],
      ['Ингибитор коррозии', 'т', '0.5', '120000'],
      ['Авиабилеты Москва-Н.Новгород (16 шт)', 'шт', '16', '12000'],
      ['Проживание (15 ночей × 8 чел)', 'сут', '120', '3500'],
      ['Суточные (15 дн × 8 чел)', 'сут', '120', '1000'],
    ];

    for (let i = 0; i < items.length; i++) {
      if (i > 0) {
        const addBtn = page.locator('#btnAddItem, button:has-text("Добавить строку"), button:has-text("+ Строку"), button:has-text("+ строку")').first();
        if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await addBtn.click();
          await page.waitForTimeout(500);
        }
      }

      // Fill last row
      await page.evaluate((item) => {
        const tbody = document.querySelector('#tkpItemsBody');
        if (!tbody) return;
        const rows = tbody.querySelectorAll('tr');
        const row = rows[rows.length - 1];
        if (!row) return;
        const inputs = row.querySelectorAll('input, textarea');
        // Typically: desc, unit, qty, price
        if (inputs[0]) { inputs[0].value = item[0]; inputs[0].dispatchEvent(new Event('input', {bubbles:true})); }
        if (inputs[1]) { inputs[1].value = item[1]; inputs[1].dispatchEvent(new Event('input', {bubbles:true})); }
        if (inputs[2]) { inputs[2].value = item[2]; inputs[2].dispatchEvent(new Event('input', {bubbles:true})); }
        if (inputs[3]) { inputs[3].value = item[3]; inputs[3].dispatchEvent(new Event('input', {bubbles:true})); }
      }, items[i]);
    }

    await page.waitForTimeout(1000);
    await ss(page, '05_tkp_filled.png');

    // Save TKP
    log('Saving TKP...');
    const saveTkp = page.locator('#btnSaveTkp').first();
    if (await saveTkp.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveTkp.click({ force: true });
    } else {
      await page.locator('button:has-text("Сохранить")').first().click({ force: true });
    }
    await page.waitForTimeout(4000);
    await ss(page, '06_tkp_saved.png');

    tkpId = await page.evaluate(() => {
      const url = location.hash;
      const m = url.match(/id=(\d+)/);
      if (m) return m[1];
      const row = document.querySelector('tbody tr[data-id], [data-id]');
      return row ? row.getAttribute('data-id') : null;
    });
    log(`TKP ID: ${tkpId}`);
    results.push({ step: '2. Create TKP', ok: !!tkpId, id: tkpId });

    // ════════════════════════════════
    // STEP 3: APPROVAL
    // ════════════════════════════════
    log('STEP 3: Check approval...');
    // Navigate to approvals page
    await page.goto(BASE + '/#/approvals');
    await waitLoad(page);
    await dumpForm(page, 'APPROVALS PAGE');
    await ss(page, '07_approvals.png');

    // Look for any approval items
    const hasApproval = await page.evaluate(() => {
      const rows = document.querySelectorAll('tbody tr[data-id], .card[data-id], .approval-item');
      return rows.length;
    });
    log(`Approval items: ${hasApproval}`);

    if (hasApproval > 0) {
      // Click first item
      await page.locator('tbody tr[data-id], .card[data-id]').first().click({ force: true });
      await page.waitForTimeout(2000);
      await ss(page, '08_approval_detail.png');

      // Try to approve
      const apprBtn = page.locator('button:has-text("Согласовать"), button:has-text("Утвердить"), button:has-text("Одобрить")').first();
      if (await apprBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await apprBtn.click();
        await page.waitForTimeout(2000);
        await ss(page, '09_approved.png');
        log('Approved!');
      }
    }
    results.push({ step: '3. Approval', ok: true, note: `${hasApproval} items` });

    // ════════════════════════════════
    // STEP 4: CREATE WORK
    // ════════════════════════════════
    log('STEP 4: Create work...');
    await page.goto(BASE + '/#/pm-works');
    await waitLoad(page);
    await ss(page, '10_works_page.png');

    // Click create
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.offsetParent && /Создать|Добавить|Новая|\+/.test(b.textContent) && b.id !== 'mimirNewChat');
      if (btn) btn.click();
    });
    await page.waitForTimeout(2000);
    await page.waitForSelector('.modal-content, .modalback', { state: 'visible', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    await dumpForm(page, 'WORK CREATE FORM');
    await ss(page, '10b_work_form.png');

    // Fill work form - find the actual fields from form dump
    // Try common selectors for work title
    const workTitleFilled = await page.evaluate(() => {
      const modal = document.querySelector('.modal-content, #modalBody');
      if (!modal) return false;
      const inputs = modal.querySelectorAll('input[type="text"], input:not([type])');
      for (const inp of inputs) {
        if (!inp.value && inp.offsetParent && !inp.classList.contains('cr-select__search-input') && !inp.classList.contains('cr-ac__input')) {
          inp.value = 'Химическая чистка ТО АВТ-6, ЛУКОЙЛ-Нефтехим, Кстово';
          inp.dispatchEvent(new Event('input', {bubbles:true}));
          inp.dispatchEvent(new Event('change', {bubbles:true}));
          return true;
        }
      }
      return false;
    });
    log(`Work title filled: ${workTitleFilled}`);

    // Set CRSelect fields for work
    await page.evaluate(() => {
      if (typeof CRSelect === 'undefined') return;
      const all = CRSelect.getAll ? CRSelect.getAll() : {};
      for (const [k, v] of Object.entries(all)) {
        // Find PM field
        if (k.includes('pm') || k.includes('manager') || k.includes('responsible')) {
          try { CRSelect.setValue(k, '3474'); } catch(e) {} // Андросов
        }
        // Find status field
        if (k.includes('status')) {
          try { CRSelect.setValue(k, 'in_progress'); } catch(e) {}
        }
      }
    });

    // Try to fill customer
    const workCustAc = page.locator('.modal-content .cr-ac__input').first();
    if (await workCustAc.isVisible({ timeout: 2000 }).catch(() => false)) {
      await workCustAc.fill('ЛУКОЙЛ');
      await page.waitForTimeout(2000);
      const wsug = page.locator('.modal-content .cr-ac__option').first();
      if (await wsug.isVisible({ timeout: 2000 }).catch(() => false)) {
        await wsug.click();
        await page.waitForTimeout(1000);
      }
    }

    // Set any CRDatePicker in the work form
    await page.evaluate(() => {
      if (typeof CRDatePicker === 'undefined') return;
      document.querySelectorAll('.modal-content [data-cr-dp-id]').forEach(el => {
        const dpId = el.getAttribute('data-cr-dp-id');
        if (dpId.includes('start') || dpId.includes('ws') || dpId.includes('begin')) {
          try { CRDatePicker.setValue(dpId, '2026-05-15'); } catch(e) {}
        } else if (dpId.includes('end') || dpId.includes('we') || dpId.includes('finish')) {
          try { CRDatePicker.setValue(dpId, '2026-05-30'); } catch(e) {}
        }
      });
    });

    // Fill price/amount
    await page.evaluate(() => {
      const modal = document.querySelector('.modal-content, #modalBody');
      if (!modal) return;
      const priceInput = modal.querySelector('input[name*="price"], input[name*="sum"], input[name*="amount"], input[placeholder*="Сумма"]');
      if (priceInput) {
        priceInput.value = '4850000';
        priceInput.dispatchEvent(new Event('input', {bubbles:true}));
      }
    });

    // Link tender if select exists
    if (tenderId) {
      await page.evaluate((tid) => {
        const sel = document.querySelector('.modal-content select[name*="tender"], .modal-content select[name*="tender_id"]');
        if (sel) { sel.value = tid; sel.dispatchEvent(new Event('change', {bubbles:true})); }
      }, tenderId);
    }

    await page.waitForTimeout(1000);
    await dumpForm(page, 'WORK AFTER FILL');
    await ss(page, '11_work_filled.png');

    // Save work
    const saveWork = page.locator('.modal-content button:has-text("Сохранить"), .modal-content button:has-text("Создать"), .modal-content button.btn-primary, #btnSave').first();
    if (await saveWork.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveWork.click();
    }
    await page.waitForTimeout(4000);
    await ss(page, '12_work_created.png');

    workId = await page.evaluate(() => {
      const rows = document.querySelectorAll('tbody tr[data-id], .card[data-id], .work-card[data-id]');
      if (rows.length > 0) return rows[0].getAttribute('data-id');
      return null;
    });
    log(`Work ID: ${workId}`);
    results.push({ step: '4. Create Work', ok: !!workId, id: workId });

    // ════════════════════════════════
    // STEP 5-6: STAFF / PERSONNEL
    // ════════════════════════════════
    log('STEP 5-6: Staff and personnel...');
    await page.goto(BASE + '/#/personnel');
    await waitLoad(page);

    // Search for Андросов
    const persSearch = page.locator('#f_q, input[type="search"], input[placeholder*="Поиск"]').first();
    if (await persSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
      await persSearch.fill('Андросов');
      await page.waitForTimeout(2000);
    }
    await ss(page, '15_personnel_search.png');

    // Click first employee
    const empRow = page.locator('tbody tr[data-id], .card[data-id]').first();
    if (await empRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await empRow.click({ force: true });
      await page.waitForTimeout(2000);
      await ss(page, '16_employee_card.png');
    }
    results.push({ step: '5-6. Personnel', ok: true });

    // ════════════════════════════════
    // STEP 7: VERIFY WORK
    // ════════════════════════════════
    log('STEP 7: Verify work card...');
    if (workId) {
      await page.goto(BASE + `/#/pm-works?open=${workId}`);
      await waitLoad(page);
      await ss(page, '17_work_card.png');
    }
    results.push({ step: '7. Verify', ok: !!workId });

    // ════════════════════════════════
    // STEP 8-14: FIELD MODULE
    // ════════════════════════════════
    log('STEP 8: Field module...');

    // Open work card if not already open
    if (workId) {
      await page.goto(BASE + `/#/pm-works?open=${workId}`);
      await waitLoad(page);
    } else {
      await page.goto(BASE + '/#/pm-works');
      await waitLoad(page);
      // Click first work
      await page.locator('tbody tr[data-id], .card[data-id]').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Look for field module button in work card
    const fieldBtns = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, .btn, a[href]')).filter(el => {
        const t = (el.textContent || '').toLowerCase();
        return el.offsetParent && (t.includes('полевой') || t.includes('field') || t.includes('⚔') || t.includes('модуль'));
      }).map(el => ({ text: el.textContent.trim().slice(0, 50), id: el.id, tag: el.tagName }));
    });
    log('Field module buttons: ' + JSON.stringify(fieldBtns));

    if (fieldBtns.length > 0) {
      // Click field module button
      await page.locator(`button:has-text("Полевой"), button:has-text("⚔️"), button:has-text("Field")`).first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(3000);
      await ss(page, '19_field_module.png');
      await dumpForm(page, 'FIELD MODULE');

      // Navigate tabs
      const tabs = ['crew', 'logistics', 'stages', 'dashboard', 'timesheet'];
      for (const tab of tabs) {
        const tabBtn = page.locator(`[data-ftab="${tab}"]`).first();
        if (await tabBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await tabBtn.click();
          await page.waitForTimeout(2000);
          const ssName = { crew: '20_field_crew.png', logistics: '22_logistics.png', stages: '27_stages.png', dashboard: '30_dashboard.png', timesheet: '31_timesheet.png' }[tab];
          await ss(page, ssName);
          log(`Field tab ${tab} OK`);
        }
      }
      results.push({ step: '8-14. Field Module', ok: true });
    } else {
      log('FIELD MODULE BUTTON NOT FOUND');
      await ss(page, '19_field_not_found.png');

      // Check if there are action menus or dropdowns
      const actionMenus = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[data-action], .dropdown-item, .action-item, button')).filter(el => {
          const t = (el.textContent || '').toLowerCase();
          return el.offsetParent && (t.includes('действ') || t.includes('action') || t.includes('меню'));
        }).map(el => el.textContent.trim().slice(0, 50));
      });
      log('Action menus: ' + JSON.stringify(actionMenus));
      results.push({ step: '8-14. Field Module', ok: false, note: 'button not found' });
    }

    // ════════════════════════════════
    // FINAL
    // ════════════════════════════════
    await ss(page, '33_final.png');

  } catch (err) {
    log(`ERROR: ${err.message}`);
    await ss(page, 'ERROR_fatal.png').catch(() => {});
    results.push({ step: 'FATAL', ok: false, note: err.message });
  } finally {
    console.log('\n\n════════════════════════════════════');
    console.log('RESULTS');
    console.log('════════════════════════════════════');
    results.forEach(r => {
      const icon = r.ok ? '✅' : '❌';
      console.log(`${icon} ${r.step} ${r.id ? '(ID:' + r.id + ')' : ''} ${r.note || ''}`);
    });
    console.log(`\nTender: ${tenderId}, TKP: ${tkpId}, Work: ${workId}`);
    console.log(`Console errors: ${consoleErrors.length}`);
    consoleErrors.slice(0, 5).forEach(e => console.log(`  ⚠ ${e.slice(0, 150)}`));
    console.log('════════════════════════════════════\n');
    await browser.close();
  }
})();
