#!/usr/bin/env node
/**
 * verify_tkp_full_form.js — браузерный гейт формы полного КП (vanilla, /#/tkp).
 *
 * Зачем (D-182):
 *   Шапка таблицы стоимости полного КП стала параметрической: дефолт задаёт сервис
 *   (`TABLE_LABELS_DEFAULT` в src/services/tkp-full-kp.js), конкретное КП переопределяет
 *   через `items.full.table_labels`. Форма — прослойка между ними, и её можно сломать
 *   незаметно для grep: блок подписей есть, а payload их не шлёт; или шлёт пустые строки
 *   и затирает дефолт; или теряет уже сохранённые подписи при повторном сохранении.
 *   Ловится только прогоном формы в браузере с перехватом сохранения.
 *
 * Что делает:
 *   1. Берёт порядок CSS из public/index.html, грузит реальные ui.js + tkp-full-form.js.
 *   2. Подменяет fetch: отдаёт ТКП-заготовку, ловит тело сохранения.
 *   3. Открывает форму, дёргает блок «⚙ Шапка таблицы», пишет переопределение и жмёт «Сохранить».
 *
 * Гейты (все обязаны быть зелёными, иначе exit 1):
 *   G1 форма открылась, блок подписей на месте (7 полей)
 *   G2 блок скрыт по умолчанию, заголовок кнопки — «⚙ Шапка таблицы»
 *   G3 кнопка раскрывает блок и меняет подпись на «Скрыть шапку таблицы»
 *   G4 заголовки колонок в форме = дефолты сервиса (5 штук)
 *   G5 подсказки в полях позиции совпадают с заголовками колонок
 *   G6 подпись строки транспорта взята из той же шапки
 *   G7 правка подписи сразу меняет заголовок колонки в форме
 *   G8 сохранение шлёт только непустые переопределения
 *   G9 повторное открытие ТКП с сохранёнными подписями показывает их (round-trip)
 *   G10 незаполненные поля не подменяются значениями
 *   G11 чужие/алиасные ключи payload при сохранении не теряются
 *   G12 пустое поле = вернуться к дефолту (ключ из payload убирается)
 *   G13 нет JS-ошибок страницы
 *
 * Использование: node tools/verify_tkp_full_form.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const INDEX = path.join(PUBLIC, 'index.html');
const SHOT = path.join(ROOT, '_tmp_tender_brief', 'zavidovo_golf_kp', 'form-labels-block.png');

const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail || '') });
  console.log(`${ok ? C.green + 'PASS' : C.red + 'FAIL'}${C.off}  ${name}${detail ? C.dim + '  — ' + detail + C.off : ''}`);
}

// ── 1. Реальные ассеты ─────────────────────────────────────────────────────
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20');
const html = fs.readFileSync(INDEX, 'utf8');
const css = [];
for (const m of html.matchAll(/<link\b[^>]*?\bhref\s*=\s*["']([^"']+\.css)(?:\?[^"']*)?["']/gi)) {
  const rel = m[1].replace(/^\.?\//, '');
  if (/^https?:/i.test(rel)) continue;
  const abs = path.join(PUBLIC, rel);
  if (fs.existsSync(abs) && !css.includes(abs)) css.push(abs);
}
const SCRIPTS = ['assets/js/ui.js', 'assets/js/tkp-full-form.js'].map((rel) => path.join(PUBLIC, rel));
for (const s of SCRIPTS) {
  if (!fs.existsSync(s)) { console.error(`${C.red}нет файла ${s}${C.off}`); process.exit(1); }
}

// Заготовка ТКП — самодостаточная (гейт не должен зависеть от _tmp_*/БД).
function tkpPayload(labels) {
  return {
    id: 3042,
    tkp_number: 'ТКП-2026-077',
    customer_name: 'ООО «ЗАВИДОВО ГОЛЬФ»',
    customer_inn: '7612039279',
    subject: 'Промывка сетей ХВС из труб ПНД Ø225/Ø160, 5000 м',
    validity_days: 30,
    items: {
      vat_pct: 22,
      full: {
        object_name: 'Конаковский р-н, Тверская обл.',
        apparatus: [
          { equipment: 'Химическая промывка сети Ø225', inventory_no: 'м', tube_data: '2000 м', qty: '1 компл.', amount_no_vat: 3000000 },
          { equipment: 'Химическая промывка сети Ø160', inventory_no: 'м', tube_data: '3000 м', qty: '1 компл.', amount_no_vat: 4910000 }
        ],
        transport_amount: 600000,
        table_labels: labels || {}
      }
    }
  };
}

