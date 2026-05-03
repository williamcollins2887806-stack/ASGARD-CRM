// @ts-check
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const SCREENSHOTS = 'C:/Users/Nikita-ASGARD/ASGARD-CRM/screenshots/arkhbum';

// Shared state between tests
let tenderId = null;
let workId = null;
let estimateId = null;

test.describe.serial('АРХБУМ — Полный проект', () => {

  test.beforeEach(async ({ page }) => {
    // Increase timeout for slow server
    test.setTimeout(120000);
  });

  // ═══════════════════════════════════════════════
  // ШАГ 1: КОНТРАГЕНТ
  // ═══════════════════════════════════════════════
  test('Step 1 — Создать контрагента АО АРХБУМ', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.waitForTimeout(2000);

    // Navigate to customers page
    await page.goto(h.BASE_URL + '/#/customers');
    await page.waitForTimeout(3000);

    // Check if customer already exists by searching INN
    const searchInput = page.locator('#q');
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('2903003430');
      await page.waitForTimeout(1500);
    }

    // Check if the customer appears in the table
    const existingRow = page.locator('tr:has-text("2903003430")');
    const exists = await existingRow.count() > 0;

    if (exists) {
      console.log('Контрагент 2903003430 уже существует, открываем');
      await existingRow.first().locator('a:has-text("Открыть")').click();
      await page.waitForTimeout(2000);
    } else {
      console.log('Контрагент не найден, создаём нового');
      // Click "Контрагент" button
      await page.locator('#btnNew').click();
      await page.waitForTimeout(2000);
    }

    // Now we should be on customer edit page (#/customer?inn=...)
    // Fill INN field
    const innInput = page.locator('#inn');
    await innInput.waitFor({ state: 'visible', timeout: 10000 });

    // Clear and fill INN
    if (!await innInput.isDisabled()) {
      await innInput.fill('2903003430');
      await page.waitForTimeout(500);
    }

    // Click ЕГРЮЛ lookup button to auto-fill from DaData
    const lookupBtn = page.locator('#btnLookup');
    if (await lookupBtn.isVisible().catch(() => false)) {
      await lookupBtn.click();
      await page.waitForTimeout(3000); // Wait for API response
    }

    // Fill/override fields
    const nameInput = page.locator('#name');
    if (await nameInput.isVisible()) {
      const currentName = await nameInput.inputValue();
      if (!currentName || currentName.trim() === '') {
        await nameInput.fill('АО «АРХБУМ»');
      }
    }

    const fullInput = page.locator('#full');
    if (await fullInput.isVisible()) {
      const currentFull = await fullInput.inputValue();
      if (!currentFull || currentFull.trim() === '') {
        await fullInput.fill('АО «АРХБУМ» (филиал, д. Лешково)');
      }
    }

    // Fill address
    const addrInput = page.locator('#addr');
    if (await addrInput.isVisible()) {
      const currentAddr = await addrInput.inputValue();
      if (!currentAddr || currentAddr.trim() === '') {
        await addrInput.fill('Московская обл., Истринский р-н, д. Лешково, тер. квартала 0050238, зд. 99');
      }
    }

    // Fill phone
    const phoneInput = page.locator('#phone');
    if (await phoneInput.isVisible()) {
      await phoneInput.fill('+7 929 642 69 55');
    }

    // Fill comment
    const commentInput = page.locator('#comment');
    if (await commentInput.isVisible()) {
      await commentInput.fill('Контактное лицо: Лепёшкин С.А.');
    }

    // Save
    await page.locator('#btnSave').click();
    await page.waitForTimeout(2000);

    // Screenshot
    await page.screenshot({ path: SCREENSHOTS + '/01-customer.png', fullPage: true });
    console.log('Step 1 DONE — Контрагент сохранён');
  });

  // ═══════════════════════════════════════════════
  // ШАГ 2: ТЕНДЕР
  // ═══════════════════════════════════════════════
  test('Step 2 — Создать тендер АРХБУМ', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.waitForTimeout(2000);

    // Navigate to tenders page
    await page.goto(h.BASE_URL + '/#/tenders');
    await page.waitForTimeout(3000);

    // Click "Внести тендер"
    await page.locator('#btnNew').click();
    await page.waitForTimeout(2000);

    // Wait for modal to open
    await page.waitForSelector('#e_title', { state: 'visible', timeout: 10000 });

    // Fill INN via CRAutocomplete — type into the input inside #cr-inn-wrap
    const innWrap = page.locator('#cr-inn-wrap input[type="text"]');
    if (await innWrap.count() > 0) {
      await innWrap.first().fill('2903003430');
      await page.waitForTimeout(2000);
      // Click first suggestion if available
      const suggestion = page.locator('.cr-ac-dropdown .cr-ac-item').first();
      if (await suggestion.isVisible().catch(() => false)) {
        await suggestion.click();
        await page.waitForTimeout(1000);
      }
    }

    // If customer autocomplete didn't populate, try the customer wrap too
    const custWrap = page.locator('#cr-customer-wrap input[type="text"]');
    if (await custWrap.count() > 0) {
      const custVal = await custWrap.first().inputValue().catch(() => '');
      if (!custVal) {
        await custWrap.first().fill('АРХБУМ');
        await page.waitForTimeout(2000);
        const suggestion = page.locator('.cr-ac-dropdown .cr-ac-item').first();
        if (await suggestion.isVisible().catch(() => false)) {
          await suggestion.click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // Close any open dropdowns by clicking on title area
    await page.locator('.modal-title, .modal h2').first().click().catch(() => {});
    await page.waitForTimeout(500);

    // Fill title
    await page.locator('#e_title').fill('Химическая чистка сушильного цилиндра PH-M 1100/2');

    // Set type via CRSelect — "Тендер" (should be default)
    await page.evaluate(() => { CRSelect.setValue('e_type', 'Тендер'); });

    // Set PM — click trigger to open dropdown, search, select "Андросов"
    const pmTrigger = page.locator('#e_pm_w .cr-select__trigger');
    await pmTrigger.click();
    await page.waitForTimeout(500);
    // Type into the search input inside the dropdown
    const pmSearch = page.locator('#e_pm_w .cr-select__search-input');
    if (await pmSearch.isVisible().catch(() => false)) {
      await pmSearch.fill('Андросов');
      await page.waitForTimeout(1000);
    }
    // Click the first matching option
    const pmOpt = page.locator('#e_pm_w .cr-select__option').first();
    if (await pmOpt.isVisible().catch(() => false)) {
      await pmOpt.click();
      await page.waitForTimeout(500);
    } else {
      // Fallback: clear search and select first PM
      console.log('Андросов not found, trying without search');
      if (await pmSearch.isVisible().catch(() => false)) {
        await pmSearch.fill('');
        await page.waitForTimeout(500);
      }
      const firstPmOpt = page.locator('#e_pm_w .cr-select__option').first();
      if (await firstPmOpt.isVisible().catch(() => false)) {
        await firstPmOpt.click();
      }
    }

    // Verify PM was selected
    const pmVal = await page.evaluate(() => CRSelect.getValue('e_pm'));
    console.log('PM selected value:', pmVal);

    // Set status to "Новый"
    await page.evaluate(() => { CRSelect.setValue('e_status', 'Новый'); });

    // Fill price
    await page.locator('#e_price').fill('2293230');

    // Set period: March 2026 — must happen AFTER mount
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      CRSelect.setValue('e_period_month', '03');
      CRSelect.setValue('e_period_year', '2026');
    });
    // Verify period
    const month = await page.evaluate(() => CRSelect.getValue('e_period_month'));
    const year = await page.evaluate(() => CRSelect.getValue('e_period_year'));
    console.log('Period set to:', month + '/' + year);

    // Set dates
    await page.evaluate(() => {
      if (window.CRDatePicker) {
        CRDatePicker.setValue('e_ws', '2026-03-28');
        CRDatePicker.setValue('e_we', '2026-03-31');
        CRDatePicker.setValue('e_docs_deadline', '2026-03-28');
      }
    });

    // Fill URL (optional) — leave empty or placeholder
    const urlInput = page.locator('#e_url');
    if (await urlInput.isVisible()) {
      await urlInput.fill('');
    }

    await page.waitForTimeout(500);

    // Screenshot before save
    await page.screenshot({ path: SCREENSHOTS + '/02-tender-form.png', fullPage: false });

    // Click Create
    await page.locator('#btnSave').click();
    await page.waitForTimeout(3000);

    // Handle duplicate detection dialog
    const dupDialog = page.locator('button:has-text("Создать всё равно")');
    const openExisting = page.locator('button:has-text("Открыть →"), a:has-text("Открыть →")');
    if (await dupDialog.isVisible().catch(() => false)) {
      console.log('Duplicate detected — opening existing tender');
      // Open existing tender instead of creating duplicate
      if (await openExisting.isVisible().catch(() => false)) {
        await openExisting.click();
        await page.waitForTimeout(3000);
      } else {
        // Create anyway if can't open existing
        await dupDialog.click();
        await page.waitForTimeout(3000);
      }
    }

    // Wait for save result — modal should now show "Тендер #XXX"
    await page.waitForTimeout(2000);

    // Capture tender ID from modal title
    tenderId = await page.evaluate(() => {
      // Check modal title for "Тендер #123"
      const titles = document.querySelectorAll('.modal-title, .modal h2, [class*="modal"] h2');
      for (const t of titles) {
        const m = t.textContent.match(/#(\d+)/);
        if (m) return parseInt(m[1]);
      }
      // Check any text on page
      const body = document.body.innerText;
      const m = body.match(/Тендер\s*#(\d+)/);
      if (m) return parseInt(m[1]);
      // Check toast
      const toasts = document.querySelectorAll('[class*="toast"]');
      for (const t of toasts) {
        const m2 = t.textContent.match(/#(\d+)/);
        if (m2) return parseInt(m2[1]);
      }
      return null;
    });

    console.log('Tender ID:', tenderId);

    // Screenshot
    await page.screenshot({ path: SCREENSHOTS + '/02-tender-created.png', fullPage: false });
    console.log('Step 2 DONE — Тендер создан, ID:', tenderId);
  });

  // ═══════════════════════════════════════════════
  // ШАГ 3: HANDOFF (Передача в просчёт)
  // ═══════════════════════════════════════════════
  test('Step 3 — Передать в просчёт (Handoff)', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.waitForTimeout(2000);

    // Navigate to tenders
    await page.goto(h.BASE_URL + '/#/tenders');
    await page.waitForTimeout(3000);

    // Find and open the АРХБУМ tender by clicking "Открыть" button in the row
    const openBtn = page.locator('tr:has-text("АРХБУМ") button:has-text("Открыть"), tr:has-text("АРХБУМ") a:has-text("Открыть")').first();
    await openBtn.waitFor({ state: 'visible', timeout: 10000 });
    await openBtn.click();
    await page.waitForTimeout(3000);

    // Wait for modal/editor
    await page.waitForSelector('#btnHandoff, #btnSave', { state: 'visible', timeout: 10000 }).catch(() => {});

    // Handoff requires a URL or document — fill in a placeholder URL
    const urlInput = page.locator('#e_url');
    if (await urlInput.isVisible().catch(() => false)) {
      const urlVal = await urlInput.inputValue().catch(() => '');
      if (!urlVal || urlVal.trim() === '') {
        await urlInput.fill('https://disk.yandex.ru/arkhbum-docs');
        await page.waitForTimeout(300);
        // Save first to persist the URL
        await page.locator('#btnSave').click();
        await page.waitForTimeout(2000);
      }
    }

    // If Handoff button exists, click it
    const handoffBtn = page.locator('#btnHandoff');
    if (await handoffBtn.isVisible().catch(() => false)) {
      await handoffBtn.click();
      await page.waitForTimeout(3000);
      console.log('Handoff button clicked');
    } else {
      console.log('Handoff button not found — tender may already be handed off');
    }

    // Get tender ID from modal title "Тендер #XXX"
    tenderId = await page.evaluate(() => {
      const titles = document.querySelectorAll('.modal-title, .modal h2, [class*="modal"] h2');
      for (const t of titles) {
        const m = t.textContent.match(/#(\d+)/);
        if (m) return parseInt(m[1]);
      }
      return null;
    });
    console.log('Tender ID from modal:', tenderId);

    // Screenshot
    await page.screenshot({ path: SCREENSHOTS + '/03-handoff.png', fullPage: false });
    console.log('Step 3 DONE — Handoff, tender ID:', tenderId);
  });

  // ═══════════════════════════════════════════════
  // ШАГ 4: ПРОСЧЁТ (via API from browser)
  // ═══════════════════════════════════════════════
  test('Step 4 — Просчёт и отправка на согласование', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.waitForTimeout(2000);

    // Tender #18 = АРХБУМ, PM = Андросов (id 3474)
    const token = await h.getSessionToken(page);
    console.log('Token obtained, creating estimate via API...');

    const tid = 18;
    const pmId = 3474;

    // Check if estimate already exists for this tender
    const existingEstimate = await page.evaluate(async ({ token, tid }) => {
      try {
        const resp = await fetch('/api/estimates?tender_id=' + tid, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const rows = Array.isArray(data) ? data : (data.rows || data.estimates || []);
        return Array.isArray(rows) ? rows.find(e => e.tender_id === tid) : null;
      } catch(e) { return null; }
    }, { token, tid });

    if (existingEstimate && existingEstimate.approval_status === 'sent') {
      console.log('Estimate already sent, ID:', existingEstimate.id);
      estimateId = existingEstimate.id;
    } else {
      // Create estimate via POST /api/estimates
      const estimateResult = await page.evaluate(async ({ token, tid, pmId }) => {
        const body = {
          tender_id: tid,
          pm_id: pmId,
          title: 'Химическая чистка сушильного цилиндра PH-M 1100/2',
          approval_status: 'sent',
          price_tkp: 2293230,
          cost_plan: 1000000,
          probability_pct: 100,
          payment_terms: '30% аванс, остаток по акту выполненных работ',
          comment: 'Объект малый, бригада 4 чел + РП. Работы стандартные — щелочная промывка, кислотные циклы, пассивация. Выполнено в срок.',
          assumptions: 'Доступ на объект обеспечен заказчиком. Химия и оборудование наши. Объект в МО — логистика минимальная.',
          cover_letter: 'Проект АРХБУМ — химическая чистка сушильного цилиндра PH-M 1100/2 (Ст20, ~200 кг магнетита Fe₃O₄). Бригада 4 человека, 4 смены. Себестоимость план 1.0М, цена 2.29М с НДС. Маржа ~47%.',
          calc_summary_json: JSON.stringify({
            people_count: 4,
            work_days: 4,
            city: 'Истра (Московская обл.)',
            distance_km: 50
          })
        };
        const resp = await fetch('/api/estimates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(body)
        });
        const data = await resp.json();
        return { status: resp.status, estimate: data.estimate, error: data.error };
      }, { token, tid, pmId });

      console.log('Estimate created:', estimateResult.status, estimateResult.estimate?.id || estimateResult.error);
      estimateId = estimateResult.estimate?.id;
    }

    // Now navigate to PM Calcs to take screenshot
    await page.goto(h.BASE_URL + '/#/pm-calcs');
    await page.waitForTimeout(3000);

    // Check "За все периоды"
    const allPeriod = page.locator('#f_allperiod');
    if (await allPeriod.isVisible().catch(() => false)) {
      await allPeriod.check();
      await page.waitForTimeout(1000);
    }

    // Open the АРХБУМ tender
    const openLink = page.locator('tr:has-text("АРХБУМ") [data-act="open"]');
    if (await openLink.count() > 0) {
      await openLink.first().click({ force: true });
      await page.waitForTimeout(3000);
    }

    // Screenshot
    await page.screenshot({ path: SCREENSHOTS + '/04-estimate-sent.png', fullPage: true });
    console.log('Step 4 DONE — Просчёт отправлен, ID:', estimateId);
  });

  // ═══════════════════════════════════════════════
  // ШАГ 5: СОГЛАСОВАНИЕ ПРОСЧЁТА
  // ═══════════════════════════════════════════════
  test('Step 5 — Согласовать просчёт', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.waitForTimeout(2000);

    const token = await h.getSessionToken(page);
    const eid = estimateId || 11;

    // Approve via API
    const result = await page.evaluate(async ({ token, eid }) => {
      const resp = await fetch('/api/approval/estimates/' + eid + '/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ comment: 'Согласовано. Проект АРХБУМ — работаем.' })
      });
      return { status: resp.status, data: await resp.json().catch(() => null) };
    }, { token, eid });

    console.log('Approval result:', result.status, JSON.stringify(result.data)?.slice(0, 200));

    // Navigate to all-estimates and set period to March 2026
    await page.goto(h.BASE_URL + '/#/all-estimates');
    await page.waitForTimeout(3000);

    // Change period to March
    await page.evaluate(() => {
      if (window.CRSelect) CRSelect.setValue('f_period', '2026-03');
    });
    await page.waitForTimeout(2000);

    // Screenshot
    await page.screenshot({ path: SCREENSHOTS + '/05-approved.png', fullPage: false });
    console.log('Step 5 DONE — Просчёт согласован, estimate:', eid);
  });

  // ═══════════════════════════════════════════════
  // ШАГ 6: СМЕНА СТАТУСОВ → "ВЫИГРАЛИ"
  // ═══════════════════════════════════════════════
  test('Step 6 — Статусы: → Выиграли + создание работы', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.waitForTimeout(2000);

    const token = await h.getSessionToken(page);

    // Update tender status to "Выиграли" via API
    const updateResult = await page.evaluate(async ({ token }) => {
      const resp = await fetch('/api/data/tenders/18', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ tender_status: 'Выиграли' })
      });
      return { status: resp.status, data: await resp.json().catch(() => null) };
    }, { token });
    console.log('Tender status update:', updateResult.status);

    // Navigate to PM Calcs to trigger work auto-creation
    // The ensureWorkFromTender() function in pm_calcs creates work when status is "Выиграли"
    await page.goto(h.BASE_URL + '/#/pm-calcs');
    await page.waitForTimeout(3000);

    // Check "За все периоды" and open АРХБУМ
    const allPeriod = page.locator('#f_allperiod');
    if (await allPeriod.isVisible().catch(() => false)) {
      await allPeriod.check();
      await page.waitForTimeout(1000);
    }

    const openLink = page.locator('tr:has-text("АРХБУМ") [data-act="open"]');
    if (await openLink.count() > 0) {
      await openLink.first().click({ force: true });
      await page.waitForTimeout(3000);
    }

    // Screenshot — PM Calcs view
    await page.screenshot({ path: SCREENSHOTS + '/06-won.png', fullPage: false });

    // Close modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Now check for the auto-created work — look in IndexedDB and API
    workId = await page.evaluate(async ({ token }) => {
      // Check IndexedDB first (pm_calcs auto-creates work on openTender for Выиграли status)
      if (window.AsgardDB) {
        try {
          const works = await AsgardDB.byIndex("works", "tender_id", 18);
          if (works && works.length > 0) return works[0].id;
        } catch(e) {}
      }
      // Try API
      try {
        const resp = await fetch('/api/data/works', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await resp.json();
        const list = data.rows || data;
        if (Array.isArray(list)) {
          const w = list.find(w => w.tender_id === 18);
          if (w) return w.id;
        }
      } catch(e) {}
      return null;
    }, { token });

    // If work not auto-created, create it manually via API
    if (!workId) {
      console.log('Work not auto-created, creating via API...');
      const createResult = await page.evaluate(async ({ token }) => {
        const body = {
          tender_id: 18,
          pm_id: 3474,
          customer_name: 'АО "АРХБУМ"',
          work_title: 'Химическая чистка сушильного цилиндра PH-M 1100/2',
          contract_value: 2293230,
          cost_plan: 1000000,
          work_start_plan: '2026-03-28',
          work_end_plan: '2026-03-31',
          work_status: 'Подготовка'
        };
        const resp = await fetch('/api/data/works', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(body)
        });
        const data = await resp.json();
        return { status: resp.status, id: data.id || data.row?.id || null, error: data.error };
      }, { token });
      workId = createResult.id;
      console.log('Work created via API:', createResult.status, workId);
    }

    console.log('Work ID:', workId);

    // Navigate to PM Works and screenshot
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: SCREENSHOTS + '/06-work-found.png', fullPage: false });
    console.log('Step 6 DONE — Выиграли, work ID:', workId);
  });

  // ═══════════════════════════════════════════════
  // ШАГ 7: ЗАПОЛНЕНИЕ КАРТОЧКИ РАБОТЫ
  // ═══════════════════════════════════════════════
  test('Step 7 — Заполнить карточку работы', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.waitForTimeout(2000);

    const token = await h.getSessionToken(page);
    const wid = workId || 10;

    // Update work via API with all fields
    const updateResult = await page.evaluate(async ({ token, wid }) => {
      const body = {
        work_status: 'Завершена',
        start_in_work_date: '2026-03-28',
        end_plan: '2026-03-31',
        end_fact: '2026-03-31',
        contract_value: 2293230,
        cost_plan: 1000000,
        cost_fact: 818405,
        comment: 'Работы выполнены в полном объёме. Акт, счёт и СФ отправлены заказчику, ожидают подписания.'
      };
      const resp = await fetch('/api/data/works/' + wid, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
      return { status: resp.status, data: await resp.json().catch(() => null) };
    }, { token, wid });
    console.log('Work updated:', updateResult.status);

    // Navigate to PM Works page, open work card
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(3000);

    // Change period to March 2026
    await page.evaluate(() => {
      if (window.CRSelect) CRSelect.setValue('f_period', '2026-03');
    });
    await page.waitForTimeout(2000);

    // Open АРХБУМ work
    const openBtn = page.locator('tr:has-text("АРХБУМ") [data-act="open"], tr:has-text("АРХБУМ") button:has-text("Открыть"), tr:has-text("Химическая чистка") [data-act="open"]');
    if (await openBtn.count() > 0) {
      await openBtn.first().click({ force: true });
      await page.waitForTimeout(3000);
    }

    // Screenshot
    await page.screenshot({ path: SCREENSHOTS + '/07-work-card.png', fullPage: true });
    console.log('Step 7 DONE — Работа заполнена');
  });

  // ═══════════════════════════════════════════════
  // ШАГ 8-10: РАСХОДЫ ПО РАБОТЕ
  // ═══════════════════════════════════════════════
  test('Step 8-10 — Расходы по работе', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.waitForTimeout(2000);

    const token = await h.getSessionToken(page);
    const wid = workId || 10;

    // Create work expenses via API for all categories
    const expenses = [
      // МАТЕРИАЛЫ (equipment + chemicals)
      { category: 'chemicals', amount: 40650, date: '2026-03-23', supplier: 'Химтрейд', comment: 'Ингибитор ДРУГ СГ 50л' },
      { category: 'chemicals', amount: 9906, date: '2026-03-23', comment: 'Жидкость ПМС-200А 20кг' },
      { category: 'equipment', amount: 6125, date: '2026-03-23', comment: 'Пирометр RGK PL-12' },
      { category: 'equipment', amount: 3702, date: '2026-03-23', comment: 'Тестер воды Ermenrich QT20' },
      { category: 'equipment', amount: 2792, date: '2026-03-23', comment: 'Рефрактометр МЕГЕОН 72029' },
      { category: 'chemicals', amount: 1442, date: '2026-03-23', comment: 'Лакмусовая бумага (2 позиции)' },
      { category: 'equipment', amount: 4547, date: '2026-03-23', comment: 'Магнитный винил 4шт + 1шт' },
      { category: 'equipment', amount: 8168, date: '2026-03-23', supplier: 'СОНИС', comment: 'Краны ПП + трубы ПП + муфты' },
      { category: 'chemicals', amount: 52200, date: '2026-03-23', supplier: 'СОФЭКС', comment: 'Натр едкий 46% 0.9т' },
      { category: 'chemicals', amount: 5040, date: '2026-03-23', comment: 'Тринатрий фосфат 25кг' },
      { category: 'chemicals', amount: 29250, date: '2026-03-23', comment: 'Аскорбиновая кислота 75кг' },
      { category: 'chemicals', amount: 6250, date: '2026-03-23', comment: 'Нитрит натрия 25кг' },
      { category: 'chemicals', amount: 4200, date: '2026-03-23', comment: 'Аммиак 30кг' },
      { category: 'chemicals', amount: 5500, date: '2026-03-23', comment: 'Натр гранулы 50кг' },
      { category: 'equipment', amount: 20000, date: '2026-03-23', comment: 'Ёмкость кубическая б/у 2шт' },
      { category: 'logistics', amount: 26000, date: '2026-03-31', supplier: 'ИП Гоменюк', comment: 'Автотранспортные услуги' },
      { category: 'equipment', amount: 98000, date: '2026-03-23', supplier: 'Яртек', comment: 'Мембранный насос YARTEK 170л/мин' },
      { category: 'equipment', amount: 26700, date: '2026-03-23', comment: 'Комплект пневмораспред. KP0170 2шт' },
      // НАЛИЧНЫЕ
      { category: 'other', amount: 25000, date: '2026-03-29', comment: 'Насос (Яндекс Маркет) — наличные' },
      { category: 'other', amount: 2000, date: '2026-03-28', comment: 'З/Ч сантехника — наличные' },
      { category: 'other', amount: 4000, date: '2026-03-27', comment: 'Токарь (изготовление фланца) — наличные' },
      { category: 'other', amount: 1400, date: '2026-03-30', comment: 'З/Ч сантехника — наличные' },
      { category: 'other', amount: 4000, date: '2026-03-31', comment: 'Простой машины 4.5ч — наличные' },
      { category: 'other', amount: 700, date: '2026-03-31', comment: 'Такси гостиница-объект — наличные' },
      { category: 'other', amount: 5000, date: '2026-03-27', comment: 'Манипулятор — наличные' },
      { category: 'subcontract', amount: 300000, date: '2026-04-15', comment: 'Агентское вознаграждение (для подписания акта)' },
      // БИЛЕТЫ
      { category: 'logistics', amount: 2782, date: '2026-03-27', comment: 'Горшков И.А. — Воронеж→Москва, автобус' },
      { category: 'logistics', amount: 3485, date: '2026-03-26', comment: 'Шмелёв А.А. — Саратов→Москва, поезд' },
      { category: 'logistics', amount: 887, date: '2026-03-28', comment: 'Горшков И.А. — Истра (такси)' },
      // ПРОЖИВАНИЕ
      { category: 'accommodation', amount: 14025, date: '2026-03-28', comment: 'Гостиница СОВА, 4 чел × 3 ночи (28-31.03)' },
      // ПРОЧИЕ
      { category: 'other', amount: 14000, date: '2026-03-27', comment: 'Доставка химии (ТК) — безнал' },
      { category: 'other', amount: 10000, date: '2026-03-31', comment: 'Вывоз отработанной химии — безнал' },
      // ФОТ
      { category: 'fot', amount: 24000, date: '2026-03-31', fot_employee_name: 'Пантузенко Александр Викторович', comment: 'ФОТ — 48 баллов' },
      { category: 'fot', amount: 40000, date: '2026-03-31', fot_employee_name: 'Найдаров Бато Лодоевич', comment: 'ФОТ — 80 баллов' },
      { category: 'fot', amount: 38000, date: '2026-03-31', fot_employee_name: 'Шмелёв Александр Алексеевич', comment: 'ФОТ — 76 баллов' },
      { category: 'fot', amount: 27000, date: '2026-03-31', fot_employee_name: 'Горшков Иван Александрович', comment: 'ФОТ — 54 баллов' },
      // СУТОЧНЫЕ
      { category: 'fot', amount: 5000, date: '2026-03-31', fot_employee_name: 'Пантузенко А.В.', fot_per_diem: 5000, comment: 'Суточные 5 дней × 1000₽' },
      { category: 'fot', amount: 5000, date: '2026-03-31', fot_employee_name: 'Найдаров Б.Л.', fot_per_diem: 5000, comment: 'Суточные 5 дней × 1000₽' },
      { category: 'fot', amount: 6000, date: '2026-03-31', fot_employee_name: 'Шмелёв А.А.', fot_per_diem: 6000, comment: 'Суточные 6 дней × 1000₽' },
      { category: 'fot', amount: 6000, date: '2026-03-31', fot_employee_name: 'Горшков И.А.', fot_per_diem: 6000, comment: 'Суточные 6 дней × 1000₽' },
      { category: 'fot', amount: 4000, date: '2026-03-31', fot_employee_name: 'Андросов Н.А. (РП)', fot_per_diem: 4000, comment: 'Суточные 4 дня × 1000₽' },
    ];

    // Insert all expenses
    let created = 0;
    for (const exp of expenses) {
      const result = await page.evaluate(async ({ token, wid, exp }) => {
        const body = {
          work_id: wid,
          category: exp.category,
          amount: exp.amount,
          date: exp.date,
          comment: exp.comment || '',
          supplier: exp.supplier || '',
          fot_employee_name: exp.fot_employee_name || '',
          fot_per_diem: exp.fot_per_diem || null,
        };
        const resp = await fetch('/api/data/work_expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(body)
        });
        return resp.status;
      }, { token, wid, exp });
      if (result === 200) created++;
    }

    console.log('Expenses created:', created, '/', expenses.length);

    // Navigate to work card and open expenses
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(2000);
    await page.evaluate(() => { CRSelect.setValue('f_period', '2026-03'); });
    await page.waitForTimeout(2000);

    // Open work card
    const openWork = page.locator('tr:has-text("АРХБУМ") [data-act="open"], tr:has-text("Химическая чистка") [data-act="open"]');
    if (await openWork.count() > 0) {
      await openWork.first().click({ force: true });
      await page.waitForTimeout(3000);
    }

    // Screenshot of work card
    await page.screenshot({ path: SCREENSHOTS + '/10-expenses-summary.png', fullPage: true });
    console.log('Step 8-10 DONE — Расходы внесены');
  });

  // ═══════════════════════════════════════════════
  // ШАГ 11: ДОХОДЫ + ИТОГОВАЯ ПРОВЕРКА
  // ═══════════════════════════════════════════════
  test('Step 11 — Доходы и итоговая проверка', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.waitForTimeout(2000);

    const token = await h.getSessionToken(page);
    const wid = workId || 10;

    // Create income records via API
    const incomes = [
      { work_id: wid, amount: 684969, date: '2026-03-25', type: 'advance', counterparty: 'АО АРХБУМ', comment: 'Аванс 30%' },
      { work_id: wid, amount: 800000, date: '2026-04-15', type: 'postpay', counterparty: 'АО АРХБУМ', comment: 'Окончательный расчёт (часть 1)', confirmed: false },
      { work_id: wid, amount: 808261, date: '2026-04-25', type: 'postpay', counterparty: 'АО АРХБУМ', comment: 'Окончательный расчёт (часть 2)', confirmed: false },
    ];

    for (const inc of incomes) {
      await page.evaluate(async ({ token, inc }) => {
        await fetch('/api/data/incomes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(inc)
        });
      }, { token, inc });
    }
    console.log('Incomes created: 3');

    // Navigate to PM Works and take final screenshot
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(2000);
    await page.evaluate(() => { CRSelect.setValue('f_period', '2026-03'); });
    await page.waitForTimeout(2000);

    // Open work card
    const openWork = page.locator('tr:has-text("АРХБУМ") [data-act="open"], tr:has-text("Химическая чистка") [data-act="open"]');
    if (await openWork.count() > 0) {
      await openWork.first().click({ force: true });
      await page.waitForTimeout(3000);
    }

    // Final screenshot
    await page.screenshot({ path: SCREENSHOTS + '/11-work-final.png', fullPage: true });

    // Navigate to KPI Money page
    await page.goto(h.BASE_URL + '/#/kpi-money');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: SCREENSHOTS + '/11-kpi-money.png', fullPage: true });

    console.log('Step 11 DONE — Доходы внесены, итоговая проверка');
    console.log('=== СВОДКА ===');
    console.log('Tender #18: АРХБУМ → Выиграли');
    console.log('Estimate #' + (estimateId || 11) + ': Согласовано');
    console.log('Work #' + (workId || 10) + ': Завершена');
    console.log('Выручка: 2 293 230₽');
    console.log('Расходы: ~892 751₽');
    console.log('Прибыль: ~1 400 479₽');
  });

  // ═══════════════════════════════════════════════
  // ШАГ 12: FIELD МОДУЛЬ — БРИГАДА + ТАБЕЛЬ
  // ═══════════════════════════════════════════════
  test('Step 12 — Field: бригада + табель', async ({ page }) => {
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.waitForTimeout(2000);

    const token = await h.getSessionToken(page);
    const wid = workId || 10;

    // ── 1. Создать тариф в field_tariff_grid (12 б/см = 6000₽) ──
    const tariffResult = await page.evaluate(async ({ token }) => {
      // Check if tariff already exists
      const checkResp = await fetch('/api/data/field_tariff_grid', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const checkData = await checkResp.json().catch(() => null);
      const rows = checkData?.rows || checkData || [];
      if (Array.isArray(rows)) {
        const existing = rows.find(r => r.category === 'ground' && r.points === 12);
        if (existing) return { status: 200, id: existing.id, existed: true };
      }

      const body = {
        category: 'ground',
        position_name: 'Слесарь-монтажник (хим. промывка)',
        points: 12,
        rate_per_shift: 6000,
        sort_order: 1,
        is_active: true,
        is_combinable: false,
        requires_approval: false
      };
      const resp = await fetch('/api/data/field_tariff_grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
      const data = await resp.json().catch(() => null);
      return { status: resp.status, id: data?.id || data?.row?.id, data };
    }, { token });

    const tariffId = tariffResult.id;
    console.log('Tariff:', tariffResult.existed ? 'already exists' : 'created', 'ID:', tariffId);

    // ── 2. Активировать Field модуль для work #10 ──
    const activateResult = await page.evaluate(async ({ token, wid }) => {
      const resp = await fetch('/api/field/manage/projects/' + wid + '/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          site_category: 'ground',
          schedule_type: 'shift',
          shift_hours: 11,
          per_diem: 1000,
          rounding_rule: 'half_up',
          rounding_step: 0.5
        })
      });
      return { status: resp.status, data: await resp.json().catch(() => null) };
    }, { token, wid });
    console.log('Field activated:', activateResult.status, JSON.stringify(activateResult.data));

    // ── 3. Назначить бригаду ──
    // Пантузенко 223 — мастер, Найдаров 205 — слесарь,
    // Шмелёв 363 — слесарь, Горшков 63 — слесарь
    const crewList = [
      { employee_id: 223, field_role: 'shift_master', tariff_id: tariffId, per_diem: 1000 },
      { employee_id: 205, field_role: 'worker',       tariff_id: tariffId, per_diem: 1000 },
      { employee_id: 363, field_role: 'worker',       tariff_id: tariffId, per_diem: 1000 },
      { employee_id: 63,  field_role: 'worker',       tariff_id: tariffId, per_diem: 1000 },
    ];

    const crewResult = await page.evaluate(async ({ token, wid, crewList }) => {
      const resp = await fetch('/api/field/manage/projects/' + wid + '/crew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ employees: crewList })
      });
      return { status: resp.status, data: await resp.json().catch(() => null) };
    }, { token, wid, crewList });
    console.log('Crew assigned:', crewResult.status, JSON.stringify(crewResult.data)?.slice(0, 400));

    // ── 4. Получить assignment IDs ──
    const assignments = await page.evaluate(async ({ token, wid }) => {
      const resp = await fetch('/api/data/employee_assignments?work_id=' + wid, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await resp.json().catch(() => null);
      return data?.rows || data || [];
    }, { token, wid });
    console.log('Assignments found:', Array.isArray(assignments) ? assignments.length : 0);

    // ── 5. Создать записи табеля (field_checkins) за 28-31 марта ──
    // 4 человека × 4 рабочих дня = 16 смен
    // Смена: 08:00-19:00 (11ч), ставка 6000₽/смена
    const crewMembers = [
      { id: 223, name: 'Пантузенко А.В.' },
      { id: 205, name: 'Найдаров Б.Л.' },
      { id: 363, name: 'Шмелёв А.А.' },
      { id: 63,  name: 'Горшков И.А.' },
    ];
    const workDates = ['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31'];

    let checkinsCreated = 0;
    for (const emp of crewMembers) {
      const assignment = Array.isArray(assignments)
        ? assignments.find(a => a.employee_id === emp.id)
        : null;

      for (const date of workDates) {
        const result = await page.evaluate(async ({ token, emp, wid, assignmentId, date }) => {
          const body = {
            employee_id: emp.id,
            work_id: wid,
            assignment_id: assignmentId,
            checkin_at: date + 'T08:00:00+03:00',
            checkout_at: date + 'T19:00:00+03:00',
            checkin_source: 'master',
            checkout_source: 'master',
            hours_worked: 11,
            hours_paid: 11,
            day_rate: 6000,
            amount_earned: 6000,
            date: date,
            shift: 'day',
            status: 'completed',
            note: 'Рабочая смена 08:00–19:00'
          };
          const resp = await fetch('/api/data/field_checkins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify(body)
          });
          return resp.status;
        }, { token, emp, wid, assignmentId: assignment?.id || null, date });
        if (result === 200) checkinsCreated++;
      }
    }
    console.log('Checkins created:', checkinsCreated, '/ 16');

    // ── 6. Проверить табель через API ──
    const timesheet = await page.evaluate(async ({ token, wid }) => {
      const resp = await fetch('/api/field/manage/projects/' + wid + '/timesheet?from=2026-03-28&to=2026-03-31', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      return { status: resp.status, data: await resp.json().catch(() => null) };
    }, { token, wid });
    console.log('Timesheet:', timesheet.status, JSON.stringify(timesheet.data)?.slice(0, 500));

    // ── 7. Dashboard ──
    const dashboard = await page.evaluate(async ({ token, wid }) => {
      const resp = await fetch('/api/field/manage/projects/' + wid + '/dashboard', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      return { status: resp.status, data: await resp.json().catch(() => null) };
    }, { token, wid });
    console.log('Dashboard:', dashboard.status, JSON.stringify(dashboard.data)?.slice(0, 500));

    // ── 8. Скриншот карточки работы ──
    await page.goto(h.BASE_URL + '/#/pm-works');
    await page.waitForTimeout(2000);
    await page.evaluate(() => { if (window.CRSelect) CRSelect.setValue('f_period', '2026-03'); });
    await page.waitForTimeout(2000);

    const openWork = page.locator('tr:has-text("АРХБУМ") [data-act="open"], tr:has-text("Химическая чистка") [data-act="open"]');
    if (await openWork.count() > 0) {
      await openWork.first().click({ force: true });
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: SCREENSHOTS + '/12-field-crew.png', fullPage: true });
    console.log('Step 12 DONE — Field модуль: бригада назначена, табель заполнен (4 чел × 4 дня)');
  });

});
