#!/usr/bin/env node
'use strict';
/**
 * gate D-243: ставка НДС в модалке «Подались» берётся из НАСТРОЕК, а не из карточки.
 *
 * ЗАЧЕМ. Модалка смены статуса (реестр тендеров, ванила) показывала НДС 20 % при
 * `settings.vat_default_pct = 22`. Причина — не хардкод, а приоритет + сломанное чтение:
 *   1) `AsgardDB.get('settings','vat_default_pct')` возвращает УЖЕ разобранное значение
 *      (`{key,value}` → 22), а код читал `.value_json` → parseFloat(undefined) → NaN →
 *      ветка «взять из настроек» не срабатывала НИКОГДА;
 *   2) первым в приоритете стоял `row.vat_pct`, а у колонки tenders.vat_pct DEFAULT 20
 *      (на проде так у 1401 из 1410 строк) → 20 % перебивал настройку;
 *   3) суммы предложения считались в money_fmt.js по ставке карточки, а подпись — по
 *      настройке: «С НДС 22%» рядом с НДС, посчитанным как 20 %.
 *
 * ЧЕГО НЕ ЛОВИЛ ПРЕДЫДУЩИЙ ГЕЙТ. `tools/verify_vat22_ui.js` (D-190) проверяет статику на
 * литерал 20 и канбан на `file://` без сервера и БД. Цепочка «настройка → модалка реестра →
 * суммы» не проверялась вообще. Этот гейт закрывает именно её — на ЖИВОМ сервере (:3100) и клоне БД.
 *
 * ПРОВЕРКИ:
 *   V1 настройка = 22 % → подпись «С НДС 22%» и строка «в т.ч. НДС 22%» в модалке;
 *   V2 настройка = 20 % → модалка следует за настройкой;
 *   V3 настройка = 0 % (краевой: НДС не начисляется) → «С НДС 0%», без NaN в суммах;
 *   V4 настройки нет/мусор → честный fallback 22 %, без JS-ошибок и без NaN;
 *   V5 «подались» → в PATCH `submission_price` = без НДС и `submission_price_with_vat` = с НДС
 *      ровно по ставке из настроек (это и есть деньги заказчика).
 *
 * Mutation-контроль (доказательство честности гейта):
 *   node tools/make_vat_mutant.js            # собирает мутант с прежней (сломанной) логикой
 *   REGISTRY_TAB_PATH=%TEMP%\registry_tab_MUTANT.js node tools/verify_registry_vat_from_settings.js
 *   На коде до D-243 гейт обязан КРАСНЕТЬ. Подмена идёт перехватом ОТВЕТА сервера
 *   (route.fulfill): страницу отдаёт сервер, поэтому подмена файла на диске ничего не доказывает.
 *
 * Требует поднятого приложения-двойника на клоне: PORT=3100, DB_NAME=asgard_crm_test.
 * Тендер для проверки: SENTINEL_TENDER_ID (по умолчанию 2052), роль ADMIN.
 * БД после прогона возвращается в исходное состояние (vat_default_pct, строка тендера).
 *
 * Запуск: node tools/verify_registry_vat_from_settings.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
const TENDER_ID = Number(process.env.SENTINEL_TENDER_ID || 2052);
const SETTING_KEY = 'vat_default_pct';
const RESTORE_PCT = 22; // значение клона до прогона (прод: 22)

const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' };
const results = [];
let failed = 0;

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail == null ? '' : detail) });
  if (!ok) failed++;
  console.log(`${ok ? C.green + 'PASS' : C.red + 'FAIL'}${C.off}  ${name}${detail ? C.dim + '  — ' + String(detail).slice(0, 240) + C.off : ''}`);
}

// ── БД (клон) ──────────────────────────────────────────────────────────────
const pool = new Pool({ user: 'asgard', password: '123456789', database: DB_NAME, host: '127.0.0.1' });

async function dbSetting() {
  const r = await pool.query('SELECT value_json FROM settings WHERE key = $1', [SETTING_KEY]);
  return r.rows[0] ? r.rows[0].value_json : null;
}
async function dbSetSetting(raw) {
  await pool.query(
    `INSERT INTO settings (key, value_json, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [SETTING_KEY, raw]
  );
}
async function dbTender() {
  const r = await pool.query(
    `SELECT id, registry_status, vat_pct, submission_price, submission_price_with_vat,
            docs_deadline, participation_paid, analysis_deadline
       FROM tenders WHERE id = $1`, [TENDER_ID]);
  return r.rows[0] || null;
}
async function dbRestoreTender(snap) {
  if (!snap) return;
  await pool.query(
    `UPDATE tenders SET registry_status=$2, vat_pct=$3, submission_price=$4,
            submission_price_with_vat=$5, docs_deadline=$6, participation_paid=$7,
            analysis_deadline=$8, updated_at=NOW()
      WHERE id=$1`,
    [snap.id, snap.registry_status, snap.vat_pct, snap.submission_price,
     snap.submission_price_with_vat, snap.docs_deadline, snap.participation_paid,
     snap.analysis_deadline]
  );
}

// ── API ────────────────────────────────────────────────────────────────────
async function login(login, password, pin) {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  }).then((r) => r.json());
  if (!lr.token) throw new Error('login fail: ' + JSON.stringify(lr).slice(0, 200));
  let token = lr.token, user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin }),
    }).then((r) => r.json());
    if (!pr.token) throw new Error('pin fail: ' + JSON.stringify(pr).slice(0, 200));
    token = pr.token; user = pr.user || user;
  }
  return { token, user };
}

// ── Модалка: открыть и прочитать ставку из DOM ────────────────────────────
/**
 * Гоняет РЕАЛЬНЫЙ openStatusModal на реальном registry_tab.js. Читает строго из ВЕРХНЕГО
 * оверлея и ждёт снятия предыдущих: hideModal() удаляет оверлей из DOM с задержкой 300 мс
 * (ui.js:295), поэтому getElementById/querySelector по document вернул бы элемент прежней модалки.
 */
