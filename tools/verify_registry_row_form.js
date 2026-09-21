#!/usr/bin/env node
/**
 * verify_registry_row_form.js — repro/регресс-гейт формы «Новая строка реестра» (D-198).
 *
 * Зачем: форма монтируется на НАСТОЯЩИХ vanilla-скриптах (ui.js + registry_api.js +
 * registry_tab.js) с подменённым API — только так видно, что после создания строки
 * экран «Загрузите документы» перерисовывается ИЗ ОБЪЕКТА row, в который введённые
 * значения не перенесены. Статический grep этого не ловит.
 *
 * Гейты (все обязаны быть зелёными, иначе exit 1):
 *   R1 после «Добавить» открывается экран «Загрузите документы · строка #<id>»
 *   R2 заказчик из формы создания сохранён на экране документов
 *   R3 тендер сохранён
 *   R4 НМЦ сохранён
 *   R5 срок подачи сохранён
 *   R6 при СОЗДАНИИ поля доступны для ввода (не disabled)
 *   R7 строка создаётся РОВНО ОДИН раз (повторный «Сохранить» не плодит дубли)
 *   R8 «Сохранить» уходит на реальный id (/registry/<id>), а не на /undefined
 *   R9 id, который вернул бэк, доехал до экрана и до bindRegistryDocs
 *
 * Mutation-тест (доказательство честности гейта):
 *   REGISTRY_TAB_PATH=<другой registry_tab.js> node tools/verify_registry_row_form.js
 *   На коде HEAD (до фикса D-198) гейт обязан упасть.
 *
 * Использование: node tools/verify_registry_row_form.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? C.green + 'PASS' : C.red + 'FAIL'}${C.off}  ${name}${detail ? C.dim + '  — ' + detail + C.off : ''}`);
}

function fileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20');
}

function scriptTags() {
  // Порядок как в проде: ui.js → registry_api.js → (подмена API) → registry_tab.js.
  const names = [
    'assets/js/ui.js',
    'assets/js/money_fmt.js',
    'assets/js/registry_api.js',
    // Модалки нужны стенду: без них openRpReviewModal() не может выбрать режим,
    // и нельзя проверить, редактируемо ли открывается анализ хозяину (B5).
    'assets/js/rp_calc_modal.js',
    'assets/js/rp_review_modal.js'
  ];
  const before = names.map((rel) => {
    const abs = path.join(PUBLIC, rel);
    if (!fs.existsSync(abs)) throw new Error('Нет файла ' + rel);
    return `<script src="${fileUrl(abs)}"></script>`;
  }).join('\n');
  const tab = process.env.REGISTRY_TAB_PATH
    ? path.resolve(process.env.REGISTRY_TAB_PATH)
    : path.join(PUBLIC, 'assets/js/registry_tab.js');
  return before + '\n' + OVERRIDE_SCRIPT + '\n' + `<script src="${fileUrl(tab)}"></script>`;
}

/**
 * Подмена API ПОСЛЕ registry_api.js, но ДО registry_tab.js: модуль захватывает
 * `AsgardRegistryApi` в константу на этапе IIFE, поэтому позже переопределять бесполезно.
 * Реальные fmtDate/fmtDateIso/REGISTRY_STATUSES/buildRegistryPeriodOptions оставляем.
 */
