// Diagnostic script — understand CRSelect and CRDatePicker DOM structure
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'https://asgard-crm.ru';
const DIR = __dirname;
const CREDS = { login: 'admin', password: 'AsgardTest2026!', pin: '1234' };

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
  });
  const page = await context.newPage();

  // Login
  log('Logging in...');
  await page.goto(BASE + '/#/welcome');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);

  await page.locator('#btnShowLogin').click().catch(() => {});
  await page.waitForSelector('#w_login', { state: 'visible', timeout: 10000 });
  await page.fill('#w_login', CREDS.login);
  await page.fill('#w_pass', CREDS.password);
  await page.locator('#btnDoLogin').click().catch(() => {});
  await page.waitForSelector('#pinForm', { state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  if (await page.locator('#pinForm').isVisible().catch(() => false)) {
    for (const d of CREDS.pin.split('')) {
      await page.locator(`#pk-keypad [data-digit="${d}"]`).click().catch(() => {});
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(3000);
  }

  await page.waitForFunction(() => localStorage.getItem('asgard_token')?.length > 50, { timeout: 15000 });
  log('Logged in');

  // Navigate to tenders and open create form
  await page.goto(BASE + '/#/tenders');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  await page.locator('#btnNew').click();
  await page.waitForTimeout(3000);

  // ===== DIAGNOSE CRSelect =====
  log('Diagnosing CRSelect...');
  const crSelectInfo = await page.evaluate(() => {
    const result = {};

    // Check what CRSelect is
    result.typeofCRSelect = typeof CRSelect;
    result.CRSelectKeys = typeof CRSelect === 'object' ? Object.keys(CRSelect) : [];

    // Check _instances
    if (CRSelect._instances) {
      result.instances = {};
      for (const [k, v] of Object.entries(CRSelect._instances)) {
        result.instances[k] = {
          keys: Object.keys(v),
          value: v.value,
          options: (v.options || []).slice(0, 15).map(o => ({ v: o.value, l: o.label })),
        };
      }
    }

    // Check if there's a different internal structure
    if (CRSelect.registry) {
      result.registry = Object.keys(CRSelect.registry);
    }

    // Check the DOM structure of a CRSelect wrapper
    const typeWrap = document.getElementById('e_type_w');
    if (typeWrap) {
      result.typeWrapHTML = typeWrap.outerHTML.slice(0, 500);
      result.typeWrapChildren = Array.from(typeWrap.children).map(c => ({
        tag: c.tagName,
        cls: c.className,
        id: c.id,
        text: c.textContent?.slice(0, 50),
      }));
    }

    // Period month
    const periodMonth = document.getElementById('e_period_month');
    if (periodMonth) {
      result.periodMonthHTML = periodMonth.outerHTML.slice(0, 500);
    }

    // Check for the CRSelect global methods
    result.setValueType = typeof CRSelect.setValue;
    result.getValueType = typeof CRSelect.getValue;
    result.createType = typeof CRSelect.create;

    // Try getValue on known IDs
    try { result.typeValue = CRSelect.getValue('e_type_w'); } catch(e) { result.typeValueErr = e.message; }
    try { result.monthValue = CRSelect.getValue('e_period_month'); } catch(e) { result.monthValueErr = e.message; }
    try { result.yearValue = CRSelect.getValue('e_period_year'); } catch(e) { result.yearValueErr = e.message; }
    try { result.statusValue = CRSelect.getValue('e_status_w'); } catch(e) { result.statusValueErr = e.message; }
    try { result.pmValue = CRSelect.getValue('e_pm_w'); } catch(e) { result.pmValueErr = e.message; }

    return result;
  });
  console.log('\n===== CRSelect DIAGNOSTIC =====');
  console.log(JSON.stringify(crSelectInfo, null, 2));

  // ===== DIAGNOSE CRDatePicker =====
  log('Diagnosing CRDatePicker...');
  const crDateInfo = await page.evaluate(() => {
    const result = {};

    result.typeofCRDatePicker = typeof CRDatePicker;
    result.CRDatePickerKeys = typeof CRDatePicker === 'object' ? Object.keys(CRDatePicker) : [];

    if (CRDatePicker._instances) {
      result.instances = {};
      for (const [k, v] of Object.entries(CRDatePicker._instances)) {
        result.instances[k] = {
          keys: Object.keys(v),
          value: v.value,
        };
      }
    }

    result.setValueType = typeof CRDatePicker.setValue;
    result.getValueType = typeof CRDatePicker.getValue;

    // Check DOM of deadline wrapper
    const deadlineWrap = document.getElementById('e_deadline_w');
    if (deadlineWrap) {
      result.deadlineHTML = deadlineWrap.outerHTML.slice(0, 500);
      result.deadlineChildren = Array.from(deadlineWrap.children).map(c => ({
        tag: c.tagName,
        cls: c.className,
        id: c.id,
        text: c.textContent?.slice(0, 50),
      }));
    }

    // Check start date wrapper
    const wsWrap = document.getElementById('e_ws_w');
    if (wsWrap) {
      result.wsHTML = wsWrap.outerHTML.slice(0, 500);
    }

    // Try getValue
    try { result.deadlineValue = CRDatePicker.getValue('e_deadline_w'); } catch(e) { result.deadlineValueErr = e.message; }
    try { result.wsValue = CRDatePicker.getValue('e_ws_w'); } catch(e) { result.wsValueErr = e.message; }

    return result;
  });
  console.log('\n===== CRDatePicker DIAGNOSTIC =====');
  console.log(JSON.stringify(crDateInfo, null, 2));

  // ===== DIAGNOSE Customer autocomplete =====
  log('Diagnosing customer autocomplete...');
  const custInfo = await page.evaluate(() => {
    const result = {};
    const innWrap = document.getElementById('cr-inn-wrap');
    if (innWrap) {
      result.innWrapHTML = innWrap.outerHTML.slice(0, 500);
    }
    const custWrap = document.getElementById('cr-customer-wrap');
    if (custWrap) {
      result.custWrapHTML = custWrap.outerHTML.slice(0, 500);
    }
    // Check all elements in the modal that might be customer-related
    const modal = document.querySelector('.modal-content, .modal-body, #modalBody');
    if (modal) {
      const allInputs = Array.from(modal.querySelectorAll('input')).map(i => ({
        id: i.id, name: i.name, ph: i.placeholder, type: i.type, cls: i.className?.slice(0, 50),
      }));
      result.modalInputs = allInputs;
    }
    return result;
  });
  console.log('\n===== Customer DIAGNOSTIC =====');
  console.log(JSON.stringify(custInfo, null, 2));

  // ===== Try to click CRSelect and see dropdown =====
  log('Trying CRSelect interaction...');

  // Click the type CRSelect wrapper
  const typeWrap = page.locator('#e_type_w');
  if (await typeWrap.isVisible({ timeout: 3000 }).catch(() => false)) {
    await typeWrap.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(DIR, 'diag_crselect_dropdown.png') });

    // Check what appeared
    const dropdownInfo = await page.evaluate(() => {
      // Find visible dropdowns
      const drops = Array.from(document.querySelectorAll('.cr-select-dropdown, .cr-sel-dropdown, .dropdown, [class*="dropdown"]')).filter(el => {
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
      });
      return drops.map(d => ({
        cls: d.className?.slice(0, 100),
        html: d.innerHTML.slice(0, 500),
        children: Array.from(d.children).map(c => ({ tag: c.tagName, text: c.textContent?.slice(0, 50), cls: c.className?.slice(0, 50) })),
      }));
    });
    console.log('\n===== CRSelect Dropdown after click =====');
    console.log(JSON.stringify(dropdownInfo, null, 2));
  }

  // Close dropdown
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ===== Try to click CRDatePicker and see calendar =====
  log('Trying CRDatePicker interaction...');
  const deadlineWrap = page.locator('#e_deadline_w');
  if (await deadlineWrap.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Click the button inside
    const dateBtn = deadlineWrap.locator('button').first();
    if (await dateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dateBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(DIR, 'diag_datepicker_calendar.png') });

      // Check what appeared
      const calInfo = await page.evaluate(() => {
        const cals = Array.from(document.querySelectorAll('.cr-dp-calendar, .calendar, .datepicker, [class*="calendar"], [class*="datepicker"]')).filter(el => {
          const s = window.getComputedStyle(el);
          return s.display !== 'none' && el.offsetParent !== null;
        });
        return cals.map(c => ({
          cls: c.className?.slice(0, 100),
          html: c.innerHTML.slice(0, 1000),
        }));
      });
      console.log('\n===== CRDatePicker Calendar after click =====');
      console.log(JSON.stringify(calInfo, null, 2));
    }
  }

  // ===== Check what pages exist for works =====
  log('Checking navigation links...');
  const navInfo = await page.evaluate(() => {
    // Find all sidebar links
    const links = Array.from(document.querySelectorAll('a[href*="#/"], [data-page], [data-route]')).map(l => ({
      text: l.textContent?.trim().slice(0, 50),
      href: l.getAttribute('href'),
      page: l.getAttribute('data-page'),
      route: l.getAttribute('data-route'),
    }));
    return links;
  });
  console.log('\n===== Navigation Links =====');
  console.log(JSON.stringify(navInfo, null, 2));

  await browser.close();
  log('Done');
})();
