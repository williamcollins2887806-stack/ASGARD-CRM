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
  // Комбинированный факсимиле (печать + подпись одним PNG с прозрачным фоном).
  // Если файла нет — старый раздельный путь (stamp.png / signature.png).
  const combined = (() => {
    try {
      const p = path.join(base, 'public', 'assets', 'img', 'obs_stamp_sign.png');
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch (_) { /* */ }
    return null;
  })();

  return {
    centered: false,
    getImage(tagValue, tagName) {
      // Один слой: комбинированная печать+подпись в {%stamp_img}.
      // {%signature_img} пустой — иначе двойное наложение.
      if (tagName === 'stamp_img') {
        if (!withStamp && !withSignature) return Buffer.alloc(0);
        if (combined) return combined;
        return withStamp ? pick('stamp.png') : Buffer.alloc(0);
      }
      if (tagName === 'signature_img') {
        if (combined) return Buffer.alloc(0);
        return withSignature ? pick('signature.png') : Buffer.alloc(0);
      }
      // Логотип бланка — из шаблона (word/media), не asgard_logo CRM.
      if (tagName === 'logo_img') return Buffer.alloc(0);
      return Buffer.alloc(0);
    },
    getSize(tagValue, tagName) {
      // Печать Ø 40 мм (заказчик 09.11.2026: 22% масштаба ≈ 40 мм в диаметре).
      // 40 мм = 40/25.4*72 ≈ 113.4 pt. PNG печати+подписи шире круга (~1.42×).
      if (tagName === 'stamp_img' && combined) return [161, 113];
      if (tagName === 'signature_img') return [113, 42];
      if (tagName === 'stamp_img') return [113, 113]; // Ø 40 мм
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
  // V473: если пришёл payload из модалки (номер/дата/сумма/перечень), собираем
  // данные по нему. Иначе — как раньше, из строки реестра.
  const data = opts.payload
    ? await obs.buildLetterDataFromPayload(db, docId, opts.payload)
    : await obs.loadLetterData(db, docId);
  const { doc, company, gendir, subcontract } = data;

  // Номер и дату: если письмо уже сформировано в PDF — используем тот же
  // номер, чтобы Word и PDF не разъезжались.
  let number = opts.number || null;
  const dateText = opts.dateText
    || (opts.payload && opts.payload.letter_date
      ? _shared.formatRuDate(opts.payload.letter_date)
      : _shared.formatRuDate(new Date()));
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
  // V473: предпросмотр НЕ расходует исходящий номер. Раньше здесь стояла
  // безусловная выдача — и каждое нажатие «Предпросмотр» съедало номер из
  // счётчика, хотя письмо могло так и не понадобиться.
  if (!number && !opts.payload) number = await obs.nextOutgoingNumber(db, new Date());

  // D-392: текст письма раскладывается по СМЫСЛОВЫМ блокам, как в эталонном
  // письме заказчика. Раньше всё уходило одним массивом body_paragraphs, и
  // шаблон печатал сплошной комок. Теперь у каждого блока свой цикл в шаблоне,
  // со своим форматированием: обоснование, перечень, счёт, обоснование
  // необходимости, просьба об оплате.
  const blocks = obs.buildLetterBlocks(data, { number, dateText });

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

  const asParas = (arr) => (Array.isArray(arr) ? arr : []).map((t) => ({ text: safeText(t) }));

  const payload = {
    letter_number: safeText(number),
    // D-392h: дата не должна разрываться между строкой и «г.». В шаблоне
    // это один прогон, но при узком месте Word переносит «г.» отдельно.
    // Ставим неразрывные пробелы внутри даты.
    letter_date_short: safeText(String(dateText).replace(/ /g, '\u00A0')),
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
    body_paragraphs: asParas(blocks.all),

    // D-392: блоки эталонного письма — каждый со своим форматированием.
    intro_paragraphs: asParas(blocks.intro),
    items: asParas(blocks.items),
    invoice_paragraphs: asParas(blocks.invoice),
    outro_paragraphs: asParas(blocks.outro),
    // D-397 (FAIL верификатора 07.11.2026): строка «Оплату просим провести с
    // ОБС …» идёт после «Просим оплатить» и раньше никуда не попадала — Word
    // выходил без реквизита оплаты. Приклеиваем её к блоку просьбы: в образце
    // это продолжение той же мысли, отдельный абзац в шаблоне не нужен.
    request_paragraphs: asParas((blocks.request || []).concat(blocks.post || [])),

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

  // D-392d: РАЗМЕРЫ ФАКСИМИЛЕ. ImageModule получает размеры в пикселях и
  // пересчитывает их по-своему; на практике печать и подпись вставали
  // как 0×0 (проверено по готовому XML), то есть занимали абзацы, но были
  // невидимы, а письмо всё равно уезжало на второй лист.
  //
  // Теперь размеры задаются напрямую в XML: находим картинки по r:embed
  // (печать — первая по порядку, подпись — вторая) и проставляем extent.
  // 1 см = 360000 EMU.
  {
    const xml = outZip.file('word/document.xml').asText();
    const CM = 360000;
    // D-392f: ПОРЯДОК И РАЗМЕР. В шаблоне печать стоит ПЕРЕД подписью и
    // уезжала на второй лист одна (проверено pdfimages: стр.2 — только
    // печать). Делаем её соразмерной (2.2 см) — тогда помещается вместе с
    // подписью на первой.
    const sizes = [
      { w: Math.round(2.2 * CM), h: Math.round(2.2 * CM) },   // печать
      { w: Math.round(3.6 * CM), h: Math.round(1.35 * CM) },  // подпись
    ];
    let i = 0;
    const patched = xml.replace(/(<wp:extent cx=")(\d+)(" cy=")(\d+)("[^/]*\/>)/g, (m, a, cx, b, cy, d) => {
      // Логотип крупный — его не трогаем (в шаблоне уже 5.5 см).
      if (Number(cx) > 1500000) return m;
      const s = sizes[Math.min(i++, sizes.length - 1)];
      return `${a}${s.w}${b}${s.h}${d}`;
    });
    if (patched !== xml) outZip.file('word/document.xml', patched);
  }

  // D-392f: УБИРАЕМ ПУСТЫЕ АБЗАЦЫ В КОНЦЕ документа. Word добавляет
  // невидимый абзац после последнего элемента, и он уезжает на новую
  // страницу, если места впритык. Оставляем ровно один перед sectPr.
  {
    const xml = outZip.file('word/document.xml').asText();
    const list = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
    let lastContent = -1;
    list.forEach((p, idx) => {
      const t = p.replace(/<[^>]+>/g, '').trim();
      if (t || /w:drawing/.test(p)) lastContent = idx;
    });
    const tail = list.slice(lastContent + 1).filter((p) => !/<w:sectPr/.test(p));
    if (tail.length > 1) {
      let out = xml;
      tail.slice(1).forEach((p) => { out = out.replace(p, ''); });
      outZip.file('word/document.xml', out);
    }
  }

  // Факсимиле (печать+подпись) — ВЕРХНИЙ слой на абзаце должности/ФИО.
  // Абзац {%stamp_img} убираем целиком: иначе LibreOffice резервирует под
  // него высоту и печать уезжает на 2-ю страницу (проверено pdfimages 09.11).
  {
    let xml = outZip.file('word/document.xml').asText();
    const ps = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
    const imgParas = ps.filter((p) => /w:drawing/.test(p));
    // Первый drawing — логотип шапки (крупный), последний — факсимиле.
    const stampPara = imgParas.length >= 2 ? imgParas[imgParas.length - 1] : null;
    if (stampPara) {
      const stampRun = (stampPara.match(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:drawing>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/) || [''])[0];
      // Хост: абзац с должностью или ФИО директора (не картинка).
      const hostPara = [...ps].reverse().find((p) => {
        if (/w:drawing/.test(p)) return false;
        const t = p.replace(/<[^>]+>/g, '').trim();
        return /Генеральный директор|Директор|Путков|Кудряшов|Гажилиев|[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.[А-ЯЁ]\./.test(t);
      }) || [...ps].reverse().find((p) => !/w:drawing/.test(p) && p.replace(/<[^>]+>/g, '').trim());

      if (stampRun && hostPara) {
        // Ø печати 40 мм. Комбинированный PNG шире круга (~1.42×): высота=диаметр.
        const CM = 360000;
        const diam = 4.0; // 40 мм
        const aspect = 1586 / 1114;
        const hEmu = Math.round(diam * CM);
        const wEmu = Math.round(diam * aspect * CM);
        const over = stampRun.replace(
          /<wp:inline\b([^>]*)>([\s\S]*?)<\/wp:inline>/,
          (m, attrs, inner) => {
            const clean = inner
              .replace(/<wp:simplePos[^/]*\/>/g, '')
              .replace(/<wp:positionH\b[\s\S]*?<\/wp:positionH>/g, '')
              .replace(/<wp:positionV\b[\s\S]*?<\/wp:positionV>/g, '')
              .replace(/<wp:wrap\w*[^/]*\/>/g, '')
              .replace(/<wp:extent\b[^/]*\/>/g, '');
            return `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">`
              + `<wp:simplePos x="0" y="0"/>`
              + `<wp:positionH relativeFrom="paragraph"><wp:posOffset>1100000</wp:posOffset></wp:positionH>`
              + `<wp:positionV relativeFrom="paragraph"><wp:posOffset>-200000</wp:posOffset></wp:positionV>`
              + `<wp:extent cx="${wEmu}" cy="${hEmu}"/>`
              + `<wp:wrapNone/>`
              + clean
              + '</wp:anchor>';
          });
        xml = xml.replace(stampPara, '');
        xml = xml.replace(hostPara, hostPara.replace('</w:p>', over + '</w:p>'));
        outZip.file('word/document.xml', xml);
      }
    }
  }

  // Пустой {%signature_img} (0 байт) ImageModule всё равно вставляет —
  // убираем нулевые media и ссылки на них, чтобы не плодить мусор.
  {
    const names = Object.keys(outZip.files).filter((n) => n.startsWith('word/media/'));
    for (const n of names) {
      const f = outZip.file(n);
      if (f && f.asUint8Array().length === 0) {
        outZip.remove(n);
      }
    }
  }

  return outZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { generateObsLetterDocx, TPL_DEFAULT };