const OVERRIDE_SCRIPT = `<script>
(function () {
  window.__calls = [];
  window.__docsBound = [];
  window.__nextId = 970001;

  // Модалки в стенде грузим настоящие (нужно для B5), но открытие перехватываем:
  // иначе file://-стенд уйдёт в сеть за /api/... и получит ERR_FILE_NOT_FOUND.
  window.__rpOpened = [];
  if (window.AsgardRpReviewModal && typeof window.AsgardRpReviewModal.open === 'function') {
    window.AsgardRpReviewModal.open = function (row, pms, cb, opts) {
      window.__rpOpened.push({
        readOnly: !!(opts && opts.readOnly),
        role: (opts && opts.role) || '',
        mode: (opts && opts.mode) || ''
      });
    };
  }

  const real = window.AsgardRegistryApi || {};

  function ok(v) { return Promise.resolve(v); }

  // Перехват тостов: по тексту отличаем «прав нет» от «срок обновлён» (D-237).
  window.__toasts = [];
  const realToast = (window.AsgardUI && window.AsgardUI.toast) || function () {};
  if (window.AsgardUI) {
    window.AsgardUI.toast = function (title, msg, type) {
      window.__toasts.push({ title: String(title || ''), msg: String(msg || ''), type: String(type || '') });
      try { return realToast.apply(this, arguments); } catch (e) {}
    };
  }

  window.AsgardRegistryApi = Object.assign({}, real, {
    loadUsers: function () { return ok([]); },
    loadRegistry: function () { return ok({ items: window.__FIXTURE_ROWS || [], total: (window.__FIXTURE_ROWS || []).length }); },
    loadPmDutyCurrent: function () { return ok({}); },
    suggestCustomers: function () { return ok([]); },
    markRegistryReviewSeen: function () { return ok({ ok: true }); },
    loadRegistryHistory: function () { return ok({ items: [] }); },
    loadRpReview: function () { return ok({ review: null, items: [] }); },
    saveRpReview: function () { return ok({ ok: true }); },
    loadRpChecklist: function () { return ok({ template: [], answers: {}, free_answers: [], checklist: null }); },
    loadAnalysisChecklist: function () { return ok({ template: [], answers: {}, free_answers: [], checklist: null }); },
    createRegistryWork: function () { return ok({ ok: true }); },
    assignRegistryCalculator: function () { return ok({ ok: true }); },
    archiveRegistryRow: function () { return ok({ ok: true }); },

    assignRegistryAnalysis: function (id) {
      window.__calls.push({ url: '/api/tenders/registry/' + id + '/assign-analysis', method: 'POST' });
      return ok({ ok: true, analysis_owner_name: 'Тест ТО' });
    },

    findRegistryDuplicates: function () {
      window.__calls.push({ url: '/api/tenders/registry/find-duplicates', method: 'GET' });
      return ok({ items: [] });
    },

    // Бэк отвечает INSERT ... RETURNING * — то есть полным объектом тендера.
    // Значения намеренно РЕАЛИСТИЧНЫЕ: если фронт их проигнорирует, гейт это увидит.
    createRegistryRow: function (body) {
      const id = window.__nextId++;
      window.__calls.push({ url: '/api/tenders/registry', method: 'POST', body: body, id: id });
      return ok({
        tender: {
          id: id,
          customer_name: body && body.customer_name,
          customer_inn: body && body.customer_inn,
          tender_title: body && body.tender_title,
          tender_price: body && body.tender_price,
          docs_deadline: body && body.docs_deadline,
          purchase_url: body && body.purchase_url,
          comment_to: body && body.comment_to,
          registry_status: (body && body.registry_status) || 'рассмотрение',
          participation_paid: !!(body && body.participation_paid),
          participation_fee: (body && body.participation_fee) || null,
          analysis_deadline: '2026-12-01',
          created_at: '2026-09-20T10:00:00.000Z'
        }
      });
    },

    patchRegistryField: function (id, field, value) {
      window.__calls.push({ url: '/api/tenders/registry/' + id, method: 'PATCH', field: field, value: value });
      return ok({ ok: true });
    },
    patchRegistryStatus: function (id, body) {
      window.__calls.push({ url: '/api/tenders/registry/' + id + '/status', method: 'PATCH', body: body });
      return ok({ ok: true });
    },

    bindRegistryDocs: function (root, tenderId) {
      window.__docsBound.push(tenderId);
      return ok({ ok: true });
    }
  });
})();
</script>`;

function cssTags() {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*?\bhref\s*=\s*["']([^"']+\.css)(?:\?[^"']*)?["']/gi)) {
    const rel = m[1].replace(/^\.?\//, '');
    if (/^https?:/i.test(rel)) continue;
    const abs = path.join(PUBLIC, rel);
    if (fs.existsSync(abs) && !out.includes(abs)) out.push(abs);
  }
  return out.map((p) => `<link rel="stylesheet" href="${fileUrl(p)}">`).join('\n');
}

