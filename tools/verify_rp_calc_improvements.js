#!/usr/bin/env node
/**
 * verify_rp_calc_improvements.js — браузерный гейт доработки просчёта (D-182..D-188).
 *
 * ВНИМАНИЕ (21.09.2026, R1): стенд на `file://` с ПОДМЕНЁННЫМ API (см. строку ниже:
 * «модалка монтируется на настоящих vanilla-скриптах ... с подменённым API»).
 * Сервер и БД в проверке НЕ участвуют. Гейт честен для логики модалки, но НЕ
 * является доказательством DONE: для DONE нужна живая цепочка в chromium против
 * :3100/:3101 с ассертом по DOM и БД. См. tests/reports/COMPLETED-EVIDENCE-MAP.md.
 *
 * Зачем: замечания РП/ТО проверяются только в живом DOM. Статический grep не ловит
 * ни «смета не пересчитывается на input», ни «кнопка директора не меняет лейбл»,
 * ни «ссылок на документы нет». Здесь модалка просчёта монтируется на НАСТОЯЩИХ
 * vanilla-скриптах (ui.js + asgard_smeta.js + rp_calc_modal.js) с подменённым API.
 *
 * Гейты (все обязаны быть зелёными, иначе exit 1):
 *   A1 KPI «Чистая прибыль» и «Прибыль / чел·смен» есть в футере и в итогах сметы
 *   A2 KPI считаются от переданного income_tax (значение, а не прочерк)
 *   A3 таблица сметы: строки R8 «Маржа», R9 «Налог на прибыль», R10 «ЧИСТАЯ ПРИБЫЛЬ»
 *   A4 кнопка: при цене ниже порога — «Завершить просчёт», при цене выше — «Отправить директору»
 *   A5 порог берётся с бэка (director_threshold), хардкод 10 млн не перебивает его
 *   A6 живой пересчёт: ввод в поле параметра меняет KPI БЕЗ нажатия «Сохранить черновик»
 *   A7 автосейв: после ввода уходит PUT /rp-review (debounce), индикатор меняется
 *   A8 документы: вкладка «Файлы» показывает документы тендера со ссылками «Просмотр»/«Скачать»
 *   A9 read-only: при readOnly=true поле не пересчитывается и автосейв не уходит
 *  A10 «Открыть анализ»: кнопка есть и вызывает AsgardRpReviewModal с readOnly+viewer
 *  A11 кнопка «Сохранить черновик» не закрывает модалку (никто не требует ручного сейва)
 *
 * Использование: node tools/verify_rp_calc_improvements.js
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

function scriptTags() {
  const names = [
    'assets/js/ui.js',
    'assets/js/money_fmt.js',
    'assets/js/asgard_smeta.js',
    'assets/js/file_download.js',
  ];
  const before = names.map((rel) => {
    const abs = path.join(PUBLIC, rel);
    if (!fs.existsSync(abs)) throw new Error('Нет файла ' + rel);
    return `<script src="file:///${abs.replace(/\\/g, '/').replace(/ /g, '%20')}"></script>`;
  }).join('\n');
  const rpc = path.join(PUBLIC, 'assets/js/rp_calc_modal.js');
  return before + '\n' + OVERRIDE_SCRIPT + '\n' +
    `<script src="file:///${rpc.replace(/\\/g, '/').replace(/ /g, '%20')}"></script>`;
}

/**
 * Подмена модалки/API ДО загрузки rp_calc_modal.js: модуль захватывает
 * AsgardUI.showModal в замыкание на этапе IIFE, поэтому переопределять
 * его после загрузки бесполезно.
 */
