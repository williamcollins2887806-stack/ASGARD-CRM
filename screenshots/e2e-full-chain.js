// E2E Full Chain Test — ASGARD CRM
// Tenders → TKP → Approval → Work → Staff → Field Module
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://asgard-crm.ru';
const DIR = __dirname;
const CREDS = { login: 'admin', password: 'AsgardTest2026!', pin: '1234' };

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }
function logJSON(label, obj) { console.log(`[${label}]`, JSON.stringify(obj, null, 2).slice(0, 3000)); }

async function ss(page, name) {
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(DIR, name), fullPage: false });
  log(`SCREENSHOT: ${name}`);
}

async function waitLoad(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
}

// Dump all visible form elements for diagnostics
async function dumpForm(page, label) {
  const data = await page.evaluate(() => {
    const isVis = el => {
      if (!el || !el.offsetParent) return false;
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    };
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'))
      .filter(el => isVis(el) && el.type !== 'hidden')
      .map(el => ({ tag: el.tagName, type: el.type || '', id: el.id || '', name: el.name || '', ph: el.placeholder || '', val: (el.value || '').slice(0, 50) }));
    const buttons = Array.from(document.querySelectorAll('button, .btn, [role="button"]'))
      .filter(isVis)
      .map(el => ({ text: (el.textContent || '').trim().slice(0, 80), id: el.id || '', cls: (el.className || '').toString().slice(0, 80) }));
    // CRSelect wrappers
    const crSel = [];
    if (typeof CRSelect !== 'undefined' && CRSelect._instances) {
      for (const [k, v] of Object.entries(CRSelect._instances || {})) {
        crSel.push({ id: k, value: v.value, options: (v.options || []).slice(0, 10).map(o => ({ v: o.value, l: (o.label || '').slice(0, 40) })) });
      }
    }
    return { inputs, buttons, crSel };
  }).catch(() => ({ inputs: [], buttons: [], crSel: [] }));

  console.log(`\n====== FORM DUMP: ${label} ======`);
  if (data.inputs.length) { console.log('INPUTS:'); data.inputs.forEach(i => console.log(`  [${i.tag} ${i.type}] id="${i.id}" name="${i.name}" ph="${i.ph}" val="${i.val}"`)); }
  if (data.buttons.length) { console.log('BUTTONS:'); data.buttons.forEach(b => console.log(`  [btn] id="${b.id}" text="${b.text}"`)); }
  if (data.crSel.length) { console.log('CR-SELECTS:'); data.crSel.forEach(s => console.log(`  [CRSelect] id="${s.id}" val="${s.value}" opts=${JSON.stringify(s.options)}`)); }
  console.log('======\n');
  return data;
}

// Set CRSelect value by ID
async function setCRS(page, id, value) {
  return page.evaluate(({id, value}) => {
    if (typeof CRSelect !== 'undefined') {
      // Try setValue directly
      if (CRSelect.setValue) { CRSelect.setValue(id, value); return 'setValue'; }
      // Try _instances
      if (CRSelect._instances && CRSelect._instances[id]) {
        CRSelect._instances[id].value = value;
        const el = document.querySelector(`#${id}`);
        if (el) { const inp = el.querySelector('input[type="hidden"]'); if (inp) inp.value = value; }
        return '_instances';
      }
    }
    // Fallback native select
    const sel = document.querySelector(`#${id} select, select#${id}`);
    if (sel) { sel.value = value; sel.dispatchEvent(new Event('change', {bubbles:true})); return 'native'; }
    return 'NOT_FOUND';
  }, {id, value});
}

// Set CRDatePicker value
async function setCRD(page, id, isoDate) {
  return page.evaluate(({id, isoDate}) => {
    if (typeof CRDatePicker !== 'undefined' && CRDatePicker.setValue) {
      CRDatePicker.setValue(id, isoDate);
      return 'ok';
    }
    // Fallback
    const inp = document.querySelector(`#${id} input, input#${id}`);
    if (inp) {
      inp.value = isoDate;
      inp.dispatchEvent(new Event('input', {bubbles:true}));
      inp.dispatchEvent(new Event('change', {bubbles:true}));
      return 'fallback';
    }
    return 'NOT_FOUND';
  }, {id, isoDate});
}

// Try to fill an input by ID or name
async function fillInput(page, selector, value) {
  try {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.fill(value);
      return true;
    }
  } catch (e) {}
  return false;
}

