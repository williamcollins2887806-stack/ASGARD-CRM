'use strict';

/**
 * src/services/obs-letter-docx.js
 *
 * D-384: письмо для ОБС в РЕДАКТИРУЕМОМ Word на фирменном бланке.
 *
 * ЗАЧЕМ. Первая версия «Word» собирала DOCX из текста PDF: получался
 * голый текст без логотипа, без реквизитов и без подписи. Заказчик
 * 27.10.2026: «Так не пойдёт. Нужен нормальный ворд. Как шаблон Димы 1в1
 * на оф бланке с логотипом». Для PDF такой бланк уже был (obs-letter.js),
 * а для Word — нет.
 *
 * РЕШЕНИЕ. Не изобретаем второй бланк: используем ТОТ ЖЕ официальный шаблон,
 * что и вся исходящая переписка — `templates/customer-letter-tpl.docx`
 * (в нём логотип АСГАРД, реквизиты, банк, поля под подпись и печать).
 * Рендер — через `docxtemplater` (уже в зависимостях), тот же путь, что у
 * `letter/docx-letter.js`. Значит Word-письмо ОБС и остальная переписка
 * выглядят одинаково и правятся в одном месте.
 *
 * ЧТО ПОДСТАВЛЯЕМ:
 *   • номер и дата исходящего — из генератора (obs-letter.js);
 *   • заголовок документа — «Письмо для оплаты через ОБС»;
 *   • адресат — получатель ОБС (по умолчанию администрация объекта);
 *   • тело — тот же текст, что в PDF: основание, перечень, сумма, лимит;
 *   • подпись гендиректора + печать (картинки из public/assets/img).
 *
 * ПОЧЕМУ ТЕЛО ОДНО НА ДВА ФОРМАТА. Текст письма обязан совпадать в PDF и
 * Word — иначе бухгалтерия распечатает одно, а отправит другое. Поэтому
 * `buildLetterBody()` живёт в obs-letter.js и используется обоими
 * генераторами.
 */

const fs = require('fs');
const path = require('path');

const _shared = require('./letter/_shared');

let _Docxtemplater = null;
let _PizZip = null;
let _ImageModule = null;

function _loadLibs() {
  if (_Docxtemplater && _PizZip && _ImageModule) {
    return { Docxtemplater: _Docxtemplater, PizZip: _PizZip, ImageModule: _ImageModule };
  }
  _Docxtemplater = require('docxtemplater');
  _PizZip = require('pizzip');
  _ImageModule = require('docxtemplater-image-module-free');
  return { Docxtemplater: _Docxtemplater, PizZip: _PizZip, ImageModule: _ImageModule };
}

// D-384: шаблон письма ОБС — производный от официального бланка
// (customer-letter-tpl.docx), из которого убраны тендерные строки
// «Реестровый номер процедуры» и «Лот № …». Собирается скриптом
// tools/make_obs_docx_template.js. Логотип, реквизиты, подпись и печать —
// те же, что у всей исходящей переписки.
const TPL_DEFAULT = path.join(__dirname, '..', '..', 'templates', 'obs-letter-tpl.docx');
const TPL_FALLBACK = path.join(__dirname, '..', '..', 'templates', 'customer-letter-tpl.docx');

/** Экранирование для docxtemplater: `{` и `}` в тексте ломают шаблон. */
function safeText(s) {
  return String(s == null ? '' : s).replace(/\{/g, '(').replace(/\}/g, ')');
}

/**
 * Картинки подписи и печати для image-module.
 * Размеры подобраны под поле подписи шаблона (как в letter/docx-letter.js).
 */
function _buildImageOpts(withSignature, withStamp) {
  const { ImageModule } = _loadLibs();
  const base = process.cwd();
  const pick = (name) => {
    try { return fs.readFileSync(path.join(base, 'public', 'assets', 'img', name)); }
    catch (_) { return Buffer.alloc(0); }
  };

  return {
    centered: false,
    getImage(tagValue, tagName) {
      if (tagName === 'signature_img') return withSignature ? pick('signature.png') : Buffer.alloc(0);
      if (tagName === 'stamp_img') return withStamp ? pick('stamp.png') : Buffer.alloc(0);
      if (tagName === 'logo_img') return pick('asgard_logo.png');
      return Buffer.alloc(0);
    },
    getSize(tagValue, tagName) {
      if (tagName === 'signature_img') return [150, 56];
      if (tagName === 'stamp_img') return [110, 110];
      if (tagName === 'logo_img') return [120, 40];
      return [0, 0];
    },
  };
}

/**
 * Сформировать DOCX письма для ОБС на официальном бланке.
 *
 * @param {object} db — pg pool/клиент
 * @param {number} docId — id строки doc_registry (счёт)
 * @param {object} [opts]
 * @param {string} [opts.number]   — номер исходящего (если уже выдан)
 * @param {string} [opts.dateText] — дата письма строкой
 * @param {boolean} [opts.with_signature=true]
 * @param {boolean} [opts.with_stamp=true]
 * @param {string} [opts.template_path]
 * @returns {Promise<Buffer>}
 */
