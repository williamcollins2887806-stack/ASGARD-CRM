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

  // V488: НИЧЕГО НЕ ВЫДУМЫВАЕМ.
  //
  // Раньше при отсутствии позиций и комментария возвращалось
  // `['по счёту № Е-00063180']` — и это печаталось как ПЕРЕЧЕНЬ ЗАКУПКИ:
  //   «… необходимы по счёту № Е-00063180. Поставка осуществляется ООО «ДНС
  //    РИТЕЙЛ» … — по счёту № Е-00063180»
  // Заказчик справедливо назвал это бредом. Пустой перечень честнее выдуманного:
  // если позиций нет, письмо просто их не перечисляет.
  return [];
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

/**
 * Данные письма из payload модалки.
 *
 * Зачем отдельно от `loadLetterData`. До модалки письмо собиралось ТОЛЬКО из
 * строки реестра: номер, дата и сумма счёта брались как есть, а если парсер их
 * не распознал — в письме стояло «б/н» и неверная дата, переписать было нечем.
 * Теперь человек в модалке видит эти поля и может их поправить, не меняя
 * строку реестра (у бухгалтерии счёт уже проведён, трогать его нельзя).
 *
 * Что переопределяет payload:
 *   • invoice_number / invoice_date — номер и дата счёта;
 *   • amount_gross / vat_amount / vat_rate — суммы (НДС считается от gross,
 *     если ставка задана, а сумма НДС нет);
 *   • items — перечень строк (если пусто, остаются позиции из счёта);
 *   • subcontract_id — договор субподряда;
 *   • obs_account_id — ОБС-счёт, с которого платим;
 *   • counterparty_name — если контрагент распознан неверно и человек исправил.
 *
 * Всё остальное (объект, бланк, подпись, печать) — из базы, как раньше.
 *
 * @param {object} db
 * @param {number} docId
 * @param {object} payload
 * @returns {Promise<object>} те же поля, что у loadLetterData
 */