const OVERRIDE_SCRIPT = `<script>
(function () {
  window.__calls = [];
  window.__modalHtml = null;
  window.__analysisOpenArgs = null;

  window.AsgardUI = window.AsgardUI || {};
  window.AsgardUI.showModal = function (cfg) {
    window.__modalHtml = cfg.html;
    const host = document.getElementById('modalHost');
    host.innerHTML = '<div class="cr-m-overlay modalback cr-m-overlay--visible"><div class="cr-m modal cr-m--fullscreen">' +
      '<div class="cr-m__body">' + cfg.html + '</div></div></div>';
    if (cfg.onMount) cfg.onMount();
    return { close: function () {} };
  };
  window.AsgardUI.replaceModal = function (cfg) {
    window.__modalHtml = cfg.html;
    const host = document.getElementById('modalHost');
    host.innerHTML = '<div class="cr-m-overlay modalback cr-m-overlay--visible"><div class="cr-m modal cr-m--fullscreen">' +
      '<div class="cr-m__body">' + cfg.html + '</div></div></div>';
    if (cfg.onMount) cfg.onMount();
  };
  window.AsgardUI.toast = function (title, msg) {
    window.__toasts = window.__toasts || [];
    window.__toasts.push([String(title == null ? '' : title), String(msg == null ? '' : msg)]);
  };
  window.AsgardUI.esc = function (s) { return String(s == null ? '' : s); };
  window.AsgardUI.hideModal = function () { window.__modalHidden = true; };
  window.AsgardUI.closeModal = window.AsgardUI.hideModal;
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
  return out.map((p) => `<link rel="stylesheet" href="file:///${p.replace(/\\/g, '/').replace(/ /g, '%20')}">`).join('\n');
}

const TENDER_ID = 990001;

/**
 * Смета-заготовка строится В БРАУЗЕРЕ из настоящего skeletonRows() (D-174):
 * все строки обнуляются, в блок B кладётся 1 000 000 — это «прямые», на которые
 * наценка начисляется (не материалы E, у них своя material_markup).
 * При markup=1.5: цена без НДС 1 500 000, маржа 500 000, налог 125 000, чистая 375 000.
 * При markup=2:   цена без НДС 2 000 000, маржа 1 000 000, налог 250 000, чистая 750 000.
 */
const BUILD_SEED = `function buildSeed(rowPrice) {
  const sm = window.AsgardSmeta;
  const base = { template: 'asgard_v1', meta: {}, params: {}, rows: sm.skeletonRows() };
  let est = sm.recalcAsgardSmeta(base);
  for (const r of est.rows) {
    if (r.kind !== 'line') continue;
    r.qty = 0; r.price = 0; r.override = true;
  }
  const b5 = est.rows.find((r) => r.id === 'b5');
  if (b5) { b5.qty = 1; b5.price = rowPrice; b5.override = true; }
  est.params = Object.assign({}, est.params, {
    fot_tax: 0, overhead: 0, contingency: 0,
    income_tax: 0.25, vat: 0.22,
    work_days: 10, shifts_per_day: 2, workers_per_shift: 5, masters_per_shift: 1,
    markup: 1.5
  });
  est.meta = { customer: 'Тестовый заказчик', work_start_plan: '2026-12-28', work_duration_days: 10 };
  return sm.recalcAsgardSmeta(est);
}`;

function harness(opts) {
  const o = opts || {};
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
${cssTags()}
<style>html,body{margin:0}body{background:#0b0f14;color:#e6e8ee;font-family:sans-serif}</style>
</head><body>
<div id="modalHost"></div>
${scriptTags()}
<script>
(function () {
${BUILD_SEED}
  // Цена без НДС 1 000 000 → 2 000 000 при markup=2 (ставка наценки ниже правится из теста).
  const seed = buildSeed(${o.rowPrice || 1000000});
  const tender = { id: ${TENDER_ID}, customer_name: 'Тестовый заказчик', tender_title: 'Проверка', docs_deadline: '2026-12-20' };

  const rpReviewPayload = {
    tender: tender,
    review: {
      id: 1, decision: 'submit', work_price: seed.totals.price_no_vat,
      is_final: false, is_final_owner: true, can_finalize: true,
      report_json: { mode: 'calc', asgard_smeta: seed }
    },
    director_threshold: ${o.threshold != null ? o.threshold : 10000000},
    estimate_file: { id: 11, original_name: 'смета.xlsx', filename: 'smeta.xlsx', download_url: '/uploads/rp_estimates/1/smeta.xlsx' },
    report_file: null,
    tkp_file: null,
    tender_files: [
      { id: 21, original_name: 'ТЗ.docx', type: 'Документ', filename: 'tz.docx', download_url: '/uploads/tz.docx' },
      { id: 22, original_name: 'Чертёж.pdf', type: 'Документ', filename: 'plan.pdf', download_url: '/uploads/plan.pdf' }
    ]
  };

  window.AsgardRegistryApi = {
    getRpReview: function () { return Promise.resolve(rpReviewPayload); },
    loadRpReview: function () { return Promise.resolve(rpReviewPayload); },
    saveRpReview: function (id, body) {
      window.__calls.push({ url: '/api/tenders/' + id + '/rp-review', method: 'PUT', body: body });
      return Promise.resolve({ ok: true, review: Object.assign({}, rpReviewPayload.review, { updated_at: new Date().toISOString() }) });
    },
    patchRegistryField: function () { return Promise.resolve({ ok: true }); },
    docDownloadHref: function (d) { return d.download_url || ''; }
  };

  window.AsgardRpReviewModal = {
    open: function (tender, pms, onSaved, opts) {
      window.__analysisOpenArgs = { tenderId: tender && tender.id, opts: opts || null, pmsCount: (pms || []).length };
      return { ok: true };
    }
  };
})();
</script>
</body></html>`;
}

