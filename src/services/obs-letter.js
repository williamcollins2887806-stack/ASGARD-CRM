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
            pi.payment_source AS pi_source, pi.created_by AS pi_created_by
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

  // D-381: договор субподряда с лимитом существенности.
  // В письме должно стоять основание ИМЕННО того договора, по которому идёт
  // расход: у АСГАРД их два (КР320п26 на 1,5 млн и КР-433п26 на 3 млн), и
  // ошибка в основании делает письмо непригодным.
  //
  // Приоритет выбора:
  //   1. `doc.subcontract_id` — директор выбрал договор при создании письма;
  //   2. `doc.contract_label` — номер договора, сохранённый в карточке;
  //   3. договор по работе (`work_id`) — единственный, если он один.
  let subcontract = null;
  if (doc.subcontract_id) {
    const sc = await db.query(
      `SELECT a.*, s.spent_amount, s.remaining, s.used_pct, s.exhausted
         FROM subcontract_agreements a, subcontract_limit_state(a.id, $2) s
        WHERE a.id = $1`, [doc.subcontract_id, doc.id]);
    subcontract = sc.rows[0] || null;
  }
  if (!subcontract && doc.contract_label) {
    const num = String(doc.contract_label).replace(/[^А-Яа-яЁёA-Za-z0-9-]/g, '');
    if (num) {
      const sc = await db.query(
        `SELECT a.*, s.spent_amount, s.remaining, s.used_pct, s.exhausted
           FROM subcontract_agreements a, subcontract_limit_state(a.id, $2) s
          WHERE REPLACE(REPLACE(UPPER(a.number),'-',''),' ','') = REPLACE(REPLACE(UPPER($1),'-',''),' ','')
          LIMIT 1`, [num, doc.id]);
      subcontract = sc.rows[0] || null;
    }
  }
  if (!subcontract && doc.work_id) {
    const sc = await db.query(
      `SELECT a.*, s.spent_amount, s.remaining, s.used_pct, s.exhausted
         FROM subcontract_agreements a, subcontract_limit_state(a.id, $2) s
        WHERE a.work_id = $1 AND a.is_active = TRUE
        ORDER BY a.agreement_date DESC`, [doc.work_id, doc.id]);
    // Берём только если договор ровно один — иначе выбор за человеком.
    if (sc.rows.length === 1) subcontract = sc.rows[0];
  }

  // Позиции: из заявки, если распознаны.
  let lines = null;
  if (doc.pi_lines) {
    lines = typeof doc.pi_lines === 'string'
      ? (() => { try { return JSON.parse(doc.pi_lines); } catch (_) { return null; } })()
      : doc.pi_lines;
  }
  // D-381: у архивных счетов (импорт до автоматизации) позиции лежат в
  // `parsed_json.lines`, а не в заявке — заявки у них может не быть вовсе.
  if ((!Array.isArray(lines) || !lines.length) && doc.parsed_json) {
    const pj = typeof doc.parsed_json === 'string'
      ? (() => { try { return JSON.parse(doc.parsed_json); } catch (_) { return null; } })()
      : doc.parsed_json;
    if (pj && Array.isArray(pj.lines) && pj.lines.length) lines = pj.lines;
  }

  const company = await _shared.loadCompanyProfile(db);
  const gendir = await _shared.loadAsgardGendir(db);

  // D-385: «Исп.:» в письме. Раньше здесь подставлялось название компании —
  // в исходящем документе появлялось «Исп.: ООО «Асгард-Сервис»», то есть
  // строка без смысла (Д. Путков, 28.10.2026: «убрать исполнителя письма или
  // переделать на кого-то, например на инициатора»). Исполнитель — тот, кто
  // завёл счёт: его имя и контакт и нужны получателю, если возникнет вопрос.
  const initiatorId = doc.created_by || (doc.pi_created_by || null);
  const initiator = initiatorId ? await _shared.loadUserById(initiatorId, db) : null;
  return {
    doc,
    work,
    subcontract,
    contractLabel: subcontract ? subcontract.number : String(doc.contract_label || '').trim(),
    contractDate: subcontract && subcontract.agreement_date
      ? _shared.formatRuDate(subcontract.agreement_date)
      : (doc.contract_date ? _shared.formatRuDate(doc.contract_date) : ''),
    items: buildItems(doc, lines),
    company,
    gendir,
    initiator,
  };
}

