'use strict';

/**
 * src/services/letter/docx-letter.js
 *
 * Генерация DOCX из correspondence для composer'а.
 *
 * Источник: tests/reports/letters/_LETTER_CONTRACT.md §1, §4.7.
 *
 * Зависимости:
 *   - docxtemplater + pizzip — рендер шаблона.
 *   - docxtemplater-image-module-free — вставка PNG-картинок (подпись/печать)
 *     по плейсхолдерам `{%signature_img}` / `{%stamp_img}`.
 *   - ./_shared — реквизиты, гендир, Dadata, факсимиле, форматирование даты.
 *
 * Шаблон: `templates/customer-letter-tpl.docx`.
 *
 *   ⚠️ Stage 5 (S-18) добавит в шаблон плейсхолдеры:
 *      - `{%signature_img}` / `{%stamp_img}` — для toggle картинок.
 *      - `{body_html}` — для произвольного тела письма из composer'а
 *        (или раскрытие <p>/<br>/<strong> через docxtemplater HTML-расширение).
 *      - `{bank_name}` / `{bank_account}` / `{bank_corr_account}` / `{bank_bik}`
 *        — для печати реквизитов под подписью.
 *      - `{procedure_number}` / `{lot_number}` / `{lot_title}` / `{header_subline}`
 *        — для тендерной шапки.
 *      - `{letter_kind_title}` / `{letter_kind_sub}` — для заголовка письма.
 *   Сейчас этих плейсхолдеров в шаблоне нет → `nullGetter` возвращает '—',
 *   а ImageModule просто не находит тег и ничего не вставляет (DOCX без подписи
 *   на этой стадии). Это OK до Stage 5.
 */

const fs = require('fs');
const path = require('path');

const _shared = require('./_shared');

// ─── Lazy require docxtemplater / pizzip / image-module ───────────────────
// Lazy-инициализация — чтобы при сбое модуля (например image-module-free не
// установлен) ошибка возникала на первом вызове generateLetterDocx, а не при
// require самого файла (это убивало бы цепочку загрузки всех routes).
let _Docxtemplater = null;
let _PizZip = null;
let _ImageModule = null;
function _loadLibs() {
  if (_Docxtemplater && _PizZip && _ImageModule) {
    return { Docxtemplater: _Docxtemplater, PizZip: _PizZip, ImageModule: _ImageModule };
  }
  try {
    _Docxtemplater = require('docxtemplater');
    _PizZip = require('pizzip');
    _ImageModule = require('docxtemplater-image-module-free');
  } catch (e) {
    const missing = e.message && e.message.match(/'([^']+)'/);
    throw new Error(
      `[docx-letter] Не установлены docxtemplater/pizzip/docxtemplater-image-module-free` +
      (missing ? ` (отсутствует: ${missing[1]})` : '') +
      `. Выполните: npm install docxtemplater pizzip docxtemplater-image-module-free`
    );
  }
  return { Docxtemplater: _Docxtemplater, PizZip: _PizZip, ImageModule: _ImageModule };
}

// ─── Resolve template ─────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..', '..', '..');
const TPL_DEFAULT = path.join(ROOT, 'templates', 'customer-letter-tpl.docx');

// ─── HTML body → plain text (грубое разбиение на параграфы) ───────────────
/**
 * Разбить body_html на массив строк-параграфов для шаблона.
 * Не полноценный HTML-парсер: убирает теги, схлопывает HTML-entities, бьёт
 * по `</p>`, `<br/>`, `\n`. Stage 5 заменит на полноценный HTML-в-DOCX
 * рендеринг (через `html-docx-js` или `mammoth-обратно`), пока — текст.
 *
 * @param {string} html
 * @returns {Array<{text: string}>} массив для `{#body_paragraphs}{text}{/body_paragraphs}`
 */