async function buildLetterDataFromPayload(db, docId, payload) {
  const base = await loadLetterData(db, docId);
  const p = payload || {};
  const doc = Object.assign({}, base.doc);

  if (p.counterparty_name !== undefined) {
    const nm = String(p.counterparty_name || '').trim();
    if (nm) doc.counterparty_name = nm;
  }
  if (p.invoice_number !== undefined) {
    doc.invoice_number = String(p.invoice_number || '').trim() || null;
  }
  if (p.invoice_date !== undefined && p.invoice_date !== null && p.invoice_date !== '') {
    doc.invoice_date = p.invoice_date;
  }

  // Суммы. gross — сумма с НДС («в том числе НДС»), поэтому НДС из ставки
  // считается как gross * rate / (100 + rate), а не gross * rate / 100.
  const hasGross = p.amount_gross !== undefined && p.amount_gross !== null && p.amount_gross !== '';
  if (hasGross) {
    const gross = Number(p.amount_gross);
    if (Number.isFinite(gross) && gross >= 0) doc.amount_gross = gross;
  }
  const grossNum = Number(doc.amount_gross) || 0;

  let rate = null;
  if (p.vat_rate !== undefined && p.vat_rate !== null && p.vat_rate !== '') {
    rate = Number(p.vat_rate);
    if (!Number.isFinite(rate) || rate < 0) rate = null;
    if (rate !== null) doc.vat_rate = rate > 1 ? rate : rate * 100;
  }
  if (p.vat_amount !== undefined && p.vat_amount !== null && p.vat_amount !== '') {
    const vat = Number(p.vat_amount);
    if (Number.isFinite(vat) && vat >= 0) doc.vat_amount = vat;
  } else if (hasGross && rate !== null) {
    doc.vat_amount = Math.round(grossNum * rate / (100 + rate) * 100) / 100;
  }
  doc.amount_gross = grossNum;
  if (doc.amount_net === undefined || hasGross) {
    doc.amount_net = Math.round((grossNum - (Number(doc.vat_amount) || 0)) * 100) / 100;
  }

  // Перечень: строки из модалки главнее распознанных позиций.
  let items = base.items;
  if (Array.isArray(p.items)) {
    const clean = p.items.map((v) => String(v == null ? '' : v).trim()).filter(Boolean);
    if (clean.length) items = clean;
  }

  // Договор: если человек выбрал другой — перечитываем остаток лимита.
  let subcontract = base.subcontract;
  let contractLabel = base.contractLabel;
  let contractDate = base.contractDate;
  if (p.subcontract_id !== undefined) {
    if (p.subcontract_id === null || p.subcontract_id === '') {
      subcontract = null;
      contractLabel = '';
      contractDate = '';
    } else {
      const sc = await db.query(
        `SELECT a.*, s.spent_amount, s.remaining, s.used_pct, s.exhausted
           FROM subcontract_agreements a, subcontract_limit_state(a.id, $2) s
          WHERE a.id = $1`, [Number(p.subcontract_id), docId]);
      if (sc.rows[0]) {
        subcontract = sc.rows[0];
        contractLabel = subcontract.number;
        contractDate = subcontract.agreement_date
          ? _shared.formatRuDate(subcontract.agreement_date) : '';
      }
    }
  }

  // ОБС-счёт: нужен только для строки «куда платить» в просьбе об оплате.
  let obsAccount = null;
  if (p.obs_account_id) {
    const oa = await db.query(
      'SELECT id, name, bank_name, bank_account FROM obs_accounts WHERE id=$1 AND is_active',
      [Number(p.obs_account_id)]);
    obsAccount = oa.rows[0] || null;
  }

  const letterRules = require('./obs-letter-rules');
  const work_context = p.work_context !== undefined
    ? String(p.work_context || '').trim()
    : '';
  const subcontract_party = p.subcontract_party !== undefined
    ? String(p.subcontract_party || '').trim() || letterRules.DEFAULT_SUBCONTRACT_PARTY
    : letterRules.DEFAULT_SUBCONTRACT_PARTY;
  const special_context = p.special_context !== undefined ? String(p.special_context || '').trim() : '';

  let payment_pct = 100;
  if (p.payment_pct !== undefined && p.payment_pct !== null && p.payment_pct !== '') {
    const n = Number(p.payment_pct);
    if (Number.isFinite(n)) payment_pct = Math.max(0, Math.min(100, n));
  }
  const payment_period = p.payment_period !== undefined ? String(p.payment_period || '').trim() : '';

  let paragraphs_override = null;
  const rawOverride = p.paragraphs_override || p.letter_body;
  if (Array.isArray(rawOverride)) {
    const clean = rawOverride.map((t) => String(t == null ? '' : t).trim()).filter(Boolean);
    if (clean.length) paragraphs_override = clean;
  }

  // ─── V486: ТЕКСТ ПИСЬМА ПОД ПРЕДМЕТ ЗАКУПКИ ─────────────────────────────
  let aiBody = null;
  const skipAi = !!paragraphs_override;
  if (!skipAi) {
    try {
      const aiSvc = require('./obs-letter-ai');
      const contractText = subcontract
        ? `№ ${subcontract.number}${contractDate ? ` от ${contractDate}` : ''}`
        : (contractLabel ? `№ ${contractLabel}` : '');
      aiBody = await aiSvc.generate({
        items,
        comment: doc.comment_text || base.doc.comment_text || '',
        counterparty: doc.counterparty_name || '',
        company: (base.company && (base.company.name_short || base.company.name_full)) || 'ООО «Асгард-Сервис»',
        invoiceNo: doc.invoice_number || '',
        invoiceDate: doc.invoice_date ? _shared.formatRuDate(doc.invoice_date) : '',
        contractLabel: contractText,
        amount: doc.amount_gross,
      });
    } catch (e) {
      console.warn('[obs-letter] aiBody не собрался: ' + (e && e.message));
    }
  }

  return Object.assign({}, base, {
    doc, subcontract, contractLabel, contractDate, items, obsAccount,
    aiBody,
    work_context,
    subcontract_party,
    payment_pct,
    payment_period,
    special_context,
    paragraphs_override,
  });
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
  // Комбинированный факсимиле предпочтительнее раздельных stamp/signature.
  const stampCombined = (() => {
    try {
      const p = path.join(process.cwd(), 'public', 'assets', 'img', 'obs_stamp_sign.png');
      if (fs.existsSync(p)) return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
    } catch (_) { /* */ }
    return '';
  })();
  const stamp = o.with_stamp === false ? '' : (stampCombined || _shared.getStampBase64());
  // Фирменный логотип бланка ОБС (не asgard_logo CRM).
  const logo = (() => {
    try {
      const p = path.join(process.cwd(), 'public', 'assets', 'img', 'obs_letterhead_logo.png');
      if (fs.existsSync(p)) return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
    } catch (_) { /* */ }
    return _shared.getLogoBase64();
  })();

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

  const letterRules = require('./obs-letter-rules');
  const workCtx = String(data.work_context || '').trim() || letterRules.DEFAULT_WORK_CONTEXT;
  const subParty = String(data.subcontract_party || '').trim() || letterRules.DEFAULT_SUBCONTRACT_PARTY;
  const payPct = Math.max(0, Math.min(100, Number(data.payment_pct) || 100));
  const payPeriod = String(data.payment_period || '').trim();
  const specialCtx = String(data.special_context || '').trim();

  const scNoHtml = data.subcontract ? data.subcontract.number : (data.contractLabel || '');
  const scDateHtml = data.contractDate || '';
  let basisText = `Настоящим сообщаем, что ${esc(company.name_short)} ${esc(workCtx)}`;
  if (scNoHtml) {
    basisText += ` на основании Договора субподряда № ${esc(scNoHtml)}`
      + `${scDateHtml ? ` от ${esc(scDateHtml)}` : ''}`
      + `, заключенного с ${esc(subParty)}`;
  }
  basisText += '.';

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

  // ─── V486: текст по каркасу ──────────────────────────────────────────────
  //
  // Заказчик 11.11.2026: «холодильник, шуруповёрт и кулер не для безопасного
  // выполнения работ». Раньше здесь стояли ДВА жёстких абзаца — про допуски
  // персонала и про «привлекло для оказания услуг», — и они попадали в любое
  // письмо, включая счёт на кулер.
  //
  // Теперь: `data.aiBody` (собрано в buildLetterDataFromPayload) даёт `gist`
  // и `why` под конкретный предмет, а абзац про допуски печатается ТОЛЬКО для
  // каркаса «допуск».
  const aiGist = (data.aiBody && data.aiBody.gist) ? String(data.aiBody.gist) : '';
  const aiWhy = (data.aiBody && data.aiBody.why) ? String(data.aiBody.why) : '';
  const scaffoldGate = (data.aiBody && data.aiBody.scaffold) || '';
  // Позиции — строкой через запятую (в эталонах Дмитрия списков нет).
  //
  // V488: чистим артикулы, размеры и фасовку — иначе в письме для банка
  // красуется «Костюм Легион-1 (тк.Смесовая,210) брюки, т.серый/красный
  // р. 44-46, 158-164 (арт. 87490062)». Сокращения импортируем лениво, чтобы
  // не тянуть модуль ИИ при каждом рендере HTML.
  const _shortName = (() => {
    try { return require('./obs-letter-ai').shortenItemName; } catch (_) { return (x) => x; }
  })();
  const itemsLine = sel.shown.length
    ? sel.shown.map((t) => _shortName(t) || t).join(', ') + (sel.rest > 0 ? `, а также ${sel.restLine}` : '')
    : '';

  const vatLine = hasVat
    ? ` (включая НДС ${ratePct ? String(Math.round(ratePct)) + '%' : ''} — ${money(vat)} руб.)`
    : ' (без НДС)';

  const payGross = Math.round(gross * payPct / 100 * 100) / 100;
  const payVat = hasVat ? Math.round(vat * payPct / 100 * 100) / 100 : 0;
  const pctNote = payPct < 100 ? ` (${payPct}% от суммы счёта)` : '';
  const vatTail = hasVat
    ? `, в том числе НДС ${ratePct ? String(Math.round(ratePct)) + '%' : ''} — ${money(payVat)} руб.`
    : '';
  const periodNote = payPeriod ? ` за период ${payPeriod}` : '';

  // V473: куда платить. В письме для ОБС обязательно должен быть виден счёт
  // ОБС — раньше его не было вовсе, и получатель не знал, куда перечислять.
  // Если реквизиты в справочнике не заполнены, печатаем только название:
  // пустой номер счёта хуже, чем его отсутствие.
  const obsAccount = data.obsAccount || null;
  const obsPayLine = obsAccount
    ? `<p style="font-size:10.5pt;color:#444">Оплату просим провести с ${esc(obsAccount.name)}`
      + `${obsAccount.bank_name ? ` (${esc(obsAccount.bank_name)})` : ''}`
      + `${obsAccount.bank_account ? `, р/с ${esc(obsAccount.bank_account)}` : ''}.</p>`
    : '';

  const overrideParas = Array.isArray(data.paragraphs_override) && data.paragraphs_override.length
    ? data.paragraphs_override : null;
  const mainBodyHtml = overrideParas
    ? overrideParas.map((t) => {
      const s = String(t || '');
      if (/^Просим осуществить оплату/i.test(s)) return `<p class="request">${esc(s)}</p>`;
      if (/выставлен сч[её]т на оплату/i.test(s)) return `<p>${esc(s)}</p>`;
      return `<p>${esc(s)}</p>`;
    }).join('\n    ')
      + (obsPayLine ? `\n    ${obsPayLine}` : '')
    : `<p>${basisText}</p>
    ${specialCtx ? `<p>${esc(specialCtx)}</p>` : ''}
    ${scaffoldGate === 'dopusk' ? `<p>В рамках исполнения обязательств по указанному договору персонал ${esc(company.name_short)} обязан иметь действующие допуски и разрешительные документы, подтверждающие возможность выполнения работ на объекте Заказчика.</p>` : ''}
    ${aiGist ? `<p>${esc(aiGist)}</p>` : `<p>Чтобы обеспечить допуск персонала к работам, ${esc(company.name_short)} привлекло ${esc(counterparty)}${contractText}.</p>`}
    ${itemsLine ? `<p>${esc(itemsLine)}</p>` : ''}
    <p>В адрес ООО «Асгард-Сервис» выставлен счёт на оплату <strong>№ ${esc(invoiceNo)}</strong>${invoiceDate ? ` от ${esc(invoiceDate)}` : ''}
       на сумму <strong>${money(gross)} руб.</strong>${esc(vatLine)}.</p>
    ${limitNote}
    <p>${aiWhy ? esc(aiWhy) : 'Расходы обязательные и напрямую связаны с исполнением обязательств по договору субподряда.'}</p>
    <p class="request">Просим осуществить оплату счёта${esc(pctNote)} в размере <strong>${money(payGross)} руб.</strong>
       (${esc(amountInWords(payGross))})${esc(vatTail)}${esc(periodNote)}.</p>
    ${obsPayLine}`;

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
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8mm;
  }
  /* D-392: номер и дата разнесены по краям — как в деловом письме, и не
     сливаются с текстом, когда слева логотип. */
  .doc-number__no { font-weight: bold; }
  .doc-number__date { color: #333; }

  /* D-392: заголовок документа — единый вид для всех писем. */
  .doc-title {
    text-align: center;
    margin: 0 0 7mm;
  }
  .doc-title__main {
    font-size: 13pt;
    font-weight: bold;
    letter-spacing: 0.02em;
    color: #0b3d2e;
    text-transform: none;
  }
  .doc-title__sub {
    font-size: 10pt;
    color: #333;
    font-style: italic;
    margin-top: 1.5mm;
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
  /* D-392: перечень позиций — с маркерами, без вылета за поля. */
  .body ul.items {
    margin: 2mm 0 3mm 0;
    padding-left: 9mm;
    list-style: disc;
  }
  .body ul.items li { text-indent: 0; padding-left: 1mm; }
  /* Просьба об оплате — главная строка письма, отделяем от текста. */
  .body p.request { margin-top: 4mm; font-weight: normal; }
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
    <span class="doc-number__no">Исх. № ${esc(o.number || 'б/н')}</span>
    <span class="doc-number__date">от ${esc(o.dateText || _shared.formatRuDate(new Date()))}</span>
  </div>

  <div class="salute">Уважаемые коллеги!</div>

  <div class="body">
    ${mainBodyHtml}
  </div>

  <div class="signature-block">
    <div class="signature-row">
      <div class="position">${esc(gendir.position)}<br>${esc(company.name_short)}</div>
      <div class="line"></div>
      <div class="name">/ ${esc(gendir.name)} /</div>
    </div>
    ${stampCombined ? '' : (signature ? `<img class="overlay-signature" src="${signature}" alt=""/>` : '')}
    ${stamp ? `<img class="overlay-stamp" src="${stamp}" alt="" style="${stampCombined ? 'height:40mm;width:auto;left:72mm;top:-14mm;opacity:0.95;z-index:5' : 'width:40mm;height:40mm'}"/>` : ''}
    ${(!signature && !stamp && !stampCombined) ? '<div class="mp-placeholder">М.П.</div>' : ''}
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
//
// V473: `path.resolve`, а не `path.join`. Если `UPLOAD_DIR` задан абсолютным
// (так делают тестовые стенды и клон на :3100), `path.join(cwd, '/abs/path')`
// даёт `/cwd/abs/path` — файл пишется не туда, и письмо «теряется».
const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
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

  // PDF = Word 1в1 через фирменный бланк.
  try {
    const { generateObsLetterDocx } = require('./obs-letter-docx');
    const docxBuf = await generateObsLetterDocx(db, docId, { number, dateText });
    const fromDocx = await _pdfFromOfficialDocx(docxBuf);
    if (fromDocx && fromDocx.length > 1000) {
      fs.writeFileSync(pdfPath, fromDocx);
      return { pdfPath, htmlPath: null, url: `${URL_PREFIX}/${encodeURIComponent(`${base}.pdf`)}`, number, dateText, docId: doc.id, fileName: `${base}.pdf`, source: 'docx-libreoffice' };
    }
  } catch (e) {
    console.warn('[obs-letter] generatePdf DOCX→PDF fail, HTML fallback:', e && e.message);
  }

  const browser = await _getBrowser();
  const page = await browser.newPage();
  try {
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

  return { pdfPath, htmlPath: null, url: `${URL_PREFIX}/${encodeURIComponent(`${base}.pdf`)}`, number, dateText, docId: doc.id, fileName: `${base}.pdf`, source: 'html-fallback' };
}

// ─── Рендер по payload без записи в БД (V473: предпросмотр) ────────────────
/**
 * Собрать PDF письма по данным из модалки, НИЧЕГО не записывая в БД.
 *
 * Зачем отдельно от `generateObsLetterPdf`. Предпросмотр — это черновик:
 * человек меняет номер счёта, дату, сумму, перечень и смотрит, что получится.
 * Если гонять его через обычную генерацию, каждый «Предпросмотр» расходовал бы
 * исходящий номер и оставлял строки в реестре — нумерация «съедалась» бы ещё
 * до того, как письмо кому-то понадобилось.
 *
 * Номер здесь — только для шапки («Исх. № …»), и он НЕ выдаётся: приходит из
 * payload (`previewNumber`, обычно «АС-2026-11-00») либо печатается «б/н».
 *
 * @param {object} db
 * @param {number} docId
 * @param {object} payload
 * @param {{format?:'pdf'|'docx'}} [opts]
 * @returns {Promise<{buffer:Buffer, contentType:string, fileName:string}>}
 */
/**
 * PDF = Word 1в1: сначала DOCX с фирменного бланка, потом LibreOffice → PDF.
 * HTML/Puppeteer с asgard_logo CRM больше не источник истины (заказчик 09.11.2026).
 */
async function _pdfFromOfficialDocx(docxBuf) {
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-letter-'));
  const docxPath = path.join(tmpDir, 'obs-letter.docx');
  try {
    fs.writeFileSync(docxPath, docxBuf);
    const pdfPath = _shared.convertDocxToPdf(docxPath, tmpDir);
    if (pdfPath && fs.existsSync(pdfPath)) return fs.readFileSync(pdfPath);
  } finally {
    try {
      for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));
      fs.rmdirSync(tmpDir);
    } catch (_) { /* tmp */ }
  }
  return null;
}

