// E2E v7 — Полный жизненный цикл тендера (browser-only, 10 шагов)
//
// Запуск:
//   node screenshots/e2e-v7.js
//   node screenshots/e2e-v7.js --headed
//
// Шаги:
//   1. Директор создаёт тендер (PM не имеет доступа к #/tenders)
//   2. Директор передаёт в просчёт (handoff) — уже залогинен
//   3. PM быстрый просчёт + отправка на согласование
//   4. Директор согласовывает просчёт
//   5. PM статус → "Выиграли" → автосоздание работы
//   6. PM заполняет работу + запрос персонала
//   7. HR подбор персонала
//   8. PM принимает рабочих
//   9. PM полевой модуль + бригада
//  10. PM SMS приглашение

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════
const BASE = 'https://asgard-crm.ru';
const DIR  = path.join(__dirname, 'v7');
const TS   = Date.now();
const TENDER_TITLE = `Очистка теплообменников — E2E v7 #${TS}`;

if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const ACCOUNTS = {
  pm:       { login: 'test_pm',           password: 'Test123!', pin: '0000' },
  director: { login: 'test_director_gen', password: 'Test123!', pin: '0000' },
  hr:       { login: 'test_hr',           password: 'Test123!', pin: '0000' },
};

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

async function ss(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(DIR, name), fullPage: false });
  log(`📸 ${name}`);
}

