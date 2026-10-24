'use strict';

/**
 * src/services/obs-letter.js
 *
 * D-378: письмо для оплаты счёта через ОБС.
 *
 * ЗАЧЕМ. Часть расходов платится не с расчётного счёта компании, а через ОБС.
 * На каждый такой счёт нужна официальная бумага на бланке АСГАРД с подписью
 * гендиректора и печатью — обоснование, зачем расход и почему его надо
 * провести именно так. До сих пор такие письма делали руками (Д. Путков);
 * образец — «Исх. №261023-11 от 23.10.2026» по счёту УК «МАГИСТР» А-2127.
 *
 * СТРУКТУРА ПИСЬМА (повторяет образец дословно по смыслу):
 *   1. Бланк: реквизиты, банк, ИНН/КПП, контакты.
 *   2. «Исх. №<номер> от <дата>».
 *   3. «Уважаемые Коллеги!»
 *   4. Настоящим сообщаем, что <наша компания> выполняет работы <что> в интересах
 *      <объект/заказчик> на основании <договор субподряда>.
 *   5. В рамках исполнения обязательств персонал обязан иметь допуски.
 *   6. В целях обеспечения допуска привлекли <контрагент> по договору <номер>
 *      (заявка <номера>), а именно: <перечень из счёта>.
 *   7. В адрес выставлен счёт № <номер> от <дата> на сумму <сумма> (включая НДС).
 *   8. Указанные расходы обязательны и непосредственно связаны с исполнением.
 *   9. Просим осуществить оплату счёта в размере <сумма> (<прописью>), в т.ч. НДС.
 *  10. Подпись гендиректора + печать.
 *
 * ЧТО БЕРЁМ ИЗ БАЗЫ, а что подставляем:
 *   • реквизиты, подпись, печать — settings.company_profile + public/assets/img
 *     (общий модуль letter/_shared.js, он уже используется официальной
 *     перепиской, поэтому второй источник истины не появляется);
 *   • номер счёта, дата, сумма, НДС, контрагент, ИНН — doc_registry (после
 *     D-377 суммы и ставка согласованы, пересчитывать заново нельзя);
 *   • перечень услуг — line_items_json заявки, если позиции распознаны;
 *     иначе назначение из comment_text, иначе одна строка «по счёту № …»;
 *   • объект и договор субподряда — works (object_name, work_title) и
 *     doc_registry.contract_label.
 *
 * ЧЕГО НЕ ДЕЛАЕМ:
 *   • не выдумываем реквизиты и не подставляем чужие ФИО;
 *   • не пересчитываем НДС — только то, что уже лежит в документе;
 *   • не отправляем письмо по почте — только формируем PDF в карточку.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const _shared = require('./letter/_shared');

// ─── Singleton browser ────────────────────────────────────────────────────
// Один экземпляр на процесс: запуск Chrome занимает ~1–2 с, а письма могут
// генерироваться пачкой (согласование нескольких счетов подряд).
let _browser = null;
async function _getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  const launchOpts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  _browser = await puppeteer.launch(launchOpts);
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (_) { /* */ }
    _browser = null;
  }
}

// ─── Escape ───────────────────────────────────────────────────────────────
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Деньги и суммы прописью ──────────────────────────────────────────────
const RU_UNITS_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_UNITS_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
  'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const RU_TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
  'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const RU_HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
  'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

const money = (n) => Number(n || 0)
  .toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Сотня прописью. feminine — для тысяч («одна тысяча», «две тысячи»). */