async function renderObsLetterPdf(db, docId, payload, opts = {}) {
  const data = await buildLetterDataFromPayload(db, docId, payload);
  const doc = data.doc;

  const p = payload || {};
  const number = String(p.preview_number || '').trim();
  const dateText = p.letter_date
    ? _shared.formatRuDate(p.letter_date)
    : _shared.formatRuDate(new Date());

  const safeNo = String(doc.invoice_number || doc.id).replace(/[^\p{L}\p{N}-]+/gu, '_').slice(0, 40);
  const base = `ОБС_${safeNo}_предпросмотр`;

  // 1) Основной путь: DOCX бланка → PDF (идентично Word).
  try {
    const docxBuf = await renderObsLetterDocx(db, docId, payload, opts);
    const fromDocx = await _pdfFromOfficialDocx(docxBuf);
    if (fromDocx && fromDocx.length > 1000) {
      return {
        buffer: fromDocx,
        contentType: 'application/pdf',
        fileName: `${base}.pdf`,
        number,
        dateText,
        source: 'docx-libreoffice',
      };
    }
  } catch (e) {
    console.warn('[obs-letter] PDF из DOCX не собрался, fallback HTML:', e && e.message);
  }

  // 2) Fallback только если LibreOffice недоступен.
  const browser = await _getBrowser();
  const page = await browser.newPage();
  let buf = null;
  try {
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
  } finally {
    try { await page.close(); } catch (_) { /* */ }
  }

  return {
    buffer: buf,
    contentType: 'application/pdf',
    fileName: `${base}.pdf`,
    number,
    dateText,
    source: 'html-fallback',
  };
}

