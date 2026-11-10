'use strict';

/**
 * Полное коммерческое предложение (шаблон «Ника») — DOCX (docxtemplater)
 * + PDF (LibreOffice convert). HTML — только аварийный fallback.
 * Не смешивать с кратким generateTkpPdf.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');
const db = require('./db');

const ROOT = path.resolve(__dirname, '..', '..');
const FULL_KP_TPL = path.join(ROOT, 'templates', 'full-kp-nika-tpl.docx');

/**
 * Шапка таблицы стоимости. ОДИН шаблон на все предметы КП.
 *
 * Слова в шапке — не «под аппараты» и не «под работы», а универсальные, и они
 * ПАРАМЕТРИЧЕСКИЕ: в templates/full-kp-nika-tpl.docx стоят плейсхолдеры
 * {tbl_title}, {tbl_col1..5}, {tbl_transport_label}, а значения подставляются отсюда.
 * Значения по умолчанию можно переопределить на конкретное КП через
 * items.full.table_labels (поля есть в форме полного КП).
 *
 * Зачем так: прошлая попытка решала это вторым файлом-шаблоном и переключателем
 * template_kind — на третьем предмете (монтаж, антикор, диагностика) понадобился бы
 * третий файл. Теперь шаблон править не нужно вообще, достаточно текста в форме.
 */
const TABLE_LABELS_DEFAULT = {
  // Заголовок раздела печатается на месте прежнего «СТОИМОСТЬ РАБОТ ПО АППАРАТАМ» —
  // поэтому дефолт капсом, как соседние разделы шаблона (УСЛОВИЯ И КОММЕНТАРИИ,
  // ТЕХНИЧЕСКИЙ ПЕРИМЕТР РАБОТ, ПОРЯДОК СДАЧИ...): иначе новый заголовок выбивается из стиля.
  tbl_title: 'СТОИМОСТЬ РАБОТ И ЗАТРАТ',
  tbl_col1: 'Наименование',
  tbl_col2: 'Ед. изм.',
  tbl_col3: 'Объём и расчётные данные',
  tbl_col4: 'Кол-во',
  tbl_col5: 'Сумма без НДС, руб.',
  // НЕ «Транспортные расходы»: эта фраза в INTERNAL_WORDS клиентского линтера
  // (client-doc-lint.js). Дефолтная подпись приложения не имеет права падать
  // на собственном гейте — из-за неё полное КП не сохранялось (05.11.2026).
  tbl_transport_label: 'Мобилизация и демобилизация'
};

/** Дружественные имена полей формы → имена плейсхолдеров шаблона. */
const TABLE_LABEL_ALIASES = {
  section_title: 'tbl_title',
  col1: 'tbl_col1',
  col2: 'tbl_col2',
  col3: 'tbl_col3',
  col4: 'tbl_col4',
  col5: 'tbl_col5',
  col_equipment: 'tbl_col1',
  col_inventory: 'tbl_col2',
  col_tube: 'tbl_col3',
  col_qty: 'tbl_col4',
  col_amount: 'tbl_col5',
  transport_label: 'tbl_transport_label'
};

/** Шапка таблицы стоимости: дефолт + переопределение из items.full.table_labels. */
function resolveTableLabels(tkp) {
  const labels = { ...TABLE_LABELS_DEFAULT };
  const full = getFullPayload(tkp);
  const over = full.table_labels && typeof full.table_labels === 'object' ? full.table_labels : {};
  const entries = Object.entries(over);
  // Порядок важен: сначала дружественные имена, затем канонические (tbl_*).
  // Иначе два ключа к одному плейсхолдеру (tbl_col1 и col1) давали бы «кто последний».
  const apply = ([key, val]) => {
    const name = TABLE_LABEL_ALIASES[key] || key;
    if (!(name in TABLE_LABELS_DEFAULT)) return;
    const text = String(val == null ? '' : val).trim();
    if (text) labels[name] = text;
  };
  entries.filter(([key]) => !(key in TABLE_LABELS_DEFAULT)).forEach(apply);
  entries.filter(([key]) => key in TABLE_LABELS_DEFAULT).forEach(apply);
  return labels;
}

let pdfGenerator = null;
try { pdfGenerator = require('./pdf-generator'); } catch (_) {}

let _Docxtemplater = null;
let _PizZip = null;
function _loadDocxLibs() {
  if (_Docxtemplater && _PizZip) return { Docxtemplater: _Docxtemplater, PizZip: _PizZip };
  _Docxtemplater = require('docxtemplater');
  _PizZip = require('pizzip');
  return { Docxtemplater: _Docxtemplater, PizZip: _PizZip };
}