async function openModalAndRead(page, row) {
  return page.evaluate(async (row) => {
    const tab = window.AsgardRegistryTab;
    if (!tab || !tab._test || !tab._test.openStatusModal) return { err: 'нет _test.openStatusModal' };
    try { window.AsgardUI.closeModal(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 420));
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.map(String).join(' ')); origErr.apply(console, a); };
    try {
      await tab._test.openStatusModal(row);
      await new Promise((r) => setTimeout(r, 150));
      const overlays = [...document.querySelectorAll('.cr-m-overlay:not(.cr-m-overlay--leaving)')];
      const root = overlays[overlays.length - 1];
      if (!root) return { err: 'нет верхнего .cr-m-overlay (модалка не открылась)' };
      // Подпись «С НДС N%, ₽» — это текст <label> вокруг #regSubWith, а не текст модалки:
      // у input.innerText пусто, поэтому читаем label по DOM.
      const withInp = root.querySelector('#regSubWith');
      const exInp = root.querySelector('#regSubEx');
      const labelEl = withInp && withInp.closest('label');
      const labelText = labelEl ? (labelEl.innerText || labelEl.textContent || '') : '';
      const withVatLabel = (labelText.match(/С\s*НДС\s+([\d.,]+)\s*%/) || [])[1] || null;
      const vatLineEl = root.querySelector('#regSubVatLine');
      const pick = root.querySelector('#regStatusPick');
      return {
        overlayCount: overlays.length,
        title: (root.querySelector('#modalTitle') || {}).textContent || null,
        labelText,
        withVatLabel,
        withVatInput: withInp ? withInp.value : null,
        noVatInput: exInp ? exInp.value : null,
        vatLine: vatLineEl ? vatLineEl.textContent : null,
        statusOptions: pick ? [...pick.options].map((o) => o.value) : null,
        errs,
      };
    } finally {
      console.error = origErr;
      try { window.AsgardUI.closeModal(); } catch (_) {}
    }
  }, row);
}

/**
 * Сценарный прогон для одной настройки: ставим настройку, открываем модалку, читаем то,
 * что увидит пользователь. Проверяем согласованность «подпись ↔ строка НДС»: именно их
 * расхождение (подпись 22 %, а НДС посчитан как 20 %) и было дефектом.
 */