function renderBodyHtmlToParagraphs(html) {
  if (!html || typeof html !== 'string') return [];
  const normalized = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/div\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n');
  return normalized
    .split(/\n{2,}/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(text => ({ text }));
}

// ─── Image module options factory ─────────────────────────────────────────
function _buildImageOpts(withSignature, withStamp) {
  return {
    centered: false,
    getImage(tagValue, tagName) {
      // tagName — имя плейсхолдера БЕЗ префикса '%' (например 'signature_img').
      if (tagName === 'signature_img') {
        if (!withSignature) return Buffer.alloc(0);
        const data = _shared.getSignatureBase64();
        if (!data) return Buffer.alloc(0);
        return Buffer.from(data.split(',')[1] || '', 'base64');
      }
      if (tagName === 'stamp_img') {
        if (!withStamp) return Buffer.alloc(0);
        const data = _shared.getStampBase64();
        if (!data) return Buffer.alloc(0);
        return Buffer.from(data.split(',')[1] || '', 'base64');
      }
      if (tagName === 'logo_img') {
        const data = _shared.getLogoBase64();
        if (!data) return Buffer.alloc(0);
        return Buffer.from(data.split(',')[1] || '', 'base64');
      }
      return Buffer.alloc(0);
    },
    getSize(_img, _tagValue, tagName) {
      if (tagName === 'signature_img') return [150, 56];
      if (tagName === 'stamp_img') return [110, 110];
      if (tagName === 'logo_img') return [120, 60];
      return [100, 100];
    }
  };
}

// ─── Main: generateLetterDocx ─────────────────────────────────────────────
/**
 * Сгенерировать DOCX из строки correspondence + опций.
 *
 * @param {object} correspondence — строка из таблицы `correspondence` (полная,
 *   с полями body_html, doc_title, doc_sub, header_subline, procedure_number,
 *   lot_number, lot_title, number, date, created_by, counterparty, customer_id,
 *   signature_on, stamp_on, signer_snapshot и т.д.).
 * @param {object} [options]
 * @param {boolean} [options.with_signature]  по умолчанию из correspondence.signature_on (или true).
 * @param {boolean} [options.with_stamp]      по умолчанию из correspondence.stamp_on (или true).
 * @param {string}  [options.template_path]   override пути к шаблону.
 * @param {boolean} [options.dadata=true]     резолвить ФИО директора заказчика через Dadata.
 * @param {string}  [options.save_to]         если задан — записать DOCX по пути и вернуть путь, иначе вернуть Buffer.
 * @param {object}  [options.db]              опционально — переопределить db-клиент (тесты).
 * @returns {Promise<Buffer|string>} Buffer (по умолчанию) либо абсолютный путь, если save_to.
 */
async function generateLetterDocx(correspondence, options) {
  if (!correspondence || typeof correspondence !== 'object') {
    throw new Error('[docx-letter] correspondence обязателен (объект из таблицы correspondence)');
  }

  const opts = options || {};
  const withSignature = (opts.with_signature !== undefined)
    ? !!opts.with_signature
    : (correspondence.signature_on !== false);
  const withStamp = (opts.with_stamp !== undefined)
    ? !!opts.with_stamp
    : (correspondence.stamp_on !== false);
  const useDadata = opts.dadata !== false;

  const templatePath = opts.template_path || TPL_DEFAULT;
  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `[docx-letter] Шаблон не найден: ${templatePath}. ` +
      `Положите customer-letter-tpl.docx в templates/ на сервере.`
    );
  }

  const { Docxtemplater, PizZip, ImageModule } = _loadLibs();

  // ─── Сбор данных ────────────────────────────────────────────────────
  const dbClient = opts.db || undefined;
  const [company, gendir, executor] = await Promise.all([
    _shared.loadCompanyProfile(dbClient),
    _shared.loadAsgardGendir(dbClient),
    _shared.loadUserById(correspondence.created_by, dbClient)
  ]);

  // Заказчик: Dadata по inn (если есть customer_id → lookup customers.inn,
  // иначе — counterparty_inn в самой correspondence не хранится, используем
  // raw counterparty как fallback).
  let customer = {
    name: correspondence.counterparty || '—',
    full_name: correspondence.counterparty || '—',
    director_short: '',
    director_note: ''
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
            director_short: dad.director_short || '',
            director_note: ''
          };
        }
      }
    } catch (_) { /* graceful: оставляем counterparty raw */ }
  }

  const executorPhoneEmailParts = [];
  if (executor.phone) executorPhoneEmailParts.push(`Тел.: ${executor.phone}`);
  if (executor.email) executorPhoneEmailParts.push(`E-mail: ${executor.email}`);
  const executorPhoneEmail = executorPhoneEmailParts.join('   ');

  // signer_snapshot имеет приоритет над текущими settings (если письмо
  // финализировано — фиксируем подписанта на момент finalize).
  const sn = correspondence.signer_snapshot || null;
  const gendirEffective = sn
    ? {
        name: sn.name || gendir.name,
        full_name: sn.full_name || gendir.full_name,
        position: sn.position || gendir.position,
        org: sn.org || gendir.org
      }
    : gendir;

  const data = {
    // ── Шапка ────────────────────────────────────────────────
    letter_number:   correspondence.number || 'б/н',
    letter_date_short: _shared.formatRuDate(correspondence.date || new Date()),
    company_org_short: company.name_short,

    // ── Тендерная подшапка (если есть) ───────────────────────
    header_subline:    correspondence.header_subline || '',
    procedure_number:  correspondence.procedure_number || '',
    lot_number:        correspondence.lot_number || '',
    lot_title:         correspondence.lot_title || '',

    // ── Заголовок письма ─────────────────────────────────────
    letter_kind_title: correspondence.doc_title || correspondence.subject || '',
    letter_kind_sub:   correspondence.doc_sub || '',

    // ── Адресат ──────────────────────────────────────────────
    customer_full_name:   customer.full_name,
    recipient_name_short: customer.director_short || 'Уважаемые коллеги!',
    recipient_note:       customer.director_note ? [{ text: customer.director_note }] : [],

    // Приветствие в теле (F-29 fix S-19): если есть director_short — именное,
    // иначе общее «Уважаемые коллеги!». В шаблоне используется как
    // `{recipient_greeting}` в первом абзаце body.
    recipient_greeting: customer.director_short
      ? `Уважаемый(ая) ${customer.director_short}!`
      : 'Уважаемые коллеги!',

    // ── Тело ─────────────────────────────────────────────────
    body_html:        correspondence.body_html || correspondence.body || '',
    body_paragraphs:  renderBodyHtmlToParagraphs(correspondence.body_html || correspondence.body || ''),

    // ── ГНШ-секции (могут быть пустыми для composer-писем) ───
    procurement_intro: [],
    procurement_lot:   [],
    project_intro:     '',
    project_outro:     [],
    questions:         [],

    // ── Подпись ──────────────────────────────────────────────
    gendir_name:     gendirEffective.name,
    gendir_position: gendirEffective.position,
    executor_name:   executor.full_name || executor.name,
    executor_phone_email: executorPhoneEmail,

    // ── Реквизиты (Stage 5 добавит плейсхолдеры) ─────────────
    // F-30 fix S-19: ГНШ-шаблон использует имена `company_inn_kpp`,
    // `company_bank_name`, `company_bank_account`, `company_bank_corr_account`,
    // `company_bank_bic` (с префиксом company_ и латиницей `bic`).
    // Сохраняем старые ключи (bank_name/bank_account/bank_corr_account/bank_bik/
    // company_inn/company_kpp) для обратной совместимости с любыми сторонними
    // шаблонами, добавляем новые в правильной нотации.
    bank_name:         company.bank_name,
    bank_account:      company.bank_rs,
    bank_corr_account: company.bank_ks,
    bank_bik:          company.bank_bik,
    company_inn:       company.inn,
    company_kpp:       company.kpp,
    company_inn_kpp:   (company.inn && company.kpp)
                         ? `${company.inn} / ${company.kpp}`
                         : (company.inn || company.kpp || ''),
    company_bank_name:         company.bank_name || '',
    company_bank_account:      company.bank_rs || '',
    company_bank_corr_account: company.bank_ks || '',
    // alias bik↔bic: шаблон использует латинскую `bic`, profile хранит `bik`
    company_bank_bic:          company.bank_bik || company.bank_bic || '',
    company_ogrn:      company.ogrn,
    company_address:   company.legal_address,
    company_phone:     company.phone,
    company_email:     company.email,

    // Image placeholders: image-module-free вызывает getImage(tagValue, tagName)
    // ТОЛЬКО если в data есть ключ с этим именем. Значения формальные —
    // getImage в _buildImageOpts использует tagName, не tagValue.
    signature_img: 'signature.png',
    stamp_img:     'stamp.png',
    logo_img:      'asgard_logo.png'
  };

  // ─── Render ─────────────────────────────────────────────────────────
  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  const imageModule = new ImageModule(_buildImageOpts(withSignature, withStamp));

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    modules: [imageModule],
    nullGetter: () => '—'
  });

  doc.render(data);

  const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });

  if (opts.save_to) {
    fs.writeFileSync(opts.save_to, buf);
    return opts.save_to;
  }
  return buf;
}

module.exports = {
  generateLetterDocx,
  renderBodyHtmlToParagraphs,
  TPL_DEFAULT
};