let _convertDocxToPdf = null;
function _getConvertDocxToPdf() {
  if (_convertDocxToPdf) return _convertDocxToPdf;
  try {
    _convertDocxToPdf = require('./letter/_shared').convertDocxToPdf;
  } catch (_) {
    _convertDocxToPdf = () => null;
  }
  return _convertDocxToPdf;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${dt.getFullYear()}`;
}

function numberToWordsRu(num) {
  if (pdfGenerator && pdfGenerator.numberToWordsRu) return pdfGenerator.numberToWordsRu(num);
  return String(num);
}

/** Дефолтная структура full-payload внутри tkp.items.full */
function emptyFullPayload() {
  return {
    object_name: '',
    basis: '',
    conditions: {
      mobilization: '',
      personnel: '',
      regime: '',
      payment: '',
      customer_resources: '',
      price_summary: ''
    },
    scope: '',
    scope_boundary: '',
    apparatus: [], // { equipment|name, inventory_no|unit, tube_data|details, qty, amount_no_vat }
    transport_amount: 0,
    table_labels: {}, // переопределение шапки таблицы стоимости (см. TABLE_LABELS_DEFAULT)
    cost_notes: '',
    acceptance: '',
    risks: '',
    customer_duties: '',
    deliverables: '',
    author_name: '',
    author_position: 'Генеральный директор'
  };
}

function parseItems(tkp) {
  let cj;
  try {
    cj = typeof tkp.items === 'string' ? JSON.parse(tkp.items || '{}') : (tkp.items || {});
  } catch (_) { cj = {}; }
  if (Array.isArray(cj)) cj = { items: cj };
  return cj;
}

function getFullPayload(tkp) {
  const cj = parseItems(tkp);
  const base = emptyFullPayload();
  const full = cj.full && typeof cj.full === 'object' ? cj.full : {};
  return {
    ...base,
    ...full,
    conditions: { ...base.conditions, ...(full.conditions || {}) },
    apparatus: Array.isArray(full.apparatus) ? full.apparatus : []
  };
}

/** Значение позиции таблицы: сначала исторические ключи, затем универсальные. */
function posVal(row, ...keys) {
  for (const k of keys) {
    const v = row && row[k];
    if (v != null && String(v).trim()) return v;
  }
  return '';
}

/**
 * Итоги КП.
 *
 * ВАЖНО: у полного КП позиции лежат в `full.apparatus`, а у КОРОТКОГО — в
 * `items.items` (их строит from-card/ai-draft). Раньше функция суммировала
 * только `full.apparatus`, поэтому короткое КП печатало «ИТОГО 0,00» и
 * «Цена предложения 0,00 руб.» — фирменный бланк с пустой таблицей сумм
 * (верификатор 10.11.2026). Теперь источник зависит от того, что есть.
 *
 * @param {object} full — payload полного КП (может быть пустым)
 * @param {number} vatPct
 * @param {object} [itemsPayload] — `items` ТКП ({ items: [...] }), для короткого
 */
function calcTotals(full, vatPct, itemsPayload) {
  const vat = vatPct != null ? Number(vatPct) : 22;
  const src = full || {};
  let subtotal = 0;
  let counted = 0;
  for (const row of src.apparatus || []) {
    subtotal += Number(row.amount_no_vat) || 0;
    counted += 1;
  }
  subtotal += Number(src.transport_amount) || 0;

  // Фолбэки, если полного payload нет (короткое КП): явный subtotal, затем
  // сумма клиентских позиций, затем цена из карточки ТКП.
  if (!counted) {
    const ip = itemsPayload || {};
    const rows = Array.isArray(ip.items) ? ip.items : [];
    const itemsSum = rows.reduce((s, it) => {
      const q = Number(it.qty) || 0;
      const p = Number(it.price) || 0;
      const t = it.total != null ? Number(it.total) : q * p;
      return s + (Number.isFinite(t) ? t : 0);
    }, 0);
    const explicit = Number(ip.subtotal);
    if (Number.isFinite(explicit) && explicit > 0) subtotal = explicit;
    else if (itemsSum > 0) subtotal = itemsSum;
    else if (Number(src.total_sum) > 0) subtotal = Number(src.total_sum);
  }

  // НДС в ЦЕЛЫХ копейках — та же формула, что vatFromBase в tkp-ai-draft
  // и в модалке. Иначе на 0,08 % баз документ печатал 145 880,95 при
  // сохранённых 145 880,96 (расхождение на копейку в клиентском файле).
  const baseKop = Math.round(subtotal * 100);
  const bp = Math.round(vat * 100); // 22% → 2200 базисных пунктов
  const vatKop = Math.round(baseKop * bp / 10000);
  const vatSum = vatKop / 100;
  const total = (baseKop + vatKop) / 100;
  return { subtotal, vatPct: vat, vatSum, total };
}

function sectionBlock(title, bodyHtml) {
  if (!bodyHtml || !String(bodyHtml).trim()) return '';
  return `<div class="sec"><div class="sec-h">${esc(title)}</div><div class="sec-b">${bodyHtml}</div></div>`;
}

function preBlock(text) {
  if (!text || !String(text).trim()) return '';
  return `<div class="pre">${esc(text)}</div>`;
}

function listFromText(text) {
  if (!text || !String(text).trim()) return '';
  const lines = String(text).split(/\n+/).map(l => l.replace(/^[\s•\-\d.)]+/, '').trim()).filter(Boolean);
  if (!lines.length) return preBlock(text);
  return `<ul class="bullets">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
}

