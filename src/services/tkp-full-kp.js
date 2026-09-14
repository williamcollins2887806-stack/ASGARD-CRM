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
    apparatus: [], // { equipment, inventory_no, tube_data, qty, amount_no_vat }
    transport_amount: 0,
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

function calcTotals(full, vatPct) {
  const vat = vatPct != null ? Number(vatPct) : 22;
  let subtotal = 0;
  for (const row of full.apparatus || []) {
    subtotal += Number(row.amount_no_vat) || 0;
  }
  subtotal += Number(full.transport_amount) || 0;
  const vatSum = Math.round(subtotal * vat / 100 * 100) / 100;
  const total = Math.round((subtotal + vatSum) * 100) / 100;
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
  const totals = calcTotals(full, vatPct);

  const num = tkp.tkp_number || ('АС-' + tkp.id);
  const dateStr = formatDate(tkp.created_at || new Date());
  const validity = tkp.validity_days || 30;

  const cond = full.conditions || {};
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
      <td>${esc(r.equipment || '—')}</td>
      <td>${esc(r.inventory_no || '—')}</td>
      <td>${esc(r.tube_data || '—')}</td>
      <td class="c">${esc(r.qty || '1 компл.')}</td>
      <td class="r">${fmtMoney(r.amount_no_vat)}</td>
    </tr>`).join('');

  const authorPos = full.author_position || 'Генеральный директор';
  const authorName = full.author_name || company.director_name || '';

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

${(full.apparatus || []).length ? sectionBlock('Стоимость работ по аппаратам', `
<table class="app">
  <thead><tr>
    <th style="width:28px">№</th>
    <th>Оборудование</th>
    <th style="width:90px">Инвентарный №</th>
    <th>Расчетные данные по трубкам</th>
    <th style="width:70px">Кол-во</th>
    <th style="width:110px">Сумма без НДС, руб.</th>
  </tr></thead>
  <tbody>
    ${apparatusRows}
    <tr>
      <td colspan="5"><b>Транспортные расходы: мобилизация и демобилизация оборудования и персонала</b></td>
      <td class="r"><b>${fmtMoney(full.transport_amount)}</b></td>
    </tr>
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

/** Данные для templates/full-kp-nika-tpl.docx */
function buildFullKpTemplateData(tkp, company = {}) {
  const full = getFullPayload(tkp);
  const cj = parseItems(tkp);
  const vatPct = cj.vat_pct != null ? Number(cj.vat_pct) : 22;
  const totals = calcTotals(full, vatPct);
  const cond = full.conditions || {};
  const companyName = company.name || company.name_short || 'ООО «АСГАРД-Сервис»';
  const priceSummary = cond.price_summary
    || `${fmtMoney(totals.subtotal)} руб. без НДС; НДС ${vatPct}% — ${fmtMoney(totals.vatSum)} руб.; итого с НДС — ${fmtMoney(totals.total)} руб.`;

  const apparatus = (full.apparatus || []).map((r, i) => ({
    n: String(i + 1),
    equipment: r.equipment || '—',
    inventory_no: r.inventory_no || '—',
    tube_data: r.tube_data || '—',
    qty: r.qty || '1 компл.',
    amount: fmtMoney(r.amount_no_vat)
  }));

  let totalWords = '';
  try {
    const w = numberToWordsRu(totals.total);
    totalWords = w && w !== String(totals.total) ? w : '';
  } catch (_) { totalWords = ''; }

  return {
    company_name: companyName,
    company_address: company.legal_address || company.address || '',
    company_phone: company.phone || '',
    tkp_number: tkp.tkp_number || ('АС-' + (tkp.id || '')),
    tkp_date: formatDate(tkp.created_at || new Date()),
    validity_days: String(tkp.validity_days || 30),
    customer_name: tkp.customer_name || '—',
    object_name: full.object_name || '—',
    subject: tkp.subject || '—',
    basis: full.basis || '—',
    cond_mobilization: cond.mobilization || '',
    cond_personnel: cond.personnel || '',
    cond_regime: cond.regime || '',
    cond_payment: cond.payment || '',
    cond_customer_resources: cond.customer_resources || '',
    cond_price_summary: priceSummary,
    scope_paras: splitParas(full.scope),
    scope_boundary: full.scope_boundary || '',
    apparatus,
    transport_amount: fmtMoney(full.transport_amount),
    subtotal: fmtMoney(totals.subtotal),
    vat_pct: String(vatPct),
    vat_sum: fmtMoney(totals.vatSum),
    total: fmtMoney(totals.total),
    total_words: totalWords,
    cost_notes: full.cost_notes || '',
    acceptance_paras: splitParas(full.acceptance),
    risks_paras: splitParas(full.risks),
    duties: splitListItems(full.customer_duties),
    deliverables: splitListItems(full.deliverables),
    author_position: full.author_position || 'Генеральный директор',
    author_name: (full.author_name || company.director_name || company.director_full_name || '').toUpperCase()
  };
}

function generateFullKpDocxBuffer(tkp, company = {}) {
  if (!fs.existsSync(FULL_KP_TPL)) {
    throw new Error('Шаблон полного КП не найден: templates/full-kp-nika-tpl.docx');
  }
  const { Docxtemplater, PizZip } = _loadDocxLibs();
  const data = buildFullKpTemplateData(tkp, company);
  const content = fs.readFileSync(FULL_KP_TPL);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => ''
  });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
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

/** DOCX → PDF через LibreOffice; при отсутствии LO — HTML fallback. */
async function generateFullKpPdfBuffer(tkp, opts = {}) {
  const company = await resolveCompany(opts.company);
  const docxBuf = generateFullKpDocxBuffer(tkp, company);

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

  // Fallback: старый HTML→Puppeteer (не 1:1 со шаблоном)
  console.warn('[tkp-full-kp] LibreOffice недоступен — PDF fallback HTML');
  let logo = '';
  let signatureImg = '';
  let stampImg = '';
  if (pdfGenerator) {
    try {
      if (pdfGenerator.getLogoBase64) logo = pdfGenerator.getLogoBase64() || '';
      if (opts.signature && pdfGenerator.getSignatureBase64) signatureImg = pdfGenerator.getSignatureBase64() || '';
      if (opts.stamp && pdfGenerator.getStampBase64) stampImg = pdfGenerator.getStampBase64() || '';
    } catch (_) {}
  }
  const html = buildFullKpHtml(tkp, { company, logo, signatureImg, stampImg });
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

/** Classic brief DOCX (упрощённый) */
function generateClassicDocxBuffer(tkp, company = {}) {
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
  const total = tkp.total_sum || cj.total_with_vat || 0;
  parts.push(docxP(`Итого с НДС: ${fmtMoney(total)} руб.`, { bold: true, size: 22 }));
  if (tkp.deadline) parts.push(docxP(`Сроки: ${tkp.deadline}`, { size: 20 }));
  if (cj.payment_terms) parts.push(docxP(`Оплата: ${cj.payment_terms}`, { size: 20 }));
  if (cj.notes || tkp.notes) parts.push(docxP(`Примечание: ${cj.notes || tkp.notes}`, { size: 20 }));
  parts.push(docxP(`${cj.author_position || 'Генеральный директор'}\n____________________ / ${cj.author_name || company.director_name || ''} /`, { size: 20 }));

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
  generateFullKpPdf,
  generateFullKpPdfBuffer,
  generateFullKpDocx,
  generateFullKpDocxBuffer,
  generateClassicDocxBuffer
};