// ─── HTML письма ──────────────────────────────────────────────────────────
function buildHtml(data, opts) {
  const o = opts || {};
  const { doc, work, company, gendir } = data;

  // D-385: ступень уплотнения перечня (см. COMPACT_STEPS). 0 — как раньше.
  // Всё остальное в письме не масштабируется: суммы и реквизиты должны
  // читаться одинаково при любом объёме позиций.
  const step = Math.max(0, Math.min(COMPACT_STEPS.length - 1, Number(o.compact) || 0));
  const ulFont = [9.5, 8.8, 8.2][step];
  const ulLine = [1.15, 1.08, 1.02][step];
  const liGap = [0.2, 0.1, 0][step];

  const signature = o.with_signature === false ? '' : _shared.getSignatureBase64();
  const stamp = o.with_stamp === false ? '' : _shared.getStampBase64();
  // D-387: логотип в бланке — как в Word-версии (templates/*.docx).
  const logo = _shared.getLogoBase64();

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
  //
  // D-378 (P2 от верификатора 25.10.2026): в первой версии были обороты из
  // запрещённого списка .cursor/rules/anti-ai-text.mdc — «Настоящим сообщаем»,
  // «В рамках исполнения», «В целях обеспечения». Письмо уходит внешнему
  // контрагенту, поэтому переписано прямыми формулировками без канцелярита.
  let basisText;
  if (objectName && customerName) {
    basisText = `${esc(company.name_short)} выполняет ${esc(whatWeDo)} `
      + `на объекте ${esc(objectName)} по договору субподряда с ${esc(customerName)}.`;
  } else if (objectName) {
    basisText = `${esc(company.name_short)} выполняет ${esc(whatWeDo)} на объекте ${esc(objectName)}.`;
  } else if (workTitle) {
    basisText = `${esc(company.name_short)} выполняет ${esc(whatWeDo)}.`;
  } else {
    basisText = `${esc(company.name_short)} привлекает подрядчиков для исполнения своих обязательств перед заказчиками.`;
  }

  // D-381: договор субподряда. Если директор выбрал договор — пишем его номер,
  // дату и ссылку на лимит существенности. Ошибка в основании делает письмо
  // непригодным, поэтому договор берём из данных, а не «какой найдётся».
  const contractText = data.subcontract
    ? ` на основании договора субподряда № ${esc(data.subcontract.number)}`
      + `${data.contractDate ? ` от ${esc(data.contractDate)}` : ''}`
    : (data.contractLabel
      ? ` на основании договора № ${esc(data.contractLabel)}${data.contractDate ? ` от ${esc(data.contractDate)}` : ''}`
      : '');

  // D-381: остаток лимита существенности — справочно в письме, чтобы
  // получатель ОБС видел, в рамках какого лимита расход.
  const limitNote = (data.subcontract && Number(data.subcontract.limit_amount) > 0)
    ? `<p style="font-size:10.5pt;color:#444">Лимит существенности по договору: `
      + `${money(data.subcontract.limit_amount)} руб. `
      + `Использовано ранее: ${money(data.subcontract.spent_amount || 0)} руб. `
      + `Остаток до настоящего счёта: ${money(data.subcontract.remaining || 0)} руб.</p>`
    : '';

  // D-385: длинный перечень. Д. Путков 28.10.2026: «всегда умещать на 1 листе
  // письмо или как-то делить его на части». Делить на части — плохо: письмо
  // читают как основание платежа, разорванный перечень сбивает.
  const sel = selectLetterItems(data.items, doc.invoice_number);
  const itemsHtml = sel.shown.map((t) => `<li>${esc(t)}</li>`).join('')
    + (sel.rest > 0 ? `<li class="more">${esc(sel.restLine)}</li>` : '');

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
    display: flex;
    align-items: flex-start;
    gap: 6mm;
  }
  /* D-387: логотип в бланке PDF. Раньше его не было вовсе — бланк был
     текстовым, хотя в Word-версии логотип есть. Заказчик 28.10.2026:
     «почему он создает 2 письма без лого и с лого» — расхождение форматов. */
  .letterhead .logo {
    width: 26mm;
    height: auto;
    flex: 0 0 auto;
    margin-top: 1mm;
  }
  .letterhead .head-text { flex: 1 1 auto; }
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
    margin: 1.5mm 0 2mm 7mm;
    padding-left: 4mm;
    /* D-381: счета за спецодежду дают 9–11 позиций, и письмо уезжало на
       2 страницы — подпись отдельно от текста. Перечень справочный,
       поэтому уплотняем: читаемость важнее «воздуха». */
    font-size: ${ulFont}pt;
    line-height: ${ulLine};
  }
  .body li { margin-bottom: ${liGap}mm; text-align: left; }
  .body li.more { font-style: italic; color: #444; }
  .body p { margin-bottom: 2.4mm; text-indent: 6mm; }
  .salute { margin: 0 0 3mm; }
  .doc-number { margin: 3mm 0 4mm; }
  .signature-block {
    margin-top: 5mm;
    position: relative;
    min-height: 24mm;
    /* D-378: письмо А-2115 выходило на 2 страницы, и подпись с печатью
       уезжали на вторую, оставляя на первой пустое место. Блок подписи
       неделим — как в бумажном делопроизводстве. */
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /* D-378 (P2 от верификатора 25.10.2026): одного break-inside оказалось
     мало — Chrome при min-height 297mm у контейнера страницы всё равно
     разрывал лист. Запрещаем разрыв у самой страницы и держим подпись
     сразу за текстом: письмо умещается на одном листе. */
  .page { break-inside: avoid; page-break-inside: avoid; }
  .body { break-after: avoid; page-break-after: avoid; }
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
  /* D-385: «Исп.:» — тот, кто завёл счёт. Строка мелкая и внизу, как в
     деловом письме; в блок подписи не входит, чтобы не спорить с печатью. */
  .executor-line {
    margin-top: 3mm;
    font-size: 9pt;
    color: #444;
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
    ${logo ? `<img class="logo" src="${logo}" alt=""/>` : ''}
    <div class="head-text">
      <div class="co">${esc(company.name_full)}</div>
      <div class="meta">
        ${esc(company.legal_address)}<br>
        ИНН / КПП: ${esc(company.inn)} / ${esc(company.kpp)}${company.ogrn ? ` · ОГРН ${esc(company.ogrn)}` : ''}<br>
        ${esc(company.bank_name)} · р/с ${esc(company.bank_rs)} · к/с ${esc(company.bank_ks)} · БИК ${esc(company.bank_bik)}<br>
        e-mail: ${esc(company.email)} · тел.: ${esc(company.phone)}
      </div>
    </div>
  </div>

  <div class="doc-number">
    Исх. № ${esc(o.number || 'б/н')} от ${esc(o.dateText || _shared.formatRuDate(new Date()))}
  </div>

  <div class="salute">Уважаемые Коллеги!</div>

  <div class="body">
    <p>${basisText}</p>
    <p>Персонал ${esc(company.name_short)} обязан иметь действующие допуски и разрешительные документы,
       подтверждающие возможность выполнения работ на объекте Заказчика.</p>
    <p>Чтобы обеспечить допуск персонала к работам, ${esc(company.name_short)} привлекло
       ${esc(counterparty)} для оказания услуг${contractText}, а именно:</p>
    ${data.items.length ? `<ul>${itemsHtml}</ul>` : ''}
    <p>${esc(company.name_short)} получило счёт на оплату № ${esc(invoiceNo)}${invoiceDate ? ` от ${esc(invoiceDate)}` : ''}
       на сумму ${money(gross)} руб.${esc(vatLine)}.</p>
    ${limitNote}
    <p>Расходы обязательные и напрямую связаны с исполнением обязательств по договору:
       без этих документов работы на объекте Заказчика выполнять нельзя.</p>
    <p>Просим оплатить счёт (100% суммы) в размере ${money(gross)} руб.
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

  ${(data.initiator && data.initiator.name && data.initiator.name !== '—') ? `<div class="executor-line">
    Исп.: ${esc(data.initiator.name)}${data.initiator.phone ? ` · тел.: ${esc(data.initiator.phone)}` : ''}
  </div>` : ''}

  <div class="footer">
    ${esc(company.name_short)} · ${esc(company.legal_address)} · ${esc(company.phone)} · ${esc(company.email)}
  </div>

</div>
</body></html>`;
}

// ─── Генерация PDF ────────────────────────────────────────────────────────
// D-378 (дефект, найденный верификатором 25.10.2026): первая версия писала
// PDF в `storage/obs-letters/`, а это вне и `public/`, и `uploads/` — nginx
// такой путь не раздаёт, и клик «Письмо готово» получал SPA-заглушку вместо
// файла. Теперь письма лежат в `uploads/doc-hub/obs-letters/` — в том же
// защищённом каталоге, откуда реестр отдаёт остальные документы ACL-роутом.
const UPLOAD_ROOT = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
const STORAGE_DIR = path.join(UPLOAD_ROOT, 'doc-hub', 'obs-letters');
/** Публичный URL-префикс для записи в attachments (раздаётся ACL-роутом). */
const URL_PREFIX = '/uploads/doc-hub/obs-letters';

function ensureDir() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// ─── Уместить письмо на один лист (D-385) ─────────────────────────────────
/**
 * Ступени уплотнения перечня. 0 — обычный вид; дальше по порядку ужимаем
 * ТОЛЬКО список позиций и отбивки абзацев. Реквизиты, суммы, подпись и
 * печать не масштабируются: это платёжный документ, а не листовка.
 *
 * Почему ступени, а не «подобрать шрифт по числу позиций»: высота строки
 * зависит от длины наименований (переносы), поэтому число позиций —
 * плохой предсказатель. Рендерим и меряем фактически.
 */
const COMPACT_STEPS = [0, 1, 2];

/**
 * Сколько позиций печатать в письме.
 *
 * Общее правило для PDF и Word: до 28 позиций — весь перечень, сверх —
 * первые 20 и явная строка «и ещё N позиций по счёту». Врать про количество
 * нельзя, поэтому остаток назван прямо, а не спрятан. Почему не режем
 * молча: письмо служит основанием платежа, и получатель должен видеть, что
 * перечень в письме неполный, а полный — в счёте.
 *
 * @param {string[]} items
 * @param {string} [invoiceNo]
 * @returns {{shown:string[], rest:number, restLine:string}}
 */
function selectLetterItems(items, invoiceNo) {
  const all = Array.isArray(items) ? items : [];
  const FULL_LIMIT = 28;
  const HEAD = 20;
  if (all.length <= FULL_LIMIT) return { shown: all, rest: 0, restLine: '' };
  const rest = all.length - HEAD;
  return {
    shown: all.slice(0, HEAD),
    rest,
    restLine: `… и ещё ${rest} ${_plural(rest, 'позиция', 'позиции', 'позиций')} `
      + `по счёту № ${invoiceNo || 'б/н'} — полный перечень в счёте.`,
  };
}

/** Сколько страниц в готовом PDF. Встроенный счётчик, без внешних бинарей. */
async function _pageCount(buf) {
  try {
    const pdfParse = require('pdf-parse');
    const d = await pdfParse(buf);
    return Number(d && d.numpages) || 1;
  } catch (_) {
    return 1; // счётчик недоступен — считаем, что уместилось
  }
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

  ensureDir();
  const safeNo = String(doc.invoice_number || doc.id).replace(/[^\p{L}\p{N}-]+/gu, '_').slice(0, 40);
  const base = `ОБС_${safeNo}_${number}`;
  const pdfPath = path.join(STORAGE_DIR, `${base}.pdf`);

  // D-378 (P3 от верификатора 25.10.2026): HTML-исходник письма на диск
  // больше не пишем. Каталог раздаётся nginx напрямую, и файл .html
  // открывался бы в браузере как страница с реквизитами и суммами —
  // это утечка внешнего документа и лишняя XSS-поверхность.
  // Для отладки HTML можно получить из функции buildHtml.

  const browser = await _getBrowser();
  const page = await browser.newPage();
  try {
    // D-385: письмо обязано уместиться на ОДНОМ листе (Д. Путков, 28.10.2026:
    // «всегда умещать на 1 листе письмо или как-то делить его на части»).
    // Замер: 16 позиций — ещё 1 лист, 25 — уже 2, и подпись с печатью
    // уезжали на второй лист отдельно от текста.
    //
    // Делить письмо не нужно: перечень справочный, поэтому сначала ужимаем
    // его (шрифт/интерлиньяж), а суммы и реквизиты не трогаем. Подгонка
    // детерминированная — масштабы пробуем по порядку и берём первый,
    // который дал одну страницу.
    let buf = null;
    for (const compact of COMPACT_STEPS) {
      const html = buildHtml(data, { number, dateText, compact });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      buf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
        displayHeaderFooter: false,
      });
      if (await _pageCount(buf) <= 1) break;
    }
    fs.writeFileSync(pdfPath, buf);
  } finally {
    try { await page.close(); } catch (_) { /* */ }
  }

  return { pdfPath, htmlPath: null, url: `${URL_PREFIX}/${encodeURIComponent(`${base}.pdf`)}`, number, dateText, docId: doc.id, fileName: `${base}.pdf` };
}

/**
 * D-384: абзацы письма как ПЛОСКИЙ текст — один источник для PDF и Word.
 *
 * Зачем отдельно. Раньше текст собирался внутри `buildHtml` в виде HTML.
 * Word рендерится через docxtemplater и HTML не понимает, поэтому нужен
 * общий «смысловой» слой: массив абзацев, из которого HTML делает `<p>`,
 * а DOCX — параграфы Word. Иначе PDF и Word начнут расходиться по тексту,
 * и бухгалтерия распечатает одно, а отправит другое.
 *
 * Возвращает массив строк. Перечень услуг идёт отдельными строками с
 * маркером «— », чтобы в Word не нужен был список Word (шаблон его не
 * содержит).
 *
 * @param {object} data — результат loadLetterData
 * @param {{number?:string, dateText?:string}} [opts]
 * @returns {string[]}
 */
function buildLetterParagraphs(data, opts = {}) {
  const { doc, work, company, subcontract } = data;

  const dateNum = (d) => {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()} г.`;
  };
  const money = (n) => Number(n || 0)
    .toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const gross = Number(doc.amount_gross || 0);
  const vat = Number(doc.vat_amount || 0);
  const ratePct = Number(doc.vat_rate || 0) > 1
    ? Number(doc.vat_rate)
    : Number(doc.vat_rate || 0) * 100;
  const hasVat = vat > 0;

  const invoiceNo = doc.invoice_number || 'б/н';
  const invoiceDate = dateNum(doc.invoice_date);
  const counterparty = doc.counterparty_name || 'контрагент';

  const objectName = (work && work.object_name) || '';
  const workTitle = (work && work.work_title) || '';
  const customerName = (work && work.customer_name) || '';

  const ACTION_TITLE = /^(капитальный|текущий|ремонт|замена|очистка|промывка|монтаж|демонтаж|восстановлен|диагностик|обследован|испытани)/i;
  const whatWeDo = workTitle
    ? (ACTION_TITLE.test(workTitle.trim()) ? workTitle.trim() : `работы по ${workTitle.trim()}`)
    : 'работы';

  const out = [];

  // 1. Основание: объект и работы.
  if (objectName && customerName) {
    out.push(`${company.name_short} выполняет ${whatWeDo} на объекте ${objectName} `
      + `по договору субподряда с ${customerName}.`);
  } else if (objectName) {
    out.push(`${company.name_short} выполняет ${whatWeDo} на объекте ${objectName}.`);
  } else if (workTitle) {
    out.push(`${company.name_short} выполняет ${whatWeDo}.`);
  } else {
    out.push(`${company.name_short} привлекает подрядчиков для исполнения своих обязательств перед заказчиками.`);
  }

  // 2. Требование к допускам.
  out.push(`Персонал ${company.name_short} обязан иметь действующие допуски и разрешительные документы, `
    + `подтверждающие возможность выполнения работ на объекте Заказчика.`);

  // 3. Кого привлекли и по какому договору.
  const contractTail = subcontract
    ? ` на основании договора субподряда № ${subcontract.number}`
      + (data.contractDate ? ` от ${data.contractDate}` : '')
    : (data.contractLabel
      ? ` на основании договора № ${data.contractLabel}`
        + (data.contractDate ? ` от ${data.contractDate}` : '')
      : '');
  out.push(`Чтобы обеспечить допуск персонала к работам, ${company.name_short} привлекло `
    + `${counterparty} для оказания услуг${contractTail}, а именно:`);

  // 4. Перечень услуг — по строке на позицию. Отбор общий с PDF (см.
  // selectLetterItems): если перечень длинный, в обоих форматах остаётся
  // одинаковый хвост «и ещё N позиций», иначе PDF и Word разойдутся.
  const sel = selectLetterItems(data.items, invoiceNo);
  for (const item of sel.shown) {
    out.push(`— ${item}`);
  }
  if (sel.rest > 0) out.push(`— ${sel.restLine}`);

  // 5. Счёт и сумма.
  const vatLine = hasVat
    ? ` (включая НДС ${ratePct ? String(Math.round(ratePct)) + '%' : ''} — ${money(vat)} руб.)`
    : ' (НДС не облагается)';
  out.push(`${company.name_short} получило счёт на оплату № ${invoiceNo}`
    + `${invoiceDate ? ` от ${invoiceDate}` : ''} на сумму ${money(gross)} руб.${vatLine}.`);

  // 6. Лимит существенности по договору (справочно).
  if (subcontract && Number(subcontract.limit_amount) > 0) {
    out.push(`Лимит существенности по договору: ${money(subcontract.limit_amount)} руб. `
      + `Использовано ранее: ${money(subcontract.spent_amount || 0)} руб. `
      + `Остаток до настоящего счёта: ${money(subcontract.remaining || 0)} руб.`);
  }

  // 7. Обоснование необходимости.
  out.push('Расходы обязательные и напрямую связаны с исполнением обязательств по договору: '
    + 'без этих документов работы на объекте Заказчика выполнять нельзя.');

  // 8. Просьба об оплате.
  const vatTail = hasVat
    ? `, в том числе НДС ${ratePct ? String(Math.round(ratePct)) + '%' : ''} — ${money(vat)} руб.`
    : '. НДС не облагается.';
  out.push(`Просим оплатить счёт (100% суммы) в размере ${money(gross)} руб. `
    + `(${amountInWords(gross)})${vatTail}`);

  return out;
}

module.exports = {
  generateObsLetterPdf,
  buildHtml,
  buildLetterParagraphs,
  loadLetterData,
  buildItems,
  selectLetterItems,
  amountInWords,
  nextOutgoingNumber,
  closeBrowser,
  STORAGE_DIR,
};