function buildFullKpHtml(tkp, opts = {}) {
  const company = opts.company || {};
  const logo = opts.logo || '';
  const signatureImg = opts.signatureImg || '';
  const stampImg = opts.stampImg || '';
  const full = getFullPayload(tkp);
  const cj = parseItems(tkp);
  const vatPct = cj.vat_pct != null ? cj.vat_pct : 22;
  const totals = calcTotals(full, vatPct, cj);
  const L = resolveTableLabels(tkp);

  const num = tkp.tkp_number || ('АС-' + tkp.id);
  const dateStr = formatDate(tkp.created_at || new Date());
  const validity = tkp.validity_days || 30;

  const cond = full.conditions || {};
  // Пустые метки не печатаем: «Мобилизация и срок» без значения — это дырка
  // в клиентском документе, а не раздел. Раньше в DOCX оставались заголовки
  // без текста, и ТО видела «много мест не заполнено».
  const condRows = [
    ['Мобилизация и срок', cond.mobilization],
    ['Персонал', cond.personnel],
    ['Режим производства', cond.regime],
    ['Оплата', cond.payment],
    ['Ресурсы Заказчика', cond.customer_resources],
    ['Цена предложения', cond.price_summary || `${fmtMoney(totals.subtotal)} руб. без НДС; НДС ${vatPct}% — ${fmtMoney(totals.vatSum)} руб.; итого с НДС — ${fmtMoney(totals.total)} руб.`]
  ].filter(([, v]) => v && String(v).trim());

  const apparatusRows = (full.apparatus || []).map((r, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(posVal(r, 'equipment', 'name', 'title', 'work') || '—')}</td>
      <td>${esc(posVal(r, 'inventory_no', 'unit', 'measure') || '—')}</td>
      <td>${esc(posVal(r, 'tube_data', 'details', 'volume', 'scope') || '—')}</td>
      <td class="c">${esc(r.qty || '1 компл.')}</td>
      <td class="r">${fmtMoney(r.amount_no_vat)}</td>
    </tr>`).join('');

  const authorPos = full.author_position || 'Генеральный директор';
  const authorName = company.director_name || full.author_name || '';

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><style>
@page { size: A4; margin: 14mm 16mm 14mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Times New Roman", Times, serif; font-size: 10.5pt; color: #111; line-height: 1.35; margin: 0; }
.hdr { display:flex; gap:14px; align-items:flex-start; }
.hdr-logo img { width: 150px; }
.hdr-info { font-size: 9pt; color: #333; line-height: 1.45; }
.hdr-name { font-size: 12pt; font-weight: 700; color: #1E4D8C; margin-bottom: 2px; }
.title { text-align:center; font-size: 14pt; font-weight: 700; color: #1E4D8C; margin: 14px 0 2px; letter-spacing: .02em; }
.sub { text-align:center; font-size: 10pt; color: #555; margin-bottom: 12px; }
.card { border: 1px solid #cfd4dc; background: #f7f8fa; padding: 10px 12px; margin-bottom: 12px; }
.card-row { display:flex; gap:8px; padding: 2px 0; font-size: 10pt; }
.card-l { min-width: 90px; font-weight: 700; color: #555; }
.sec { margin: 14px 0 8px; }
.sec-h { font-size: 11pt; font-weight: 700; color: #1E4D8C; text-transform: uppercase; border-bottom: 1px solid #d1d5db; padding-bottom: 3px; margin-bottom: 8px; }
.sec-b { font-size: 10pt; }
.pre { white-space: pre-line; margin: 0 0 8px; }
.kv { margin: 0 0 8px; }
.kv-k { font-weight: 700; margin-bottom: 2px; }
.kv-v { white-space: pre-line; margin-bottom: 6px; }
table.app { width: 100%; border-collapse: collapse; margin: 6px 0 8px; font-size: 9pt; }
table.app th { background: #1E4D8C; color: #fff; border: 1px solid #1E4D8C; padding: 5px 4px; text-align: center; }
table.app td { border: 1px solid #cfd4dc; padding: 5px 4px; vertical-align: top; }
table.app tr:nth-child(even) td { background: #f8f9fa; }
.c { text-align: center; }
.r { text-align: right; white-space: nowrap; }
.totals { text-align: right; margin: 8px 0; line-height: 1.7; }
.totals .g { font-size: 11.5pt; font-weight: 700; color: #1E4D8C; }
.words { font-style: italic; margin: 8px 0 12px; font-size: 10pt; }
.bullets { margin: 4px 0 0 18px; padding: 0; }
.bullets li { margin: 3px 0; }
.sign { margin-top: 18px; border-top: 1px solid #e5e7eb; padding-top: 10px; position: relative; }
.sign-row { display:flex; align-items:flex-end; gap: 16px; }
.sign-pos { width: 220px; font-weight: 600; }
.sign-line { flex:1; border-bottom: 1px solid #000; height: 1px; }
.sign-name { width: 220px; text-align: right; font-weight: 600; }
.sign-images { position: relative; height: 120px; margin-top: -40px; }
.sign-signature { position: absolute; left: 180px; top: 0; height: 130px; }
.sign-stamp { position: absolute; left: 130px; top: -10px; height: 160px; opacity: .85; }
.footer { margin-top: 10px; text-align: center; font-size: 7.5pt; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 4px; }
</style></head><body>
<div class="hdr">
  ${logo ? `<div class="hdr-logo"><img src="${logo}" alt=""></div>` : ''}
  <div class="hdr-info">
    <div class="hdr-name">${esc(company.name || 'ООО «АСГАРД-Сервис»')}</div>
    <div>${esc(company.legal_address || '')}</div>
    <div>Тел.: ${esc(company.phone || '')}</div>
  </div>
</div>
<div class="title">КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</div>
<div class="sub">№ ${esc(num)} от ${esc(dateStr)} &nbsp;|&nbsp; Срок действия: ${validity} календарных дней</div>

<div class="card">
  <div class="card-row"><div class="card-l">Заказчик</div><div>${esc(tkp.customer_name || '—')}</div></div>
  <div class="card-row"><div class="card-l">Объект</div><div>${esc(full.object_name || '—')}</div></div>
  <div class="card-row"><div class="card-l">Предмет</div><div>${esc(tkp.subject || '—')}</div></div>
  <div class="card-row"><div class="card-l">Основание</div><div>${esc(full.basis || '—')}</div></div>
</div>

${condRows.length ? sectionBlock('Условия и комментарии', condRows.map(([k, v]) =>
  `<div class="kv"><div class="kv-k">${esc(k)}</div><div class="kv-v">${esc(v)}</div></div>`
).join('')) : ''}

${sectionBlock('Технический периметр работ', preBlock(full.scope) + (full.scope_boundary
  ? `<div class="kv"><div class="kv-k">Граница объема</div><div class="kv-v">${esc(full.scope_boundary)}</div></div>` : ''))}

${(full.apparatus || []).length ? sectionBlock(L.tbl_title, `
<table class="app">
  <thead><tr>
    <th style="width:28px">№</th>
    <th>${esc(L.tbl_col1)}</th>
    <th style="width:90px">${esc(L.tbl_col2)}</th>
    <th>${esc(L.tbl_col3)}</th>
    <th style="width:70px">${esc(L.tbl_col4)}</th>
    <th style="width:110px">${esc(L.tbl_col5)}</th>
  </tr></thead>
  <tbody>
    ${apparatusRows}
    ${Number(full.transport_amount) > 0 ? `<tr>
      <td colspan="5"><b>${esc(L.tbl_transport_label)}</b></td>
      <td class="r"><b>${fmtMoney(full.transport_amount)}</b></td>
    </tr>` : ''}
  </tbody>
</table>
<div class="totals">
  <div>ИТОГО БЕЗ НДС: <b>${fmtMoney(totals.subtotal)}</b></div>
  <div>НДС ${vatPct}%: <b>${fmtMoney(totals.vatSum)}</b></div>
  <div class="g">ИТОГО С НДС: ${fmtMoney(totals.total)}</div>
</div>
<div class="words">Общая стоимость: ${fmtMoney(totals.total)} руб., в том числе НДС ${vatPct}% — ${fmtMoney(totals.vatSum)} руб. ${esc(numberToWordsRu(totals.total))}</div>
${full.cost_notes ? `<div class="kv"><div class="kv-k">Примечания к распределению стоимости</div><div class="kv-v">${esc(full.cost_notes)}</div></div>` : ''}
`) : ''}

${sectionBlock('Порядок сдачи, приемки и оплаты', preBlock(full.acceptance))}
${sectionBlock('Условия, влияющие на сроки и стоимость', preBlock(full.risks))}
${sectionBlock('Обязанности заказчика', listFromText(full.customer_duties))}
${sectionBlock('Исполнительная документация', listFromText(full.deliverables))}

<div class="sign">
  <div class="sign-row">
    <div class="sign-pos">${esc(authorPos)}${company.name ? '<br/>' + esc(company.name) : ''}</div>
    <div class="sign-line"></div>
    <div class="sign-name">${esc(authorName)}</div>
  </div>
  ${(signatureImg || stampImg) ? `<div class="sign-images">
    ${signatureImg ? `<img class="sign-signature" src="${signatureImg}" alt="">` : ''}
    ${stampImg ? `<img class="sign-stamp" src="${stampImg}" alt="">` : ''}
  </div>` : `<div style="text-align:center;font-size:8pt;color:#9CA3AF;margin-top:12px">М.П.</div>`}
</div>
<div class="footer">${esc(company.name || 'ООО «АСГАРД-Сервис»')} — ${esc(company.phone || '')}</div>
</body></html>`;
}

function splitParas(text) {
  return String(text == null ? '' : text).replace(/\r\n/g, '\n').split(/\n+/).map(s => s.trim()).filter(Boolean);
}

/**
 * Вычистить пустые абзацы внутри циклов `{#x}…{/x}` ПОСЛЕ рендера.
 *
 * docxtemplater с paragraphLoop дублирует абзац-шаблон на каждый элемент, и
 * первый (шаблонный) абзац остаётся с пустым `<w:t/>`. В Word это выглядит как
 * пустой пункт с точкой между содержательными строками — дефект клиентского
 * документа (ТКП 3071, 08.11.2026).
 *
 * Удаляем только абзацы стиля списка, в которых нет текста и нет картинки.
 */
function dropEmptyListParagraphs(buf) {
  let text;
  try {
    const zip = new _loadDocxLibs().PizZip(buf);
    const file = zip.file('word/document.xml');
    if (!file) return buf;
    text = file.asText();
    const before = text;
    text = text.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (p) => {
      const hasImg = p.includes('<w:drawing>') || p.includes('<w:pict>');
      if (hasImg) return p;
      const body = p.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '');
      const plain = body.replace(/<[^>]+>/g, '').trim();
      if (plain) return p;
      // пустышку удаляем только из нумерованных/маркированных списков
      if (!/w:pStyle w:val="a0?"/.test(p)) return p;
      return '';
    });
    if (text === before) return buf;
    zip.file('word/document.xml', text);
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch (_) {
    return buf;
  }
}