const TALL_FILE = path.join(os.tmpdir(), 'asgard-rp-calc-improvements.html');
fs.writeFileSync(TALL_FILE, harness({ rowPrice: 1000000, threshold: 10000000 }), 'utf8');
// Цена без НДС 12 000 000 (> порога 10 млн): строка 8 000 000 при markup=1.5.
const FILE_ABOVE = path.join(os.tmpdir(), 'asgard-rp-calc-above.html');
fs.writeFileSync(FILE_ABOVE, harness({ rowPrice: 8000000, threshold: 10000000 }), 'utf8');

// Цена 3 000 000 при СВОЁМ пороге 2 500 000 с бэка: строка 2 000 000.
const FILE_CUSTOM_TH = path.join(os.tmpdir(), 'asgard-rp-calc-custom-th.html');
fs.writeFileSync(FILE_CUSTOM_TH, harness({ rowPrice: 2000000, threshold: 2500000 }), 'utf8');

const FILE_RO = path.join(os.tmpdir(), 'asgard-rp-calc-ro.html');
fs.writeFileSync(FILE_RO, harness({ rowPrice: 1000000, threshold: 10000000 }), 'utf8');

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error(C.red + 'Не найден playwright' + C.off);
    process.exit(1);
  }

  const browser = await chromium.launch();

  // ─────────────────────────── Сценарий 1: базовый ───────────────────────
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));

  await page.goto('file:///' + TALL_FILE.replace(/\\/g, '/'));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.AsgardRpCalcModal.open({ id: 990001 }, [], function () {}));
  await page.waitForTimeout(600);
  const toasts = await page.evaluate(() => window.__toasts || []);
  if (toasts.length) console.log(C.dim + 'тосты модалки: ' + JSON.stringify(toasts) + C.off);

  const base = await page.evaluate(() => {
    const root = document.querySelector('[data-rp-calc-root]');
    const txt = (sel) => { const e = root && root.querySelector(sel); return e ? e.textContent.trim() : null; };
    const kpis = {};
    root.querySelectorAll('[data-kpi]').forEach((el) => {
      kpis[el.getAttribute('data-kpi')] = el.closest('.rp-calc-footer__kpi, .kpi').querySelector('span').textContent.trim();
    });
    const val = {};
    root.querySelectorAll('[data-kpi]').forEach((el) => { val[el.getAttribute('data-kpi')] = el.textContent.trim(); });
    const smetaTotals = [];
    root.querySelectorAll('.rp-calc-smeta-totals .kpi').forEach((k) => {
      smetaTotals.push({ label: k.querySelector('span').textContent.trim(), value: k.querySelector('b').textContent.trim() });
    });
    const rows = [];
    root.querySelectorAll('.rp-calc-smeta tbody tr').forEach((tr) => {
      rows.push(tr.textContent.replace(/\s+/g, ' ').trim());
    });
    const btn = root.querySelector('[data-rp-act="send-director"]');
    return {
      kpiLabels: kpis, kpiValues: val, smetaTotals, rows,
      buttonLabel: btn ? btn.textContent.trim() : null,
      hasSaveIndicator: !!root.querySelector('[data-rp-save-state]'),
      hasOpenAnalysis: !!root.querySelector('[data-rp-act="open-analysis"]'),
    };
  });

  check('A1 KPI «Чистая прибыль» в футере', !!(base.kpiLabels.net_profit && /чист/i.test(base.kpiLabels.net_profit)),
    'label=' + base.kpiLabels.net_profit);
  check('A1 KPI «Прибыль / чел·смен» в футере', !!(base.kpiLabels.profit_per_person_shift && /чел/i.test(base.kpiLabels.profit_per_person_shift)),
    'label=' + base.kpiLabels.profit_per_person_shift);
  check('A1 KPI «Чистая прибыль» в итогах сметы', base.smetaTotals.some((k) => /чист/i.test(k.label)),
    base.smetaTotals.map((k) => k.label).join(' | '));
  check('A2 значение чистой прибыли посчитано (1 500 000 − 1 000 000 = 500 000; налог 125 000 → 375 000)',
    /375\s?000/.test(base.kpiValues.net_profit || ''), 'net_profit=' + base.kpiValues.net_profit);
  check('A2 прибыль на чел·смен = 375 000 / 120 (10×2×6) = 3 125',
    /3\s?125/.test(base.kpiValues.profit_per_person_shift || ''), 'per_shift=' + base.kpiValues.profit_per_person_shift);
  // Код (R8/R9/R10) в таблицу не рендерится — колонка кода только у строк-позиций,
  // у роллапов подпись занимает всю ширину. Проверяем по подписям итогов.
  check('A3 в смете есть строки R8/R9/R10 (маржа, налог, ЧИСТАЯ ПРИБЫЛЬ)',
    base.rows.some((r) => /^Маржа/.test(r)) &&
    base.rows.some((r) => /^Налог на прибыль/.test(r)) &&
    base.rows.some((r) => /^ЧИСТАЯ ПРИБЫЛЬ/.test(r)),
    base.rows.filter((r) => /^(Маржа|Налог на прибыль|ЧИСТАЯ ПРИБЫЛЬ)/.test(r)).join(' | ').slice(0, 260));
  check('A4 цена ниже порога → кнопка «Завершить просчёт»',
    base.buttonLabel === 'Завершить просчёт', 'label=' + base.buttonLabel);
  check('A10 кнопка «Открыть анализ» есть в шапке', base.hasOpenAnalysis, 'найдена: ' + base.hasOpenAnalysis);
  check('A11 индикатор автосохранения в футере есть', base.hasSaveIndicator, 'найден: ' + base.hasSaveIndicator);

  // A10: клик по «Открыть анализ» → вызов rp_review_modal с readOnly+viewer
  await page.evaluate(() => {
    document.querySelector('[data-rp-act="open-analysis"]').click();
  });
  await page.waitForTimeout(200);
  const analysisArgs = await page.evaluate(() => window.__analysisOpenArgs);
  check('A10 «Открыть анализ» вызывает модалку анализа read-only (role=viewer, initialTab=report)',
    !!analysisArgs && analysisArgs.opts && analysisArgs.opts.readOnly === true &&
    analysisArgs.opts.role === 'viewer' && analysisArgs.opts.mode === 'analysis',
    JSON.stringify(analysisArgs));

  // ── A8: документы тендера во вкладке «Файлы» ──
  await page.evaluate(() => {
    const tab = document.querySelector('[data-rp-tab="files"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(250);
  const files = await page.evaluate(() => {
    const root = document.querySelector('[data-rp-calc-root]');
    const sec = root.querySelector('.rp-calc-file-sec');
    const links = Array.from(root.querySelectorAll('.rp-calc-file-link')).map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') }));
    // Имена файлов в блоке «Документы тендера» — чтобы поймать дубль сметы/ТКП/отчёта.
    const rows = Array.from(root.querySelectorAll('[data-tender-file]')).map((el) => el.getAttribute('data-tender-file') || '');
    const nameCounts = {};
    rows.forEach((n) => { const k = n.trim().toLowerCase(); if (k) nameCounts[k] = (nameCounts[k] || 0) + 1; });
    return {
      hasTenderSection: !!sec,
      sectionText: sec ? sec.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) : null,
      linkTexts: links.map((l) => l.text),
      previewHref: (links.find((l) => l.text === 'Просмотр') || {}).href || null,
      downloadHref: (links.find((l) => l.text === 'Скачать') || {}).href || null,
      nameCounts: nameCounts,
      dupes: Object.keys(nameCounts).filter((k) => nameCounts[k] > 1),
    };
  });
  check('A8 вкладка «Файлы» содержит блок «Документы тендера»', files.hasTenderSection && /Документы тендера/i.test(files.sectionText || ''),
    files.sectionText || 'блок не найден');
  check('A8 у документов есть ссылки «Просмотр» и «Скачать»',
    files.linkTexts.includes('Просмотр') && files.linkTexts.includes('Скачать'),
    files.linkTexts.join(','));
  check('A8 «Просмотр» ведёт на /api/files/preview/ с токеном',
    !!files.previewHref && files.previewHref.indexOf('/api/files/preview/') >= 0,
    files.previewHref);
  // Дубль сметы/ТКП/отчёта в «Документах тендера» — дефект, найденный L3-верификатором
  // на tender 2052: файл приходит и как *File-поле, и как документ тендера.
  check('A8 в «Документах тендера» нет дублей по имени файла',
    files.dupes.length === 0 && !files.nameCounts['смета.xlsx'],
    'names=' + JSON.stringify(files.nameCounts));

  // ── A6/A7: живой пересчёт + автосейв ──
  await page.evaluate(() => {
    const tab = document.querySelector('[data-rp-tab="smeta"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(250);
  const beforeNet = await page.evaluate(() => {
    const el = document.querySelector('[data-kpi="net_profit"]');
    return el ? el.textContent.trim() : null;
  });
  await page.evaluate(() => {
    const inp = document.querySelector('[data-rp-param="markup"]');
    inp.value = '2';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const afterNet = await page.evaluate(() => {
    const el = document.querySelector('[data-kpi="net_profit"]');
    return el ? el.textContent.trim() : null;
  });
  check('A6 живой пересчёт: наценка 1.5 → 2 меняет KPI чистой прибыли без «Сохранить»',
    beforeNet !== afterNet && afterNet != null, beforeNet + ' → ' + afterNet);
  check('A7 наценка 2 → цена без НДС 2 000 000, налог 250 000, чистая 750 000',
    /750\s?000/.test(afterNet || ''), 'net=' + afterNet);

  // Автосейв (debounce 2.5 с)
  const callsBefore = await page.evaluate(() => (window.__calls || []).length);
  await page.evaluate(() => {
    const inp = document.querySelector('[data-rp-row] [data-fld="price"], tr[data-row-id] [data-fld="price"]');
    if (inp) { inp.value = '1200000'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(3600);
  const saveState = await page.evaluate(() => {
    const calls = window.__calls || [];
    const el = document.querySelector('[data-rp-save-state]');
    return { calls: calls.length, lastMethod: calls.length ? calls[calls.length - 1].method : null, indicator: el ? el.textContent.trim() : null };
  });
  check('A7 автосейв: PUT /rp-review ушёл сам (debounce) без нажатия кнопки',
    saveState.calls > callsBefore && saveState.lastMethod === 'PUT',
    'calls ' + callsBefore + ' → ' + saveState.calls + ', indicator=' + saveState.indicator);

  check('I все vanilla-скрипты исполнились без JS-ошибок', errors.length === 0, errors.join(' ; ').slice(0, 300));

  await page.close();

  // ─────────────────────────── Сценарий 2: выше порога ───────────────────
  const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page2.goto('file:///' + FILE_ABOVE.replace(/\\/g, '/'));
  await page2.waitForTimeout(150);
  await page2.evaluate(() => window.AsgardRpCalcModal.open({ id: 990001 }, [], function () {}));
  await page2.waitForTimeout(500);
  const above = await page2.evaluate(() => {
    const btn = document.querySelector('[data-rp-act="send-director"]');
    return { label: btn ? btn.textContent.trim() : null };
  });
  check('A4 цена выше порога → кнопка «Отправить директору»', above.label === 'Отправить директору', 'label=' + above.label);
  await page2.close();

  // ─────────────────── Сценарий 3: свой порог с бэка ─────────────────────
  const page3 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page3.goto('file:///' + FILE_CUSTOM_TH.replace(/\\/g, '/'));
  await page3.waitForTimeout(150);
  await page3.evaluate(() => window.AsgardRpCalcModal.open({ id: 990001 }, [], function () {}));
  await page3.waitForTimeout(500);
  const custom = await page3.evaluate(() => {
    const btn = document.querySelector('[data-rp-act="send-director"]');
    return { label: btn ? btn.textContent.trim() : null };
  });
  check('A5 порог с бэка (2.5 млн) перебивает хардкод: при цене 3 млн → «Отправить директору»',
    custom.label === 'Отправить директору', 'label=' + custom.label);
  await page3.close();

  // ─────────────────── Сценарий 4: read-only ─────────────────────────────
  const page4 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page4.goto('file:///' + FILE_RO.replace(/\\/g, '/'));
  await page4.waitForTimeout(150);
  await page4.evaluate(() => window.AsgardRpCalcModal.open({ id: 990001 }, [], function () {}, { readOnly: true, role: 'viewer' }));
  await page4.waitForTimeout(500);
  const readRo = () => page4.evaluate(() => {
    const root = document.querySelector('[data-rp-calc-root]');
    const kpi = root && root.querySelector('[data-kpi="net_profit"]');
    return {
      rootFound: !!root,
      roots: document.querySelectorAll('[data-rp-calc-root]').length,
      kpiNet: kpi ? kpi.textContent.trim() : null,
      calls: (window.__calls || []).length,
    };
  });

  const ro = await page4.evaluate(() => {
    const root = document.querySelector('[data-rp-calc-root]');
    const before = (root.querySelector('[data-kpi="net_profit"]') || {}).textContent;
    const inp = root.querySelector('[data-rp-param="markup"]');
    if (inp) { inp.value = '4'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
    const afterEdit = (root.querySelector('[data-kpi="net_profit"]') || {}).textContent;
    return { canEditMarkup: !!(inp && !inp.disabled && !inp.readOnly), isDisabled: !!(inp && inp.disabled), before: before, afterEdit: afterEdit, hasRoNote: /Только просмотр/i.test(root.textContent) };
  });
  await page4.waitForTimeout(3200);
  let roAfter = await readRo();
  if (!roAfter.rootFound || roAfter.kpiNet == null) {
    // Перерисовка модалки заменяет корень: даём кадр на монтирование и повторяем.
    await page4.waitForTimeout(400);
    roAfter = await readRo();
  }
  check('A9 read-only: плашка «Только просмотр» есть', ro.hasRoNote, 'note=' + ro.hasRoNote);
  check('A9 read-only: поле наценки физически disabled', ro.isDisabled === true, 'disabled=' + ro.isDisabled);
  check('A9 read-only: цена НЕ пересчиталась по вводу',
    ro.before === ro.afterEdit && roAfter.rootFound && roAfter.kpiNet === ro.before,
    ro.before + ' → ' + ro.afterEdit + ' → ' + roAfter.kpiNet + ' (roots=' + roAfter.roots + ')');
  check('A9 read-only: автосейв НЕ уходит', roAfter.calls === 0, 'calls=' + roAfter.calls);
  await page4.close();

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length) {
    console.log(C.red + `ИТОГ: FAIL — ${failed.length} из ${results.length} проверок провалено` + C.off);
    process.exit(1);
  }
  console.log(C.green + `ИТОГ: OK — ${results.length}/${results.length} проверок пройдено (chromium, реальные скрипты vanilla)` + C.off);
  process.exit(0);
})().catch((e) => {
  console.error(C.red + 'Гейт упал с ошибкой: ' + (e && e.stack || e) + C.off);
  process.exit(1);
});