const stand = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
${css.map((p) => `<link rel="stylesheet" href="${fileUrl(p)}">`).join('\n')}
<style>html,body{margin:0}</style>
</head><body>
<div id="app"></div>
${SCRIPTS.map((p) => `<script src="${fileUrl(p)}"></script>`).join('\n')}
</body></html>`;
const standPath = path.join(os.tmpdir(), 'asgard-tkp-full-form-stand.html');
fs.writeFileSync(standPath, stand, 'utf8');

// ── 2. Скрипты страницы ────────────────────────────────────────────────────
function boot(payload) {
  window.__reqs = [];
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message || e)));
  window.__payload = payload;
  window.fetch = async function (url, opts) {
    opts = opts || {};
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch (_) { body = opts.body; }
    window.__reqs.push({ url: String(url), method: opts.method || 'GET', body: body });
    if (String(url).indexOf('/api/tkp/') === 0) {
      return { ok: true, status: 200, json: async () => ({ item: window.__payload }) };
    }
    return { ok: true, status: 200, json: async () => ({ items: [], item: { id: 3042 } }) };
  };
  window.__formReady = false;
  window.__formErr = '';
  return window.AsgardTkpFullForm.open(3042, null, function () {})
    .then(() => { window.__formReady = true; })
    .catch((e) => { window.__formErr = String((e && e.message) || e); });
}

function probe() {
  const box = document.querySelector('#fullTblLabels');
  const toggle = document.querySelector('#fullTblLabelsToggle');
  const th = (k) => { const el = document.querySelector(`th[data-lbl="${k}"]`); return el ? el.textContent.trim() : null; };
  const ph = (cls) => { const el = document.querySelector(`#fullAppBody .${cls}`); return el ? el.getAttribute('placeholder') : null; };
  const lbl = (k) => { const el = document.querySelector(`.ftl[data-lbl="${k}"]`); return el ? el.value : null; };
  const tInp = document.querySelector('#fullTransport');
  const tLab = tInp && tInp.parentElement.querySelector('label');
  const saved = window.__reqs.filter((r) => r.method !== 'GET').pop();
  return {
    ready: window.__formReady, err: window.__formErr, errors: window.__errors,
    hasBox: !!box, nInputs: box ? box.querySelectorAll('.ftl').length : 0,
    boxVisible: box ? getComputedStyle(box).display !== 'none' : false,
    toggleText: toggle ? toggle.textContent.trim() : null,
    th: { c1: th('tbl_col1'), c2: th('tbl_col2'), c3: th('tbl_col3'), c4: th('tbl_col4'), c5: th('tbl_col5') },
    ph: { c1: ph('fa-eq'), c2: ph('fa-inv'), c3: ph('fa-tube') },
    val: { t: lbl('tbl_title'), c1: lbl('tbl_col1'), c2: lbl('tbl_col2'), c3: lbl('tbl_col3'), c4: lbl('tbl_col4'), c5: lbl('tbl_col5'), tr: lbl('tbl_transport_label') },
    transportLabel: tLab ? tLab.textContent.trim() : null,
    savedBody: (saved && saved.body) || null,
    nRequests: window.__reqs.length
  };
}