function splitListItems(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map(l => l.replace(/^[\s•\-\d.)]+/, '').trim())
    .filter(Boolean);
}

async function resolveCompany(company) {
  if (company && (company.name || company.name_short || company.legal_address)) return company;
  if (pdfGenerator && pdfGenerator.getCompanyProfile) {
    try {
      const c = await pdfGenerator.getCompanyProfile();
      if (c && c.name) return c;
    } catch (_) {}
  }
  try {
    const r = await db.query('SELECT * FROM company_profile ORDER BY id LIMIT 1');
    if (r.rows[0]) return r.rows[0];
  } catch (_) {}
  return {
    name: 'ООО «АСГАРД-Сервис»',
    legal_address: 'БОЛЬШАЯ ПОЧТОВАЯ УЛ., Д. 55/59, СТР. 1, ПОМЕЩ. № 37, МОСКВА, РОССИЯ, 105082',
    phone: '+7 499 322-30-62',
    director_name: 'КУДРЯШОВ ОЛЕГ СЕРГЕЕВИЧ'
  };
}

/**
 * Данные для templates/full-kp-nika-tpl.docx
 *
 * `opts.variant`:
 *   'full'    — всё: условия, периметр, аппараты, сдача, риски, обязанности.
 *   'classic' — КОРОТКОЕ КП из ТОГО ЖЕ шаблона: та же шапка с логотипом и
 *               реквизитами, та же таблица стоимости и подпись, но без
 *               развёрнутых разделов. Раньше короткое КП собиралось
 *               отдельным генератором на 1,6 КБ: без логотипа, без печати,
 *               без реквизитов — для заказчика это выглядело как голый
 *               текстовый файл. Теперь шаблон ОДИН, разница только в объёме.
 */