async function scenario({ pctRaw, expectPct, row }) {
  await dbSetSetting(pctRaw);
  const got = await openModalAndRead(global.__page, row);
  if (got.err) return { ok: false, detail: got.err, got };
  const labelOk = String(got.withVatLabel) === String(expectPct);
  const lineOk = String(got.vatLine || '').indexOf(`в т.ч. НДС ${expectPct}%`) === 0;
  const noNaN = !/NaN|undefined/.test(String(got.withVatInput) + String(got.noVatInput) + String(got.vatLine));
  const noErr = !(got.errs || []).length;
  const detail = `label="${got.withVatLabel}" (ждали ${expectPct}), vatLine="${got.vatLine}", with_vat_input=${got.withVatInput}, no_vat_input=${got.noVatInput}, overlayCount=${got.overlayCount}`;
  return { ok: labelOk && lineOk && noNaN && noErr, detail, got };
}

/**
 * Открыть модалку, (опционально) ввести суммы, нажать «Сохранить» и перехватить PATCH смены
 * статуса. Нужен для класса «уже поданный тендер»: дефект (D-243, лицо 7) проявлялся не в
 * подписи, а в ДЕНЬГАХ — сохранённая 20 %-пара переотправлялась как есть с меткой ставки 22 %.
 * Возвращает тело PATCH и то, что реально было показано в полях (до правок).
 */
async function submitFromModal(page, row, edits) {
  return page.evaluate(async ({ row, edits }) => {
    const tab = window.AsgardRegistryTab;
    const calls = [];
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (/\/api\/tenders\/registry\/\d+\/status$/.test(u) && (opts && opts.method) === 'PATCH') {
        calls.push({ url: u, body: JSON.parse(opts.body || '{}') });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(url, opts);
    };
    try {
      try { window.AsgardUI.closeModal(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 420));
      await tab._test.openStatusModal(row);
      await new Promise((r) => setTimeout(r, 150));
      const overlays = [...document.querySelectorAll('.cr-m-overlay:not(.cr-m-overlay--leaving)')];
      const root = overlays[overlays.length - 1];
      if (!root) return { calls, err: 'модалка не открылась' };
      const pick = root.querySelector('#regStatusPick');
      pick.value = 'подались';
      pick.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 80));
      const ex = root.querySelector('#regSubEx');
      const wv = root.querySelector('#regSubWith');
      const shownEx = ex.value, shownWith = wv.value;
      if (edits && edits.ex != null) { ex.value = edits.ex; ex.dispatchEvent(new Event('input')); }
      if (edits && edits.with != null) { wv.value = edits.with; wv.dispatchEvent(new Event('input')); }
      await new Promise((r) => setTimeout(r, 120));
      const vatLine = (root.querySelector('#regSubVatLine') || {}).textContent || '';
      const btn = root.querySelector('#regStatusSave');
      if (!btn) return { calls, err: 'нет кнопки #regStatusSave' };
      btn.click();
      await new Promise((r) => setTimeout(r, 500));
      return { calls, shownEx, shownWith, vatLine };
    } finally {
      window.fetch = realFetch;
      try { window.AsgardUI.closeModal(); } catch (_) {}
    }
  }, { row, edits: edits || {} });
}