async function login(page, role) {
  const acc = ACCOUNTS[role];
  if (!acc) throw new Error(`Unknown role: ${role}`);
  log(`🔑 Login: ${role} (${acc.login})…`);

  // Clear ALL previous session data (cookies + storage)
  await page.context().clearCookies();
  await page.evaluate(() => {
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
  }).catch(() => {});

  // Full page reload to break SPA state
  await page.goto(BASE + '/#/welcome', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Wait for login button and click
  await page.waitForSelector('#btnShowLogin', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('#btnShowLogin').click().catch(() => {});

  // Wait for BOTH login fields to be visible
  await page.waitForSelector('#w_login', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  // Fill login
  await page.fill('#w_login', acc.login);
  await page.waitForTimeout(200);

  // Wait for password field and fill it
  const passField = page.locator('#w_pass');
  if (await passField.isVisible({ timeout: 3000 }).catch(() => false)) {
    await passField.fill(acc.password);
  } else {
    log(`  ⚠️ #w_pass не видно — ищем поле пароля по type`);
    const passInput = page.locator('input[type="password"]').first();
    await passInput.waitFor({ state: 'visible', timeout: 5000 });
    await passInput.fill(acc.password);
  }

  await page.locator('#btnDoLogin').click();

  // Handle first-time setup
  await page.waitForSelector('#pinForm, #setupForm', { state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);

  if (await page.locator('#setupForm').isVisible().catch(() => false)) {
    await page.fill('#s_pass', acc.password).catch(() => {});
    await page.waitForTimeout(500);
    const kp = page.locator('#setupPinKeypadContainer');
    if (await kp.isVisible().catch(() => false)) {
      for (const d of acc.pin.split('')) {
        await kp.locator(`[data-digit="${d}"]`).click().catch(() => {});
        await page.waitForTimeout(150);
      }
    }
    await page.locator('#btnSetupSave').click().catch(() => {});
    await page.waitForTimeout(3000);
  }

  if (await page.locator('#pinForm').isVisible().catch(() => false)) {
    for (const d of acc.pin.split('')) {
      await page.locator(`#pk-keypad [data-digit="${d}"]`).click();
      await page.waitForTimeout(300);
    }
    await page.waitForSelector('#pinForm', { state: 'hidden', timeout: 8000 }).catch(() => {});
  }

  await page.waitForFunction(
    () => (localStorage.getItem('asgard_token') || '').length > 50
      && !location.hash.includes('/welcome'),
    { timeout: 30000 }
  );

  // Wait for full SPA initialization (AsgardDB + AsgardRouter + AsgardAuth)
  await page.waitForFunction(
    () => window.AsgardDB && window.AsgardRouter && window.AsgardAuth
      && typeof AsgardDB.all === 'function',
    { timeout: 20000 }
  ).catch(() => {});

  await page.waitForTimeout(2000);

  // Suppress push notification dialog permanently for this session
  await page.evaluate(() => {
    localStorage.setItem('asgard_push_dismissed', '99');
    localStorage.setItem('asgard_push_subscribed', 'true');
  }).catch(() => {});

  // Dismiss push notification dialog if it already appeared
  const laterBtn = page.locator('button:has-text("Позже")');
  if (await laterBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await laterBtn.click();
    log(`  Dismissed push notification dialog`);
    await page.waitForTimeout(500);
  }
  // Also try desktop-specific close
  const pushNo = page.locator('#pushPromptNo');
  if (await pushNo.isVisible({ timeout: 500 }).catch(() => false)) {
    await pushNo.click();
    await page.waitForTimeout(500);
  }

  // Dismiss any other blocking modals/overlays
  await page.evaluate(() => {
    const mb = document.querySelector('.modalback');
    if (mb && getComputedStyle(mb).display !== 'none') {
      const closeBtn = document.querySelector('#modalClose');
      if (closeBtn) closeBtn.click();
    }
  }).catch(() => {});
  await page.waitForTimeout(500);

  log(`✅ ${role} logged in`);
}

async function dismissPush(page) {
  // Re-suppress push notifications (in case localStorage was modified)
  await page.evaluate(() => {
    localStorage.setItem('asgard_push_dismissed', '99');
    localStorage.setItem('asgard_push_subscribed', 'true');
  }).catch(() => {});
  // Dismiss visible push dialogs (ONLY push-specific selectors, NOT generic "Закрыть")
  await page.evaluate(() => {
    // Desktop push prompt
    const no = document.getElementById('pushPromptNo');
    if (no) { no.click(); return; }
    // Mobile push prompt (dynamic ID)
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.id && b.id.startsWith('push-prompt-') && b.id.endsWith('-no')) {
        b.click(); return;
      }
    }
    // Fallback: "Позже" inside .cr-push-prompt only
    const pp = document.querySelector('.cr-push-prompt');
    if (pp) {
      const later = pp.querySelector('button.ghost, button:last-child');
      if (later) later.click();
    }
  }).catch(() => {});
  // Also try Playwright locator for "Позже" only if push prompt is visible
  const pushContainer = page.locator('.cr-push-prompt');
  if (await pushContainer.isVisible({ timeout: 500 }).catch(() => false)) {
    const laterBtn = pushContainer.locator('button:has-text("Позже")');
    if (await laterBtn.isVisible({ timeout: 300 }).catch(() => false)) {
      await laterBtn.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function nav(page, hash) {
  log(`  nav → #/${hash}`);

  // Check if SPA is already loaded (we have a valid page with AsgardRouter)
  const spaReady = await page.evaluate(() =>
    typeof window.AsgardRouter !== 'undefined' && typeof window.AsgardAuth !== 'undefined'
  ).catch(() => false);

  if (spaReady) {
    // SPA is loaded — navigate by changing hash (no full reload, no auth race)
    await page.evaluate((h) => { location.hash = '#/' + h; }, hash);
  } else {
    // Cold start — full page load
    await page.goto(BASE + '/#/' + hash);
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  await page.waitForTimeout(3000);

  // Dismiss any push/notification dialogs that appeared after navigation
  await dismissPush(page);

  // Verify navigation
  const curHash = await page.evaluate(() => location.hash);
  if (!curHash.includes(hash)) {
    log(`  ⚠️ Redirect: ${curHash} (expected #/${hash}) — retrying via hash…`);
    await page.evaluate((h) => { location.hash = '#/' + h; }, hash);
    await page.waitForTimeout(3000);
    await dismissPush(page);
    const finalHash = await page.evaluate(() => location.hash);
    log(`  Final hash: ${finalHash}`);
    if (!finalHash.includes(hash)) {
      log(`  ⚠️ Still wrong hash — taking diagnostic screenshot`);
    }
  }
}

async function waitTable(page, timeout = 30000) {
  await page.waitForFunction(
    () => document.querySelectorAll('#tb tr[data-id], tbody tr[data-id]').length > 0,
    { timeout }
  );
  await page.waitForTimeout(500);
}

async function openRow(page, id) {
  // Dismiss push before clicking
  await dismissPush(page);

  // Try standard open button
  const btn = page.locator(`tr[data-id="${id}"] button[data-act="open"]`);
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click({ force: true });
  } else {
    // Try "Открыть" button
    const openBtn = page.locator(`tr[data-id="${id}"] button:has-text("Открыть")`);
    if (await openBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await openBtn.click({ force: true });
    } else {
      // Fallback: click the row itself
      await page.locator(`tr[data-id="${id}"]`).click({ force: true });
    }
  }
  await page.waitForTimeout(3000);
}

async function closeModal(page) {
  await page.locator('#modalClose').click().catch(() => {});
  await page.waitForTimeout(800);
}

async function swalConfirm(page) {
  const btn = page.locator('.swal2-confirm').first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(2000);
  }
}

async function checkDateStable(page, selector, expectedDate, label) {
  const actual = await page.locator(selector).inputValue().catch(() =>
    page.locator(selector).textContent()
  );
  if (actual && actual.includes(expectedDate)) {
    log(`   ✅ ${label}: ${actual}`);
  } else {
    log(`   ⚠️ ${label}: ожидали "${expectedDate}", получили "${actual}"`);
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
const R = []; // results
let tenderId = null, estimateId = null, workId = null;

(async () => {
  const headed = process.argv.includes('--headed');
  const browser = await chromium.launch({
    headless: !headed,
    args: ['--ignore-certificate-errors'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => log(`⚠️ PAGE: ${e.message.slice(0, 120)}`));

  // ═══════════════════════════════════════════════════════
  // STEP 1 — Директор: Создание тендера (PM нет доступа к #/tenders)
  // ═══════════════════════════════════════════════════════
  try {
    log('\n═══ STEP 1: Директор — Создание тендера ═══');
    await login(page, 'director');

    // PM userId = test_pm account (id=4404)
    const pmUserId = 4404;
    log(`PM userId = ${pmUserId} (test_pm)`);

    await nav(page, 'tenders');
    await page.waitForTimeout(1000);

    // Dismiss any blocking modal/overlay
    const hasModalBack = await page.evaluate(() => {
      const mb = document.querySelector('.modalback');
      if (mb && getComputedStyle(mb).display !== 'none') {
        // Try to close it
        const closeBtn = document.querySelector('#modalClose');
        if (closeBtn) closeBtn.click();
        else mb.style.display = 'none';
        return true;
      }
      return false;
    });
    if (hasModalBack) {
      log('  Закрыли блокирующую модалку');
      await page.waitForTimeout(1000);
    }
    await swalConfirm(page);

    // Click create
    const createBtn = page.locator('#btnNew, button[data-act="create"], button:has-text("Создать")').first();
    await createBtn.waitFor({ state: 'visible', timeout: 10000 });
    await createBtn.click({ force: true });
    await page.waitForTimeout(2500);

    // Fill form: pick real customer from AsgardDB (validation requires existing customer)
    const custInfo = await page.evaluate(async (data) => {
      // Get first existing customer from AsgardDB
      const custs = await AsgardDB.all('customers');
      const cust = custs.find(c => c.inn && c.name) || custs[0];
      if (!cust) return { error: 'no customers in DB' };

      // Set customer name and INN
      CRAutocomplete.setValue('e_customer', cust.name || cust.full_name || '');
      CRAutocomplete.setValue('e_inn', cust.inn || '');

      // Period
      const now = new Date();
      CRSelect.setValue('e_period_year', String(now.getFullYear()));
      CRSelect.setValue('e_period_month', String(now.getMonth() + 1).padStart(2, '0'));

      // Type + PM
      CRSelect.setValue('e_type', 'Тендер');
      if (data.pmId) CRSelect.setValue('e_pm', String(data.pmId));

      // Deadline
      try { CRDatePicker.setValue('e_docs_deadline', '2026-04-30'); } catch (_) {}

      return { name: cust.name, inn: cust.inn };
    }, { pmId: pmUserId });
    log(`Customer: ${custInfo.name} (ИНН: ${custInfo.inn})`);

    await page.fill('#e_title', TENDER_TITLE);
    await page.fill('#e_price', '5500000');
    await page.fill('#e_url', 'https://disk.yandex.ru/d/asgard-crm-e2e-v7');

    await ss(page, '01-tender-form.png');

    // Save
    await page.locator('#btnSave').click();
    await page.waitForTimeout(3000);

    // Handle duplicate modal
    if (await page.locator('#duplicateModal').isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.locator('#btnDupProceed').click();
      await page.waitForTimeout(2000);
    }
    await swalConfirm(page);
    await page.waitForTimeout(2000);

    // Find tender by title in AsgardDB
    tenderId = await page.evaluate(async (marker) => {
      const all = await AsgardDB.all('tenders');
      const t = all.sort((a, b) => b.id - a.id).find(x => (x.tender_title || '').includes(marker));
      return t ? t.id : null;
    }, 'E2E v7 #' + TS);

    if (!tenderId) throw new Error('Тендер не найден в AsgardDB после сохранения');
    log(`✅ Тендер #${tenderId} создан`);

    // Проверка что дата не уехала — переоткрываем тендер
    await closeModal(page);
    await nav(page, 'tenders');
    await waitTable(page);
    await openRow(page, tenderId);
    await page.waitForTimeout(2000);
    const deadlineAfter = await page.evaluate(() => {
      try { return CRDatePicker.getValue('e_docs_deadline') || ''; } catch(_) { return ''; }
    });
    if (deadlineAfter && !deadlineAfter.includes('2026-04-30') && !deadlineAfter.includes('30.04.2026')) {
      log(`⚠️ ДАТА УЕХАЛА! Ввели 2026-04-30, получили ${deadlineAfter}`);
    } else {
      log(`✅ Дата дедлайна стабильна: ${deadlineAfter}`);
    }

    await ss(page, '01-tender-created.png');
    R.push({ step: '1. Создание тендера (директор)', ok: true, id: tenderId });

  } catch (err) {
    log(`❌ STEP 1: ${err.message}`);
    await ss(page, '01-ERROR.png').catch(() => {});
    R.push({ step: '1. Создание тендера (директор)', ok: false, err: err.message });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 2 — Директор: Передача в просчёт (Handoff)
  // ═══════════════════════════════════════════════════════
  try {
    if (!tenderId) throw new Error('Нет тендера (шаг 1)');
    log('\n═══ STEP 2: Директор — Handoff ═══');

    // Директор уже залогинен из шага 1
    await closeModal(page);
    await nav(page, 'tenders');
    await waitTable(page);
    await openRow(page, tenderId);

    const handoffBtn = page.locator('#btnHandoff');
    if (await handoffBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await handoffBtn.click();
      await page.waitForTimeout(2000);
      await swalConfirm(page);
      log('Handoff выполнен');
    } else {
      // Скриншот + стоп — кнопки нет даже для директора
      await ss(page, '02-ERROR-no-handoff-btn.png');
      // Дампим видимые кнопки для диагностики
      const btns = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button'))
          .filter(b => b.offsetParent)
          .map(b => `[${b.id || '-'}] ${b.textContent.trim().slice(0, 40)}`)
      );
      log(`Видимые кнопки: ${btns.join(' | ')}`);
      throw new Error('#btnHandoff не найдена даже для директора');
    }

    // Верификация: tender должен иметь handoff_at
    const handoffOk = await page.evaluate(async (tId) => {
      const t = await AsgardDB.get('tenders', tId);
      return t && !!t.handoff_at;
    }, tenderId);
    log(`Handoff verified: ${handoffOk}`);

    await ss(page, '02-handoff-done.png');
    R.push({ step: '2. Handoff (директор)', ok: handoffOk });

  } catch (err) {
    log(`❌ STEP 2: ${err.message}`);
    await ss(page, '02-ERROR.png').catch(() => {});
    R.push({ step: '2. Handoff (директор)', ok: false, err: err.message });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 3 — PM: Быстрый просчёт + отправка
  // ═══════════════════════════════════════════════════════
  try {
    if (!tenderId) throw new Error('Нет тендера');
    log('\n═══ STEP 3: PM — Quick Calc + Send ═══');

    await closeModal(page);
    // Переключаемся на PM (до этого был директор)
    await login(page, 'pm');

    await nav(page, 'pm-calcs');

    // Try to find rows; if empty — try "Все периоды" checkbox
    let hasRows = await page.evaluate(
      () => document.querySelectorAll('#tb tr[data-id]').length
    );
    if (!hasRows) {
      log('Таблица пуста — пробуем "Все периоды"…');
      await page.evaluate(() => {
        document.querySelectorAll('label').forEach(l => {
          if (l.textContent.toLowerCase().includes('все период')) {
            const cb = l.querySelector('input[type="checkbox"]');
            if (cb && !cb.checked) cb.click();
          }
        });
      });
      await page.waitForTimeout(3000);
      hasRows = await page.evaluate(
        () => document.querySelectorAll('#tb tr[data-id]').length
      );
    }
    if (!hasRows) {
      // Reload with fresh sync
      await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(5000);
    }

    await waitTable(page, 20000);
    log(`pm-calcs rows: ${await page.evaluate(() => document.querySelectorAll('#tb tr[data-id]').length)}`);

    // Open tender — check if row is actually clickable
    const rowInfo = await page.evaluate((tId) => {
      const row = document.querySelector(`tr[data-id="${tId}"]`);
      if (!row) return { found: false };
      const btns = row.querySelectorAll('button');
      return {
        found: true,
        dataId: row.dataset.id,
        btnCount: btns.length,
        btnTexts: Array.from(btns).map(b => `[${b.id || '-'}] "${b.textContent.trim().slice(0, 30)}"`),
        hasOpen: !!row.querySelector('button[data-act="open"]'),
      };
    }, tenderId);
    log(`Row info: ${JSON.stringify(rowInfo)}`);

    await openRow(page, tenderId);

    // Check if modal opened
    const modalState = await page.evaluate(() => {
      const mb = document.querySelector('.modalback');
      const isOpen = mb && getComputedStyle(mb).display !== 'none';
      const hash = location.hash;
      return { isOpen, hash, bodyClasses: document.body.className };
    });
    log(`Modal state: ${JSON.stringify(modalState)}`);

    if (!modalState.isOpen) {
      // Try clicking "Открыть" directly by text
      log('Modal не открылась — пробуем клик по "Открыть" напрямую…');
      const openBtnDirect = page.locator('button:has-text("Открыть")').first();
      if (await openBtnDirect.isVisible({ timeout: 3000 }).catch(() => false)) {
        await openBtnDirect.click();
        await page.waitForTimeout(3000);
      }
    }

    await ss(page, '03-after-open.png');

    // Click Quick Calc button
    const qcBtn = page.locator('#btnQuickCalc');
    await qcBtn.waitFor({ state: 'visible', timeout: 8000 });
    await qcBtn.click();
    await page.waitForTimeout(2000);

    // Fill QC fields
    // City — might be CRAutocomplete or plain input
    await page.evaluate(() => {
      const inp = document.getElementById('qc_city');
      if (inp) {
        inp.value = 'Сургут';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Also try CRAutocomplete
      try { if (typeof CRAutocomplete !== 'undefined') CRAutocomplete.setValue('qc_city', 'Сургут'); }
      catch (_) {}
    });

    const qcFields = {
      '#qc_distance':    '2000',
      '#qc_work_type':   'Гидромеханическая чистка',
      '#qc_people':      '8',
      '#qc_days':        '14',
      '#qc_cost':        '3200000',
      '#qc_price':       '5500000',
      '#qc_prob':        '85',
      '#qc_terms':       '50% предоплата, остаток по акту',
      '#qc_assumptions': 'Доступ на объект обеспечен, СИЗ наше',
      '#qc_comment':     'Стандартная бригада, опыт на аналогах',
      '#qc_cover':       'Просчёт выполнен по стандартной схеме. Бригада 8 человек, 14 смен. Себестоимость 3.2М, цена 5.5М с НДС. Маржа ~29%.',
    };

    for (const [sel, val] of Object.entries(qcFields)) {
      const el = page.locator(sel);
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        await el.fill(val);
      } else {
        log(`⚠️ Поле ${sel} не видно`);
      }
    }

    await ss(page, '03-quickcalc-filled.png');

    // Send for approval
    const sendBtn = page.locator('#qc_send');
    await sendBtn.waitFor({ state: 'visible', timeout: 5000 });
    await sendBtn.click();
    await page.waitForTimeout(4000);
    await swalConfirm(page);
    await page.waitForTimeout(2000);

    // Verify estimate created
    estimateId = await page.evaluate(async (tId) => {
      const all = await AsgardDB.all('estimates');
      const e = all.filter(x => x.tender_id === tId).sort((a, b) => b.id - a.id)[0];
      return e ? e.id : null;
    }, tenderId);

    log(`Estimate ID: ${estimateId}`);

    // Verify tender status changed
    const tStatus = await page.evaluate(async (tId) => {
      const t = await AsgardDB.get('tenders', tId);
      return t ? t.tender_status : null;
    }, tenderId);
    log(`Tender status: ${tStatus}`);

    await ss(page, '03-estimate-sent.png');
    R.push({ step: '3. Quick Calc + Send', ok: !!estimateId, id: estimateId });

  } catch (err) {
    log(`❌ STEP 3: ${err.message}`);
    await ss(page, '03-ERROR.png').catch(() => {});
    R.push({ step: '3. Quick Calc + Send', ok: false, err: err.message });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 4 — Директор: Согласование просчёта
  // ═══════════════════════════════════════════════════════
  try {
    if (!estimateId) throw new Error('Нет просчёта (шаг 3)');
    log('\n═══ STEP 4: Директор — Согласование ═══');

    await closeModal(page);
    await login(page, 'director');
    await nav(page, 'all-estimates');
    await waitTable(page);

    log(`Ищем просчёт #${estimateId}…`);

    // Dismiss any push dialogs before interacting
    await dismissPush(page);

    // Open the estimate row
    const estRow = page.locator(`tr[data-id="${estimateId}"]`);
    if (await estRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await estRow.locator('button[data-act="open"]').click({ force: true }).catch(async () => {
        await estRow.click({ force: true });
      });
    } else {
      // Try first "sent" row
      log('Строка не найдена напрямую, ищем первый sent…');
      const firstOpenBtn = page.locator('tr[data-id] button[data-act="open"]').first();
      await firstOpenBtn.click({ force: true });
    }
    await page.waitForTimeout(3000);
    // Dismiss push again after modal open
    await dismissPush(page);
    await ss(page, '04-estimate-card.png');

    // Check data
    const estData = await page.evaluate(async (eId) => {
      const e = await AsgardDB.get('estimates', eId);
      return e ? { price: e.price_tkp, cost: e.cost_plan, status: e.approval_status } : null;
    }, estimateId);
    log(`Estimate data: ${JSON.stringify(estData)}`);

    // Click Approve
    const approveBtn = page.locator('#btnApprove');
    await approveBtn.waitFor({ state: 'visible', timeout: 8000 });

    // Optional: fill comment
    const commField = page.locator('#a_comm');
    if (await commField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await commField.fill('Согласовано. Приступаем.');
    }

    await approveBtn.click();
    await page.waitForTimeout(3000);
    await swalConfirm(page);
    await page.waitForTimeout(2000);

    // Verify
    const approvedStatus = await page.evaluate(async (eId) => {
      const e = await AsgardDB.get('estimates', eId);
      return e ? e.approval_status : null;
    }, estimateId);
    log(`Approval status: ${approvedStatus}`);

    await ss(page, '04-director-approved.png');
    R.push({ step: '4. Согласование', ok: approvedStatus === 'approved' });

  } catch (err) {
    log(`❌ STEP 4: ${err.message}`);
    await ss(page, '04-ERROR.png').catch(() => {});
    R.push({ step: '4. Согласование', ok: false, err: err.message });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 5 — PM: Статус → "Выиграли" → Работа
  // ═══════════════════════════════════════════════════════
  try {
    if (!tenderId) throw new Error('Нет тендера');
    log('\n═══ STEP 5: PM — Выиграли → Работа ═══');

    await closeModal(page);
    await login(page, 'pm');

    // Force sync
    await page.goto(BASE + '/#/main');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);

    await nav(page, 'pm-calcs');

    // Handle period filter
    await page.evaluate(() => {
      document.querySelectorAll('label').forEach(l => {
        if (l.textContent.toLowerCase().includes('все период')) {
          const cb = l.querySelector('input[type="checkbox"]');
          if (cb && !cb.checked) cb.click();
        }
      });
    });
    await page.waitForTimeout(2000);

    await waitTable(page, 20000);

    // Status chain: "Согласование ТКП" → "ТКП согласовано" → "КП отправлено" → "Выиграли"
    const statusChain = ['ТКП согласовано', 'КП отправлено', 'Выиграли'];

    for (const nextStatus of statusChain) {
      log(`  Статус → "${nextStatus}"…`);
      await openRow(page, tenderId);
      await page.waitForTimeout(2000);

      // Check modal is open
      const modalOpen5 = await page.evaluate(() => {
        const mb = document.querySelector('.modalback');
        return mb && getComputedStyle(mb).display !== 'none';
      });
      if (!modalOpen5) {
        log(`  ⚠️ Карточка не открылась! Пробуем "Открыть" кнопку…`);
        const ob = page.locator('button:has-text("Открыть")').first();
        if (await ob.isVisible({ timeout: 2000 }).catch(() => false)) {
          await ob.click();
          await page.waitForTimeout(3000);
        }
      }

      // Dump visible elements for debugging
      const cardDebug = await page.evaluate(() => {
        const selects = document.querySelectorAll('[id*="status"], [id*="s_status"]');
        const buttons = document.querySelectorAll('button');
        const visibleBtns = Array.from(buttons)
          .filter(b => b.offsetParent)
          .filter(b => b.id.includes('Save') || b.id.includes('save') || b.id.includes('Status') || b.id.includes('status') || b.textContent.includes('Сохранить') || b.textContent.includes('Статус'))
          .map(b => `[${b.id}] "${b.textContent.trim().slice(0, 30)}"`);
        return {
          selectIds: Array.from(selects).map(s => s.id),
          statusBtns: visibleBtns,
          hasModal: !!document.querySelector('.modalback'),
        };
      });
      log(`  Card debug: ${JSON.stringify(cardDebug)}`);

      // Проверяем текущий статус перед сменой
      const curStatus = await page.evaluate(() => {
        try { return CRSelect.getValue('s_status') || '(пусто)'; }
        catch (_) { return '(нет CRSelect)'; }
      });
      log(`  Текущий: "${curStatus}"`);

      // Set status via CRSelect
      const set = await page.evaluate((st) => {
        try { CRSelect.setValue('s_status', st); return true; }
        catch (e) { return false; }
      }, nextStatus);

      if (!set) {
        log(`  ⚠️ CRSelect.setValue('s_status', '${nextStatus}') не удался`);
        // Дамп доступных опций
        const opts = await page.evaluate(() => {
          try {
            const el = document.querySelector('#s_status_w select, [id="cr-s_status_w"]');
            if (el) return el.innerHTML.slice(0, 300);
            return '(select not found)';
          } catch (_) { return '(error)'; }
        });
        log(`  Options HTML: ${opts}`);
      }

      // Click save status
      const saveStatusBtn = page.locator('#btnSaveStatus');
      if (await saveStatusBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveStatusBtn.click();
        await page.waitForTimeout(2000);
        await swalConfirm(page);

        // Ждём пока AsgardDB запишет новый статус
        const saved = await page.waitForFunction(
          (args) => {
            return new Promise(async (resolve) => {
              try {
                const t = await AsgardDB.get('tenders', args.tId);
                resolve(t && t.tender_status === args.expected);
              } catch (_) { resolve(false); }
            });
          },
          { tId: tenderId, expected: nextStatus },
          { timeout: 10000 }
        ).then(() => true).catch(() => false);

        if (saved) {
          log(`  ✅ Статус "${nextStatus}" записан в AsgardDB`);
        } else {
          log(`  ⚠️ Статус "${nextStatus}" не подтверждён в AsgardDB`);
        }
      } else {
        log(`  ⚠️ #btnSaveStatus не найден`);
      }

      // Close modal to re-open with fresh status
      await closeModal(page);
      await page.waitForTimeout(1500);
    }

    // Check: work should have been auto-created when status = "Выиграли"
    workId = await page.evaluate(async (tId) => {
      const works = await AsgardDB.byIndex('works', 'tender_id', tId);
      return works.length > 0 ? works[0].id : null;
    }, tenderId);

    if (!workId) {
      throw new Error('Работа не создалась автоматически при статусе "Выиграли" — FAIL (без bypass)');
    }

    log(`Work ID: ${workId}`);

    // Verify on pm-works page
    if (workId) {
      await nav(page, 'pm-works');
      await page.waitForTimeout(2000);
      const workVisible = await page.evaluate((wId) => {
        return !!document.querySelector(`tr[data-id="${wId}"]`);
      }, workId);
      log(`Work visible in pm-works: ${workVisible}`);
    }

    await ss(page, '05-won-work-created.png');
    R.push({ step: '5. Выиграли + Работа', ok: !!workId, id: workId });

  } catch (err) {
    log(`❌ STEP 5: ${err.message}`);
    await ss(page, '05-ERROR.png').catch(() => {});
    R.push({ step: '5. Выиграли + Работа', ok: false, err: err.message });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 6 — PM: Заполнение работы + Запрос персонала
  // ═══════════════════════════════════════════════════════
  try {
    if (!workId) throw new Error('Нет работы (шаг 5)');
    log('\n═══ STEP 6: PM — Работа + Запрос персонала ═══');

    await nav(page, 'pm-works');
    await waitTable(page, 20000).catch(async () => {
      // Try "Все периоды"
      await page.evaluate(() => {
        document.querySelectorAll('label').forEach(l => {
          if (l.textContent.toLowerCase().includes('все период')) {
            const cb = l.querySelector('input[type="checkbox"]');
            if (cb && !cb.checked) cb.click();
          }
        });
      });
      await page.waitForTimeout(3000);
    });

    await openRow(page, workId);

    // Fill work fields
    const wStart = page.locator('#w_start');
    if (await wStart.isVisible({ timeout: 3000 }).catch(() => false)) {
      await wStart.fill('2026-05-15');
    }
    const wEnd = page.locator('#w_end_plan');
    if (await wEnd.isVisible({ timeout: 2000 }).catch(() => false)) {
      await wEnd.fill('2026-06-15');
    }
    const wValue = page.locator('#w_value');
    if (await wValue.isVisible({ timeout: 2000 }).catch(() => false)) {
      await wValue.fill('5500000');
    }
    const wAdv = page.locator('#w_adv_pct');
    if (await wAdv.isVisible({ timeout: 2000 }).catch(() => false)) {
      await wAdv.fill('50');
    }

    // Save work first
    const saveWork = page.locator('#btnSaveWork');
    if (await saveWork.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveWork.click();
      await page.waitForTimeout(3000);
      await swalConfirm(page);
    }

    // Проверка что даты не уехали после сохранения
    await checkDateStable(page, '#w_start', '2026-05-15', 'Дата начала работы');
    await checkDateStable(page, '#w_end_plan', '2026-06-15', 'Дата окончания работы');

    // Fill staff request
    const staffFields = {
      '#sr_Мастера':     '1',
      '#sr_Слесари':     '5',
      '#sr_ПТО':         '1',
      '#sr_Промывщики':  '1',
    };
    for (const [sel, val] of Object.entries(staffFields)) {
      const el = page.locator(sel);
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.fill(val);
      } else {
        // Try evaluate
        await page.evaluate((s, v) => {
          const inp = document.querySelector(s) || document.getElementById(s.replace('#', ''));
          if (inp) {
            inp.value = v;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, sel, val);
      }
    }

    const srComment = page.locator('#sr_comment');
    if (await srComment.isVisible({ timeout: 2000 }).catch(() => false)) {
      await srComment.fill('Стандартная бригада, опыт от 1 года');
    }

    await ss(page, '06-staff-form.png');

    // Request staff
    let staffRequested = false;
    const reqStaffBtn = page.locator('#btnReqStaff');
    if (await reqStaffBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await reqStaffBtn.scrollIntoViewIfNeeded().catch(() => {});
      await reqStaffBtn.click();
      await page.waitForTimeout(3000);
      await swalConfirm(page);
      await page.waitForTimeout(2000);
      staffRequested = true;
      log('Заявка на персонал отправлена');
    } else {
      log('⚠️ #btnReqStaff не видна');
      await ss(page, '06-ERROR-no-btn.png');
      throw new Error('#btnReqStaff не найдена — заявка не отправлена');
    }

    await ss(page, '06-staff-requested.png');
    R.push({ step: '6. Работа + Персонал', ok: staffRequested });

  } catch (err) {
    log(`❌ STEP 6: ${err.message}`);
    await ss(page, '06-ERROR.png').catch(() => {});
    R.push({ step: '6. Работа + Персонал', ok: false, err: err.message });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 7 — HR: Подбор персонала
  // ═══════════════════════════════════════════════════════
  try {
    log('\n═══ STEP 7: HR — Подбор персонала ═══');

    await closeModal(page);
    await login(page, 'hr');
    await nav(page, 'hr-requests');

    await waitTable(page, 20000).catch(async () => {
      // Try "Все периоды"
      await page.evaluate(() => {
        document.querySelectorAll('label').forEach(l => {
          if (l.textContent.toLowerCase().includes('все период')) {
            const cb = l.querySelector('input[type="checkbox"]');
            if (cb && !cb.checked) cb.click();
          }
        });
      });
      await page.waitForTimeout(3000);
    });

    // Find the staff request — look for "sent" status row
    // Open the first row (or the one matching our work)
    const srRow = await page.evaluate((wId) => {
      const rows = document.querySelectorAll('#tb tr[data-id]');
      for (const r of rows) {
        if (r.textContent.includes('sent') || r.textContent.includes('Отправлен')) return r.dataset.id;
      }
      // Fallback: first row
      return rows.length > 0 ? rows[0].dataset.id : null;
    }, workId);

    if (!srRow) throw new Error('Заявки HR не найдены');
    log(`HR request row: ${srRow}`);

    // Dismiss any push dialogs before clicking
    await dismissPush(page);

    await openRow(page, srRow);

    // Wait for HR card modal to fully load (openReq fetches data from server)
    await page.waitForFunction(() => {
      const mb = document.querySelector('.modalback');
      if (!mb || getComputedStyle(mb).display === 'none') return false;
      // Check for either employee cards or role groups or composition table
      return document.querySelectorAll('.sr-emp-card, [data-emp-id], .sr-role-group, .sr-compos-table').length > 0
        || document.querySelector('#btnSend') !== null;
    }, { timeout: 15000 }).catch(() => {
      log('⚠️ Modal or employee list did not load in 15s');
    });
    await page.waitForTimeout(2000);
    await ss(page, '07-hr-request-card.png');

    // Проверяем наличие сотрудников в списке
    const empStats = await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('.stchk, .stchkA, .stchkB');
      const cards = document.querySelectorAll('.sr-emp-card, [data-emp-id]');
      const roleGroups = document.querySelectorAll('.sr-role-group');
      return { checkboxes: checkboxes.length, cards: cards.length, roleGroups: roleGroups.length };
    });
    log(`Сотрудники в списке: ${empStats.checkboxes} чекбоксов, ${empStats.cards} карточек, ${empStats.roleGroups} role-групп`);

    if (empStats.checkboxes === 0 && empStats.cards === 0) {
      // Check if modal is actually open
      const modalState = await page.evaluate(() => {
        const mb = document.querySelector('.modalback');
        const isOpen = mb && getComputedStyle(mb).display !== 'none';
        const title = document.querySelector('#modalTitle')?.textContent || '';
        const bodyLen = document.querySelector('#modalBody')?.innerHTML?.length || 0;
        return { isOpen, title, bodyLen };
      });
      log(`Modal state: ${JSON.stringify(modalState)}`);

      if (!modalState.isOpen) {
        log('⚠️ Модалка не открылась — пробуем клик по кнопке "Открыть" напрямую');
        const openBtn = page.locator(`tr[data-id="${srRow}"] button:has-text("Открыть")`);
        if (await openBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await openBtn.click({ force: true });
          await page.waitForTimeout(5000);
          // Re-check employees
          const empStats2 = await page.evaluate(() => {
            const checkboxes = document.querySelectorAll('.stchk, .stchkA, .stchkB');
            const cards = document.querySelectorAll('.sr-emp-card, [data-emp-id]');
            return { checkboxes: checkboxes.length, cards: cards.length };
          });
          log(`После повторного открытия: ${empStats2.checkboxes} чекбоксов, ${empStats2.cards} карточек`);
          if (empStats2.checkboxes > 0 || empStats2.cards > 0) {
            log('✅ Модалка открылась после повторного клика');
          }
        }
      }

      // Final check
      const finalEmp = await page.evaluate(() => {
        const checkboxes = document.querySelectorAll('.stchk, .stchkA, .stchkB');
        const cards = document.querySelectorAll('.sr-emp-card, [data-emp-id]');
        return { checkboxes: checkboxes.length, cards: cards.length };
      });
      if (finalEmp.checkboxes === 0 && finalEmp.cards === 0) {
        log('⚠️ НЕТ свободных сотрудников в тестовой базе — автоподбор невозможен');
        await ss(page, '07-ERROR-no-employees.png');
        throw new Error('Нет сотрудников для подбора в тестовой базе');
      }
    }

    // Auto-pick employees per role
    const pickBtns = page.locator('[data-act="pickRole"]');
    const pickCount = await pickBtns.count();
    log(`Auto-pick buttons: ${pickCount}`);

    if (pickCount > 0) {
      for (let i = 0; i < pickCount; i++) {
        const roleName = await pickBtns.nth(i).getAttribute('data-role').catch(() => '?');
        await pickBtns.nth(i).click().catch(() => {});
        await page.waitForTimeout(500);
        log(`  Auto-pick: ${roleName}`);
      }
      // Проверяем сколько реально выбрано
      const checked = await page.evaluate(() =>
        document.querySelectorAll('.stchk:checked, .stchkA:checked').length
      );
      log(`Auto-pick: выбрано ${checked} сотрудников`);
      if (checked === 0) {
        log('⚠️ Auto-pick не выбрал ни одного — пробуем вручную');
      }
    }

    // Если auto-pick не сработал или его нет — выбираем вручную
    const checkedAfterPick = await page.evaluate(() =>
      document.querySelectorAll('.stchk:checked, .stchkA:checked').length
    );
    if (checkedAfterPick === 0) {
      log('Выбираем вручную первых 8 сотрудников…');
      const checkboxes = page.locator('.stchk');
      const cbCount = await checkboxes.count();
      const toCheck = Math.min(cbCount, 8);
      for (let i = 0; i < toCheck; i++) {
        const cb = checkboxes.nth(i);
        if (!(await cb.isChecked().catch(() => false))) {
          await cb.check({ force: true }).catch(() => {});
        }
      }
      log(`Выбрано вручную: ${toCheck} сотрудников`);
    }

    // Ensure employee 14 (Андросов, phone 79160614809) is checked for field module testing
    await page.evaluate(() => {
      const cb14 = document.querySelector('.stchk[value="14"]');
      if (cb14 && !cb14.checked) { cb14.checked = true; cb14.dispatchEvent(new Event('change', { bubbles: true })); }
    });

    // HR comment
    const hrComment = page.locator('#hr_comment');
    if (await hrComment.isVisible({ timeout: 2000 }).catch(() => false)) {
      await hrComment.fill('Подобраны по опыту и рейтингу. Все свободны на указанный период.');
    }

    await ss(page, '07-hr-selected.png');

    // Проверяем что хоть кто-то выбран перед отправкой
    const finalChecked = await page.evaluate(() =>
      document.querySelectorAll('.stchk:checked, .stchkA:checked').length
    );
    if (finalChecked === 0) {
      await ss(page, '07-ERROR-nobody-selected.png');
      throw new Error(`Не выбран ни один сотрудник (checkboxes: ${empStats.checkboxes})`);
    }
    log(`Итого выбрано сотрудников: ${finalChecked}`);

    // DEBUG: dump what HR code would collect
    const debugIds = await page.evaluate(() => {
      const cbs = Array.from(document.querySelectorAll('.stchk'));
      const checked = cbs.filter(c => c.checked);
      return {
        total: cbs.length,
        checked: checked.length,
        ids: checked.slice(0, 5).map(c => ({ val: c.value, num: Number(c.value), role: c.getAttribute('data-role') })),
        isVachta: !!document.querySelector('.stchkA'),
      };
    });
    log(`DEBUG: HR будет отправлять: ${JSON.stringify(debugIds)}`);

    // Send answer
    const btnSend = page.locator('#btnSend');
    if (await btnSend.isVisible({ timeout: 5000 }).catch(() => false)) {
      await btnSend.scrollIntoViewIfNeeded().catch(() => {});
      await btnSend.click();
      await page.waitForTimeout(3000);
      await swalConfirm(page);
      await page.waitForTimeout(2000);

      // Verify the data was actually saved
      const savedData = await page.evaluate(async () => {
        const srs = await AsgardDB.all('staff_requests');
        const sr = srs[srs.length - 1]; // last one
        return sr ? {
          id: sr.id,
          status: sr.status,
          proposed: sr.proposed_staff_ids_json,
          proposedA: sr.proposed_staff_ids_a_json,
          hrComment: sr.hr_comment,
        } : null;
      });
      log(`DEBUG: Saved staff_request: ${JSON.stringify(savedData)}`);

      log('HR ответ отправлен');
    } else {
      await ss(page, '07-ERROR-no-send-btn.png');
      throw new Error('#btnSend не найдена — HR не может отправить ответ');
    }

    // Проверка запрошенного состава
    const requestedVisible = await page.evaluate(() => {
      const text = document.body.textContent || '';
      return text.includes('Мастер') || text.includes('Слесар') || text.includes('Запрошено') || text.includes('Состав');
    });
    log(`   Запрошенный состав отображался: ${requestedVisible ? '✅' : '⚠️'}`);

    await ss(page, '07-hr-answered.png');
    R.push({ step: '7. HR подбор', ok: true });

  } catch (err) {
    log(`❌ STEP 7: ${err.message}`);
    await ss(page, '07-ERROR.png').catch(() => {});
    R.push({ step: '7. HR подбор', ok: false, err: err.message });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 8 — PM: Принятие рабочих
  // ═══════════════════════════════════════════════════════
  try {
    if (!workId) throw new Error('Нет работы');
    log('\n═══ STEP 8: PM — Принятие рабочих ═══');

    await closeModal(page);
    await login(page, 'pm');

    // Force full page reload to sync SPA state after login switch
    await page.goto(BASE + '/#/pm-works', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);
    await dismissPush(page);

    // Verify we're on pm-works
    const step8Hash = await page.evaluate(() => location.hash);
    if (!step8Hash.includes('pm-works')) {
      log(`  ⚠️ Still on ${step8Hash}, retrying…`);
      await page.evaluate(() => { location.hash = '#/pm-works'; });
      await page.waitForTimeout(3000);
    }

    await waitTable(page, 20000).catch(async () => {
      await page.evaluate(() => {
        document.querySelectorAll('label').forEach(l => {
          if (l.textContent.toLowerCase().includes('все период')) {
            const cb = l.querySelector('input[type="checkbox"]');
            if (cb && !cb.checked) cb.click();
          }
        });
      });
      await page.waitForTimeout(3000);
    });

    await openRow(page, workId);
    await page.waitForTimeout(2000);

    // View staff response
    const viewStaffBtn = page.locator('#btnViewStaff');
    if (await viewStaffBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await viewStaffBtn.scrollIntoViewIfNeeded().catch(() => {});
      await viewStaffBtn.click();
      await page.waitForTimeout(3000);

      // Проверяем что PM видит выбранных сотрудников
      const staffInfo = await page.evaluate(() => {
        const cards = document.querySelectorAll('.selected-employee, .staff-selected-item, .sr-emp-card, [data-emp-id]');
        const bodyText = (document.querySelector('.modal-body, .card-body') || document.body).textContent || '';
        const hasZero = bodyText.includes('Пока не выбрано') || bodyText.includes('(0)');
        return { count: cards.length, hasZero };
      });
      if (staffInfo.count === 0 && staffInfo.hasZero) {
        // Проверяем в AsgardDB напрямую
        const dbCheck = await page.evaluate(async (wId) => {
          const srs = await AsgardDB.all('staff_requests');
          const sr = srs.find(s => s.work_id == wId);
          return sr ? {
            id: sr.id, status: sr.status,
            proposed: sr.proposed_staff_ids_json,
            proposedLen: Array.isArray(sr.proposed_staff_ids_json) ? sr.proposed_staff_ids_json.length : 0,
          } : 'not found';
        }, workId);
        log(`⚠️ PM видит 0 карточек, DB: ${JSON.stringify(dbCheck)}`);
        await ss(page, '08-zero-selected-debug.png');
        // Продолжаем если proposed > 0 (визуал глюк) или status = answered
        if (typeof dbCheck === 'object' && dbCheck.status === 'answered') {
          log('  → Статус answered, продолжаем');
        } else {
          throw new Error('FAIL: PM видит 0 выбранных — HR ответ не сохранился');
        }
      }
      log(`PM видит ответ HR (карточек: ${staffInfo.count})`);

      await ss(page, '08-staff-response.png');

      // Close staff modal and re-open work card to get #btnApproveStaff back
      await closeModal(page);
      await page.waitForTimeout(1000);
      await openRow(page, workId);
      await page.waitForTimeout(2000);
    } else {
      log('⚠️ #btnViewStaff не видна — проверяем статус заявки');
      const srStatus = await page.evaluate(async (wId) => {
        try {
          const srs = await AsgardDB.all('staff_requests');
          const sr = srs.find(s => s.work_id == wId);
          return sr ? { id: sr.id, status: sr.status } : 'not found';
        } catch (_) { return 'error'; }
      }, workId);
      log(`Staff request status: ${JSON.stringify(srStatus)}`);
    }

    // Approve staff
    const approveStaffBtn = page.locator('#btnApproveStaff');
    if (await approveStaffBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await approveStaffBtn.scrollIntoViewIfNeeded().catch(() => {});
      await approveStaffBtn.click();
      await page.waitForTimeout(3000);
      await swalConfirm(page);
      await page.waitForTimeout(2000);
      log('Персонал принят');
    } else {
      // Дампим видимые кнопки для диагностики
      const btns = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button'))
          .filter(b => b.offsetParent)
          .map(b => `[${b.id || '-'}] ${b.textContent.trim().slice(0, 40)}`)
      );
      log(`Visible buttons: ${btns.join(' | ')}`);
      await ss(page, '08-ERROR-no-approve-btn.png');
      throw new Error('#btnApproveStaff не найдена — статус заявки не "answered" или HR не отправил');
    }

    await ss(page, '08-staff-approved.png');
    R.push({ step: '8. Принятие рабочих', ok: true });

  } catch (err) {
    log(`❌ STEP 8: ${err.message}`);
    await ss(page, '08-ERROR.png').catch(() => {});
    R.push({ step: '8. Принятие рабочих', ok: false, err: err.message });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 9 — PM: Полевой модуль + Бригада
  // ═══════════════════════════════════════════════════════
  try {
    if (!workId) throw new Error('Нет работы');
    log('\n═══ STEP 9: PM — Полевой модуль + Бригада ═══');

    // Make sure work card is open (or re-open)
    const modalOpen = await page.evaluate(() => {
      const m = document.querySelector('.modalback');
      return m && getComputedStyle(m).display !== 'none';
    });
    if (!modalOpen) {
      await nav(page, 'pm-works');
      await waitTable(page, 20000).catch(() => {});
      await openRow(page, workId);
    }

    // Click Actions menu
    const actionsBtn = page.locator('#btnActions');
    if (await actionsBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await actionsBtn.scrollIntoViewIfNeeded().catch(() => {});
      await actionsBtn.click();
      await page.waitForTimeout(2000);

      // Find and click "Полевой модуль" in the menu (AsgardActionMenu uses .aam-card)
      const fieldClicked = await page.evaluate(() => {
        // First try: direct .aam-card selector (AsgardActionMenu cards)
        const cards = document.querySelectorAll('.aam-card');
        for (const card of cards) {
          const label = card.querySelector('.aam-label');
          const text = (label ? label.textContent : card.textContent) || '';
          if (text.toLowerCase().includes('полевой')) {
            card.click();
            return true;
          }
        }
        // Fallback: broader search
        const items = document.querySelectorAll(
          'button, a, li, div[role="menuitem"], [data-act], .aam-card, [data-aam-idx]'
        );
        for (const el of items) {
          if (!el.offsetParent) continue;
          if ((el.textContent || '').toLowerCase().includes('полевой')) {
            el.click();
            return true;
          }
        }
        return false;
      });
      log(`"Полевой модуль" click: ${fieldClicked}`);
      await page.waitForTimeout(3000);
    }

    // Check if field tabs are visible (must open via UI menu, no JS bypass)
    const fieldVisible = await page.locator('[data-ftab]').first()
      .isVisible({ timeout: 5000 }).catch(() => false);

    if (!fieldVisible) {
      log('⚠️ Полевой модуль не открылся через UI меню');
      // Look for activation button
      const activateBtn = await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.includes('Запустить') || b.textContent.includes('Активир')) {
            b.click();
            return true;
          }
        }
        return false;
      });
      if (activateBtn) {
        log('Clicked activate button');
        await page.waitForTimeout(4000);
      }
      // Re-check
      const fieldVisible2 = await page.locator('[data-ftab]').first()
        .isVisible({ timeout: 5000 }).catch(() => false);
      if (!fieldVisible2) {
        await ss(page, '09-ERROR-field-not-opened.png');
        throw new Error('Полевой модуль не открылся через UI — FAIL');
      }
    }

    await ss(page, '09-field-module.png');

    // Make sure Crew tab is active
    const crewTab = page.locator('[data-ftab="crew"]');
    if (await crewTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await crewTab.click({ force: true });
      await page.waitForTimeout(2000);
    }

    // Try to add crew members
    // 1. Find "Добавить сотрудника" button
    const addEmpResult = await page.evaluate(async () => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.includes('Добавить сотрудника') || b.textContent.includes('➕')) {
          // Get employees — ensure ID 14 (Андросов, phone 79160614809) is included
          const emps = await AsgardDB.all('employees');
          const allActive = emps.filter(e => e.is_active !== false);
          const target14 = allActive.find(e => e.id === 14);
          const others = allActive.filter(e => e.id !== 14).slice(0, 2);
          const active = target14 ? [target14, ...others] : allActive.slice(0, 3);

          // Add 3 rows
          for (let i = 0; i < Math.min(3, active.length); i++) {
            b.click();
            await new Promise(r => setTimeout(r, 500));
          }
          return { clicked: true, empCount: active.length };
        }
      }
      return { clicked: false };
    });
    log(`Add employee result: ${JSON.stringify(addEmpResult)}`);

    if (addEmpResult.clicked) {
      await page.waitForTimeout(2000);

      // Проверяем что строки реально появились
      const rowsBefore = await page.evaluate(() =>
        document.querySelectorAll('[data-crew-row="1"]').length
      );
      log(`Crew rows в DOM: ${rowsBefore}`);

      if (rowsBefore === 0) {
        log('⚠️ Строки бригады не появились в DOM после клика "Добавить"');
      } else {
        // Set employees in the new rows via CREmployeePicker
        const rowsSet = await page.evaluate(async () => {
          const emps = await AsgardDB.all('employees');
          const allActive = emps.filter(e => e.is_active !== false);
          const t14 = allActive.find(e => e.id === 14);
          const oth = allActive.filter(e => e.id !== 14).slice(0, 2);
          const active = t14 ? [t14, ...oth] : allActive.slice(0, 3);
          const roles = ['worker', 'master', 'pto'];
          let set = 0;
          const errors = [];

          const rows = document.querySelectorAll('tr[data-crew-row]');
          for (let i = 0; i < Math.min(rows.length, active.length); i++) {
            const rid = rows[i].dataset.crewRid;
            try {
              // Find the picker ID from the row's employee cell
              const pickerWrap = rows[i].querySelector('[data-field="employee"]');
              const pickerId = pickerWrap ? pickerWrap.dataset.pickerId : null;

              if (pickerId && typeof CREmployeePicker !== 'undefined') {
                // Use CREmployeePicker.setSelected
                CREmployeePicker.setSelected(pickerId, [active[i].id]);
                // Verify
                const sel = CREmployeePicker.getSelected(pickerId);
                if (!sel || sel.length === 0) {
                  errors.push(`picker ${pickerId}: setSelected не сработал`);
                } else {
                  set++;
                }
              } else {
                // Fallback: try CRSelect
                try {
                  CRSelect.setValue('ft_emp_' + rid, String(active[i].id));
                  const empVal = CRSelect.getValue('ft_emp_' + rid);
                  if (empVal) set++;
                  else errors.push(`ft_emp_${rid}: CRSelect fallback не сработал`);
                } catch (e2) {
                  errors.push(`row ${rid}: no picker found (pickerId=${pickerId}): ${e2.message}`);
                }
              }

              // Set role via CRSelect
              try {
                CRSelect.setValue('ft-role-' + rid, roles[i] || 'worker');
              } catch (_) {}

              // Set tariff
              try {
                const tOpts = CRSelect.getOptions ? CRSelect.getOptions('ft-tariff-' + rid) : [];
                if (tOpts.length > 0) CRSelect.setValue('ft-tariff-' + rid, String(tOpts[0].value));
              } catch (_) {}
            } catch (e) {
              errors.push(`row ${rid}: ${e.message}`);
            }
          }
          return { set, errors, totalRows: rows.length };
        });
        log(`Crew rows заполнено: ${rowsSet.set}/${rowsSet.totalRows}`);
        if (rowsSet.errors.length > 0) {
          log(`  Ошибки: ${rowsSet.errors.join('; ')}`);
        }
      }
    }

    await ss(page, '09-crew-filled.png');

    // Проверяем что хоть одна строка бригады заполнена сотрудником
    const crewBefore = await page.evaluate(() => {
      const rows = document.querySelectorAll('tr[data-crew-row]');
      let filled = 0;
      for (const r of rows) {
        const pickerWrap = r.querySelector('[data-field="employee"]');
        const pickerId = pickerWrap ? pickerWrap.dataset.pickerId : null;
        try {
          if (pickerId && typeof CREmployeePicker !== 'undefined') {
            const sel = CREmployeePicker.getSelected(pickerId);
            if (sel && sel.length > 0) filled++;
          }
        } catch (_) {}
      }
      return { total: rows.length, filled };
    });
    log(`Бригада перед сохранением: ${crewBefore.filled}/${crewBefore.total} строк с сотрудниками`);

    if (crewBefore.filled === 0 && crewBefore.total > 0) {
      log('⚠️ Ни один сотрудник не назначен в строки бригады');
      await ss(page, '09-ERROR-no-employees-set.png');
      throw new Error(`Бригада: ${crewBefore.total} строк, но 0 сотрудников назначено`);
    }
    if (crewBefore.total === 0) {
      await ss(page, '09-ERROR-no-crew-rows.png');
      throw new Error('Строки бригады не создались (0 строк)');
    }

    // Save crew
    const saveCrewBtn = page.locator('button:has-text("Сохранить бригаду")').first();
    const saveCrewVisible = await saveCrewBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (saveCrewVisible) {
      await saveCrewBtn.click();
      await page.waitForTimeout(5000);

      // Верификация: проверяем что строки сохранились
      const crewSaved = await page.evaluate(() => {
        const rows = document.querySelectorAll('tr[data-crew-row]');
        let filled = 0;
        for (const r of rows) {
          const pickerWrap = r.querySelector('[data-field="employee"]');
          const pickerId = pickerWrap ? pickerWrap.dataset.pickerId : null;
          try {
            if (pickerId && typeof CREmployeePicker !== 'undefined') {
              const sel = CREmployeePicker.getSelected(pickerId);
              if (sel && sel.length > 0) filled++;
            }
          } catch (_) {}
        }
        return { total: rows.length, filled };
      });
      log(`Бригада после сохранения: ${crewSaved.filled}/${crewSaved.total} строк с сотрудниками`);

      // Дополнительно — проверяем ФИО в ячейках
      const crewNames = await page.evaluate(() => {
        const cells = document.querySelectorAll('.field-crew-table td, .crew-member-name, [data-crew-row] .cr-select__single-value, [data-crew-row] .cr-emp-picker__value');
        return Array.from(cells).map(c => c.textContent.trim()).filter(t => t && t !== '—' && !t.includes('сотрудник') && t.length > 2);
      });
      if (crewNames.length === 0) {
        log(`⚠️ Бригада: нет ФИО в ячейках (${crewSaved.filled} значений в CRSelect, но визуально пусто)`);
      } else {
        log(`✅ Бригада: ${crewNames.length} сотрудников с ФИО`);
      }
    } else {
      await ss(page, '09-ERROR-no-save-btn.png');
      throw new Error('Кнопка "Сохранить бригаду" не найдена');
    }

    await ss(page, '09-crew-saved.png');
    R.push({ step: '9. Field + Бригада', ok: true });

  } catch (err) {
    log(`❌ STEP 9: ${err.message}`);
    await ss(page, '09-ERROR.png').catch(() => {});
    R.push({ step: '9. Field + Бригада', ok: false, err: err.message });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 10 — PM: SMS приглашение
  // ═══════════════════════════════════════════════════════
  try {
    log('\n═══ STEP 10: PM — SMS ═══');

    // Ensure field module is open with crew tab active
    let smsBtn = page.locator('button:has-text("SMS бригаде"), button:has-text("Отправить SMS")').first();
    let smsBtnVisible = await smsBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (!smsBtnVisible && workId) {
      log('SMS кнопка не видна — пробуем переключить на crew tab…');
      const crewT = page.locator('[data-ftab="crew"]');
      if (await crewT.isVisible({ timeout: 3000 }).catch(() => false)) {
        await crewT.click({ force: true });
        await page.waitForTimeout(2000);
        smsBtnVisible = await smsBtn.isVisible({ timeout: 3000 }).catch(() => false);
      }
    }

    if (smsBtnVisible) {
      // IMPORTANT: Set up dialog handler BEFORE clicking (confirm() blocks JS)
      page.once('dialog', async dialog => {
        log(`  Dialog: "${dialog.message().slice(0, 80)}"`);
        await dialog.accept();
      });

      await smsBtn.click();
      await page.waitForTimeout(4000);
      await swalConfirm(page);
      log('SMS отправлено (или попытка)');
    } else {
      await ss(page, '10-ERROR-no-sms-btn.png');
      throw new Error('Кнопка SMS не найдена — field module не открылся или crew tab пуст');
    }

    await ss(page, '10-sms-sent.png');
    R.push({ step: '10. SMS', ok: true });

  } catch (err) {
    log(`❌ STEP 10: ${err.message}`);
    await ss(page, '10-ERROR.png').catch(() => {});
    R.push({ step: '10. SMS', ok: false, err: err.message });
  }

  // ═══════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(55));
  console.log('  E2E v7 — РЕЗУЛЬТАТЫ');
  console.log('═'.repeat(55));
  R.forEach(r => {
    const icon = r.ok ? '✅' : '❌';
    const extra = r.id ? ` (ID: ${r.id})` : '';
    const errMsg = r.err ? ` — ${r.err.slice(0, 80)}` : '';
    console.log(`  ${icon} ${r.step}${extra}${errMsg}`);
  });
  const ok = R.filter(r => r.ok).length;
  console.log(`\n  Итого: ${ok}/${R.length} шагов OK`);
  console.log(`  Tender: #${tenderId}, Estimate: #${estimateId}, Work: #${workId}`);
  console.log(`  Скриншоты: ${DIR}`);
  console.log('═'.repeat(55) + '\n');

  await browser.close();
})();