function buildFullKpTemplateData(tkp, company = {}, opts = {}) {
  const variant = opts.variant === 'classic' ? 'classic' : 'full';
  const isShort = variant === 'classic';
  const full = getFullPayload(tkp);
  const cj = parseItems(tkp);
  const vatPct = cj.vat_pct != null ? Number(cj.vat_pct) : 22;
  const totals = calcTotals(full, vatPct, cj);
  const cond = full.conditions || {};
  const companyName = company.name || company.name_short || 'ООО «АСГАРД-Сервис»';
  const priceSummary = cond.price_summary
    || `${fmtMoney(totals.subtotal)} руб. без НДС; НДС ${vatPct}% — ${fmtMoney(totals.vatSum)} руб.; итого с НДС — ${fmtMoney(totals.total)} руб.`;

  // ── Таблица стоимости ──────────────────────────────────────────────────
  // В полном КП строки берутся из `full.apparatus` (детальная раскладка по
  // аппаратам с инвентарными номерами). У короткого КП такой раскладки нет
  // и не должно быть — берём готовые клиентские позиции из `items.items`
  // (их сформировал from-card/ai-draft: работы + МТР, без себестоимости).
  let apparatus;
  if (isShort) {
    const clientItems = Array.isArray(cj.items) ? cj.items : [];
    apparatus = clientItems.map((r, i) => ({
      n: String(i + 1),
      equipment: posVal(r, 'name', 'description', 'title') || '—',
      inventory_no: posVal(r, 'unit', 'measure') || '—',
      tube_data: [
        r.qty != null ? String(r.qty) : '',
        r.unit ? String(r.unit) : ''
      ].filter(Boolean).join(' ') || '—',
      qty: r.qty != null ? String(r.qty) : '1',
      amount: fmtMoney(r.total != null ? r.total : (Number(r.qty) || 0) * (Number(r.price) || 0))
    }));
  } else {
    apparatus = (full.apparatus || []).map((r, i) => ({
      n: String(i + 1),
      equipment: posVal(r, 'equipment', 'name', 'title', 'work') || '—',
      inventory_no: posVal(r, 'inventory_no', 'unit', 'measure') || '—',
      tube_data: posVal(r, 'tube_data', 'details', 'volume', 'scope') || '—',
      qty: r.qty || '1 компл.',
      amount: fmtMoney(r.amount_no_vat)
    }));
  }

  const L = resolveTableLabels(tkp);

  // Флаги разделов: заголовок печатается только при наличии содержания
  // (см. tools/patch_full_kp_sections.js). Пустой «ПОРЯДОК СДАЧИ…» без текста
  // — дефект клиентского документа, а не раздел.
  // В коротком КП развёрнутые разделы выключены осознанно: это не «забыли
  // заполнить», а другой объём документа.
  const hasAcceptance = !isShort && splitParas(full.acceptance).length > 0;
  const hasRisks = !isShort && splitParas(full.risks).length > 0;
  const hasDuties = !isShort && splitListItems(full.customer_duties).length > 0;
  const hasDeliverables = !isShort && splitListItems(full.deliverables).length > 0;

  let totalWords = '';
  try {
    const w = numberToWordsRu(totals.total);
    totalWords = w && w !== String(totals.total) ? w : '';
  } catch (_) { totalWords = ''; }

  return {
    company_name: companyName,
    company_address: company.legal_address || company.address || '',
    company_phone: company.phone || '',
    ...L,
    tkp_number: tkp.tkp_number || ('АС-' + (tkp.id || '')),
    tkp_date: formatDate(tkp.created_at || new Date()),
    validity_days: String(tkp.validity_days || 30),
    customer_name: tkp.customer_name || '—',
    object_name: full.object_name || '—',
    subject: tkp.subject || '—',
    basis: full.basis || '—',
    cond_mobilization: isShort ? '' : (cond.mobilization || ''),
    cond_personnel: isShort ? '' : (cond.personnel || ''),
    cond_regime: isShort ? '' : (cond.regime || ''),
    cond_payment: cond.payment || '',
    cond_customer_resources: isShort ? '' : (cond.customer_resources || ''),
    cond_price_summary: priceSummary,
    // Короткое КП оставляет только периметр работ: он и есть суть предложения.
    scope_paras: splitParas(isShort ? (full.scope || cj.work_description || '') : full.scope),
    scope_boundary: isShort ? '' : (full.scope_boundary || ''),
    apparatus,
    // Строка транспорта печатается только при ненулевой сумме (см. шаблон
    // full-kp-nika-tpl.docx: строка обёрнута в {#has_transport}...{/has_transport}).
    has_transport: Number(full.transport_amount) > 0,
    transport_amount: fmtMoney(full.transport_amount),
    subtotal: fmtMoney(totals.subtotal),
    vat_pct: String(vatPct),
    vat_sum: fmtMoney(totals.vatSum),
    total: fmtMoney(totals.total),
    total_words: totalWords,
    cost_notes: isShort ? '' : (full.cost_notes || ''),
    has_acceptance: hasAcceptance,
    has_risks: hasRisks,
    has_duties: hasDuties,
    has_deliverables: hasDeliverables,
    // Пустые строки таблицы условий не печатаем: метка без значения —
    // дырка в документе (см. tools/patch_full_kp_conditions.js,
    // tools/patch_full_kp_optional.js). 114 из 115 готовых просчётов не имеют
    // crew/params — без guard'ов они давали «Персонал:» и «Режим производства:».
    has_cond_mobilization: !isShort && !!String(cond.mobilization || '').trim(),
    has_cond_personnel: !isShort && !!String(cond.personnel || '').trim(),
    has_cond_regime: !isShort && !!String(cond.regime || '').trim(),
    has_cond_payment: !!String(cond.payment || '').trim(),
    has_cond_customer_resources: !isShort && !!String(cond.customer_resources || '').trim(),
    has_cost_notes: !isShort && !!String(full.cost_notes || '').trim(),
    has_scope_boundary: !isShort && !!String(full.scope_boundary || '').trim(),
    acceptance_paras: splitParas(full.acceptance),
    risks_paras: splitParas(full.risks),
    duties: splitListItems(full.customer_duties),
    deliverables: splitListItems(full.deliverables),
    author_position: full.author_position || 'Генеральный директор',
    // Пустая подпись «()» в клиентском документе недопустима: если ни в ТКП,
    // ни в профиле компании нет ФИО — печатаем прочерк, а не пустые скобки.
    author_name: _signerName(full, company)
  };
}

/**
 * ФИО подписанта. Пустая строка превращала подпись в «()» — верификатор
 * 05.11.2026 воспроизвёл это на реальных КП: таблицы company_profile в схеме
 * нет, профиль тянулся из несуществующего источника и catch глотал ошибку.
 */
function _signerName(full, company) {
  const c = company || {};
  const pick = (v) => String(v == null ? '' : v).trim();
  // В клиентском КП подписывает директор, а не автор записи ТКП (ТО).
  // author_name из items раньше подставлял «Газретов…» при source=ai_tender.
  const name = pick(c.director_name)
    || pick(c.director_full_name)
    || pick(c.director)
    || pick(full && full.author_name)
    || '';
  if (!name) return '________________';
  return name.toUpperCase();
}

function generateFullKpDocxBuffer(tkp, company = {}, opts = {}) {
  const variant = opts && opts.variant === 'classic' ? 'classic' : 'full';
  const data = buildFullKpTemplateData(tkp, company, { variant });
  const content = fs.readFileSync(FULL_KP_TPL);
  const { Docxtemplater, PizZip } = _loadDocxLibs();
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => ''
  });
  doc.render(data);
  let out = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  out = dropEmptyListParagraphs(out);
  if (opts && (opts.stamp || opts.signature)) {
    out = applyStampAndSignature(out, opts);
  }
  return out;
}

/**
 * Вставить печать и подпись в DOCX прямо в авторский блок шаблона.
 *
 * Раньше печать/подпись были ТОЛЬКО в HTML-версии PDF: кнопка «Word» отдавала
 * документ без печати, а «PDF» уходил в HTML-рендерер и выглядел как другой
 * шаблон (ТКП 3071, 08.11.2026). Теперь источник один — docx-шаблон, а картинки
 * вставляются в него же.
 */