async function generateObsLetterDocx(db, docId, opts = {}) {
  // Данные и текст берём из того же модуля, что и PDF — один источник правды.
  const obs = require('./obs-letter');
  const data = await obs.loadLetterData(db, docId);
  const { doc, company, gendir, subcontract } = data;

  // Номер и дату: если письмо уже сформировано в PDF — используем тот же
  // номер, чтобы Word и PDF не разъезжались.
  let number = opts.number || null;
  let dateText = opts.dateText || _shared.formatRuDate(new Date());
  if (!number) {
    try {
      const cur = await db.query(
        `SELECT l.invoice_number FROM doc_registry d
           JOIN doc_registry l ON l.id = d.obs_letter_doc_id
          WHERE d.id = $1`, [docId]);
      const inv = cur.rows[0] && cur.rows[0].invoice_number;
      if (inv) number = String(inv).replace(/^Исх\.\s*/i, '');
    } catch (_) { /* нет письма — выдадим новый номер */ }
  }
  if (!number) number = await obs.nextOutgoingNumber(db, new Date());

  // Тело: те же абзацы, что в PDF. Собираем плоский текст — шаблон ждёт
  // `body_paragraphs` массивом объектов { text }.
  const paragraphs = obs.buildLetterParagraphs(data, { number, dateText });

  const { Docxtemplater, PizZip, ImageModule } = _loadLibs();
  // Если спец-шаблон ещё не собран — падаем на официальный бланк, чтобы
  // Word формировался всегда (пусть и с лишними тендерными строками).
  const templatePath = opts.template_path
    || (fs.existsSync(TPL_DEFAULT) ? TPL_DEFAULT : TPL_FALLBACK);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Шаблон бланка не найден: ${templatePath}`);
  }

  const gross = Number(doc.amount_gross || 0);
  const vat = Number(doc.vat_amount || 0);
  const ratePct = Number(doc.vat_rate || 0) > 1
    ? Number(doc.vat_rate)
    : Number(doc.vat_rate || 0) * 100;

  const payload = {
    letter_number: safeText(number),
    letter_date_short: safeText(dateText),
    company_org_short: safeText(company.name_short),

    header_subline: '',
    // D-384: шаблон печатает «Реестровый номер процедуры: …» и «Лот № …»,
    // если передать хоть что-то. Для письма ОБС эти строки не нужны —
    // оставляем пустыми и подавляем блок (шаблон проверяет непустоту).
    procedure_number: '',
    lot_number: '',
    lot_title: '',
    // Флаг для шаблона: если он умеет скрывать лот-блок по пустому значению —
    // этот ключ гарантирует, что «Лот № «».» не появится.
    hide_procurement_block: '1',

    letter_kind_title: 'Письмо для оплаты через ОБС',
    letter_kind_sub: safeText(
      `по счёту № ${doc.invoice_number || 'б/н'}`
      + (doc.invoice_date ? ` от ${_shared.formatRuDate(doc.invoice_date)}` : '')
      + (subcontract ? ` · договор ${subcontract.number}` : '')
    ),

    customer_full_name: '',           // получатель ОБС — обезличенно
    recipient_name_short: 'Уважаемые коллеги!',
    recipient_note: [],
    recipient_greeting: 'Уважаемые Коллеги!',

    body_html: '',
    body_paragraphs: paragraphs.map((t) => ({ text: safeText(t) })),

    procurement_intro: [],
    procurement_lot: [],
    project_intro: '',
    project_outro: [],
    questions: [],

    gendir_name: safeText(gendir.name),
    gendir_position: safeText(gendir.position),
    // D-385 (Д. Путков, 28.10.2026: «убрать исполнителя письма или переделать
    // на кого-то, например на инициатора»). Раньше при отсутствии имени
    // подставлялось название компании — получалось «Исп.: ООО «Асгард-Сервис»»,
    // строка без смысла. Теперь исполнитель — тот, кто завёл счёт.
    executor_name: safeText((data.initiator && data.initiator.name) || ''),
    executor_phone_email: safeText(
      [
        (data.initiator && data.initiator.phone) || '',
        (data.initiator && data.initiator.email) || '',
      ].filter(Boolean).join(' · ')
    ),

    bank_name: company.bank_name,
    bank_account: company.bank_rs,
    bank_corr_account: company.bank_ks,
    bank_bik: company.bank_bik,
    company_inn: company.inn,
    company_kpp: company.kpp,
    company_inn_kpp: `${company.inn} / ${company.kpp}`,
    company_bank_name: company.bank_name || '',
    company_bank_account: company.bank_rs || '',
    company_bank_corr_account: company.bank_ks || '',
    company_bank_bic: company.bank_bik || '',
    company_ogrn: company.ogrn || '',
    company_address: company.legal_address,
    company_phone: company.phone,
    company_email: company.email,

    // Суммы дублируем в шаблон — часть шаблонов умеет печатать их отдельно.
    invoice_number: safeText(doc.invoice_number || ''),
    amount_gross: gross.toFixed(2),
    vat_amount: vat.toFixed(2),
    vat_rate: String(Math.round(ratePct)),

    signature_img: 'signature.png',
    stamp_img: 'stamp.png',
    logo_img: 'asgard_logo.png',
  };

  const zip = new PizZip(fs.readFileSync(templatePath, 'binary'));
  const imageModule = new ImageModule(_buildImageOpts(
    opts.with_signature !== false,
    opts.with_stamp !== false
  ));

  const docx = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    modules: [imageModule],
    nullGetter: () => '',
  });
  docx.render(payload);

  // D-385: если исполнителя нет (счёт завёл служебный аккаунт), шаблон
  // оставил бы висячее «Исп.:» — в исходящем документе это брак. Убираем
  // весь абзац целиком, как когда-то тендерные строки в шаблоне.
  const outZip = docx.getZip();
  const hasExecutor = !!(payload.executor_name || payload.executor_phone_email);
  if (!hasExecutor) {
    const xml = outZip.file('word/document.xml').asText();
    const re = /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?Исп\.:(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g;
    const cleaned = xml.replace(re, '');
    if (cleaned !== xml) outZip.file('word/document.xml', cleaned);
  }

  return outZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { generateObsLetterDocx, TPL_DEFAULT };