function setInput(args) {
  const el = document.querySelector(`.ftl[data-lbl="${args[0]}"]`);
  if (!el) return false;
  el.value = args[1];
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

async function openForm(page, payload) {
  await page.goto(fileUrl(standPath), { waitUntil: 'load' });
  await page.evaluate(boot, payload);
  await page.waitForFunction(() => window.__formReady || window.__formErr, null, { timeout: 15000 });
  return page.evaluate(probe);
}

const labelsOf = (state) => state.savedBody && state.savedBody.items && state.savedBody.items.full
  ? state.savedBody.items.full.table_labels : null;

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error(`${C.red}Не найден playwright. Установи: npm i -D playwright && npx playwright install chromium${C.off}`);
    process.exit(1);
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

    // ── Сценарий 1: пустые table_labels (дефолты сервиса) ──────────────────
    console.log(`${C.dim}Сценарий 1: ТКП без переопределений — печатается дефолт${C.off}`);
    let s = await openForm(page, tkpPayload({}));
    check('G1 форма открылась, блок «Шапка таблицы» на месте (7 полей)',
      s.ready && s.hasBox && s.nInputs === 7, `ready=${s.ready} err=${s.err || '-'} полей=${s.nInputs}`);
    check('G2 блок скрыт по умолчанию, кнопка «⚙ Шапка таблицы»',
      !s.boxVisible && s.toggleText === '⚙ Шапка таблицы', `visible=${s.boxVisible} text=«${s.toggleText}»`);
    check('G4 заголовки колонок = дефолты сервиса',
      s.th.c1 === 'Наименование' && s.th.c2 === 'Ед. изм.' && s.th.c3 === 'Объём и расчётные данные'
      && s.th.c4 === 'Кол-во' && s.th.c5 === 'Сумма без НДС, руб.',
      [s.th.c1, s.th.c2, s.th.c3, s.th.c4, s.th.c5].join(' | '));
    check('G5 подсказки в позициях совпадают с заголовками колонок',
      s.ph.c1 === s.th.c1 && s.ph.c2 === s.th.c2 && s.ph.c3 === s.th.c3,
      `eq=«${s.ph.c1}» inv=«${s.ph.c2}» tube=«${s.ph.c3}»`);
    check('G6 подпись строки транспорта взята из той же шапки',
      !!s.transportLabel && s.transportLabel.indexOf('Транспортные расходы') === 0,
      `label=«${s.transportLabel}»`);

    await page.click('#fullTblLabelsToggle');
    s = await page.evaluate(probe);
    check('G3 кнопка раскрывает блок и меняет подпись',
      s.boxVisible && s.toggleText === 'Скрыть шапку таблицы', `visible=${s.boxVisible} text=«${s.toggleText}»`);

    await page.evaluate(setInput, ['tbl_col2', 'Ед. изм. (уточнить)']);
    s = await page.evaluate(probe);
    check('G7 правка подписи сразу меняет заголовок колонки в форме',
      s.th.c2 === 'Ед. изм. (уточнить)', `th.col2=«${s.th.c2}»`);

    await page.screenshot({ path: SHOT });
    await page.click('#fullSave');
    await page.waitForFunction(() => window.__reqs.some((r) => r.method !== 'GET'), null, { timeout: 10000 });
    s = await page.evaluate(probe);
    const l1 = labelsOf(s);
    check('G8 сохранение шлёт только непустые переопределения',
      !!l1 && l1.tbl_col2 === 'Ед. изм. (уточнить)' && Object.keys(l1).length === 1, JSON.stringify(l1));

    // ── Сценарий 2: round-trip сохранённых подписей + чужой ключ ───────────
    console.log(`${C.dim}Сценарий 2: ТКП с сохранёнными подписями + чужим ключом payload${C.off}`);
    s = await openForm(page, tkpPayload({ tbl_col1: 'Работы', tbl_title: 'СВОЯ ШАПКА', col1: 'Чужой ключ', col5: 'Сумма' }));
    check('G9 повторное открытие показывает сохранённые подписи',
      s.val.c1 === 'Работы' && s.val.t === 'СВОЯ ШАПКА' && s.th.c1 === 'Работы',
      `input=«${s.val.c1}» th=«${s.th.c1}» title=«${s.val.t}»`);
    check('G10 незаполненные поля пусты, а колонка показывается дефолтом',
      s.val.c3 === '' && s.th.c3 === 'Объём и расчётные данные', `input=«${s.val.c3}» th=«${s.th.c3}»`);

    await page.evaluate(setInput, ['tbl_col2', 'Измерение']);
    await page.click('#fullSave');
    await page.waitForFunction(() => window.__reqs.some((r) => r.method !== 'GET'), null, { timeout: 10000 });
    s = await page.evaluate(probe);
    const l2 = labelsOf(s);
    check('G11 чужие/алиасные ключи payload не потерялись',
      !!l2 && l2.col1 === 'Чужой ключ' && l2.col5 === 'Сумма' && l2.tbl_col1 === 'Работы' && l2.tbl_col2 === 'Измерение',
      JSON.stringify(l2));

    // ── Сценарий 3: очистка поля = возврат к дефолту ───────────────────────
    console.log(`${C.dim}Сценарий 3: очистка поля снимает переопределение${C.off}`);
    s = await openForm(page, tkpPayload({ tbl_col1: 'Работы' }));
    await page.evaluate(setInput, ['tbl_col1', '']);
    s = await page.evaluate(probe);
    const thAfterClear = s.th.c1;
    const jsErrors = s.errors;
    await page.click('#fullSave');
    await page.waitForFunction(() => window.__reqs.some((r) => r.method !== 'GET'), null, { timeout: 10000 });
    s = await page.evaluate(probe);
    const l3 = labelsOf(s);
    check('G12 пустое поле = дефолт (ключ из payload убран), заголовок вернулся',
      !!l3 && l3.tbl_col1 === undefined && thAfterClear === 'Наименование',
      `labels=${JSON.stringify(l3)} th=«${thAfterClear}»`);
    check('G13 нет JS-ошибок страницы', jsErrors.length === 0, jsErrors.join(' | ') || 'нет');
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length) {
    console.log(`${C.red}ИТОГ: FAIL — ${failed.length} из ${results.length} проверок${C.off}`);
    process.exit(1);
  }
  console.log(`${C.green}ИТОГ: OK — ${results.length}/${results.length} проверок (chromium, реальные ui.js + tkp-full-form.js)${C.off}`);
  console.log(`скриншот блока «Шапка таблицы»: ${SHOT}`);
})();