// Click first visible matching button
async function clickBtn(page, textOrId, timeout = 5000) {
  if (textOrId.startsWith('#')) {
    const el = page.locator(textOrId);
    await el.waitFor({ state: 'visible', timeout });
    await el.click();
    return true;
  }
  // By text
  const el = page.locator(`button:has-text("${textOrId}"), .btn:has-text("${textOrId}")`).first();
  await el.waitFor({ state: 'visible', timeout });
  await el.click();
  return true;
}

// ══════════════════════════════════════
// MAIN
// ══════════════════════════════════════
(async () => {
  log('Starting E2E full chain test...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
  });
  const page = await context.newPage();

  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(`PAGE_ERROR: ${err.message}`));

  const results = [];
  let tenderId = null, tkpId = null, workId = null;

  try {
    // ═══════════════════════════════════
    // STEP 0: LOGIN
    // ═══════════════════════════════════
    log('STEP 0: Login...');
    await page.goto(BASE + '/#/welcome');
    await waitLoad(page);

    // Show login form
    const showLoginBtn = page.locator('#btnShowLogin');
    if (await showLoginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await showLoginBtn.click();
    }
    await page.waitForSelector('#w_login', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);

    await page.fill('#w_login', CREDS.login);
    await page.fill('#w_pass', CREDS.password);

    // Click login button
    const doLoginBtn = page.locator('#btnDoLogin');
    if (await doLoginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await doLoginBtn.click();
    } else {
      await page.locator('button:has-text("Войти")').first().click();
    }

    // Wait for PIN or setup
    await page.waitForSelector('#pinForm, #setupForm', { state: 'visible', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Handle setup form
    if (await page.locator('#setupForm').isVisible().catch(() => false)) {
      log('Setup form detected...');
      await page.fill('#s_pass', CREDS.password).catch(() => {});
      await page.waitForTimeout(500);
      const pad = page.locator('#setupPinKeypadContainer');
      if (await pad.isVisible().catch(() => false)) {
        for (const d of CREDS.pin.split('')) {
          await pad.locator(`[data-digit="${d}"]`).click().catch(() => {});
          await page.waitForTimeout(200);
        }
      }
      await page.locator('#btnSetupSave').click().catch(() => {});
      await page.waitForTimeout(3000);
    }

    // Enter PIN
    if (await page.locator('#pinForm').isVisible().catch(() => false)) {
      log('Entering PIN...');
      for (const d of CREDS.pin.split('')) {
        const key = page.locator(`#pk-keypad [data-digit="${d}"]`);
        if (await key.isVisible({ timeout: 3000 }).catch(() => false)) {
          await key.click();
          await page.waitForTimeout(300);
        }
      }
      await page.waitForTimeout(3000);
    }

    // Verify logged in
    const loggedIn = await page.waitForFunction(() => {
      const t = localStorage.getItem('asgard_token');
      return !!t && t.length > 50;
    }, { timeout: 15000 }).catch(() => null);

    if (!loggedIn) {
      await ss(page, '00_LOGIN_FAILED.png');
      throw new Error('LOGIN FAILED — token not found in localStorage');
    }

    await waitLoad(page);
    await ss(page, '00_logged_in.png');
    log('Login SUCCESS');
    results.push({ step: '0. Login', status: 'OK' });

    // ═══════════════════════════════════
    // STEP 1: CREATE TENDER
    // ═══════════════════════════════════
    log('STEP 1: Create tender...');
    await page.goto(BASE + '/#/tenders');
    await waitLoad(page);
    await ss(page, '01_tenders_page.png');

    // Click "Создать" / #btnNew
    const btnNew = page.locator('#btnNew');
    if (await btnNew.isVisible({ timeout: 5000 }).catch(() => false)) {
      await btnNew.click();
    } else {
      // Fallback: clickCreate pattern
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.offsetParent && /Создать|Добавить|Новый|\+/.test(b.textContent));
        if (btn) btn.click();
      });
    }
    await page.waitForTimeout(2000);

    // Wait for modal
    await page.waitForSelector('.modal-content, .modalback, #modalBody', { state: 'visible', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Dump form to understand fields
    const tenderForm = await dumpForm(page, 'TENDER CREATE FORM');
    await ss(page, '01b_tender_form_empty.png');

    // Fill tender fields
    log('Filling tender form...');

    // Title
    await fillInput(page, '#e_title', 'Химическая чистка теплообменного оборудования АВТ-6');

    // Price
    await fillInput(page, '#e_price', '4850000');

    // URL (optional)
    await fillInput(page, '#e_url', '');

    // Try description/textarea
    await fillInput(page, '.modal textarea', 'Химическая чистка теплообменного оборудования на установке первичной переработки нефти АВТ-6. Объект: ПАО ЛУКОЙЛ-Нефтехим, г. Кстово, Нижегородская обл. Контакт: Козлов Д.С. +7(831)255-12-34');

    // Customer by INN
    const innInput = page.locator('#cr-inn-wrap input, input[name="inn"], input[placeholder*="ИНН"]').first();
    if (await innInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await innInput.fill('7728186670');
      await page.waitForTimeout(3000); // Wait for autocomplete
      // Try to select first suggestion
      const suggestion = page.locator('.cr-autocomplete-item, .autocomplete-item, .suggestion-item, .dropdown-item').first();
      if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await suggestion.click();
        await page.waitForTimeout(1000);
      }
    }

    // Customer name field (fallback if INN didn't autocomplete)
    const custInput = page.locator('#cr-customer-wrap input, input[name="customer_name"], input[placeholder*="Заказчик"], input[placeholder*="заказчик"]').first();
    if (await custInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const custVal = await custInput.inputValue().catch(() => '');
      if (!custVal || custVal.length < 3) {
        await custInput.fill('ПАО ЛУКОЙЛ-Нефтехим');
        await page.waitForTimeout(2000);
        const sug = page.locator('.cr-autocomplete-item, .autocomplete-item, .suggestion-item').first();
        if (await sug.isVisible({ timeout: 2000 }).catch(() => false)) {
          await sug.click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // CRSelect fields — set values
    // Tender type
    let r = await setCRS(page, 'e_type_w', 'Тендер');
    log(`CRSelect e_type_w: ${r}`);

    // Status
    r = await setCRS(page, 'e_status_w', 'new');
    log(`CRSelect e_status_w: ${r}`);

    // PM — try to set admin (id=1) as PM
    r = await setCRS(page, 'e_pm_w', '1');
    log(`CRSelect e_pm_w: ${r}`);

    // Period
    r = await setCRS(page, 'e_period_month', '4');
    log(`CRSelect e_period_month: ${r}`);
    r = await setCRS(page, 'e_period_year', '2026');
    log(`CRSelect e_period_year: ${r}`);

    // Dates
    r = await setCRD(page, 'e_deadline_w', '2026-04-20');
    log(`CRDate e_deadline_w: ${r}`);
    r = await setCRD(page, 'e_ws_w', '2026-05-15');
    log(`CRDate e_ws_w: ${r}`);
    r = await setCRD(page, 'e_we_w', '2026-05-30');
    log(`CRDate e_we_w: ${r}`);

    await page.waitForTimeout(1000);
    await ss(page, '02_tender_form_filled.png');

    // Dump to verify
    await dumpForm(page, 'TENDER FORM AFTER FILL');

    // SAVE
    log('Saving tender...');
    const saveBtn = page.locator('#btnSave');
    if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveBtn.click();
    } else {
      // Fallback: click primary save button in modal
      await page.locator('.modal button.btn-primary, .modal button:has-text("Сохранить"), .modal button:has-text("Создать")').first().click();
    }
    await page.waitForTimeout(3000);

    // Check if modal closed (success) or error
    const modalStillVisible = await page.locator('.modal-content').isVisible().catch(() => false);
    if (modalStillVisible) {
      // Maybe there's an error toast or validation message
      await ss(page, '02b_tender_save_error.png');
      const errText = await page.locator('.toast-error, .alert-danger, .error-msg, .validation-error').first().textContent().catch(() => '');
      log(`TENDER SAVE — modal still visible. Error: ${errText}`);
      // Try to find and click a different save button
      const allBtns = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.modal button')).filter(b => b.offsetParent).map(b => ({ text: b.textContent.trim(), id: b.id }));
      });
      log('Modal buttons: ' + JSON.stringify(allBtns));
    }

    await waitLoad(page);
    await ss(page, '03_tender_created.png');

    // Try to get the tender ID
    tenderId = await page.evaluate(() => {
      // Check URL hash for open=ID
      const m = location.hash.match(/open=(\d+)/);
      if (m) return m[1];
      // Check first row in table
      const row = document.querySelector('tbody tr[data-id], .card[data-id], [data-id]');
      if (row) return row.getAttribute('data-id');
      return null;
    });
    log(`Tender ID: ${tenderId}`);
    results.push({ step: '1. Create Tender', status: tenderId ? 'OK' : 'MAYBE', id: tenderId });

    // ═══════════════════════════════════
    // STEP 2: CREATE TKP
    // ═══════════════════════════════════
    log('STEP 2: Create TKP...');
    await page.goto(BASE + '/#/tkp');
    await waitLoad(page);
    await ss(page, '04_tkp_page.png');

    // Click create TKP
    const btnNewTkp = page.locator('#btnNewTkp');
    if (await btnNewTkp.isVisible({ timeout: 5000 }).catch(() => false)) {
      await btnNewTkp.click();
    } else {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.offsetParent && /Создать|Добавить|Новый|Новое|\+/.test(b.textContent));
        if (btn) btn.click();
      });
    }
    await page.waitForTimeout(2000);
    await page.waitForSelector('.modal-content, .modalback, #modalBody, #tkpEditor', { state: 'visible', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const tkpForm = await dumpForm(page, 'TKP CREATE FORM');

    // Fill TKP fields
    // Subject/Title
    await fillInput(page, '#tkpSubject', 'ТКП: Химическая чистка ТО АВТ-6, ЛУКОЙЛ-Нефтехим');

    // Description
    await fillInput(page, '#tkpDescription', 'Химическая чистка теплообменного оборудования на установке АВТ-6. Бригада 8 человек, 15 рабочих дней. Материалы: соляная кислота, ингибитор, щёлочь, пассиватор. Транспорт: авиа Москва-Н.Новгород 16 билетов. Проживание: гостиница 15 ночей × 8 чел. Суточные: 1000₽ × 15 дней × 8 чел.');

    // Customer search in TKP
    const tkpCust = page.locator('#tkpCustomerSearch, input[placeholder*="Заказчик"], input[placeholder*="заказчик"]').first();
    if (await tkpCust.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tkpCust.fill('ЛУКОЙЛ');
      await page.waitForTimeout(2000);
      const sug = page.locator('#tkpCustomerDropdown .item, .autocomplete-item, .dropdown-item, .suggestion').first();
      if (await sug.isVisible({ timeout: 3000 }).catch(() => false)) {
        await sug.click();
        await page.waitForTimeout(1000);
      }
    }

    // INN
    await fillInput(page, '#tkpInn', '7728186670');

    // Contact info
    await fillInput(page, '#tkpContactPerson', 'Козлов Дмитрий Сергеевич');
    await fillInput(page, '#tkpContactPhone', '+7 (831) 255-12-34');
    await fillInput(page, '#tkpContactEmail', 'kozlov@lukoil-nh.ru');
    await fillInput(page, '#tkpAddress', 'г. Кстово, промзона ЛУКОЙЛ-Нефтехим');

    // Link to tender
    if (tenderId) {
      const tkpTenderSearch = page.locator('#tkpTenderSearch').first();
      if (await tkpTenderSearch.isVisible({ timeout: 2000 }).catch(() => false)) {
        await tkpTenderSearch.fill('Химическая чистка');
        await page.waitForTimeout(2000);
        const sug = page.locator('#tkpTenderDropdown .item, .suggestion, .dropdown-item').first();
        if (await sug.isVisible({ timeout: 2000 }).catch(() => false)) {
          await sug.click();
        }
      }
    }

    // CRSelect type
    await setCRS(page, 'cr-tkpType-wrap', 'service');

    // Deadline & validity
    await fillInput(page, '#tkpDeadline', '15 рабочих дней с момента подписания договора');
    await fillInput(page, '#tkpValidity', '30');

    // Additional notes
    await fillInput(page, '#tkpNotes', 'Объект: АВТ-6, г. Кстово, Нижегородская обл.');

    // Author
    await fillInput(page, '#tkpAuthorName', 'Андросов Никита Андреевич');
    await fillInput(page, '#tkpAuthorPosition', 'Генеральный директор');

    // Add items (work rows)
    log('Adding TKP items...');
    const addItemBtn = page.locator('#btnAddItem, button:has-text("Добавить строку"), button:has-text("+ Строку")').first();

    const tkpItems = [
      { desc: 'Химическая чистка теплообменников (8 ед.)', unit: 'комплекс', qty: '1', price: '2500000' },
      { desc: 'Соляная кислота ингибированная', unit: 'т', qty: '5', price: '45000' },
      { desc: 'Ингибитор коррозии', unit: 'т', qty: '0.5', price: '120000' },
      { desc: 'Щёлочь (NaOH)', unit: 'т', qty: '3', price: '35000' },
      { desc: 'Пассиватор', unit: 'т', qty: '1', price: '80000' },
      { desc: 'Авиабилеты Москва-Н.Новгород (16 шт)', unit: 'шт', qty: '16', price: '12000' },
      { desc: 'Проживание (гостиница, 15 ночей × 8 чел)', unit: 'сут', qty: '120', price: '3500' },
      { desc: 'Суточные (15 дней × 8 чел)', unit: 'сут', qty: '120', price: '1000' },
    ];

    for (let i = 0; i < tkpItems.length; i++) {
      // Click add item for rows beyond first
      if (i > 0 && await addItemBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await addItemBtn.click();
        await page.waitForTimeout(500);
      }

      // Try to fill the last row in the items table
      const rows = page.locator('#tkpItemsBody tr, .tkp-items-row, .item-row');
      const rowCount = await rows.count();
      if (rowCount > 0) {
        const lastRow = rows.nth(rowCount - 1);
        const descInput = lastRow.locator('input[name*="desc"], input[name*="name"], textarea, input').first();
        const unitInput = lastRow.locator('input[name*="unit"], select[name*="unit"]').first();
        const qtyInput = lastRow.locator('input[name*="qty"], input[name*="quantity"], input[type="number"]').first();
        const priceInput = lastRow.locator('input[name*="price"], input[name*="cost"]').first();

        if (await descInput.isVisible({ timeout: 1000 }).catch(() => false)) await descInput.fill(tkpItems[i].desc);
        if (await unitInput.isVisible({ timeout: 1000 }).catch(() => false)) {
          if (await unitInput.evaluate(el => el.tagName) === 'SELECT') {
            await unitInput.selectOption({ label: tkpItems[i].unit }).catch(() => {});
          } else {
            await unitInput.fill(tkpItems[i].unit);
          }
        }
        if (await qtyInput.isVisible({ timeout: 1000 }).catch(() => false)) await qtyInput.fill(tkpItems[i].qty);
        if (await priceInput.isVisible({ timeout: 1000 }).catch(() => false)) await priceInput.fill(tkpItems[i].price);
      }
    }

    await page.waitForTimeout(1000);
    await ss(page, '05_tkp_filled.png');
    await dumpForm(page, 'TKP AFTER FILL');

    // Save TKP
    log('Saving TKP...');
    const saveTkp = page.locator('#btnSaveTkp, button:has-text("Сохранить")').first();
    if (await saveTkp.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveTkp.click();
    }
    await page.waitForTimeout(3000);
    await ss(page, '06_tkp_saved.png');

    tkpId = await page.evaluate(() => {
      const m = location.hash.match(/[?&]id=(\d+)/);
      if (m) return m[1];
      const row = document.querySelector('tbody tr[data-id], [data-id]');
      if (row) return row.getAttribute('data-id');
      return null;
    });
    log(`TKP ID: ${tkpId}`);
    results.push({ step: '2. Create TKP', status: tkpId ? 'OK' : 'MAYBE', id: tkpId });

    // ═══════════════════════════════════
    // STEP 3: SEND TKP TO APPROVAL
    // ═══════════════════════════════════
    log('STEP 3: Send TKP to approval...');
    // If we're on the TKP page, try to find an approval button
    // First open the TKP if not already open
    if (tkpId) {
      // Navigate to the TKP or open it
      await page.goto(BASE + '/#/tkp');
      await waitLoad(page);
    }

    // Look for approval buttons (this might be in estimates section, not TKP)
    // The approval flow might be through estimates, not TKP directly
    // Let's check what's available
    await ss(page, '07_before_approval.png');

    // Navigate to estimates/approvals to check
    await page.goto(BASE + '/#/all-estimates');
    await waitLoad(page);
    await dumpForm(page, 'ESTIMATES PAGE');
    await ss(page, '07b_estimates_page.png');

    // Try approvals page
    await page.goto(BASE + '/#/approvals');
    await waitLoad(page);
    await dumpForm(page, 'APPROVALS PAGE');
    await ss(page, '08_approvals_page.png');

    // Since admin is also effectively a director, check if we can approve from here
    // Look for any pending items
    const approvalRow = page.locator('tbody tr, .card[data-id], .approval-item').first();
    if (await approvalRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await approvalRow.click({ force: true });
      await page.waitForTimeout(2000);
      await ss(page, '08b_approval_detail.png');

      // Look for approve button
      const approveBtn = page.locator('button:has-text("Согласовать"), button:has-text("Утвердить"), button:has-text("Одобрить"), button.btn-success').first();
      if (await approveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await approveBtn.click();
        await page.waitForTimeout(2000);
      }
    }
    await ss(page, '09_approval_done.png');
    results.push({ step: '3. TKP Approval', status: 'ATTEMPTED' });

    // ═══════════════════════════════════
    // STEP 4: CREATE WORK
    // ═══════════════════════════════════
    log('STEP 4: Create work...');
    await page.goto(BASE + '/#/pm-works');
    await waitLoad(page);
    await ss(page, '10_works_page.png');

    // Click create
    const btnNewWork = page.locator('#btnNew, button:has-text("Создать"), button:has-text("Добавить")').first();
    if (await btnNewWork.isVisible({ timeout: 5000 }).catch(() => false)) {
      await btnNewWork.click();
    } else {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.offsetParent && /Создать|Добавить|Новый|\+/.test(b.textContent));
        if (btn) btn.click();
      });
    }
    await page.waitForTimeout(2000);
    await page.waitForSelector('.modal-content, .modalback, #modalBody', { state: 'visible', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const workForm = await dumpForm(page, 'WORK CREATE FORM');

    // Fill work fields
    // Try all possible field selectors based on what we found
    await fillInput(page, 'input[name="title"], input[name="name"], #w_title, .modal input[name="description"]', 'Химическая чистка ТО АВТ-6, ЛУКОЙЛ-Нефтехим, Кстово');

    // Customer
    const workCust = page.locator('.modal input[name="customer_name"], .modal input[placeholder*="Заказчик"]').first();
    if (await workCust.isVisible({ timeout: 2000 }).catch(() => false)) {
      await workCust.fill('ЛУКОЙЛ');
      await page.waitForTimeout(2000);
      const sug = page.locator('.autocomplete-item, .suggestion, .dropdown-item').first();
      if (await sug.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sug.click();
        await page.waitForTimeout(1000);
      }
    }

    // City / Object / Address
    await fillInput(page, 'input[name="city"]', 'Кстово');
    await fillInput(page, 'input[name="object"], input[name="object_name"]', 'АВТ-6');
    await fillInput(page, 'input[name="address"], input[name="object_address"]', 'г. Кстово, промзона ЛУКОЙЛ-Нефтехим');

    // Contract amount
    await fillInput(page, 'input[name="amount"], input[name="contract_sum"], input[name="sum"], input[name="price"]', '4850000');

    // Dates
    await fillInput(page, 'input[name="start_date"], input[name="date_start"]', '2026-05-15');
    await fillInput(page, 'input[name="end_date"], input[name="date_end"]', '2026-05-30');

    // Link to tender
    if (tenderId) {
      const tenderSelect = page.locator('select[name="tender_id"]').first();
      if (await tenderSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await tenderSelect.selectOption(tenderId).catch(() => {});
      }
    }

    // Try CRSelect fields for work
    await page.evaluate(() => {
      // Set all visible CRSelect fields for work
      if (typeof CRSelect !== 'undefined' && CRSelect._instances) {
        for (const [k, inst] of Object.entries(CRSelect._instances)) {
          // Status
          if (k.includes('status')) {
            const workOpt = inst.options?.find(o => o.value === 'in_progress' || o.label?.includes('В работе'));
            if (workOpt) CRSelect.setValue(k, workOpt.value);
          }
          // PM
          if (k.includes('pm') || k.includes('manager')) {
            const adminOpt = inst.options?.find(o => o.value === '1' || o.label?.includes('Андросов'));
            if (adminOpt) CRSelect.setValue(k, adminOpt.value);
          }
        }
      }
    });

    await page.waitForTimeout(1000);
    await ss(page, '11_work_form_filled.png');
    await dumpForm(page, 'WORK FORM AFTER FILL');

    // Save work
    log('Saving work...');
    const saveWork = page.locator('#btnSave, .modal button.btn-primary, .modal button:has-text("Сохранить"), .modal button:has-text("Создать")').first();
    if (await saveWork.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveWork.click();
    }
    await page.waitForTimeout(3000);
    await ss(page, '12_work_created.png');

    workId = await page.evaluate(() => {
      const m = location.hash.match(/open=(\d+)/);
      if (m) return m[1];
      const row = document.querySelector('tbody tr[data-id], .card[data-id], .work-card[data-id]');
      if (row) return row.getAttribute('data-id');
      return null;
    });
    log(`Work ID: ${workId}`);
    results.push({ step: '4. Create Work', status: workId ? 'OK' : 'MAYBE', id: workId });

    // ═══════════════════════════════════
    // STEP 5-6: STAFF REQUEST
    // ═══════════════════════════════════
    log('STEP 5: Staff request...');
    await page.goto(BASE + '/#/hr-requests');
    await waitLoad(page);
    await ss(page, '13_hr_requests_page.png');
    await dumpForm(page, 'HR REQUESTS PAGE');

    // Try to create staff request
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.offsetParent && /Создать|Добавить|Новый|Запрос|\+/.test(b.textContent));
      if (btn) btn.click();
    });
    await page.waitForTimeout(2000);
    await page.waitForSelector('.modal-content, .modalback', { state: 'visible', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const staffForm = await dumpForm(page, 'STAFF REQUEST FORM');
    await ss(page, '13b_staff_request_form.png');

    // Fill staff request form
    await fillInput(page, 'input[name="position"], input[name="role"]', 'Слесарь');
    await fillInput(page, 'input[name="quantity"], input[name="count"]', '1');
    await fillInput(page, 'textarea[name="requirements"], textarea[name="description"]', 'Слесарь для химической чистки теплообменного оборудования');

    // Link to work
    if (workId) {
      await page.evaluate((workId) => {
        if (typeof CRSelect !== 'undefined' && CRSelect._instances) {
          for (const [k, inst] of Object.entries(CRSelect._instances)) {
            if (k.includes('work') || k.includes('project')) {
              const opt = inst.options?.find(o => o.value == workId);
              if (opt) CRSelect.setValue(k, opt.value);
            }
          }
        }
      }, workId);
    }

    await ss(page, '14_staff_request_filled.png');

    // Save
    await page.locator('.modal button.btn-primary, .modal button:has-text("Сохранить"), .modal button:has-text("Создать")').first().click().catch(() => {});
    await page.waitForTimeout(3000);
    await ss(page, '14b_staff_request_created.png');
    results.push({ step: '5-6. Staff Request', status: 'ATTEMPTED' });

    // ═══════════════════════════════════
    // STEP 7: VERIFY BINDINGS
    // ═══════════════════════════════════
    log('STEP 7: Verify bindings...');

    // Open work card
    if (workId) {
      await page.goto(BASE + `/#/pm-works?open=${workId}`);
      await waitLoad(page);
      await ss(page, '17_work_card.png');
    }

    // Open personnel
    await page.goto(BASE + '/#/personnel');
    await waitLoad(page);

    // Search for Андросов
    const searchInput = page.locator('input[type="search"], input[placeholder*="Поиск"], input#fSearch, #f_q').first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill('Андросов');
      await page.waitForTimeout(2000);
    }
    await ss(page, '18_personnel_search.png');

    // Click first matching row
    const empRow = page.locator('tbody tr, .card[data-id]').first();
    if (await empRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await empRow.click({ force: true });
      await page.waitForTimeout(2000);
      await ss(page, '18b_employee_card.png');
    }
    results.push({ step: '7. Verify Bindings', status: 'ATTEMPTED' });

    // ═══════════════════════════════════
    // STEP 8: FIELD MODULE
    // ═══════════════════════════════════
    log('STEP 8: Field module...');

    // Open work card first
    if (workId) {
      await page.goto(BASE + `/#/pm-works?open=${workId}`);
    } else {
      await page.goto(BASE + '/#/pm-works');
    }
    await waitLoad(page);

    // Click first work to open it
    if (!workId) {
      const firstWork = page.locator('tbody tr[data-id], .card[data-id]').first();
      if (await firstWork.isVisible({ timeout: 5000 }).catch(() => false)) {
        await firstWork.click({ force: true });
        await page.waitForTimeout(2000);
      }
    }

    await dumpForm(page, 'WORK CARD — looking for field module button');

    // Look for field module button
    const fieldBtn = page.locator('button:has-text("Полевой"), button:has-text("Field"), button:has-text("⚔️"), [data-action="field"]').first();
    if (await fieldBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await fieldBtn.click();
      await page.waitForTimeout(3000);
      await ss(page, '19_field_module.png');
      await dumpForm(page, 'FIELD MODULE');

      // Fill field module settings
      await setCRS(page, 'fieldCategory', 'ground');
      await fillInput(page, '#fieldPerDiem', '1000');

      // Look for activate button
      const activateBtn = page.locator('button:has-text("Активировать"), button:has-text("Запустить"), button:has-text("Сохранить")').first();
      if (await activateBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await activateBtn.click();
        await page.waitForTimeout(2000);
      }

      await ss(page, '19b_field_activated.png');

      // ═══ STEP 9: CREW ═══
      log('STEP 9: Crew assignment...');
      const crewTab = page.locator('[data-ftab="crew"], button:has-text("Бригада")').first();
      if (await crewTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await crewTab.click();
        await page.waitForTimeout(2000);
        await ss(page, '20_field_crew.png');
        await dumpForm(page, 'FIELD CREW TAB');
      }

      // ═══ STEP 10: LOGISTICS ═══
      log('STEP 10: Logistics...');
      const logTab = page.locator('[data-ftab="logistics"], button:has-text("Логистика")').first();
      if (await logTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await logTab.click();
        await page.waitForTimeout(2000);
        await ss(page, '22_logistics.png');
        await dumpForm(page, 'FIELD LOGISTICS TAB');
      }

      // ═══ STEP 12: STAGES ═══
      log('STEP 12: Stages...');
      const stagesTab = page.locator('[data-ftab="stages"], button:has-text("Маршруты")').first();
      if (await stagesTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await stagesTab.click();
        await page.waitForTimeout(2000);
        await ss(page, '27_stages.png');
        await dumpForm(page, 'FIELD STAGES TAB');
      }

      // ═══ STEP 13: DASHBOARD ═══
      log('STEP 13: Dashboard...');
      const dashTab = page.locator('[data-ftab="dashboard"], button:has-text("Дашборд")').first();
      if (await dashTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dashTab.click();
        await page.waitForTimeout(2000);
        await ss(page, '30_dashboard.png');
      }

      // ═══ STEP 14: TIMESHEET ═══
      log('STEP 14: Timesheet...');
      const tsTab = page.locator('[data-ftab="timesheet"], button:has-text("Табель")').first();
      if (await tsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tsTab.click();
        await page.waitForTimeout(2000);
        await ss(page, '31_timesheet.png');
      }

      results.push({ step: '8-14. Field Module', status: 'ATTEMPTED' });
    } else {
      log('Field module button NOT FOUND');
      await ss(page, '19_field_not_found.png');
      results.push({ step: '8-14. Field Module', status: 'NOT_FOUND' });
    }

    // ═══════════════════════════════════
    // FINAL
    // ═══════════════════════════════════
    log('Final screenshots...');
    if (workId) {
      await page.goto(BASE + `/#/pm-works?open=${workId}`);
      await waitLoad(page);
    }
    await ss(page, '33_final.png');

  } catch (err) {
    log(`ERROR: ${err.message}`);
    await ss(page, 'ERROR_screenshot.png').catch(() => {});
    results.push({ step: 'ERROR', status: err.message });
  } finally {
    // Print results
    console.log('\n\n═══════════════════════════════════');
    console.log('RESULTS SUMMARY');
    console.log('═══════════════════════════════════');
    results.forEach(r => console.log(`${r.status === 'OK' ? '✅' : r.status === 'ATTEMPTED' ? '🔄' : '❌'} ${r.step} ${r.id ? '(ID: '+r.id+')' : ''}`));
    console.log(`\nTender ID: ${tenderId}`);
    console.log(`TKP ID: ${tkpId}`);
    console.log(`Work ID: ${workId}`);
    console.log(`Console errors: ${errors.length}`);
    if (errors.length > 0) errors.slice(0, 10).forEach(e => console.log(`  ⚠️ ${e.slice(0, 200)}`));
    console.log('═══════════════════════════════════\n');

    await browser.close();
  }
})();