function _hundreds(n, feminine) {
  const out = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) out.push(RU_HUNDREDS[h]);
  if (rest >= 10 && rest < 20) {
    out.push(RU_TEENS[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (t) out.push(RU_TENS[t]);
    if (u) out.push(feminine ? RU_UNITS_F[u] : RU_UNITS_M[u]);
  }
  return out.join(' ');
}

/** Форма слова по числу: 1 рубль / 2 рубля / 5 рублей. */
function _plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/**
 * Сумма прописью: «Сто три тысячи сто пятьдесят рублей 00 копеек».
 * Только целые группы, без «миллиардов» — счета крупнее миллиарда в CRM
 * не встречаются, но если встретятся, добавится группа автоматически.
 */
function amountInWords(amount) {
  const total = Math.round(Number(amount || 0) * 100);
  const rub = Math.floor(total / 100);
  const kop = total % 100;

  if (!rub) return `Ноль рублей ${String(kop).padStart(2, '0')} копеек`;

  const groups = [
    { div: 1e9, one: 'миллиард', few: 'миллиарда', many: 'миллиардов', fem: false },
    { div: 1e6, one: 'миллион', few: 'миллиона', many: 'миллионов', fem: false },
    { div: 1e3, one: 'тысяча', few: 'тысячи', many: 'тысяч', fem: true },
    { div: 1, one: 'рубль', few: 'рубля', many: 'рублей', fem: false },
  ];

  const parts = [];
  let rest = rub;
  for (const g of groups) {
    const n = Math.floor(rest / g.div);
    rest %= g.div;
    if (!n) continue;
    const word = _plural(n, g.one, g.few, g.many);
    if (g.div === 1) {
      // Рубли: «сто пятьдесят рублей» — слово в конце, не в середине.
      parts.push(`${_hundreds(n, false)} ${word}`.trim());
    } else {
      parts.push(`${_hundreds(n, g.fem)} ${word}`.trim());
    }
  }

  // D-378: при круглых суммах (235 000, 1 000 000) группа рублей даёт n = 0
  // и слово «рублей» теряется — «Двести тридцать пять тысяч 00 копеек».
  // В счёте на 235 000 ₽ это была бы ошибка в платёжном документе.
  if (!parts.some((p) => /рубл/.test(p))) {
    parts.push(_plural(rub, 'рубль', 'рубля', 'рублей'));
  }

  const tail = `${String(kop).padStart(2, '0')} ${_plural(kop, 'копейка', 'копейки', 'копеек')}`;
  const head = parts.join(' ').replace(/\s+/g, ' ').trim();
  return `${head.charAt(0).toUpperCase()}${head.slice(1)} ${tail}`;
}

// ─── Номер исходящего ─────────────────────────────────────────────────────
/**
 * Захватить следующий исходящий номер АТОМАРНО.
 *
 * D-378: первый вариант считал COUNT() и прибавлял 1 — при двух письмах
 * подряд (или одновременной генерации) оба получали один номер. Для
 * исходящего документа это брак: два разных письма с «Исх. №261025-01».
 *
 * Теперь счётчик живёт в отдельной строке `obs_letter_counter` и
 * увеличивается одним UPDATE ... RETURNING внутри транзакции. Postgres
 * сериализует такие UPDATE, поэтому одинаковых номеров быть не может.
 *
 * Если таблицы нет (старая база) — мягкий откат на подсчёт по письмам.
 */
async function nextOutgoingNumber(db, date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const prefix = `${yy}${mm}${dd}`;

  // Атомарный путь.
  try {
    const r = await db.query(
      `INSERT INTO obs_letter_counter (day, last_seq)
       VALUES (CURRENT_DATE, 1)
       ON CONFLICT (day)
       DO UPDATE SET last_seq = obs_letter_counter.last_seq + 1
       RETURNING last_seq`
    );
    const seq = r.rows[0] && Number(r.rows[0].last_seq);
    if (seq > 0) return `${prefix}-${String(seq).padStart(2, '0')}`;
  } catch (_) { /* таблицы нет — идём в фолбэк */ }

  // Фолбэк: по уже созданным письмам за сегодня.
  let seq = 1;
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM doc_registry
        WHERE dir = 'out' AND package_type = 'letter'
          AND created_at::date = CURRENT_DATE AND deleted_at IS NULL`
    );
    seq = (r.rows[0] ? Number(r.rows[0].n) || 0 : 0) + 1;
  } catch (_) { /* начинаем с 1 */ }

  return `${prefix}-${String(seq).padStart(2, '0')}`;
}

// ─── Перечень услуг ───────────────────────────────────────────────────────
/**
 * Позиции для письма. Приоритет:
 *   1. line_items_json заявки — если OCR распознал строки с количеством;
 *   2. comment_text документа — назначение платежа текстом;
 *   3. одна нейтральная строка «по счёту № …».
 *
 * ВАЖНО: не сочиняем. Если позиций нет — пишем по счёту.
 */
function buildItems(doc, lines) {
  const out = [];

  if (Array.isArray(lines) && lines.length) {
    // D-378: в счетах за обучение единица «шт» читается неверно —
    // в образце Димы написано «7 чел.», «85 чел.». Определяем по названию:
    // если речь об обучении/аттестации/допусках, единица — человек.
    const isTraining = lines.some((l) => /обучен|аттестац|допуск|повышен.*квалификац|инструктаж|курс/i
      .test(String(l.name || l.title || l.description || '')));

    for (const l of lines) {
      const name = String(l.name || l.title || l.description || '').trim();
      if (!name) continue;
      const qty = Number(l.qty || l.quantity || 0);
      let unit = String(l.unit || '').trim();
      if (isTraining && (!unit || /^(шт|ед)/i.test(unit))) unit = 'чел.';
      let text = name;
      if (qty > 0) {
        text += ` — ${qty}${unit ? ' ' + unit : ' шт.'}`;
      }
      out.push(text);
    }
  }

  if (out.length) return out;

  const comment = String(doc.comment_text || '').trim();
  if (comment) {
    // Комментарий может быть длинным абзацем — режем на фразы, не больше 6.
    const bits = comment.split(/[;•\n]+/).map((s) => s.trim()).filter((s) => s.length > 2);
    if (bits.length) return bits.slice(0, 6);
  }

  return [`по счёту № ${doc.invoice_number || 'б/н'}`];
}

// ─── Данные для письма ────────────────────────────────────────────────────
/**
 * Собрать всё, что нужно письму. Читает ТОЛЬКО существующие поля; ничего не
 * додумывает. Возвращает объект для buildHtml.
 */
async function loadLetterData(db, docId) {
  const docRes = await db.query(
    `SELECT d.*, pi.line_items_json AS pi_lines, pi.basis_text AS pi_basis,
            pi.payment_source AS pi_source
       FROM doc_registry d
       LEFT JOIN payment_invoices pi ON pi.id = d.payment_invoice_id
      WHERE d.id = $1 AND d.deleted_at IS NULL`,
    [docId]
  );
  const doc = docRes.rows[0];
  if (!doc) throw new Error(`документ реестра #${docId} не найден`);

  // Объект и работы — если счёт привязан к работе.
  let work = null;
  if (doc.work_id) {
    const wr = await db.query(
      `SELECT id, work_title, object_name, object_address, customer_name, customer_inn
         FROM works WHERE id = $1`,
      [doc.work_id]
    );
    work = wr.rows[0] || null;
  }

  // Договор субподряда: contract_label («26-16/2») — номер договора с контрагентом.
  const contractLabel = String(doc.contract_label || '').trim();
  const contractDate = doc.contract_date ? _shared.formatRuDate(doc.contract_date) : '';

  // Позиции: из заявки, если распознаны.
  let lines = null;
  if (doc.pi_lines) {
    lines = typeof doc.pi_lines === 'string'
      ? (() => { try { return JSON.parse(doc.pi_lines); } catch (_) { return null; } })()
      : doc.pi_lines;
  }

  const company = await _shared.loadCompanyProfile(db);
  const gendir = await _shared.loadAsgardGendir(db);

  return {
    doc,
    work,
    contractLabel,
    contractDate,
    items: buildItems(doc, lines),
    company,
    gendir,
  };
}

// ─── HTML письма ──────────────────────────────────────────────────────────
function buildHtml(data, opts) {
  const o = opts || {};
  const { doc, work, company, gendir } = data;

  const signature = o.with_signature === false ? '' : _shared.getSignatureBase64();
  const stamp = o.with_stamp === false ? '' : _shared.getStampBase64();

  // D-378: в образце письма даты записаны числами («23.10.2026 г.»), а не
  // словами. formatRuDate даёт «23 октября 2026 г.» — для официальной бумаги
  // это допустимо, но расходится с шаблоном Димы. Держим единый вид.
  const dateNum = (d) => {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()} г.`;
  };

  const gross = Number(doc.amount_gross || 0);
  const vat = Number(doc.vat_amount || 0);
  const ratePct = Number(doc.vat_rate || 0) > 1
    ? Number(doc.vat_rate)
    : Number(doc.vat_rate || 0) * 100;
  const hasVat = vat > 0;

  const invoiceNo = doc.invoice_number || 'б/н';
  const invoiceDate = dateNum(doc.invoice_date);
  const counterparty = doc.counterparty_name || 'контрагент';

  // Основание: объект и работы. Если работы нет — нейтральная формулировка.
  const objectName = (work && work.object_name) || '';
  const workTitle = (work && work.work_title) || '';
  const customerName = (work && work.customer_name) || '';

  // D-378: падеж. «выполняет работы по Капитальный ремонт» — ошибка, которую
  // поймал первый прогон. Если название работы само является действием
  // («Капитальный ремонт…», «Очистка…»), ставим его сразу после «выполняет»;
  // иначе — «выполняет работы по <название>».
  const ACTION_TITLE = /^(капитальный|текущий|ремонт|замена|очистка|промывка|монтаж|демонтаж|восстановлен|диагностик|обследован|испытани)/i;
  const whatWeDo = workTitle
    ? (ACTION_TITLE.test(workTitle.trim()) ? workTitle.trim() : `работы по ${workTitle.trim()}`)
    : 'работы';

  // Даты — числами, как в образце («23.10.2026 г.»), а не словами.
  let basisText;
  if (objectName && customerName) {
    basisText = `Настоящим сообщаем, что ${esc(company.name_short)} выполняет ${esc(whatWeDo)} `
      + `на объекте ${esc(objectName)} в рамках договора субподряда, заключённого с ${esc(customerName)}.`;
  } else if (objectName) {
    basisText = `Настоящим сообщаем, что ${esc(company.name_short)} выполняет ${esc(whatWeDo)} на объекте ${esc(objectName)}.`;
  } else if (workTitle) {
    basisText = `Настоящим сообщаем, что ${esc(company.name_short)} выполняет ${esc(whatWeDo)}.`;
  } else {
    basisText = `Настоящим сообщаем, что ${esc(company.name_short)} привлекает подрядчиков для исполнения своих обязательств перед заказчиками.`;
  }

  // D-378: раньше выходило «привлекло ООО "УК МАГИСТР" Договор с ООО "УК
  // МАГИСТР" № …» — контрагент повторялся дважды. Теперь как в образце:
  // привлекло <контрагент> для оказания услуг на основании договора № …
  const contractText = data.contractLabel
    ? ` на основании договора № ${esc(data.contractLabel)}${data.contractDate ? ` от ${esc(data.contractDate)}` : ''}`
    : '';

  const itemsHtml = data.items.map((t) => `<li>${esc(t)}</li>`).join('');

  const vatLine = hasVat
    ? ` (включая НДС ${ratePct ? String(Math.round(ratePct)) + '%' : ''} — ${money(vat)} руб.)`
    : ' (НДС не облагается)';

  const vatTail = hasVat
    ? `, в том числе НДС ${ratePct ? String(Math.round(ratePct)) + '%' : ''} — ${money(vat)} руб.`
    : '. НДС не облагается';

  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"/>
<title>Исх. № ${esc(o.number || 'б/н')}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    color: #111;
    line-height: 1.45;
    background: #fff;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 16mm 16mm 20mm 22mm;
    position: relative;
  }
  .letterhead {
    border-bottom: 1pt solid #0b3d2e;
    padding-bottom: 6mm;
    margin-bottom: 6mm;
  }
  .letterhead .co {
    font-size: 13pt;
    font-weight: bold;
    color: #0b3d2e;
    margin-bottom: 2mm;
  }
  .letterhead .meta {
    font-size: 9.5pt;
    color: #333;
    line-height: 1.35;
  }
  .head-right {
    text-align: right;
    font-size: 9.5pt;
    color: #333;
    margin: 4mm 0 2mm;
  }
  .doc-number {
    font-size: 11pt;
    margin: 5mm 0 6mm;
  }
  .salute { margin: 0 0 4mm; font-size: 12pt; }
  .body p {
    text-align: justify;
    margin: 0 0 4mm;
    text-indent: 8mm;
  }
  .body ul {
    margin: 2mm 0 4mm 8mm;
    padding-left: 6mm;
  }
  .body li { margin-bottom: 1.5mm; text-align: left; }
  .signature-block {
    margin-top: 12mm;
    position: relative;
    min-height: 34mm;
  }
  .signature-row {
    display: flex;
    align-items: flex-end;
    gap: 4mm;
    font-size: 11pt;
  }
  .signature-row .position { flex: 1; }
  .signature-row .line {
    width: 58mm;
    border-bottom: 0.5pt solid #111;
    margin: 0 4mm;
    height: 6mm;
  }
  .signature-row .name { white-space: nowrap; }
  .overlay-signature {
    position: absolute;
    left: 78mm;
    top: -2mm;
    width: 48mm;
    opacity: 0.92;
    pointer-events: none;
  }
  .overlay-stamp {
    position: absolute;
    left: 92mm;
    top: -9mm;
    width: 36mm;
    opacity: 0.78;
    pointer-events: none;
  }
  .mp-placeholder {
    margin-top: 5mm;
    text-align: center;
    color: #9CA3AF;
    font-size: 9pt;
    width: 40mm;
    margin-left: 88mm;
  }
  .footer {
    position: absolute;
    left: 22mm;
    right: 16mm;
    bottom: 10mm;
    border-top: 0.5pt solid #cfcfcf;
    padding-top: 3mm;
    font-size: 8.5pt;
    color: #666;
    text-align: center;
  }
</style>
</head><body>
<div class="page">

  <div class="letterhead">
    <div class="co">${esc(company.name_full)}</div>
    <div class="meta">
      ${esc(company.legal_address)}<br>
      ИНН / КПП: ${esc(company.inn)} / ${esc(company.kpp)}${company.ogrn ? ` · ОГРН ${esc(company.ogrn)}` : ''}<br>
      ${esc(company.bank_name)} · р/с ${esc(company.bank_rs)} · к/с ${esc(company.bank_ks)} · БИК ${esc(company.bank_bik)}<br>
      e-mail: ${esc(company.email)} · тел.: ${esc(company.phone)}
    </div>
  </div>

  <div class="doc-number">
    Исх. № ${esc(o.number || 'б/н')} от ${esc(o.dateText || _shared.formatRuDate(new Date()))}
  </div>

  <div class="salute">Уважаемые Коллеги!</div>

  <div class="body">
    <p>${basisText}</p>
    <p>В рамках исполнения обязательств персонал ${esc(company.name_short)} обязан иметь действующие допуски
       и разрешительные документы, подтверждающие возможность выполнения работ на объекте Заказчика.</p>
    <p>В целях обеспечения допуска персонала к выполнению работ ${esc(company.name_short)} привлекло
       ${esc(counterparty)} для оказания услуг${contractText}, а именно:</p>
    ${data.items.length ? `<ul>${itemsHtml}</ul>` : ''}
    <p>В адрес ${esc(company.name_short)} выставлен счёт на оплату № ${esc(invoiceNo)}${invoiceDate ? ` от ${esc(invoiceDate)}` : ''}
       на сумму ${money(gross)} руб.${esc(vatLine)}.</p>
    <p>Указанные расходы являются обязательными и непосредственно связаны с исполнением обязательств по договору,
       поскольку отсутствие соответствующих документов исключает возможность выполнения работ на объекте Заказчика.</p>
    <p>Просим осуществить оплату счёта (100% суммы) в размере ${money(gross)} руб.
       (${esc(amountInWords(gross))})${esc(vatTail)}</p>
  </div>

  <div class="signature-block">
    <div class="signature-row">
      <div class="position">${esc(gendir.position)}<br>${esc(company.name_short)}</div>
      <div class="line"></div>
      <div class="name">/ ${esc(gendir.name)} /</div>
    </div>
    ${signature ? `<img class="overlay-signature" src="${signature}" alt=""/>` : ''}
    ${stamp ? `<img class="overlay-stamp" src="${stamp}" alt=""/>` : ''}
    ${(!signature && !stamp) ? '<div class="mp-placeholder">М.П.</div>' : ''}
  </div>

  <div class="footer">
    ${esc(company.name_short)} · ${esc(company.legal_address)} · ${esc(company.phone)} · ${esc(company.email)}
  </div>

</div>
</body></html>`;
}

// ─── Генерация PDF ────────────────────────────────────────────────────────
const STORAGE_DIR = path.join(process.cwd(), 'storage', 'obs-letters');

function ensureDir() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

/**
 * Сформировать PDF письма и сохранить на диск.
 *
 * @param {object} db — pg pool/клиент
 * @param {number} docId — id строки doc_registry (счёт)
 * @returns {Promise<{pdfPath:string, number:string, htmlPath:string}>}
 */
async function generateObsLetterPdf(db, docId) {
  const data = await loadLetterData(db, docId);
  const doc = data.doc;

  const number = await nextOutgoingNumber(db, new Date());
  const dateText = _shared.formatRuDate(new Date());

  const html = buildHtml(data, { number, dateText });

  ensureDir();
  const safeNo = String(doc.invoice_number || doc.id).replace(/[^\p{L}\p{N}-]+/gu, '_').slice(0, 40);
  const base = `ОБС_${safeNo}_${number}`;
  const htmlPath = path.join(STORAGE_DIR, `${base}.html`);
  const pdfPath = path.join(STORAGE_DIR, `${base}.pdf`);

  fs.writeFileSync(htmlPath, html, 'utf8');

  const browser = await _getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      displayHeaderFooter: false,
    });
    fs.writeFileSync(pdfPath, buf);
  } finally {
    try { await page.close(); } catch (_) { /* */ }
  }

  return { pdfPath, htmlPath, number, dateText, docId: doc.id };
}

module.exports = {
  generateObsLetterPdf,
  buildHtml,
  loadLetterData,
  buildItems,
  amountInWords,
  nextOutgoingNumber,
  closeBrowser,
  STORAGE_DIR,
};
