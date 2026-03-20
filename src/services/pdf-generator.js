/**
 * PDF Generator Service — ASGARD CRM
 * Generates TKP and Invoice PDFs matching corporate Excel templates
 * Uses Puppeteer (headless Chrome) for HTML→PDF conversion
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserInstance;
}

// ── Company Profile ────────────────────────────────────────
async function getCompanyProfile() {
  const { rows } = await db.query("SELECT value_json FROM settings WHERE key = 'company_profile'");
  if (rows.length > 0) {
    return typeof rows[0].value_json === 'string' ? JSON.parse(rows[0].value_json) : rows[0].value_json;
  }
  return {
    name: 'ООО «Асгард-Сервис»',
    full_name: 'Общество с ограниченной ответственностью «Асгард-Сервис»',
    inn: '7736244785', kpp: '770101001', ogrn: '1157746388128',
    legal_address: '105082, г. Москва, ул. Большая Почтовая, д. 55/59, строение 1, пом. 37',
    phone: '8(499)322-30-62', email: 'info@asgard-service.com',
    director_name: 'Кудряшов Олег Сергеевич', director_title: 'Генеральный директор',
    accountant_name: 'Иванова Елена Васильевна',
    bank_name: 'АО «Альфа-Банк»',
    bank_rs: '40702810502260000343', bank_ks: '30101810200000000593', bank_bik: '044525593',
  };
}

// ── Formatting helpers ─────────────────────────────────────
function formatMoney(amount) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} г.`;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

// ── Russian number to words (полная реализация) ────────────
function numberToWordsRu(num) {
  if (!num && num !== 0) return 'Ноль рублей 00 копеек';

  const units = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
  const unitsFem = ['','одна','две','три','четыре','пять','шесть','семь','восемь','девять'];
  const teens = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
  const tens = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
  const hundreds = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];

  function getForm(n, forms) {
    n = Math.abs(n) % 100;
    if (n > 10 && n < 20) return forms[2];
    n = n % 10;
    if (n === 1) return forms[0];
    if (n >= 2 && n <= 4) return forms[1];
    return forms[2];
  }

  function triplet(n, fem) {
    if (n === 0) return '';
    const parts = [];
    const h = Math.floor(n / 100);
    const remainder = n % 100;
    const t = Math.floor(remainder / 10);
    const u = remainder % 10;

    if (h > 0) parts.push(hundreds[h]);
    if (t === 1) {
      parts.push(teens[u]);
    } else {
      if (t > 1) parts.push(tens[t]);
      if (u > 0) parts.push(fem ? unitsFem[u] : units[u]);
    }
    return parts.join(' ');
  }

  const rub = Math.floor(Math.abs(num));
  const kop = Math.round((Math.abs(num) - rub) * 100);

  if (rub === 0) {
    return `Ноль рублей ${String(kop).padStart(2, '0')} ${getForm(kop, ['копейка','копейки','копеек'])}`;
  }

  const parts = [];

  // Миллиарды
  const billions = Math.floor(rub / 1000000000);
  if (billions > 0) {
    parts.push(triplet(billions, false) + ' ' + getForm(billions, ['миллиард','миллиарда','миллиардов']));
  }

  // Миллионы
  const millions = Math.floor((rub % 1000000000) / 1000000);
  if (millions > 0) {
    parts.push(triplet(millions, false) + ' ' + getForm(millions, ['миллион','миллиона','миллионов']));
  }

  // Тысячи (feminine!)
  const thousands = Math.floor((rub % 1000000) / 1000);
  if (thousands > 0) {
    parts.push(triplet(thousands, true) + ' ' + getForm(thousands, ['тысяча','тысячи','тысяч']));
  }

  // Единицы
  const remainder = rub % 1000;
  if (remainder > 0 || parts.length === 0) {
    parts.push(triplet(remainder, false));
  }

  const rubWord = getForm(rub, ['рубль','рубля','рублей']);
  const kopWord = getForm(kop, ['копейка','копейки','копеек']);

  let result = parts.join(' ').replace(/\s+/g, ' ').trim();
  // Capitalize first letter
  result = result.charAt(0).toUpperCase() + result.slice(1);

  return `${result} ${rubWord} ${String(kop).padStart(2, '0')} ${kopWord}`;
}

// Legacy alias
function numberToWords(num) {
  return numberToWordsRu(num);
}

// ── Images as base64 ──────────────────────────────────────
const imgCache = {};
function getImgBase64(name) {
  if (imgCache[name] !== undefined) return imgCache[name];
  try {
    const imgPath = path.join(__dirname, '..', '..', 'public', 'assets', 'img', name);
    const buf = fs.readFileSync(imgPath);
    imgCache[name] = 'data:image/png;base64,' + buf.toString('base64');
  } catch (e) {
    imgCache[name] = '';
  }
  return imgCache[name];
}
function getLogoBase64() { return getImgBase64('asgard_logo.png'); }
function getSignatureBase64() { return getImgBase64('signature.png'); }
function getStampBase64() { return getImgBase64('stamp.png'); }

// ── Common CSS ─────────────────────────────────────────────
const BASE_CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', 'DejaVu Sans', Arial, sans-serif; font-size: 10.5pt; color: #1a1a1a; line-height: 1.45; margin: 0; padding: 0; }
  table { width: 100%; border-collapse: collapse; }
  .right { text-align: right; }
  .center { text-align: center; }
  .bold { font-weight: 600; }
  .small { font-size: 9pt; }
  .muted { color: #6B7280; }
`;

// ══════════════════════════════════════════════════════════════
//  GENERATE TKP PDF
// ══════════════════════════════════════════════════════════════
async function generateTkpPdf(tkpId, opts) {
  opts = opts || {};
  const { rows: [tkp] } = await db.query('SELECT * FROM tkp WHERE id = $1', [tkpId]);
  if (!tkp) throw new Error('TKP not found');

  const company = await getCompanyProfile();
  const logo = getLogoBase64();
  const signatureImg = opts.signature ? getSignatureBase64() : '';
  const stampImg = opts.stamp ? getStampBase64() : '';

  // Parse items from JSONB
  let cj;
  try {
    cj = typeof tkp.items === 'string' ? JSON.parse(tkp.items || '{}') : (tkp.items || {});
  } catch (_) { cj = {}; }
  const items = Array.isArray(cj.items) ? cj.items : [];
  const vatPct = cj.vat_pct || 22;
  const subtotal = cj.subtotal || items.reduce((s, r) => s + (r.total || (r.qty || r.quantity || 1) * (r.price || 0)), 0);
  const vatSum = cj.vat_sum || Math.round(subtotal * vatPct / 100);
  const totalWithVat = cj.total_with_vat || (subtotal + vatSum);

  // Payment info
  const paymentType = cj.payment_type || '';
  const advancePct = cj.advance_pct || 0;
  const deferredDays = cj.deferred_days || 0;
  const paymentTerms = cj.payment_terms || '';

  // Author
  const authorName = cj.author_name || company.director_name || '';
  const authorPos = cj.author_position || company.director_title || 'Генеральный директор';

  // Validity date
  let validityDate = '';
  if (tkp.validity_days && tkp.created_at) {
    const d = new Date(tkp.created_at);
    d.setDate(d.getDate() + tkp.validity_days);
    validityDate = formatDate(d);
  }

  // Customer card lines
  const cardLines = [];
  if (tkp.customer_name) cardLines.push({ label: 'Заказчик', value: tkp.customer_name });
  if (tkp.customer_inn) cardLines.push({ label: 'ИНН', value: tkp.customer_inn + (cj.customer_kpp ? ' / КПП: ' + cj.customer_kpp : '') });
  if (tkp.customer_address) cardLines.push({ label: 'Адрес', value: tkp.customer_address });
  if (tkp.contact_person) cardLines.push({ label: 'Контактное лицо', value: tkp.contact_person });
  const contacts = [tkp.contact_phone, tkp.contact_email].filter(Boolean).join(' | ');
  if (contacts) cardLines.push({ label: 'Контакты', value: contacts });

  // Conditions
  const conditions = [];
  if (tkp.deadline) conditions.push(`Сроки выполнения: ${tkp.deadline}`);
  conditions.push(`Срок действия предложения: ${tkp.validity_days || 30} календарных дней${validityDate ? ' (до ' + validityDate + ')' : ''}`);
  if (paymentTerms) conditions.push(`Условия оплаты: ${paymentTerms}`);
  if (cj.notes || tkp.notes) conditions.push(`Примечание: ${cj.notes || tkp.notes}`);

  const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8">
<style>
${BASE_CSS}
/* ── Header ── */
.hdr { display: flex; align-items: flex-start; gap: 16px; margin-top: -10mm; }
.hdr-logo { width: 165px; flex-shrink: 0; }
.hdr-logo img { width: 100%; }
.hdr-info { flex: 1; font-size: 9pt; color: #4B5563; line-height: 1.6; }
.hdr-name { font-size: 13pt; font-weight: 700; color: #1E4D8C; margin-bottom: 2px; }
.accent { height: 3px; display: flex; margin: 10px 0 18px; }
.accent-blue { flex: 1; background: #1E4D8C; }
.accent-red { flex: 1; background: #C8293B; }

/* ── Title ── */
.kp-title { text-align: center; font-size: 15pt; font-weight: 700; color: #1E4D8C; margin: 0 0 4px; }
.kp-number { text-align: center; font-size: 10pt; color: #6B7280; margin-bottom: 16px; }

/* ── Customer card ── */
.card { background: #F8F9FA; border: 1px solid #E5E7EB; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }
.card-row { display: flex; gap: 8px; padding: 3px 0; font-size: 10pt; line-height: 1.4; }
.card-label { font-weight: 600; color: #6B7280; min-width: 120px; flex-shrink: 0; }
.card-value { color: #1a1a1a; word-wrap: break-word; overflow-wrap: break-word; }

/* ── Section titles ── */
.sec-title { font-size: 11pt; font-weight: 700; color: #1E4D8C; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #E5E7EB; }

/* ── Items table ── */
.items-table { margin: 8px 0 4px; border: 1px solid #D1D5DB; }
.items-table th { background: #1E4D8C; color: #fff; font-weight: 600; font-size: 9pt; padding: 7px 6px; border: 1px solid #1E4D8C; text-align: center; white-space: nowrap; }
.items-table td { border: 1px solid #D1D5DB; padding: 6px 8px; font-size: 9.5pt; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; }
.items-table tr:nth-child(even) td { background: #F8F9FA; }

/* ── Totals ── */
.totals-block { text-align: right; margin: 10px 0 16px; font-size: 10pt; line-height: 1.8; }
.totals-block .grand { font-size: 12pt; font-weight: 700; color: #1E4D8C; border-top: 2px solid #1E4D8C; display: inline-block; padding-top: 4px; margin-top: 2px; }

/* ── Conditions ── */
.cond-list { margin: 6px 0 0; padding: 0; list-style: none; }
.cond-list li { padding: 3px 0 3px 16px; position: relative; font-size: 10pt; line-height: 1.4; }
.cond-list li::before { content: '•'; position: absolute; left: 0; color: #1E4D8C; font-weight: 700; }

/* ── Signature ── */
.sign-block { margin-top: 14px; border-top: 1px solid #E5E7EB; padding-top: 14px; position: relative; }
.sign-row { display: flex; align-items: flex-end; gap: 20px; }
.sign-pos { font-size: 10pt; font-weight: 600; width: 180px; }
.sign-line { flex: 1; border-bottom: 1px solid #000; height: 1px; margin-bottom: 4px; position: relative; }
.sign-name { font-size: 10pt; font-weight: 600; text-align: right; width: 200px; }
.sign-images { position: relative; height: 160px; overflow: hidden; margin: -60px 0 0; }
.sign-signature { position: absolute; left: 180px; top: 0; height: 140px; }
.sign-stamp { position: absolute; left: 136px; top: 0; height: 176px; opacity: 0.85; }

/* ── Sum in words ── */
.sum-words { font-size: 11pt; font-style: italic; color: #374151; margin: 18px 0 12px; }

/* ── Footer ── */
.footer { margin-top: 10px; text-align: center; font-size: 7.5pt; color: #9CA3AF; border-top: 1px solid #E5E7EB; padding-top: 4px; }

/* ── Print ── */
html, body { height: auto !important; }
tr { page-break-inside: avoid; }
.card { page-break-inside: avoid; }
</style>
</head>
<body>

<!-- HEADER -->
<div class="hdr">
  ${logo ? `<div class="hdr-logo"><img src="${logo}" alt="Logo"></div>` : ''}
  <div class="hdr-info">
    <div class="hdr-name">${company.name || 'ООО «Асгард-Сервис»'}</div>
    <div>ИНН ${company.inn || ''} / КПП ${company.kpp || ''} / ОГРН ${company.ogrn || ''}</div>
    <div>${company.legal_address || ''}</div>
    <div>Тел: ${company.phone || ''} | E-mail: ${company.email || ''}</div>
  </div>
</div>
<div class="accent"><div class="accent-blue"></div><div class="accent-red"></div></div>

<!-- TITLE -->
<div class="kp-title">КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</div>
<div class="kp-number">№ ${tkp.tkp_number || 'АС-' + tkp.id} от ${formatDate(tkp.created_at)}</div>

${cardLines.length > 0 ? `
<!-- CUSTOMER CARD -->
<div class="card">
  ${cardLines.map(l => `<div class="card-row"><span class="card-label">${l.label}:</span><span class="card-value">${l.value}</span></div>`).join('')}
</div>` : ''}

${tkp.subject ? `
<!-- SUBJECT -->
<div class="sec-title">Предмет предложения</div>
<div style="font-weight:600;font-size:10.5pt;margin-bottom:4px">${tkp.subject}</div>` : ''}

${tkp.work_description ? `<div style="font-size:10pt;color:#374151;margin-bottom:8px;white-space:pre-line">${tkp.work_description}</div>` : ''}

${items.length > 0 ? `
<!-- ITEMS TABLE -->
<div class="sec-title">Состав работ и стоимость</div>
<table class="items-table">
  <thead>
    <tr>
      <th style="width:28px">№</th>
      <th>Наименование работ / услуг</th>
      <th style="width:40px">Ед.</th>
      <th style="width:40px">Кол.</th>
      <th style="width:80px">Цена, ₽</th>
      <th style="width:90px">Сумма, ₽</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((item, i) => {
      const qty = item.qty || item.quantity || 1;
      const price = item.price || 0;
      const lineTotal = item.total || qty * price;
      return `<tr>
        <td class="center">${i + 1}</td>
        <td>${item.name || '—'}</td>
        <td class="center">${item.unit || 'усл.'}</td>
        <td class="center">${qty}</td>
        <td class="right">${formatMoney(price)}</td>
        <td class="right">${formatMoney(lineTotal)}</td>
      </tr>`;
    }).join('')}
  </tbody>
</table>

<!-- TOTALS -->
<div class="totals-block">
  <div>Итого без НДС: <b>${formatMoney(subtotal)} ₽</b></div>
  <div>НДС ${vatPct}%: <b>${formatMoney(vatSum)} ₽</b></div>
  <div class="grand">ИТОГО с НДС: ${formatMoney(totalWithVat)} ₽</div>
</div>
<div class="sum-words">Всего ${items.length} ${items.length === 1 ? 'позиция' : (items.length < 5 ? 'позиции' : 'позиций')} на сумму: <b>${numberToWordsRu(totalWithVat)}</b></div>
` : (tkp.total_sum ? `
<div class="totals-block">
  <div class="grand">Итого: ${formatMoney(tkp.total_sum)} ₽</div>
</div>
<div class="sum-words">Сумма: <b>${numberToWordsRu(parseFloat(tkp.total_sum))}</b></div>
` : '')}

<!-- CONDITIONS -->
<div class="sec-title">Условия</div>
<ul class="cond-list">
  ${conditions.map(c => `<li>${c}</li>`).join('')}
</ul>

<!-- SIGNATURE -->
<div class="sign-block">
  <div class="sign-row">
    <div class="sign-pos">${authorPos}</div>
    <div class="sign-line"></div>
    <div class="sign-name">${authorName}</div>
  </div>
${(signatureImg || stampImg) ? `  <div class="sign-images">
    ${signatureImg ? `<img class="sign-signature" src="${signatureImg}" alt="">` : ''}
    ${stampImg ? `<img class="sign-stamp" src="${stampImg}" alt="">` : ''}
  </div>` : `  <div style="text-align:center;font-size:8pt;color:#9CA3AF;margin-top:12px">М.П.</div>`}
</div>

<!-- FOOTER -->
<div class="footer">${company.name || 'ООО «Асгард-Сервис»'} — ${company.phone || ''} — ${company.email || ''}</div>

</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '14mm', bottom: '18mm', left: '18mm', right: '18mm' },
    displayHeaderFooter: false
  });
  await page.close();
  return pdfBuffer;
}


// ══════════════════════════════════════════════════════════════
//  GENERATE INVOICE PDF
// ══════════════════════════════════════════════════════════════
async function generateInvoicePdf(invoiceId) {
  const { rows: [inv] } = await db.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (!inv) throw new Error('Invoice not found');

  const company = await getCompanyProfile();
  const vatRate = parseFloat(company.vat_rate || inv.vat_pct || 22) / 100;
  const vatPct = Math.round(vatRate * 100);

  let items = [];
  try {
    const { rows } = await db.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY position', [invoiceId]);
    items = rows;
  } catch (e) {
    items = [{
      position: 1,
      name: inv.description || inv.comment || 'Оплата по счёту',
      unit: 'усл.', quantity: 1,
      price: inv.amount || 0, total: inv.amount || 0,
    }];
  }

  const subtotal = items.reduce((s, i) => s + (i.total || i.price * (i.quantity || 1)), 0);
  const vat = subtotal * vatRate;
  const total = subtotal + vat;

  const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8">
<style>
${BASE_CSS}
.bank-table { border: 2px solid #000; margin-bottom: 20px; }
.bank-table td { border: 1px solid #000; padding: 3px 8px; font-size: 9.5pt; vertical-align: top; }
.bank-label { color: #666; font-size: 8pt; display: block; }
.items-table th, .items-table td { border: 1px solid #000; padding: 5px 8px; font-size: 10.5pt; }
.items-table th { background: #e8e8e8; font-weight: bold; text-align: center; font-size: 10pt; }
.totals-row td { font-weight: bold; }
.grand-row td { font-size: 12pt; font-weight: bold; background: #f5f5f5; border: 2px solid #000; }
.sign-line { display: inline-block; width: 180px; border-bottom: 1px solid #000; margin: 0 8px; }
.parties-table td { padding: 3px 8px; vertical-align: top; font-size: 10.5pt; }
.parties-table .label { font-weight: bold; width: 110px; white-space: nowrap; }
</style>
</head>
<body>

<!-- ═══ БАНКОВСКИЙ БЛОК ═══ -->
<table class="bank-table">
  <tr>
    <td style="width:65%">
      <span class="bank-label">Банк получателя</span>
      <b>${company.bank_name || ''}</b>
    </td>
    <td>
      <span class="bank-label">БИК</span>
      ${company.bank_bik || ''}
    </td>
  </tr>
  <tr>
    <td>
      <span class="bank-label">Получатель</span>
      <b>${company.name || ''}</b><br>
      ИНН ${company.inn || ''} КПП ${company.kpp || ''}
    </td>
    <td>
      <span class="bank-label">Сч. №</span>
      ${company.bank_rs || ''}
    </td>
  </tr>
  <tr>
    <td colspan="2">
      <span class="bank-label">К/сч.</span>
      ${company.bank_ks || ''}
    </td>
  </tr>
</table>

<!-- ═══ ЗАГОЛОВОК СЧЁТА ═══ -->
<div style="text-align:center;font-size:16pt;font-weight:bold;margin:20px 0 15px;border-bottom:2px solid #000;padding-bottom:10px">
  СЧЁТ № ${inv.invoice_number || inv.id} от ${formatDate(inv.invoice_date || inv.created_at)}
</div>

<!-- ═══ СТОРОНЫ ═══ -->
<table class="parties-table" style="margin:10px 0 15px">
  <tr>
    <td class="label">Поставщик:</td>
    <td>${company.full_name || company.name}, ИНН ${company.inn}, КПП ${company.kpp}, ${company.legal_address}</td>
  </tr>
  <tr>
    <td class="label">Покупатель:</td>
    <td>${inv.customer_name || '—'}${inv.customer_inn ? ', ИНН ' + inv.customer_inn : ''}${inv.customer_address ? ', ' + inv.customer_address : ''}</td>
  </tr>
</table>

<!-- ═══ ТАБЛИЦА ПОЗИЦИЙ ═══ -->
<table class="items-table" style="margin:15px 0">
  <thead>
    <tr>
      <th style="width:35px">№</th>
      <th>Наименование товара / услуги</th>
      <th style="width:55px">Ед.<br>изм.</th>
      <th style="width:55px">Кол-во</th>
      <th style="width:90px">Цена, руб.</th>
      <th style="width:100px">Сумма, руб.</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((item, i) => {
      const lineTotal = item.total || item.price * (item.quantity || 1);
      return `<tr>
        <td class="center">${item.position || i + 1}</td>
        <td>${item.name || item.description || '—'}</td>
        <td class="center">${item.unit || 'усл.'}</td>
        <td class="center">${item.quantity || 1}</td>
        <td class="right">${formatMoney(item.price)}</td>
        <td class="right">${formatMoney(lineTotal)}</td>
      </tr>`;
    }).join('')}
  </tbody>
  <tfoot>
    <tr class="totals-row">
      <td colspan="5" class="right" style="border:1px solid #000;padding:5px 8px">Итого без НДС:</td>
      <td class="right" style="border:1px solid #000;padding:5px 8px">${formatMoney(subtotal)}</td>
    </tr>
    <tr class="totals-row">
      <td colspan="5" class="right" style="border:1px solid #000;padding:5px 8px">НДС (${vatPct}%):</td>
      <td class="right" style="border:1px solid #000;padding:5px 8px">${formatMoney(vat)}</td>
    </tr>
    <tr class="grand-row">
      <td colspan="5" class="right" style="padding:6px 8px">Всего к оплате:</td>
      <td class="right" style="padding:6px 8px">${formatMoney(total)}</td>
    </tr>
  </tfoot>
</table>

<!-- ═══ СУММА ПРОПИСЬЮ ═══ -->
<div style="margin:10px 0;font-size:11pt;font-style:italic">
  Всего наименований ${items.length}, на сумму: <b>${numberToWordsRu(total)}</b>
</div>

<!-- ═══ ПОДПИСИ ═══ -->
<div style="margin:40px 0 0">
  <div style="margin:25px 0">
    Руководитель <span class="sign-line"></span> / ${company.director_name || ''} /
  </div>
  <div style="margin:25px 0">
    Гл. бухгалтер <span class="sign-line"></span> / ${company.accountant_name || ''} /
  </div>
  <div style="text-align:center;margin-top:30px;color:#aaa;font-size:10pt">М.П.</div>
</div>

</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '15mm', bottom: '15mm', left: '20mm', right: '20mm' }
  });
  await page.close();
  return pdfBuffer;
}

// ── Cleanup ────────────────────────────────────────────────
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

process.on('exit', () => { if (browserInstance) browserInstance.close().catch(() => {}); });

module.exports = {
  generateTkpPdf,
  generateInvoicePdf,
  getCompanyProfile,
  closeBrowser,
  formatMoney,
  formatDate,
  numberToWordsRu,
  numberToWords,
};
