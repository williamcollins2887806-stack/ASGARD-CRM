'use strict';

/**
 * src/services/letter/pdf-letter.js
 *
 * Генерация PDF из correspondence для composer'а.
 *
 * Источник: tests/reports/letters/_LETTER_CONTRACT.md §1, §4.7.
 *
 * Метод: HTML→PDF через puppeteer (по образцу pdf-generator.js:generateTkpPdf,
 *   строки 7, 14-22, 186-187, 392-413). Reuse singleton browser-instance, чтобы
 *   не дёргать launch на каждый запрос (TKP-page делает то же).
 *
 * Toggle подпись/печать:
 *   - opts.with_signature → накладываем signature.png через <img class="overlay">.
 *   - opts.with_stamp     → накладываем stamp.png.
 *   - оба false → плашка «М.П.» (как в pdf-generator.js:395).
 *   - дефолты берутся из correspondence.signature_on / .stamp_on (после finalize
 *     эти поля фиксируются), иначе true.
 *
 * Визуал — бланк ГНШ (логотип сверху, шапка, тело, подпись справа, под
 * подписью реквизиты «Исп.: …», узкий футер с реквизитами компании).
 */

const path = require('path');
const puppeteer = require('puppeteer');

const _shared = require('./_shared');

// ─── Singleton browser ────────────────────────────────────────────────────
let _browser = null;
async function _getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  const launchOpts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  };
  // Локально на Windows версия Chrome из puppeteer-cache может не совпасть
  // (puppeteer ожидает X.Y.Z.46, а кэше есть только .77) → если задана
  // переменная PUPPETEER_EXECUTABLE_PATH — использовать её. На проде (Linux)
  // эта переменная не задана и puppeteer сам найдёт bundled chrome.
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  _browser = await puppeteer.launch(launchOpts);
  return _browser;
}

/**
 * Принудительно закрыть browser. Вызывать при shutdown'е приложения
 * (например, в process.on('SIGTERM', closeBrowser)) — pdf-generator.js
 * этого не делает, поэтому в composer'е делаем сами.
 */
async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (_) { /* */ }
    _browser = null;
  }
}

// ─── HTML escape ──────────────────────────────────────────────────────────
function _esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── buildHtml ────────────────────────────────────────────────────────────
/**
 * Собрать полный HTML письма-бланка.
 *
 * Source of truth по визуалу — фактический composer бланк во фронте
 * (vanilla `public/assets/js/letter-composer.js` + React v2
 * `public/desktop-v2-src/src/pages/Composer/*`). Здесь — серверная копия:
 * лого + шапка-meta + заголовок документа + тело (body_html as-is) +
 * подпись (с overlay подпись/печать).
 *
 * @param {object} correspondence
 * @param {object} data — собранные поля (company, gendir, executor, customer)
 * @param {object} opts — {with_signature, with_stamp}
 * @returns {string} html
 */