/**
 * DOCX того же письма по payload — без записи в БД.
 *
 * Word собирается тем же генератором, что и «настоящее» письмо, но с
 * подменёнными полями. Это важно: предпросмотр обязан совпадать с тем, что
 * сохранится, иначе бухгалтерия распечатает одно, а получит другое.
 */
async function renderObsLetterDocx(db, docId, payload, opts = {}) {
  const { generateObsLetterDocx } = require('./obs-letter-docx');
  const p = payload || {};
  return generateObsLetterDocx(db, docId, Object.assign({}, opts, {
    payload: p,
    // D-397b (замечание верификатора 07.11.2026): раньше при незаданном номере
    // передавался `undefined`, и Word печатал «Исх. №» с пустотой, тогда как
    // PDF подставлял «б/н». Один и тот же предпросмотр не должен выглядеть
    // по-разному в двух форматах.
    number: String(p.preview_number || '').trim()
      || opts.number
      || (opts.placeholder_number === false ? undefined : 'б/н'),
  }));
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

  const override = data.paragraphs_override;
  if (Array.isArray(override) && override.length) {
    return override.map((t) => String(t || '').trim()).filter(Boolean);
  }

  const letterRules = require('./obs-letter-rules');
  const workCtx = String(data.work_context || '').trim() || letterRules.DEFAULT_WORK_CONTEXT;
  const subParty = String(data.subcontract_party || '').trim() || letterRules.DEFAULT_SUBCONTRACT_PARTY;
  const payPct = Math.max(0, Math.min(100, Number(data.payment_pct) || 100));
  const payPeriod = String(data.payment_period || '').trim();
  const specialCtx = String(data.special_context || '').trim();

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
  // V488: в письме — короткая форма юрлица, как у Дмитрия.
  // Раньше сюда шло имя из карточки как есть: «Общество с ограниченной
  // ответственностью "Безопасность Труда"» вместо «ООО «Безопасность Труда»».
  const counterparty = (() => {
    const raw = doc.counterparty_name || 'контрагент';
    try { return require('./obs-letter-ai').shortenOrgName(raw) || raw; }
    catch (_) { return raw; }
  })();

  const out = [];

  // 1. Основание: work_context + договор субподряда с subcontract_party (не customer work).
  const scNo = subcontract ? subcontract.number : (data.contractLabel || '');
  const scDate = subcontract && subcontract.agreement_date
    ? dateNum(subcontract.agreement_date)
    : (data.contractDate || '');
  let basisIntro = `Настоящим сообщаем, что ${company.name_short} ${workCtx}`;
  if (scNo) {
    basisIntro += ` на основании Договора субподряда № ${scNo}${scDate ? ` от ${scDate}` : ''}`
      + `, заключенного с ${subParty}`;
  }
  out.push(`${basisIntro}.`.replace(/\s+/g, ' '));

  if (specialCtx) out.push(specialCtx);

  // 2. Требование к допускам — ТОЛЬКО для КАРКАСА «допуск» И ТОЛЬКО ДЛЯ УСЛУГ.
  //
  // V486: раньше этот абзац стоял всегда, из-за чего письмо про холодильник
  // или лицензию ПО начиналось с требований охраны труда. Теперь — по каркасу.
  //
  // V488: и внутри «допуска» он нужен не всегда. Для спецодежды и СИЗ (товар)
  // фраза «персонал обязан иметь допуски» — канцелярский довесок: Дмитрий
  // пишет сразу «Для обеспечения безопасного выполнения работ … привлекло …
  // для поставки спецодежды». Абзац оставляем только для УСЛУГ: медосмотр,
  // обучение, аттестация — там он объясняет, зачем вообще услуга.
  const scaffold = data.aiBody && data.aiBody.scaffold;
  const scaffoldType = data.aiBody && data.aiBody.type;
  if (scaffold === 'dopusk' && scaffoldType === 'service') {
    out.push(`В рамках исполнения обязательств по указанному договору персонал ${company.name_short} `
      + `обязан иметь действующие допуски и разрешительные документы, подтверждающие `
      + `возможность выполнения работ на объекте Заказчика.`);
  }

  // 3. Предмет закупки и обоснование — от ИИ по каркасу, иначе фолбэк.
  //
  // V486: это сердце письма. Раньше здесь был один универсальный абзац
  // («Чтобы обеспечить допуск персонала к работам… для оказания услуг»),
  // который не имел смысла для инструмента, питания и лицензий.
  if (data.aiBody && data.aiBody.gist) {
    out.push(data.aiBody.gist);
  } else {
    // Фолбэк без ИИ: та же логика, но по образцам Дмитрия.
    const aiSvc = require('./obs-letter-ai');
    const cls = aiSvc.classify(data.items, doc.comment_text || '');
    const fb = aiSvc.buildFallback(cls, {
      company: company.name_short,
      counterparty,
      items: aiSvc.itemsInline((data.items || []).map(aiSvc.shortenItemName)),
      invoice_no: doc.invoice_number || 'б/н',
      invoice_date: dateNum(doc.invoice_date),
      contract_label: data.contractLabel || '',
      amount: money(gross),
    });
    out.push(fb.gist);
  }

  // 4. Перечень позиций — СТРОКОЙ через запятую, как в эталонах Дмитрия.
  //
  // V486: в шаблонах Дмитрия списков нет вообще, даже 16 наименований идут
  // одной строкой после двоеточия. Прежний вывод «— позиция» построчно
  // расходился с эталоном.
  //
  // ВАЖНО: `buildLetterBlocks` выделяет перечень по префиксу `— ` для
  // DOCX-шаблона (там есть отдельный блок `items`). Поэтому строки перечня
  // оставляем с этим префиксом — в Word они попадут в свой блок и напечатаются
  // своим форматированием. В HTML-версии (buildHtml) перечень выводится
  // отдельной строкой через запятую, без маркеров.
  const sel = selectLetterItems(data.items, invoiceNo);
  // V488: перечень печатаем из своего блока ТОЛЬКО если ИИ не перечислил его
  // в основном абзаце — иначе позиции дублируются дважды подряд
  // («…для поставки средств индивидуальной защиты (Костюм Легион-1 СОП, Ботинки
  // "Билд" утепленные). … Костюм Легион-1 СОП Ботинки "Билд" утепленные»).
  //
  // Сравнение делаем по СОКРАЩЁННЫМ именам с обеих сторон: в gist позиции уже
  // очищены `shortenItemName`, а `sel.shown` приходят сырыми из `line_items_json`.
  // Прежняя проверка сравнивала сырое имя с очищенным и не совпадала, поэтому
  // блок печатался всегда.
  const aiMod2 = require('./obs-letter-ai');
  const cleanItem = (t) => {
    try { return aiMod2.shortenItemName(t) || t; } catch (_) { return t; }
  };
  const gistText = String((data.aiBody && data.aiBody.gist) || '').toLowerCase();
  const firstClean = sel.shown.length ? cleanItem(String(sel.shown[0])).toLowerCase() : '';
  // Первые 18 символов достаточно, чтобы опознать упоминание, и мало, чтобы
  // случайно совпасть с общей фразой.
  const itemsAlreadyInText = !!firstClean && gistText.includes(firstClean.slice(0, 18));
  if (sel.shown.length && !itemsAlreadyInText) {
    // Каждая позиция — отдельным абзацем с маркером «— ». Так их выделяет
    // `buildLetterBlocks` в блок `items` для DOCX-шаблона.
    for (const t of sel.shown) out.push(`— ${cleanItem(t)}`);
    if (sel.rest > 0) out.push(`— ${sel.restLine}`);
  }

  // 5. Счёт и сумма.
  const vatLine = hasVat
    ? ` (включая НДС ${ratePct ? String(Math.round(ratePct)) + '%' : ''} — ${money(vat)} руб.)`
    : ' (без НДС)';
  out.push(`В адрес ООО «Асгард-Сервис» выставлен счёт на оплату № ${invoiceNo}`
    + `${invoiceDate ? ` от ${invoiceDate}` : ''} на сумму ${money(gross)} руб.${vatLine}.`);

  // 6. Лимит существенности по договору (справочно).
  if (subcontract && Number(subcontract.limit_amount) > 0) {
    out.push(`Лимит существенности по договору: ${money(subcontract.limit_amount)} руб. `
      + `Использовано ранее: ${money(subcontract.spent_amount || 0)} руб. `
      + `Остаток до настоящего счёта: ${money(subcontract.remaining || 0)} руб.`);
  }

  // 7. Обоснование необходимости — от ИИ, иначе фолбэк.
  if (data.aiBody && data.aiBody.why) {
    out.push(data.aiBody.why);
  } else {
    const aiSvc = require('./obs-letter-ai');
    const cls = aiSvc.classify(data.items, doc.comment_text || '');
    const fb = aiSvc.buildFallback(cls, {
      company: company.name_short,
      counterparty,
      items: aiSvc.itemsInline((data.items || []).map(aiSvc.shortenItemName)),
      invoice_no: doc.invoice_number || 'б/н',
      invoice_date: dateNum(doc.invoice_date),
      contract_label: data.contractLabel || '',
      amount: money(gross),
    });
    out.push(fb.why);
  }

  // 8. Просьба об оплате.
  const payGross = Math.round(gross * payPct / 100 * 100) / 100;
  const payVat = hasVat ? Math.round(vat * payPct / 100 * 100) / 100 : 0;
  // Доля оплаты: «50% от суммы счёта». Период — за какой отрезок платим
  // (Газпром Питание), НЕ срок оплаты («оплатить не позднее» запрещено).
  const pctNote = payPct < 100 ? ` (${payPct}% от суммы счёта)` : '';
  const vatTail = hasVat
    ? `, в том числе НДС ${ratePct ? String(Math.round(ratePct)) + '%' : ''} — ${money(payVat)} руб.`
    : '';
  out.push(`Просим осуществить оплату счёта${pctNote} в размере ${money(payGross)} руб. `
    + `(${amountInWords(payGross)})${vatTail}`
    + (payPeriod ? ` за период ${payPeriod}` : '')
    + '.');

  // 9. V473: куда платить — ОБС-счёт из справочника. Строка после просьбы,
  // чтобы Word и PDF совпадали по тексту (проверяется тестом).
  if (data.obsAccount) {
    const oa = data.obsAccount;
    out.push(`Оплату просим провести с ${oa.name}`
      + `${oa.bank_name ? ` (${oa.bank_name})` : ''}`
      + `${oa.bank_account ? `, р/с ${oa.bank_account}` : ''}.`);
  }

  return out;
}