// ── main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n── Гейт D-243: НДС модалки «Подались» из настроек ────────');
  console.log(`   BASE=${BASE}  DB=${DB_NAME}  tender=#${TENDER_ID}\n`);

  const health = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
  if (!health || health.status !== 'ok') {
    console.log(`${C.red}Нет стенда${C.off} на ${BASE} — подними приложение-двойник на клоне:`);
    console.log(`  $env:DB_NAME='asgard_crm_test'; $env:PORT='3100'; node src/index.js`);
    process.exit(2);
  }

  let playwright;
  try { playwright = require('playwright'); } catch (_) {
    console.log('SKIP  Playwright недоступен'); process.exit(2);
  }

  const snapSetting = await dbSetting();
  const snapTender = await dbTender();
  if (!snapTender) { console.log(`Нет тендера #${TENDER_ID} в клоне`); process.exit(2); }
  console.log(`   клон до прогона: ${SETTING_KEY}=${snapSetting}, tenders.vat_pct=#${TENDER_ID}:${snapTender.vat_pct}`);
  console.log(`   (настройка и карточка ${String(snapSetting) === String(snapTender.vat_pct) ? 'СОВПАДАЮТ — тест на них не различает источник' : 'РАЗНЫЕ — тест различает источник'})\n`);

  const auth = await login('test_admin', 'Test123!', '0000');
  const scriptPath = process.env.REGISTRY_TAB_PATH || null;
  const mutantSrc = scriptPath ? fs.readFileSync(scriptPath, 'utf8') : null;
  const moneyPath = process.env.MONEY_FMT_PATH || null;
  const moneyMutantSrc = moneyPath ? fs.readFileSync(moneyPath, 'utf8') : null;
  console.log(`   registry_tab.js: ${scriptPath ? 'ПОДМЕНЁН на ' + scriptPath + ' (mutation-контроль)' : 'рабочий (HEAD)'}`);
  console.log(`   money_fmt.js:    ${moneyPath ? 'ПОДМЕНЁН на ' + moneyPath + ' (mutation-контроль)' : 'рабочий (HEAD)'}\n`);

  const browser = await playwright.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_pin_verified', 'true');
    localStorage.setItem('pin_unlocked_at', String(Date.now()));
    localStorage.setItem('asgard_presence_ok', '1');
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
    localStorage.setItem('asgard_academy_nag_dismissed', '1');
    localStorage.setItem('_v_dismissed', window.ASGARD_SHELL_VERSION || '20.28.46');
    localStorage.setItem('_v_reloaded_for', window.ASGARD_SHELL_VERSION || '20.28.46');
  }, auth);

  const page = await context.newPage();
  global.__page = page;

  // Строка, у которой карточка и настройка ГАРАНТИРОВАННО разные, иначе тест не различает
  // источник: карточка = 20 (как 1401 строка прода). Если код читает карточку — увидим 20.
  const row = {
    id: TENDER_ID,
    registry_status: 'готовим',
    customer_name: 'Гейт D-243',
    tender_title: 'Проверка ставки НДС из настроек',
    tender_price: 1000000,
    vat_pct: 20,
    docs_deadline: snapTender.docs_deadline,
    participation_paid: false,
    rp_review: { work_price: 1000000 },
  };
  global.__row = row;

  // Подменяем ТОЛЬКО сетевой источник реестра (модалка — настоящая), чтобы стенд
  // не зависел от наполнения клона и не собирал гонок со refresh().
  await page.route('**/api/tenders/registry**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        items: [global.__row], total: 1, subtab: 'registry', period: 'current',
        statuses: [{ value: 'подались', label: 'Подались' }],
      }),
    });
  });

  // Mutation-контроль: страницу отдаёт сервер, поэтому подменяем именно ОТВЕТ сервера.
  if (mutantSrc) {
    await page.route('**/assets/js/registry_tab.js*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: mutantSrc });
    });
    page.on('response', (r) => {
      if (/assets\/js\/registry_tab\.js/.test(r.url())) {
        console.log(`   [mutation] registry_tab.js отдан подменённым (HTTP ${r.status()})`);
      }
    });
  }
  if (moneyMutantSrc) {
    await page.route('**/assets/js/money_fmt.js*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: moneyMutantSrc });
    });
    page.on('response', (r) => {
      if (/assets\/js\/money_fmt\.js/.test(r.url())) {
        console.log(`   [mutation] money_fmt.js отдан подменённым (HTTP ${r.status()})`);
      }
    });
  }

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  try {
    await page.goto(BASE + '/?nocache=' + Date.now() + '#/tenders', { waitUntil: 'commit', timeout: 60000 });
    await page.waitForTimeout(2500);
    const hasTab = await page.evaluate(() => ({
      tab: !!window.AsgardRegistryTab,
      test: !!(window.AsgardRegistryTab && window.AsgardRegistryTab._test),
      open: !!(window.AsgardRegistryTab && window.AsgardRegistryTab._test && window.AsgardRegistryTab._test.openStatusModal),
    }));
    if (!hasTab.test || !hasTab.open) {
      check('стенд: AsgardRegistryTab._test доступен', false,
        `AsgardRegistryTab=${hasTab.tab}, _test=${hasTab.test}, openStatusModal=${hasTab.open}; pageErrors=${pageErrors.slice(0, 3).join(' | ') || '—'}`);
      throw new Error('стенд не поднялся');
    }
    check('стенд: AsgardRegistryTab._test доступен', true, 'page.evaluate → ок');

    // ── V1: настройка 22 при карточке 20 ──
    let r = await scenario({ pctRaw: '22', expectPct: 22, row });
    check('V1 настройка 22 % → модалка показывает 22 % (карточка 20 игнорируется)', r.ok, r.detail);

    // ── V2: настройка 20 ──
    r = await scenario({ pctRaw: '20', expectPct: 20, row });
    check('V2 настройка 20 % → модалка показывает 20 %', r.ok, r.detail);

    // ── V3: краевой случай — 0 % ──
    r = await scenario({ pctRaw: '0', expectPct: 0, row });
    check('V3 краевой: настройка 0 % → «С НДС 0%», без NaN в полях', r.ok, r.detail);

    // ── V4: мусор в настройке → честный fallback 22 %, без JS-ошибок ──
    r = await scenario({ pctRaw: '"abc"', expectPct: 22, row });
    check('V4 мусор/нечисло в настройке → fallback 22 % (не 20 из карточки, не NaN)', r.ok, r.detail);

    // ── V5: деньги — «подались» пишет суммы по ставке из настроек ──
    await dbSetSetting('22');
    const moneyRes = await page.evaluate(async (row) => {
      const tab = window.AsgardRegistryTab;
      const calls = [];
      const realFetch = window.fetch;
      window.fetch = async (url, opts) => {
        const u = String(url);
        // Реальный путь смены статуса: PATCH /api/tenders/registry/:id/status
        // (registry_api.js: patchRegistryStatus → '/status'). Ловим именно его.
        if (/\/api\/tenders\/registry\/\d+\/status$/.test(u) && (opts && opts.method) === 'PATCH') {
          calls.push({ url: u, body: JSON.parse(opts.body || '{}') });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return realFetch(url, opts);
      };
      try {
        try { window.AsgardUI.closeModal(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 420));
        await tab._test.openStatusModal(row);
        await new Promise((res) => setTimeout(res, 150));
        const overlays = [...document.querySelectorAll('.cr-m-overlay:not(.cr-m-overlay--leaving)')];
        const root = overlays[overlays.length - 1];
        if (!root) return { calls, err: 'модалка не открылась' };
        const pick = root.querySelector('#regStatusPick');
        pick.value = 'подались';
        pick.dispatchEvent(new Event('change'));
        await new Promise((res) => setTimeout(res, 120));
        const ex = root.querySelector('#regSubEx');
        const wv = root.querySelector('#regSubWith');
        ex.value = '1000000';
        ex.dispatchEvent(new Event('input'));
        await new Promise((res) => setTimeout(res, 80));
        const computedWithVat = wv.value;
        const btn = root.querySelector('#regStatusSave');
        if (!btn) return { calls, computedWithVat, err: 'нет кнопки #regStatusSave' };
        btn.click();
        await new Promise((res) => setTimeout(res, 500));
        return { calls, computedWithVat };
      } finally {
        window.fetch = realFetch;
        try { window.AsgardUI.closeModal(); } catch (_) {}
      }
    }, row);

    const patch = (moneyRes.calls || []).find((c) => c.body && c.body.registry_status === 'подались');
    const noVat = patch && Number(patch.body.submission_price);
    const withVat = patch && Number(patch.body.submission_price_with_vat);
    const wantWith = 1220000;
    check('V5 «подались» шлёт сумму с НДС по ставке из настроек (1 000 000 → 1 220 000)',
      !!patch && noVat === 1000000 && Math.abs(withVat - wantWith) < 1,
      patch ? `submission_price=${noVat}, submission_price_with_vat=${withVat} (ждали ${wantWith}), vat_pct=${patch.body.vat_pct}`
            : `PATCH не ушёл; computedWithVat=${moneyRes.computedWithVat}; err=${moneyRes.err || '-'}; calls=${JSON.stringify(moneyRes.calls || []).slice(0, 120)}`);

    // ── V6: УЖЕ поданный тендер с сохранённой 20 %-парой (лицо 7 верификатора) ──
    // Карточка: submission_price=111, submission_price_with_vat=135 (эпоха 20 %), vat_pct=20.
    // Настройка 22. Прежний дефект: модалка переотправляла пару 111/135 как есть с vat_pct=22
    // (отношение 1.2162 ≠ 1.22) — молчаливая несогласованность денег и метки ставки.
    // Ожидание: база без НДС сохраняется (111), сумма с НДС ПЕРЕСЧИТЫВАЕТСЯ по ставке → 135.42.
    await dbSetSetting('22');
    const legacyRow = {
      id: TENDER_ID, registry_status: 'подались', customer_name: 'Гейт D-243 (legacy 20%)',
      tender_title: 'Уже поданный тендер, сохранённая 20 %-пара', tender_price: null, vat_pct: 20,
      submission_price: 111, submission_price_with_vat: 135,
      docs_deadline: snapTender.docs_deadline, participation_paid: false, rp_review: {},
    };
    const legacyRes = await submitFromModal(page, legacyRow, {});
    const lPatch = (legacyRes.calls || []).find((c) => c.body && c.body.registry_status === 'подались');
    const wantLegacyWith = 135.42; // 111 × 1.22
    check('V6 уже поданный с 20 %-парой: сохранённая сумма с НДС пересчитана по ставке настроек',
      !!lPatch && Number(lPatch.body.submission_price) === 111
        && Math.abs(Number(lPatch.body.submission_price_with_vat) - wantLegacyWith) < 0.01
        && Number(lPatch.body.vat_pct) === 22,
      lPatch ? `submission_price=${lPatch.body.submission_price}, submission_price_with_vat=${lPatch.body.submission_price_with_vat} (ждали ${wantLegacyWith}), vat_pct=${lPatch.body.vat_pct}`
             : `PATCH не ушёл; shownEx=${legacyRes.shownEx}, shownWith=${legacyRes.shownWith}, err=${legacyRes.err || '-'}`);

    // ── V7: у поданного сохранена ТОЛЬКО сумма без НДС → поле «С НДС» не пустое ──
    // Прежний дефект: suggestSubmissionPrices не ставил withVat (suggested.withVat == null),
    // модалка открывалась с пустым «С НДС», а сохранение без правок слало придуманную сумму.
    const baseOnlyRow = {
      id: TENDER_ID, registry_status: 'подались', customer_name: 'Гейт D-243 (только база)',
      tender_title: 'Сохранена только сумма без НДС', tender_price: null, vat_pct: 20,
      submission_price: 1000000, submission_price_with_vat: null,
      docs_deadline: snapTender.docs_deadline, participation_paid: false, rp_review: {},
    };
    const baseOnlyRes = await submitFromModal(page, baseOnlyRow, {});
    const bPatch = (baseOnlyRes.calls || []).find((c) => c.body && c.body.registry_status === 'подались');
    check('V7 сохранена только сумма без НДС → «С НДС» заполнена и PATCH согласован (1 000 000 → 1 220 000)',
      String(baseOnlyRes.shownWith || '') !== '' && !!bPatch
        && Number(bPatch.body.submission_price) === 1000000
        && Math.abs(Number(bPatch.body.submission_price_with_vat) - 1220000) < 1,
      `shown_with="${baseOnlyRes.shownWith}", patch=${bPatch ? bPatch.body.submission_price + '/' + bPatch.body.submission_price_with_vat : 'нет'}`);

    check('   JS-ошибок на странице нет', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (e) {
    check('прогон гейта завершился без исключения', false, e.message);
  } finally {
    // Всегда возвращаем клон в исходное состояние.
    try { await dbSetSetting(snapSetting == null ? JSON.stringify(RESTORE_PCT) : snapSetting); } catch (_) {}
    try { await dbRestoreTender(snapTender); } catch (_) {}
    await browser.close().catch(() => {});
    await pool.end().catch(() => {});
  }

  console.log('\n── Итог ─────────────────────────────────────────────────');
  console.log(failed ? `${C.red}FAIL${C.off} — ${failed} проверок не прошло (${results.length - failed}/${results.length})`
                     : `${C.green}OK${C.off} — ${results.length}/${results.length}: ставка НДС берётся из настроек`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', (e && e.stack) || e); process.exit(1); });