function harness(userRole) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
${cssTags()}
<style>html,body{margin:0}body{background:#0b0f14;color:#e6e8ee;font-family:sans-serif}</style>
</head><body>
<div id="tab"></div>
<script>
  try {
    localStorage.setItem('asgard_user', JSON.stringify({ id: 42, login: 'to.test', name: 'Тест ТО', role: ${JSON.stringify(userRole)} }));
    localStorage.setItem('asgard_token', 'test-token');
  } catch (e) {}
</script>
${scriptTags()}
</body></html>`;
}

const FIXTURE = path.join(os.tmpdir(), 'asgard-registry-row-form.html');
fs.writeFileSync(FIXTURE, harness('TO'), 'utf8');

const FILL = {
  customer: 'ООО «Ромашка»',
  inn: '7701234567',
  title: 'Капремонт кровли цеха №5',
  price: '1250000',
  deadline: '2026-12-20'
};

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error(C.red + 'Не найден playwright' + C.off);
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  // Шрифты `/assets/fonts/inter*.woff2` в harness'е на file:// ищутся от корня диска
  // (C:/assets/...) и дают 4 ERR_FILE_NOT_FOUND. Это артефакт file://-стенда, не код —
  // отфильтровываем по URL ресурса, чтобы не глушить настоящие ошибки страницы.
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const u = (m.location() && m.location().url) || '';
    if (/\/assets\/fonts\//.test(u)) return;
    errors.push('console: ' + m.text() + (u ? ' @ ' + u : ''));
  });

  await page.goto(fileUrl(FIXTURE));
  await page.waitForTimeout(200);

  const hasTab = await page.evaluate(() => !!(window.AsgardRegistryTab && window.AsgardRegistryTab.mount));
  check('R0 registry_tab.js загружен', hasTab, hasTab ? 'AsgardRegistryTab.mount есть' : 'модуль не найден');
  if (!hasTab) {
    await browser.close();
    process.exit(1);
  }

  await page.evaluate(() => window.AsgardRegistryTab.mount(document.getElementById('tab'), {}));
  await page.waitForTimeout(200);

  // Открываем форму создания строки (кнопка тулбара «+ Строка»).
  const opened = await page.evaluate(() => {
    const btn = document.getElementById('regAddRow') || document.getElementById('regAddRowEmpty');
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('R0a форма «Новая строка реестра» открыта', opened, opened ? '#regAddRow нажат' : 'кнопка не найдена');
  await page.waitForTimeout(150);

  const formShown = await page.evaluate(() => !!document.querySelector('#regFormCustomer'));
  check('R0b поля формы созданы', formShown, formShown ? '#regFormCustomer есть' : 'поля нет');
  if (!formShown) {
    console.log(C.dim + 'ошибки страницы: ' + JSON.stringify(errors) + C.off);
    await browser.close();
    process.exit(1);
  }

  // Заполняем как живой ТО.
  await page.evaluate((F) => {
    const cust = document.getElementById('regFormCustomer');
    cust.value = F.customer;
    cust.dataset.inn = F.inn;
    document.getElementById('regFormTitle').value = F.title;
    document.getElementById('regFormPrice').value = F.price;
    document.getElementById('regFormDeadline').value = F.deadline;
  }, FILL);

  // R6: при СОЗДАНИИ поля доступны для ввода. Immutable-логика D-189 (серая карточка)
  // работает только для уже заведённого тендера и не должна мешать заводить новый.
  const onCreate = await page.evaluate(() => {
    const ids = ['regFormCustomer', 'regFormTitle', 'regFormPrice', 'regFormDeadline'];
    return ids.map((id) => {
      const el = document.getElementById(id);
      return { id: id, present: !!el, disabled: !!(el && el.disabled) };
    });
  });
  check('R6 при создании поля доступны для ввода',
    onCreate.every((f) => f.present) && onCreate.every((f) => !f.disabled),
    onCreate.map((f) => f.id + (f.disabled ? '=locked' : '=ok')).join(', '));

  // Создаём строку.
  await page.evaluate(() => document.getElementById('regFormSave').click());
  await page.waitForTimeout(300);

  const afterCreate = await page.evaluate(() => {
    const v = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      return { value: el.value, disabled: !!el.disabled };
    };
    return {
      modalTitle: (document.getElementById('modalTitle') || {}).textContent || '',
      modalCount: document.querySelectorAll('.cr-m-overlay').length,
      customer: v('regFormCustomer'),
      title: v('regFormTitle'),
      price: v('regFormPrice'),
      deadline: v('regFormDeadline'),
      docsHost: !!document.getElementById('regDocsHost'),
      calls: window.__calls.slice()
    };
  });

  const createCall = afterCreate.calls.find((c) => c.method === 'POST');
  const newId = createCall && createCall.id;

  check('R1 открыт экран «Загрузите документы»',
    /Загрузите документы/.test(afterCreate.modalTitle),
    'title=' + JSON.stringify(afterCreate.modalTitle));

  check('R2 заказчик сохранён на экране документов',
    !!afterCreate.customer && afterCreate.customer.value === FILL.customer,
    'ожидали ' + JSON.stringify(FILL.customer) + ', получили ' + JSON.stringify(afterCreate.customer && afterCreate.customer.value));

  check('R3 тендер сохранён',
    !!afterCreate.title && afterCreate.title.value === FILL.title,
    'ожидали ' + JSON.stringify(FILL.title) + ', получили ' + JSON.stringify(afterCreate.title && afterCreate.title.value));

  check('R4 НМЦ сохранена',
    !!afterCreate.price && String(afterCreate.price.value) === FILL.price,
    'ожидали ' + JSON.stringify(FILL.price) + ', получили ' + JSON.stringify(afterCreate.price && afterCreate.price.value));

  check('R5 срок подачи сохранён',
    !!afterCreate.deadline && afterCreate.deadline.value === FILL.deadline,
    'ожидали ' + JSON.stringify(FILL.deadline) + ', получили ' + JSON.stringify(afterCreate.deadline && afterCreate.deadline.value));

  // R7: повторное нажатие «Сохранить» на экране документов НЕ должно создавать новую строку.
  // Это и есть дефект «дубль»: isNew не сбрасывался и уходил второй POST.
  const beforeSave = await page.evaluate(() => window.__calls.length);
  const saved = await page.evaluate(() => {
    const btn = document.getElementById('regFormSave');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await page.waitForTimeout(350);

  const afterSaveCalls = await page.evaluate((n) => window.__calls.slice(n), beforeSave);
  const postAgain = afterSaveCalls.filter((c) => c.method === 'POST');
  const badUrl = afterSaveCalls.find((c) => c.method === 'PATCH' && /\/undefined$/.test(c.url));
  check('R7 строка создаётся ровно один раз (нет дубля по повторному «Сохранить»)',
    saved && postAgain.length === 0,
    postAgain.length ? 'ушёл повторный POST: ' + JSON.stringify(postAgain.map((c) => c.url)) : 'повторных POST нет');

  check('R8 «Сохранить» уходит на реальный id, не на /undefined',
    !badUrl,
    badUrl ? 'ушёл ' + badUrl.url : 'PATCH /undefined не зафиксирован');

  // R9: id, который вернул бэк, доехал до заголовка и до bindRegistryDocs.
  const boundIds = await page.evaluate(() => window.__docsBound);
  check('R9 id с бэка доехал до экрана и до bindRegistryDocs',
    !!newId && newId > 0 && /#\s*970001/.test(afterCreate.modalTitle) &&
    boundIds.length > 0 && boundIds.every((v) => Number.isFinite(Number(v)) && Number(v) > 0),
    'id=' + newId + ', title=' + JSON.stringify(afterCreate.modalTitle) + ', bindRegistryDocs=' + JSON.stringify(boundIds));

  if (errors.length) console.log(C.dim + 'ошибки страницы: ' + JSON.stringify(errors.slice(0, 6)) + C.off);

  // ─────────────────── Шаг B/D: сам-анализ ТО + ФИО аналитика ───────────────
  // Отдельная страница: в реестре одна «рассмотренная» строка, аналитик известен.
  const page2 = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors2 = [];
  page2.on('pageerror', (e) => errors2.push(String((e && e.message) || e)));
  page2.on('console', (m) => {
    if (m.type() !== 'error') return;
    const u = (m.location() && m.location().url) || '';
    if (/\/assets\/fonts\//.test(u)) return;
    errors2.push('console: ' + m.text() + (u ? ' @ ' + u : ''));
  });
  await page2.goto(fileUrl(FIXTURE));
  await page2.waitForTimeout(200);
  await page2.evaluate(() => {
    window.__FIXTURE_ROWS = [{
      id: 960001,
      registry_no: 960001,
      customer_name: 'ООО «Тест-Аналитик»',
      tender_title: 'Обследование узла',
      tender_price: 500000,
      docs_deadline: '2026-12-15',
      registry_status: 'рассмотрение',
      analyst_name: 'Пётр Петров',
      calculator_user_name: '',
      participation_paid: false,
      created_at: '2026-09-19T10:00:00.000Z',
      rp_review: null
    }];
    window.AsgardRegistryTab.mount(document.getElementById('tab'), {});
  });
  await page2.waitForTimeout(300);

  const rd = await page2.evaluate(() => {
    const head = Array.from(document.querySelectorAll('.reg-table thead th')).map((th) => th.textContent.trim());
    const row = document.querySelector('.reg-table tbody tr');
    const selfBtn = row ? row.querySelector('.reg-analysis-self') : null;
    return {
      head: head,
      hasSelfBtn: !!selfBtn,
      analystCells: row ? Array.from(row.children).map((td) => td.textContent.trim()).indexOf('Пётр Петров') : -1,
      rowText: row ? row.textContent : ''
    };
  });

  check('B1 колонка «Аналитик» есть в шапке', rd.head.includes('Аналитик'), 'шапка: ' + JSON.stringify(rd.head.slice(0, 20)));
  check('B2 ФИО аналитика отрисовано в строке', rd.analystCells >= 0, 'Пётр Петров найден в td #' + rd.analystCells);
  check('B3 кнопка «Анализирую сам» доступна ТО',
    rd.hasSelfBtn && /Анализирую сам/.test(rd.rowText),
    rd.hasSelfBtn ? '.reg-analysis-self отрисована' : 'кнопки нет');

  // Клик по кнопке → POST /assign-analysis
  await page2.evaluate(() => {
    const b = document.querySelector('.reg-table .reg-analysis-self');
    if (b) b.click();
  });
  await page2.waitForTimeout(250);
  const call2 = await page2.evaluate(() => (window.__calls || []).find((c) => /assign-analysis/.test(c.url)));
  check('B4 «Анализирую сам» уходит на POST /assign-analysis',
    !!call2 && call2.method === 'POST', call2 ? call2.method + ' ' + call2.url : 'вызова нет');

  if (errors2.length) console.log(C.dim + 'ошибки страницы 2: ' + JSON.stringify(errors2.slice(0, 6)) + C.off);

  // ─────────── Шаг B2: ТО, взявший анализ, может вернуться и править его ───────────
  // Строка, где хозяин анализа — САМ ТО (владелец помечен в аналитике).
  // Открытие такой строки обязано быть редактируемым, иначе ТО не сможет вернуться
  // к своему анализу и заполнить чек-лист (клик по «Открыть» из ячейки «Отчёт»).
  const page3 = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors3 = [];
  page3.on('pageerror', (e) => errors3.push(String((e && e.message) || e)));
  page3.on('console', (m) => {
    if (m.type() !== 'error') return;
    const u = (m.location() && m.location().url) || '';
    if (/\/assets\/fonts\//.test(u)) return;
    errors3.push('console: ' + m.text() + (u ? ' @ ' + u : ''));
  });
  await page3.goto(fileUrl(FIXTURE));
  await page3.waitForTimeout(200);
  await page3.evaluate(() => {
    window.__FIXTURE_ROWS = [{
      id: 960077,
      registry_no: 960077,
      customer_name: 'ООО «Свой анализ»',
      tender_title: 'Обследование и дефектовка',
      tender_price: 300000,
      docs_deadline: '2026-12-20',
      registry_status: 'рассмотрение',
      // Аналитик = сам ТО (id 42 в стенде) — он взял анализ кнопкой «Анализирую сам».
      analyst_name: 'Тест ТО',
      analysis_owner_user_id: 42,
      calculator_user_name: '',
      participation_paid: false,
      created_at: '2026-09-20T10:00:00.000Z',
      rp_review: { analysis_owner_user_id: 42, analysis_finalized_at: null, is_final: false, report_json: '{"mode":"analysis"}' }
    }];
    window.AsgardRegistryTab.mount(document.getElementById('tab'), {});
  });
  await page3.waitForTimeout(300);

  // Кликаем по «Открыть» из ячейки «Отчёт» — открытие уже перехвачено OVERRIDE_SCRIPT.
  await page3.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.reg-rp-view')).find((b) => b.textContent.trim() === 'Открыть')
      || document.querySelector('.reg-rp-view');
    if (btn) btn.click();
  });
  await page3.waitForTimeout(200);
  const openedAsOwner = await page3.evaluate(() => window.__rpOpened || []);

  check('B5 ТО, ведущий анализ, открывает его редактируемым (не read-only)',
    openedAsOwner.length > 0 && openedAsOwner[openedAsOwner.length - 1].readOnly === false,
    openedAsOwner.length
      ? 'readOnly=' + openedAsOwner[openedAsOwner.length - 1].readOnly + ', role="' + openedAsOwner[openedAsOwner.length - 1].role + '"'
      : 'модалка не открылась');

  // ─────── B6 (инвариант): чужой анализ для ТО остаётся только для чтения ───────
  // Фикс B5 не должен открыть всем ТО право править анализы других.
  await page3.evaluate(() => {
    window.__rpOpened.length = 0;
    window.__FIXTURE_ROWS = [{
      id: 960078,
      registry_no: 960078,
      customer_name: 'ООО «Чужой анализ»',
      tender_title: 'Обследование',
      tender_price: 100000,
      docs_deadline: '2026-12-21',
      registry_status: 'рассмотрение',
      analyst_name: 'Пётр Петров',
      analysis_owner_user_id: 999999, // НЕ текущий пользователь (стендовый id=42)
      calculator_user_name: '',
      participation_paid: false,
      created_at: '2026-09-20T10:00:00.000Z',
      rp_review: { analysis_owner_user_id: 999999, analysis_finalized_at: null, is_final: false, report_json: '{"mode":"analysis"}' }
    }];
    window.AsgardRegistryTab.mount(document.getElementById('tab'), {});
  });
  await page3.waitForTimeout(300);
  await page3.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.reg-rp-view')).find((b) => b.textContent.trim() === 'Открыть')
      || document.querySelector('.reg-rp-view');
    if (btn) btn.click();
  });
  await page3.waitForTimeout(200);
  const openedForeign = await page3.evaluate(() => window.__rpOpened || []);
  check('B6 чужой анализ для ТО остаётся read-only (фикс B5 не расширил права)',
    openedForeign.length > 0 && openedForeign[openedForeign.length - 1].readOnly === true,
    openedForeign.length
      ? 'readOnly=' + openedForeign[openedForeign.length - 1].readOnly + ', role="' + openedForeign[openedForeign.length - 1].role + '"'
      : 'модалка не открылась');

  if (errors3.length) console.log(C.dim + 'ошибки страницы 3: ' + JSON.stringify(errors3.slice(0, 6)) + C.off);

  // ─────────── Шаг C: ТО правит срок подачи инлайн (D-237) ───────────
  // Раньше ячейка срока была «серой» (immutable для всех, кроме ADMIN): ТО не мог
  // продлить срок, хотя заказчик переносит даты регулярно. Теперь это рабочее поле ТО.
  const page4 = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors4 = [];
  page4.on('pageerror', (e) => errors4.push(String((e && e.message) || e)));
  page4.on('console', (m) => {
    if (m.type() !== 'error') return;
    const u = (m.location() && m.location().url) || '';
    if (/\/assets\/fonts\//.test(u)) return;
    errors4.push('console: ' + m.text() + (u ? ' @ ' + u : ''));
  });
  await page4.goto(fileUrl(FIXTURE));
  await page4.waitForTimeout(200);
  await page4.evaluate(() => {
    window.__FIXTURE_ROWS = [{
      id: 960090,
      registry_no: 960090,
      customer_name: 'ООО «Сроки»',
      tender_title: 'Перенос сроков подачи',
      tender_price: 400000,
      docs_deadline: '2026-12-25',
      registry_status: 'рассмотрение',
      participation_paid: false,
      created_at: '2026-09-20T10:00:00.000Z',
      rp_review: null
    }];
    window.AsgardRegistryTab.mount(document.getElementById('tab'), {});
  });
  await page4.waitForTimeout(300);

  const cellState = await page4.evaluate(() => {
    const cell = document.querySelector('.reg-deadline-cell');
    if (!cell) return { hasCell: false };
    return { hasCell: true, cls: cell.className, title: cell.getAttribute('title'), dataId: cell.dataset.id };
  });
  check('C2 ячейка срока подачи у ТО редактируема (не reg-deadline-readonly)',
    cellState.hasCell && !/reg-deadline-readonly/.test(cellState.cls),
    cellState.hasCell ? 'class=' + JSON.stringify(cellState.cls) + ', title=' + JSON.stringify(cellState.title) : 'ячейки нет');

  await page4.evaluate(() => {
    const cell = document.querySelector('.reg-deadline-cell');
    if (cell) cell.click();
  });
  await page4.waitForTimeout(150);
  const inputShown = await page4.evaluate(() => !!document.querySelector('.reg-deadline-cell input.reg-deadline-inp'));
  check('C3 клик по сроку у ТО открывает инлайн-редактор',
    inputShown, inputShown ? 'input.reg-deadline-inp создан' : 'редактор не открылся');

  await page4.evaluate(() => {
    const inp = document.querySelector('.reg-deadline-cell input.reg-deadline-inp');
    if (!inp) return;
    inp.value = '2027-01-15';
    inp.dispatchEvent(new Event('blur'));
  });
  await page4.waitForTimeout(400);
  const dlCall = await page4.evaluate(() =>
    (window.__calls || []).find((c) => c.method === 'PATCH' && c.field === 'docs_deadline'));
  check('C4 новый срок уходит PATCH docs_deadline на реальный id',
    !!dlCall && dlCall.value === '2027-01-15' && dlCall.url === '/api/tenders/registry/960090',
    dlCall ? dlCall.method + ' ' + dlCall.url + ' = ' + dlCall.value : 'вызова нет');

  // Инвариант: РП срок не правит — ячейка серая, клик объясняет, что менять может ТО/админ.
  await page4.evaluate(() => {
    localStorage.setItem('asgard_user', JSON.stringify({ id: 43, login: 'pm.test', name: 'Тест РП', role: 'PM' }));
    window.__toasts.length = 0;
    window.__FIXTURE_ROWS = [{
      id: 960091,
      registry_no: 960091,
      customer_name: 'ООО «Сроки»',
      tender_title: 'Чужой перенос',
      tender_price: 400000,
      docs_deadline: '2026-12-26',
      registry_status: 'рассмотрение',
      participation_paid: false,
      created_at: '2026-09-20T10:00:00.000Z',
      rp_review: null
    }];
    window.AsgardRegistryTab.mount(document.getElementById('tab'), {});
  });
  await page4.waitForTimeout(300);
  const pmCell = await page4.evaluate(() => {
    const cell = document.querySelector('.reg-deadline-cell');
    return cell ? { hasCell: true, cls: cell.className } : { hasCell: false };
  });
  check('C5 у РП ячейка срока остаётся read-only',
    pmCell.hasCell && /reg-deadline-readonly/.test(pmCell.cls),
    pmCell.hasCell ? 'class=' + JSON.stringify(pmCell.cls) : 'ячейки нет');

  await page4.evaluate(() => {
    const cell = document.querySelector('.reg-deadline-cell');
    if (cell) cell.click();
  });
  await page4.waitForTimeout(200);
  const pmResult = await page4.evaluate(() => ({
    input: !!document.querySelector('.reg-deadline-cell input.reg-deadline-inp'),
    toasts: window.__toasts.slice()
  }));
  check('C6 клик РП не открывает редактор и объясняет права',
    !pmResult.input && pmResult.toasts.some((t) => /ТО или администратор/.test(t.msg)),
    'input=' + pmResult.input + ', toasts=' + JSON.stringify(pmResult.toasts));

  if (errors4.length) console.log(C.dim + 'ошибки страницы 4: ' + JSON.stringify(errors4.slice(0, 6)) + C.off);

  // Консоль обязана быть чистой: ошибки страницы = FAIL (не только печать).
  check('C1 консоль без ошибок страницы (TO, все экраны)',
    errors.length === 0 && errors2.length === 0 && errors3.length === 0 && errors4.length === 0,
    errors.length || errors2.length || errors3.length || errors4.length
      ? JSON.stringify(errors.concat(errors2, errors3, errors4).slice(0, 6)) : 'ошибок нет');

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log(failed.length
    ? `${C.red}${failed.length} FAIL${C.off} из ${results.length}`
    : `${C.green}все ${results.length} PASS${C.off}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(C.red + 'FATAL: ' + (e && e.message ? e.message : e) + C.off);
  process.exit(1);
});