/**
 * D-392: то же письмо, но разложенное по СМЫСЛОВЫМ БЛОКАМ эталонного письма.
 *
 * Зачем отдельно. Заказчик прислал образец (`Исх. №261023-11`) и сказал
 * «вот так надо делать и пдф и ворд». В образце у блоков РАЗНОЕ оформление:
 * обоснование и просьба об оплате — жирным, перечень — обычным, каждый блок
 * отделён отбивкой. Если отдавать шаблону плоский массив абзацев, всё
 * печатается одним шрифтом и слипается.
 *
 * Поэтому блоки:
 *   intro    — зачем работы и допуски (обычный текст);
 *   items    — перечень услуг (обычный, с маркером «—»);
 *   invoice  — счёт и сумма (жирный, как в образце);
 *   outro    — почему расход обязателен (обычный);
 *   request  — просьба об оплате (жирный).
 *
 * `all` — тот же текст плоским списком, для PDF и для совместимости.
 *
 * @param {object} data — результат loadLetterData
 * @param {{number?:string, dateText?:string}} [opts]
 * @returns {{intro:string[], items:string[], invoice:string[], outro:string[], request:string[], all:string[]}}
 */
function buildLetterBlocks(data, opts = {}) {
  const all = buildLetterParagraphs(data, opts);

  // Перечень в плоском списке идёт строками «— …»; вынимаем его отдельно,
  // чтобы шаблон напечатал его своим (обычным) форматированием.
  const items = all.filter((t) => t.startsWith('— ')).map((t) => t.replace(/^—\s*/, ''));

  const invoice = all.filter((t) => /выставлен сч[её]т на оплату/i.test(t));

  const request = all.filter((t) => /^Просим осуществить оплату/i.test(t));

  // Всё остальное делим на «до перечня» (intro), «после счёта» (outro) и
  // «после просьбы» (post — куда платить).
  const startItems = all.findIndex((t) => t.startsWith('— '));
  const invoiceIdx = all.findIndex((t) => /выставлен сч[её]т на оплату/i.test(t));
  const requestIdx = all.findIndex((t) => /^Просим осуществить оплату/i.test(t));

  const introEnd = startItems >= 0 ? startItems : (invoiceIdx >= 0 ? invoiceIdx : all.length);
  const intro = all.slice(0, introEnd);

  const outroStart = invoiceIdx >= 0 ? invoiceIdx + 1 : introEnd;
  const outroEnd = requestIdx >= 0 ? requestIdx : all.length;
  const outro = all.slice(outroStart, outroEnd)
    // лимит существенности остаётся в общем потоке — это справочная строка
    .filter((t) => !/^Просим осуществить оплату/i.test(t));

  // D-397 (FAIL верификатора 07.11.2026): строка «Оплату просим провести с…»
  // идёт ПОСЛЕ «Просим оплатить», а прежний outro заканчивался на requestIdx —
  // то есть она не попадала ни в один блок и в Word-письме её не было, хотя
  // в PDF она есть. Это главный реквизит документа (куда платить), поэтому
  // нарушать инвариант «PDF = Word» нельзя.
  const post = requestIdx >= 0 ? all.slice(requestIdx + 1) : [];

  // Инвариант: сумма строк блоков должна совпадать с плоским списком,
  // иначе текст PDF и Word разойдётся (это проверяется тестом).
  return { intro, items, invoice, outro, request, post, all };
}

module.exports = {
  generateObsLetterPdf,
  renderObsLetterPdf,
  renderObsLetterDocx,
  buildHtml,
  buildLetterParagraphs,
  buildLetterBlocks,
  loadLetterData,
  buildLetterDataFromPayload,
  buildItems,
  selectLetterItems,
  amountInWords,
  nextOutgoingNumber,
  closeBrowser,
  STORAGE_DIR,
};