function buildHtml(correspondence, data, opts) {
  const logo = _shared.getLogoBase64();           // 'data:image/png;base64,...'
  const signature = opts.with_signature ? _shared.getSignatureBase64() : '';
  const stamp     = opts.with_stamp     ? _shared.getStampBase64()     : '';

  const headerSubline   = correspondence.header_subline || '';
  const procedureNumber = correspondence.procedure_number || '';
  const lotNumber       = correspondence.lot_number || '';
  const lotTitle        = correspondence.lot_title || '';

  const procurementBlock = (procedureNumber || lotNumber || lotTitle)
    ? `<div class="procurement-meta">${_esc([procedureNumber && `Закупка № ${procedureNumber}`, lotNumber && `Лот № ${lotNumber}`, lotTitle].filter(Boolean).join('. '))}</div>`
    : '';

  const docTitle = correspondence.doc_title || correspondence.subject || '';
  const docSub   = correspondence.doc_sub || '';

  // body_html подаётся as-is (TipTap уже sanitize'd на input'е), но для
  // безопасности убираем <script>/<style> — на проде XSS-санитайз делает
  // serializeHTML в API. Здесь pdf-генератор внутренний, не пользовательский
  // input, но защита недорогая.
  const bodyHtml = String(correspondence.body_html || correspondence.body || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"/>
<title>${_esc(correspondence.number || 'Письмо')}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    color: #111;
    line-height: 1.4;
    background: #fff;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 18mm 16mm 20mm 22mm;
    position: relative;
  }
  .letterhead {
    border-bottom: 1pt solid #0b3d2e;
    padding-bottom: 8mm;
    margin-bottom: 6mm;
    display: flex;
    align-items: flex-start;
    gap: 8mm;
  }
  .letterhead .logo img { height: 18mm; }
  .letterhead .meta {
    flex: 1;
    font-size: 9.5pt;
    color: #333;
    line-height: 1.35;
  }
  .letterhead .meta b { color: #0b3d2e; }
  .meta-row {
    display: flex;
    justify-content: space-between;
    margin: 4mm 0;
    font-size: 10pt;
  }
  .meta-row .left  { white-space: nowrap; }
  .meta-row .right { text-align: right; max-width: 90mm; }
  .procurement-meta {
    font-size: 9.5pt;
    color: #555;
    margin-bottom: 4mm;
    font-style: italic;
  }
  .doc-title {
    text-align: center;
    font-weight: bold;
    font-size: 14pt;
    margin: 6mm 0 2mm;
    text-transform: uppercase;
  }
  .doc-sub {
    text-align: center;
    font-size: 11pt;
    color: #555;
    margin-bottom: 6mm;
  }
  .body {
    text-align: justify;
    font-size: 12pt;
    margin: 6mm 0 10mm;
  }
  .body p { margin: 0 0 3mm; text-indent: 12mm; }
  .body ul, .body ol { margin: 0 0 3mm 12mm; }
  .body table { border-collapse: collapse; margin: 3mm 0; width: 100%; }
  .body table td, .body table th { border: 0.5pt solid #999; padding: 2mm 3mm; }
  .signature-block {
    margin-top: 14mm;
    position: relative;
    min-height: 36mm;
  }
  .signature-row {
    display: flex;
    align-items: flex-end;
    gap: 4mm;
    font-size: 11pt;
  }
  .signature-row .position { flex: 1; }
  .signature-row .line {
    width: 60mm;
    border-bottom: 0.5pt solid #111;
    margin: 0 4mm;
    height: 6mm;
  }
  .signature-row .name { white-space: nowrap; }
  .overlay-signature {
    position: absolute;
    left: 80mm;
    top: -2mm;
    width: 50mm;
    opacity: 0.92;
    pointer-events: none;
  }
  .overlay-stamp {
    position: absolute;
    left: 95mm;
    top: -8mm;
    width: 38mm;
    opacity: 0.78;
    pointer-events: none;
  }
  .mp-placeholder {
    margin-top: 6mm;
    text-align: center;
    color: #9CA3AF;
    font-size: 9pt;
    width: 40mm;
    margin-left: 90mm;
  }
  .executor {
    margin-top: 10mm;
    font-size: 9pt;
    color: #555;
    border-top: 0.25pt dotted #aaa;
    padding-top: 2mm;
  }
  .footer {
    position: absolute;
    bottom: 8mm;
    left: 22mm;
    right: 16mm;
    font-size: 8pt;
    color: #888;
    text-align: center;
  }
</style>
</head>
<body>
<div class="page">

  <div class="letterhead">
    ${logo ? `<div class="logo"><img src="${logo}" alt=""/></div>` : ''}
    <div class="meta">
      <b>${_esc(data.company.name_short)}</b><br>
      ${_esc(data.company.legal_address)}<br>
      ИНН ${_esc(data.company.inn)} · КПП ${_esc(data.company.kpp)} · ОГРН ${_esc(data.company.ogrn)}<br>
      ${_esc(data.company.phone)} · ${_esc(data.company.email)}
    </div>
  </div>

  <div class="meta-row">
    <div class="left">
      Исх. № <b>${_esc(correspondence.number || 'б/н')}</b><br>
      от ${_esc(_shared.formatRuDate(correspondence.date || new Date()))}
    </div>
    <div class="right">
      ${_esc(data.customer.full_name)}${data.customer.director_short ? `<br>${_esc(data.customer.director_short)}` : ''}
    </div>
  </div>

  ${procurementBlock}
  ${headerSubline ? `<div class="procurement-meta">${_esc(headerSubline)}</div>` : ''}

  ${docTitle ? `<div class="doc-title">${_esc(docTitle)}</div>` : ''}
  ${docSub ? `<div class="doc-sub">${_esc(docSub)}</div>` : ''}

  <div class="body">${bodyHtml}</div>

  <div class="signature-block">
    <div class="signature-row">
      <div class="position">${_esc(data.gendir.position)}<br>${_esc(data.company.name_short)}</div>
      <div class="line"></div>
      <div class="name">/ ${_esc(data.gendir.name)} /</div>
    </div>
    ${signature ? `<img class="overlay-signature" src="${signature}" alt=""/>` : ''}
    ${stamp     ? `<img class="overlay-stamp"     src="${stamp}"     alt=""/>` : ''}
    ${(!signature && !stamp) ? `<div class="mp-placeholder">М.П.</div>` : ''}

    <div class="executor">
      Исп.: ${_esc(data.executor.full_name || data.executor.name)}${data.executor.phone ? ` · тел. ${_esc(data.executor.phone)}` : ''}${data.executor.email ? ` · ${_esc(data.executor.email)}` : ''}
    </div>
  </div>

  <div class="footer">
    ${_esc(data.company.name_short)} — ${_esc(data.company.phone)} — ${_esc(data.company.email)}
  </div>

</div>
</body></html>`;
}

// ─── Main: generateLetterPdf ──────────────────────────────────────────────
/**
 * Сгенерировать PDF из correspondence + опций.
 *
 * @param {object} correspondence — строка таблицы correspondence (полная).
 * @param {object} [options]
 * @param {boolean} [options.with_signature]  default — correspondence.signature_on (или true).
 * @param {boolean} [options.with_stamp]      default — correspondence.stamp_on (или true).
 * @param {boolean} [options.dadata=true]
 * @param {string}  [options.save_to]  если задан — записать PDF, вернуть путь.
 * @param {object}  [options.db]
 * @returns {Promise<Buffer|string>}
 */
async function generateLetterPdf(correspondence, options) {
  if (!correspondence || typeof correspondence !== 'object') {
    throw new Error('[pdf-letter] correspondence обязателен (объект из таблицы correspondence)');
  }
  const opts = options || {};
  const withSignature = (opts.with_signature !== undefined)
    ? !!opts.with_signature
    : (correspondence.signature_on !== false);
  const withStamp = (opts.with_stamp !== undefined)
    ? !!opts.with_stamp
    : (correspondence.stamp_on !== false);
  const useDadata = opts.dadata !== false;

  const dbClient = opts.db || undefined;
  const [company, gendir, executor] = await Promise.all([
    _shared.loadCompanyProfile(dbClient),
    _shared.loadAsgardGendir(dbClient),
    _shared.loadUserById(correspondence.created_by, dbClient)
  ]);

  let customer = {
    name: correspondence.counterparty || '—',
    full_name: correspondence.counterparty || '—',
    director_short: ''
  };

  if (useDadata && correspondence.customer_id && dbClient) {
    try {
      const r = await dbClient.query(
        'SELECT name, inn FROM customers WHERE id=$1 LIMIT 1',
        [correspondence.customer_id]
      );
      if (r.rows[0] && r.rows[0].inn) {
        const dad = await _shared.lookupCustomerByDadata(r.rows[0].inn);
        if (dad) {
          customer = {
            name: dad.name || r.rows[0].name || correspondence.counterparty || '—',
            full_name: dad.full_name || dad.name || correspondence.counterparty || '—',
            director_short: dad.director_short || ''
          };
        }
      }
    } catch (_) { /* */ }
  }

  // signer_snapshot имеет приоритет над settings (если письмо финализировано).
  const sn = correspondence.signer_snapshot || null;
  const gendirEffective = sn
    ? {
        name:     sn.name     || gendir.name,
        position: sn.position || gendir.position,
        org:      sn.org      || gendir.org
      }
    : gendir;

  const html = buildHtml(correspondence, {
    company, gendir: gendirEffective, executor, customer
  }, { with_signature: withSignature, with_stamp: withStamp });

  const browser = await _getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      displayHeaderFooter: false
    });
    if (opts.save_to) {
      require('fs').writeFileSync(opts.save_to, buf);
      return opts.save_to;
    }
    return buf;
  } finally {
    try { await page.close(); } catch (_) { /* */ }
  }
}

module.exports = {
  generateLetterPdf,
  buildHtml,
  closeBrowser
};
