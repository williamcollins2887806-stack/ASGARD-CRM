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

// ── Logo as base64 ─────────────────────────────────────────
let logoBase64Cache = null;
function getLogoBase64() {
  if (logoBase64Cache) return logoBase64Cache;
  try {
    const logoPath = path.join(__dirname, '..', '..', 'public', 'assets', 'img', 'asgard_logo.png');
    const buf = fs.readFileSync(logoPath);
    logoBase64Cache = 'data:image/png;base64,' + buf.toString('base64');
  } catch (e) {
    logoBase64Cache = '';
  }
  return logoBase64Cache;
}

// ── Common CSS ─────────────────────────────────────────────
const BASE_CSS = `
  @page { margin: 15mm 20mm; size: A4; }
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', 'DejaVu Serif', serif; font-size: 12pt; color: #000; line-height: 1.35; margin: 0; padding: 0; }
  table { width: 100%; border-collapse: collapse; }
  .mono { font-family: 'Courier New', monospace; }
  .right { text-align: right; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .small { font-size: 9pt; }
  .muted { color: #666; }
`;

// ══════════════════════════════════════════════════════════════
//  GENERATE TKP PDF
// ══════════════════════════════════════════════════════════════
async function generateTkpPdf(tkpId) {
  const { rows: [tkp] } = await db.query('SELECT * FROM tkp WHERE id = $1', [tkpId]);
  if (!tkp) throw new Error('TKP not found');

  const company = await getCompanyProfile();
  const logo = getLogoBase64();
  const vatRate = parseFloat(company.vat_rate || 22) / 100;

  // Get TKP items
  let items = [];
  try {
    const { rows } = await db.query('SELECT * FROM tkp_items WHERE tkp_id = $1 ORDER BY position', [tkpId]);
    items = rows;
  } catch (e) {
    items = [{
      position: 1,
      name: tkp.title || tkp.work_description || 'Выполнение работ',
      unit: 'усл.', quantity: 1,
      price: tkp.amount || 0, total: tkp.amount || 0,
    }];
  }

  const subtotal = items.reduce((s, i) => s + (i.total || i.price * (i.quantity || 1)), 0);
  const vat = subtotal * vatRate;
  const total = subtotal + vat;
  const vatPct = Math.round(vatRate * 100);

  // Validity date
  let validityDate = '';
  if (tkp.validity_days && tkp.created_at) {
    const d = new Date(tkp.created_at);
    d.setDate(d.getDate() + tkp.validity_days);
    validityDate = formatDate(d);
  }

  const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8">
<style>
${BASE_CSS}
.header-table td { vertical-align: top; padding: 0; border: none; }
.logo-cell { width: 140px; padding-right: 15px; }
.logo-cell img { width: 130px; }
.company-cell { font-size: 10pt; line-height: 1.5; }
.company-name { font-size: 14pt; font-weight: bold; }
.header-line { border-bottom: 2px solid #333; margin: 8px 0 20px; }
.items-table th, .items-table td { border: 1px solid #333; padding: 5px 8px; font-size: 10.5pt; }
.items-table th { background: #e8e8e8; font-weight: bold; text-align: center; font-size: 10pt; }
.totals-row td { border: 1px solid #333; padding: 5px 8px; font-size: 11pt; font-weight: bold; }
.grand-row td { border: 2px solid #333; padding: 6px 8px; font-size: 12pt; font-weight: bold; background: #f5f5f5; }
.sign-line { display: inline-block; width: 200px; border-bottom: 1px solid #000; margin: 0 10px; }
</style>
</head>
<body>

<!-- ═══ ШАПКА С ЛОГОТИПОМ ═══ -->
<table class="header-table">
  <tr>
    ${logo ? `<td class="logo-cell"><img src="${logo}" alt="Logo"></td>` : ''}
    <td class="company-cell">
      <div class="company-name">${company.name || 'ООО «Асгард-Сервис»'}</div>
      <div>${company.legal_address || ''}</div>
      <div>ИНН / КПП: ${company.inn || ''} / ${company.kpp || ''}</div>
      <div>${company.bank_name || ''}</div>
      <div>р/с ${company.bank_rs || ''}, к/с ${company.bank_ks || ''}, БИК ${company.bank_bik || ''}</div>
      <div>e-mail: ${company.email || ''}, тел: ${company.phone || ''}</div>
    </td>
  </tr>
</table>
<div class="header-line"></div>

<!-- ═══ НОМЕР И ДАТА ═══ -->
<div style="text-align:center;font-size:14pt;font-weight:bold;margin:15px 0 5px;">
  №${tkp.tkp_number || 'АС-' + tkp.id} от ${formatDate(tkp.created_at)}
</div>

<!-- ═══ ПРИВЕТСТВИЕ ═══ -->
<div style="margin:15px 0">
  <p>Уважаемые коллеги!</p>
  <p>Направляем Вам коммерческое предложение${tkp.work_description ? ' на ' + tkp.work_description : ''}.</p>
</div>

${tkp.customer_name ? `
<div style="margin:10px 0">
  <b>Заказчик:</b> ${tkp.customer_name}${tkp.customer_inn ? ' (ИНН: ' + tkp.customer_inn + ')' : ''}
</div>` : ''}

<!-- ═══ ТАБЛИЦА ПОЗИЦИЙ ═══ -->
<table class="items-table" style="margin:15px 0">
  <thead>
    <tr>
      <th style="width:35px">№<br>п/п</th>
      <th>Наименование работ</th>
      <th style="width:55px">Ед.<br>изм.</th>
      <th style="width:55px">Кол-во</th>
      <th style="width:90px">Цена, руб.<br>без НДС</th>
      <th style="width:100px">Сумма, руб.<br>без НДС</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((item, i) => {
      const lineTotal = item.total || item.price * (item.quantity || 1);
      return `<tr>
        <td class="center">${item.position || i + 1}</td>
        <td>${item.name || item.title || '—'}</td>
        <td class="center">${item.unit || 'усл.'}</td>
        <td class="center">${item.quantity || 1}</td>
        <td class="right">${formatMoney(item.price)}</td>
        <td class="right">${formatMoney(lineTotal)}</td>
      </tr>`;
    }).join('')}
  </tbody>
  <tfoot>
    <tr class="totals-row">
      <td colspan="5" class="right">Итого без НДС:</td>
      <td class="right">${formatMoney(subtotal)}</td>
    </tr>
    <tr class="totals-row">
      <td colspan="5" class="right">НДС (${vatPct}%):</td>
      <td class="right">${formatMoney(vat)}</td>
    </tr>
    <tr class="grand-row">
      <td colspan="5" class="right">Итого с НДС:</td>
      <td class="right">${formatMoney(total)}</td>
    </tr>
  </tfoot>
</table>

<!-- ═══ ПРИМЕЧАНИЯ ═══ -->
<div style="margin:15px 0;font-size:11pt">
  ${tkp.notes ? `<p><b>Примечание:</b> ${tkp.notes}</p>` : ''}
  <p>Срок действия ТКП${validityDate ? ' до ' + validityDate : ': 30 календарных дней'}.</p>
  ${tkp.execution_days ? `<p>Срок выполнения работ: ${tkp.execution_days} дней.</p>` : ''}
</div>

<!-- ═══ ПОДПИСЬ ═══ -->
<div style="margin:50px 0 0">
  <div>${company.director_title || 'Генеральный директор'}</div>
  <div style="margin:25px 0">
    ${company.name} <span class="sign-line"></span> ${company.director_name || ''}
  </div>
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