function applyStampAndSignature(buf, opts) {
  let api = null;
  try { api = require('pdf-generator'); } catch (_) { api = pdfGenerator; }
  if (!api) return buf;
  const pick = (fn) => { try { return (api[fn] && api[fn]()) || ''; } catch (_) { return ''; } };
  // Штатная подпись из настроек — она и есть «подпись директора».
  const sig = opts.signature ? pick('getSignatureBase64') : '';
  const stamp = opts.stamp ? pick('getStampBase64') : '';
  if (!sig && !stamp) return buf;

  const toBuf = (dataUrl) => {
    const m = /^data:image\/(\w+);base64,([\s\S]+)$/.exec(String(dataUrl || ''));
    if (!m) return null;
    return { ext: m[1].toLowerCase().replace('jpeg', 'jpg'), buf: Buffer.from(m[2], 'base64') };
  };
  const sigImg = toBuf(sig);
  const stampImg = toBuf(stamp);

  try {
    const { PizZip } = _loadDocxLibs();
    const zip = new PizZip(buf);
    const docFile = zip.file('word/document.xml');
    const relsFile = zip.file('word/_rels/document.xml.rels');
    const ctFile = zip.file('[Content_Types].xml');
    if (!docFile || !relsFile) return buf;

    let xml = docFile.asText();
    let rels = relsFile.asText();
    let ct = ctFile ? ctFile.asText() : '';

    let relId = 90;
    const nextRel = () => {
      while (rels.includes(`Id="rId${relId}"`)) relId += 1;
      return `rId${relId++}`;
    };
    const mediaName = (ext, tag) => {
      let i = 1;
      while (zip.file(`word/media/${tag}_${i}.${ext}`)) i += 1;
      return `word/media/${tag}_${i}.${ext}`;
    };
    const addRel = (id, target) => {
      rels = rels.replace('</Relationships>',
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/></Relationships>`);
    };
    const addCt = (ext) => {
      if (!ct || ct.includes(`Extension="${ext}"`)) return;
      ct = ct.replace('</Types>', `<Default Extension="${ext}" ContentType="image/${ext === 'jpg' ? 'jpeg' : ext}"/></Types>`);
    };

    // Плавающая картинка (wp:anchor + behindDoc=0 + wrapNone): лежит ПОВЕРХ
    // текста и не участвует в потоке — строка подписи не сдвигается и не
    // ломается, как было с wp:inline (ТКП 3071, 08.11.2026).
    //
    // Обе координаты — от края СТРАНИЦЫ: колонка подписи в шаблоне узкая
    // (4,6 см), и смещение от неё выносило печать за лист или на текст.
    // ── Привязка картинки ─────────────────────────────────────────────────
    // КЛЮЧЕВОЕ: раньше обе координаты отсчитывались от края СТРАНИЦЫ
    // (relativeFrom="page") с жёсткими смещениями 104 pt по вертикали. Это
    // верхняя треть листа — печать падала в шапку/таблицу, «между текстом»
    // (жалоба владельца 09.11.2026). Шаблон меняет высоту от содержания,
    // поэтому координаты от страницы неверны ВСЕГДА.
    //
    // Теперь якорь привязан к абзацу подписи:
    //   • H/V — от абзаца, а не от листа;
    //   • wrapNone + behindDoc=0 — плавающий слой ПОВЕРХ текста: картинка не
    //     участвует в потоке и не раздвигает строки. Обтекание (wrapSquare)
    //     как раз и давало ощущение «вставлено между текстом».
    const drawing = (id, cx, cy, name, offX, offY) =>
      `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>` +
      `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${256000000 + Number(id.replace(/\D/g, ''))}" ` +
      `behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/>` +
      `<wp:positionH relativeFrom="paragraph"><wp:posOffset>${offX}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${offY}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:wrapNone/>` +
      `<wp:docPr id="${id.replace(/\D/g, '')}" name="${name}"/>` +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
      `</wp:anchor></w:drawing></w:r>`;

    const PT = 12700; // 1 pt = 12 700 EMU
    // Смещения — от строки подписи (абзац «____ (ФИО)»), не от верха листа.
    //
    // Блок подписи в шаблоне стоит ВНУТРИ таблицы и вплотную под итогами.
    // Поэтому вверх уходить нельзя: при -34 pt подпись наезжала на «ИТОГО»
    // (реальный ТКП 3072, 09.11.2026). Подпись кладём на линию (чуть выше
    // базовой), печать — правее и ниже, чтобы не закрыть ФИО.
    const SIG_OFF = { x: 4 * PT, y: -8 * PT };    // подпись — на линии
    const STAMP_OFF = { x: 196 * PT, y: 6 * PT }; // печать — правее ФИО

    let insert = '';
    // В шаблоне уже есть картинка подписи — плавающий якорь в абзаце ПЕРЕД
    // строкой «____ (ФИО)» (в самом шаблоне это отдельный абзац с якорем,
    // а «____» идёт следом). Свою поверх неё не кладём: получалось две
    // подписи в Word (жалоба владельца 09.11.2026).
    const tplParas = xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
    let sigLineIdx = -1;
    for (let i = 0; i < tplParas.length; i += 1) {
      if (/_{5,}/.test(tplParas[i].replace(/<[^>]+>/g, ''))) sigLineIdx = i;
    }
    const tplHasSignature = sigLineIdx >= 0 && tplParas
      .slice(Math.max(0, sigLineIdx - 3), sigLineIdx + 1)
      .some((p) => /<w:drawing>/.test(p));

    // ── Перестановка подписи из шаблона ───────────────────────────────────
    // Дефект 09.11.2026: подпись шаблона лежит НА строке «____ (ФИО)» и
    // закрывает фамилию. В документе подпись должна быть НАД линией, а ФИО
    // читаться под ней. Правим привязку у существующего якоря, а не ставим
    // второй: иначе в Word две подписи.
    if (tplHasSignature) {
      const p = tplParas[sigLineIdx - 1] || '';
      if (/<wp:anchor/.test(p)) {
        const fixed = p
          .replace(/<wp:positionV relativeFrom="\w+"><wp:posOffset>-?\d+<\/wp:posOffset><\/wp:positionV>/,
            `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${SIG_OFF.y}</wp:posOffset></wp:positionV>`)
          .replace(/<wp:positionH relativeFrom="\w+"><wp:posOffset>-?\d+<\/wp:posOffset><\/wp:positionH>/,
            `<wp:positionH relativeFrom="paragraph"><wp:posOffset>${SIG_OFF.x}</wp:posOffset></wp:positionH>`)
          // Остаётся плавающим слоем поверх текста (wrapNone) — так подпись
          // не раздвигает строки и не выглядит «вставленной между текстом».
          .replace(/<wp:wrapSquare[^/]*\/>/, '<wp:wrapNone/>');
        if (fixed !== p) {
          xml = xml.replace(p, fixed);
          // Перечитываем абзацы: позиции строки подписи могли сдвинуться.
          const re2 = (xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || []);
          xml = xml.replace(re2[sigLineIdx - 1] || p, fixed);
        }
      }
    }
    if (sigImg && !tplHasSignature) {
      const name = mediaName(sigImg.ext, 'signature');
      zip.file(name, sigImg.buf);
      const id = nextRel();
      addRel(id, name.replace(/^word\//, ''));
      addCt(sigImg.ext);
      insert += drawing(id, 88 * PT, 75 * PT, 'signature.png', SIG_OFF.x, SIG_OFF.y);
    }
    if (stampImg) {
      const name = mediaName(stampImg.ext, 'stamp');
      zip.file(name, stampImg.buf);
      const id = nextRel();
      addRel(id, name.replace(/^word\//, ''));
      addCt(stampImg.ext);
      insert += drawing(id, 80 * PT, 85 * PT, 'stamp.png', STAMP_OFF.x, STAMP_OFF.y);
    }
    if (!insert) return buf;

    // Ставим картинки в абзац со строкой подписи (____ (ФИО)) — как в шаблоне.
    //
    // ВАЖНО: в шаблоне ЯКОРЬ подписи живёт в абзаце ПЕРЕД линией, а текст
    // «____ (ФИО)» — в следующем. Если вставлять в абзац с текстом, картинка
    // висит над линией на предыдущей странице, а сам абзац остаётся на новой
    // (наблюдалось на реальном ТКП 3072: подпись поверх итогов, вторая
    // страница почти пустая). Поэтому вставляем в абзац, который уже держит
    // якорь, — это ровно тот блок подписи.
    let anchorIdx = sigLineIdx - 1;
    if (anchorIdx < 0 || !/<wp:anchor/.test(tplParas[anchorIdx] || '')) {
      anchorIdx = sigLineIdx;
    }
    const paras = xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
    const hostPara = (anchorIdx >= 0 && paras[anchorIdx]) ? paras[anchorIdx] : null;
    if (hostPara) {
      xml = xml.replace(hostPara, hostPara.replace(/<\/w:p>$/, '') + insert + '</w:p>');
    } else {
      xml = xml.replace('<w:sectPr', `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${insert}</w:p><w:sectPr`);
    }

    // Пустой абзац сразу после таблицы уезжает на новую страницу и создаёт
    // «лист-призрак» (реальный ТКП 3072: вторая страница пустая, подпись на
    // первой). Убираем его — подпись остаётся в блоке таблицы.
    xml = xml.replace(/<\/w:tbl><w:p\b[^>]*\/><w:sectPr/g, '</w:tbl><w:sectPr');
    xml = xml.replace(/<\/w:tbl><w:p\b[^>]*>(?:\s*<w:pPr>[\s\S]*?<\/w:pPr>)?\s*<\/w:p><w:sectPr/g,
      '</w:tbl><w:sectPr');

    zip.file('word/document.xml', xml);
    zip.file('word/_rels/document.xml.rels', rels);
    if (ct) zip.file('[Content_Types].xml', ct);
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch (e) {
    // Молчаливый возврат буфера — худший вариант: печать просто исчезает,
    // и это выглядит как «кнопка не работает». Причина должна быть видна.
    console.warn('[tkp-full-kp] печать/подпись не вставлены: ' + (e && e.message));
    return buf;
  }
}

async function generateFullKpDocx(tkpId) {
  const { rows: [tkp] } = await db.query('SELECT * FROM tkp WHERE id = $1', [tkpId]);
  if (!tkp) throw new Error('TKP not found');
  const company = await resolveCompany();
  return generateFullKpDocxBuffer(tkp, company);
}

async function htmlToPdf(html) {
  let puppeteer;
  try { puppeteer = require('puppeteer'); }
  catch (e) { throw new Error('puppeteer_unavailable'); }
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '14mm', right: '14mm' }
    });
    await page.close();
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

/**
 * DOCX → PDF через LibreOffice.
 *
 * Шаблон ОДИН: и Word, и PDF собираются из full-kp-nika-tpl.docx. Раньше при
 * запросе печати/подписи функция уходила в HTML-рендерер — и PDF получался
 * другим документом (другие шрифты, вёрстка, нет логотипа). Владелец сравнил
 * выгрузки ТКП 3071 08.11.2026: Word по шаблону, PDF — нет.
 *
 * Печать и подпись теперь вставляются в DOCX (applyStampAndSignature), поэтому
 * HTML-путь больше не нужен.
 */
async function generateFullKpPdfBuffer(tkp, opts = {}) {
  const company = await resolveCompany(opts.company);
  // `variant` ОБЯЗАН доезжать до сборки DOCX: иначе PDF короткого КП печатал
  // полный документ, и Word с PDF одного КП расходились (верификатор
  // 10.11.2026). Один шаблон, разное наполнение — но выбор должен доходить.
  const docxBuf = generateFullKpDocxBuffer(tkp, company, {
    variant: opts.variant === 'classic' ? 'classic' : 'full',
    stamp: !!opts.stamp,
    signature: !!opts.signature
  });
  const convert = _getConvertDocxToPdf();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asgard-full-kp-'));
  try {
    const docxPath = path.join(tmpDir, `full-kp-${tkp.id || 'preview'}.docx`);
    fs.writeFileSync(docxPath, docxBuf);
    const pdfPath = convert(docxPath, tmpDir);
    if (pdfPath && fs.existsSync(pdfPath)) {
      return fs.readFileSync(pdfPath);
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  // LibreOffice недоступен. Отдаём DOCX-совместимый HTML-рендер только как
  // последний резерв, но помечаем это в логе явно: молчаливая подмена шаблона
  // уже стоила разбора.
  console.warn('[tkp-full-kp] LibreOffice недоступен — PDF fallback HTML (шаблон НЕ docx)');
  let logo = '';
  if (pdfGenerator && pdfGenerator.getLogoBase64) {
    try { logo = pdfGenerator.getLogoBase64() || ''; } catch (_) {}
  }
  const html = buildFullKpHtml(tkp, { company, logo, signatureImg: '', stampImg: '' });
  return htmlToPdf(html);
}

async function generateFullKpPdf(tkpId, opts = {}) {
  const { rows: [tkp] } = await db.query('SELECT * FROM tkp WHERE id = $1', [tkpId]);
  if (!tkp) throw new Error('TKP not found');
  return generateFullKpPdfBuffer(tkp, opts);
}

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function docxP(text, opts = {}) {
  const bold = opts.bold ? '<w:b/>' : '';
  const size = opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : '';
  const align = opts.align ? `<w:jc w:val="${opts.align}"/>` : '';
  const lines = String(text == null ? '' : text).split('\n');
  const runs = lines.map((ln, i) =>
    `<w:r><w:rPr>${bold}${size}</w:rPr>${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${escXml(ln)}</w:t></w:r>`
  ).join('');
  return `<w:p><w:pPr>${align}<w:spacing w:after="100"/></w:pPr>${runs || '<w:r><w:t></w:t></w:r>'}</w:p>`;
}

/**
 * Короткое (классическое) КП — ТОТ ЖЕ шаблон «Ника», только с сокращённым
 * набором разделов.
 *
 * ── Почему так (10.11.2026) ────────────────────────────────────────────────
 * Раньше это был отдельный генератор, собиравший docx «с нуля» строками:
 * 1,6 КБ, без логотипа, без реквизитов и без печати. Заказчик получал файл,
 * не похожий на фирменный документ, а PDF и Word одного и того же ТКП
 * выглядели как два разных письма.
 *
 * Теперь шапка (лого + реквизиты + номер + срок действия), таблица стоимости
 * и блок подписи — из шаблона. Отличается только объём: в коротком КП нет
 * развёрнутых условий, периметра по аппаратам, порядка сдачи и рисков.
 *
 * @param {object} tkp
 * @param {object} company
 * @param {object} [opts] — { stamp, signature } как у полного КП
 */
function generateClassicDocxBuffer(tkp, company = {}, opts = {}) {
  return generateFullKpDocxBuffer(tkp, company, Object.assign({}, opts, { variant: 'classic' }));
}

/** Classic brief DOCX — устаревшее имя, оставлено для совместимости вызовов. */
function _legacyClassicDocxBuffer(tkp, company = {}) {
  let cj;
  try { cj = typeof tkp.items === 'string' ? JSON.parse(tkp.items || '{}') : (tkp.items || {}); }
  catch (_) { cj = {}; }
  const items = Array.isArray(cj.items) ? cj.items : [];
  const parts = [];
  parts.push(docxP(company.name || 'ООО «АСГАРД-Сервис»', { bold: true, size: 28, align: 'center' }));
  parts.push(docxP('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', { bold: true, size: 28, align: 'center' }));
  parts.push(docxP(`№ ${tkp.tkp_number || ('АС-' + tkp.id)} от ${formatDate(tkp.created_at)}`, { size: 20, align: 'center' }));
  parts.push(docxP(`Заказчик: ${tkp.customer_name || '—'}`, { size: 20 }));
  parts.push(docxP(`Предмет: ${tkp.subject || '—'}`, { size: 20 }));
  if (tkp.work_description) parts.push(docxP(tkp.work_description, { size: 20 }));
  parts.push(docxP('Состав работ и стоимость', { bold: true, size: 22 }));
  items.forEach((it, i) => {
    parts.push(docxP(`${i + 1}. ${it.name || '—'} | ${it.unit || 'усл.'} | ${it.qty || 1} × ${fmtMoney(it.price)} = ${fmtMoney(it.total || (it.qty || 1) * (it.price || 0))}`, { size: 18 }));
  });
  // total_sum в БД / модалке — цена БЕЗ НДС. Раньше её печатали как
  // «Итого с НДС» → клиент получал документ на НДС дешевле PDF
  // (верификатор 05.11.2026, ТКП 3508 / 3051). Считаем в копейках
  // (та же формула, что vatFromBase / calcTotals).
  const itemsSub = items.reduce((s, it) => s + (Number(it.total) || (Number(it.qty) || 1) * (Number(it.price) || 0)), 0);
  const baseNoVat = Number(cj.subtotal) || itemsSub || Number(tkp.total_sum) || 0;
  const vatPctClassic = Number(cj.vat_pct);
  const vatPct = Number.isFinite(vatPctClassic) && vatPctClassic >= 0 ? vatPctClassic : 22;
  const baseKop = Math.round(Number(baseNoVat) * 100);
  const bp = Math.round(vatPct * 100);
  const vatKop = baseKop > 0 ? Math.round(baseKop * bp / 10000) : 0;
  const classicBase = baseKop / 100;
  const classicVat = vatKop / 100;
  const classicTotal = (baseKop + vatKop) / 100;
  parts.push(docxP(`Итого без НДС: ${fmtMoney(classicBase)} руб.`, { size: 20 }));
  parts.push(docxP(`НДС ${vatPct}%: ${fmtMoney(classicVat)} руб.`, { size: 20 }));
  parts.push(docxP(`Итого с НДС: ${fmtMoney(classicTotal)} руб.`, { bold: true, size: 22 }));
  if (tkp.deadline) parts.push(docxP(`Сроки: ${tkp.deadline}`, { size: 20 }));
  if (cj.payment_terms) parts.push(docxP(`Оплата: ${cj.payment_terms}`, { size: 20 }));
  if (cj.notes || tkp.notes) parts.push(docxP(`Примечание: ${cj.notes || tkp.notes}`, { size: 20 }));
  parts.push(docxP(`${cj.author_position || 'Генеральный директор'}\n____________________ / ${_signerName(cj, company)} /`, { size: 20 }));

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${parts.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  return zip.toBuffer();
}

module.exports = {
  emptyFullPayload,
  getFullPayload,
  calcTotals,
  buildFullKpHtml,
  buildFullKpTemplateData,
  resolveTableLabels,
  TABLE_LABELS_DEFAULT,
  generateFullKpPdf,
  generateFullKpPdfBuffer,
  generateFullKpDocx,
  generateFullKpDocxBuffer,
  generateClassicDocxBuffer
};
