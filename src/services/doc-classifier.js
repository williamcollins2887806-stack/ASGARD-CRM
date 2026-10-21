'use strict';

/**
 * Классификатор типа документа (Часть II, замечание заказчика 17.10.2026).
 * ═══════════════════════════════════════════════════════════════════════════
 * В папке со счетами были НЕ только счета: РМРС-свидетельства (сертификаты),
 * счёт-договоры, заявки на перевозку, неплатёжные документы. Парсер реквизитов
 * применялся ко всем — это неверно. Сначала определяем ТИП, и в реестр/на оплату
 * идут ТОЛЬКО счёта (invoice) и закрывающие (act/upd, для сверки).
 *
 * ПОРЯДОК ВАЖЕН (найдено на реальных счетах):
 *   1. Сначала ищем ЯВНЫЕ признаки счёта — стандартные фразы российских счетов
 *      («Счёт на оплату», «Счёт № … от», «Оплата данного счёта означает…»,
 *      «Счёт действителен до», «Настоящий счёт имеет силу договора»).
 *      Иначе слово «имеет силу ДОГОВОРА» или «КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ» внутри
 *      счёта ложно уводило его в contract/offer (проверено на 5 файлах).
 *   2. Только ПОТОМ — типы НЕ-счётов, и лишь по ЗАГОЛОВКУ (первые строки),
 *      а не по всему тексту.
 */

// ЯВНЫЕ признаки счёта на оплату (стандарт РФ). Любой → invoice.
const INVOICE_STRONG = [
  /сч[её]т\s+на\s+оплату/i,
  /оплата\s+данного\s+сч[её]та/i,
  /сч[её]т\s+действителен\s+до/i,
  /имеет\s+силу\s+договора\s+поставки/i,
  /сч[её]т[\s-]*договор\s*№/i,
  /сч[её]т\s*№\s*[\w\-/]+/i,
  /сч[её]т\s+покупателю\s*№/i
];
const PAY_SUM_RE = /(всего\s+к\s+оплате|итого\s+к\s+оплате|сумма\s+к\s+оплате)/i;
const BANK_RE = /БИК[\s:№]*\d{9}/i;
const RS_RE = /(р\/?с|расч[её]тн\S*\s+сч[её]т)[\s:№]*\d{20}/i;

// НЕ счёт (проверяется по ЗАГОЛОВКУ — первые ~6 значимых строк).
const NON_INVOICE_HEAD = [
  [/(свидетельство|сертификат\s+(соответствия|типа)|деклараци[яи]\s+о\s+соответств|аттестат\s+аккредитац)/i, 'certificate'],
  [/(заявка\s+на\s+перевозк|транспортн\S*\s+накладн|товарно[-\s]транспортн|товарн\S*\s+накладн|путевой\s+лист|универсальн\S*\s+передаточный)/i, 'waybill'],
  [/(акт\s+(выполненных|оказанных|сдачи-при[её]мки)|акт\s+сверки)/i, 'act'],
  [/^(договор\s+(поставки|подряда|возмездного|оказания)|договор\s*№)/im, 'contract'],
  [/(коммерческое\s+предложение|прайс-лист|прейскурант)/i, 'offer']
];

/** Первые N значимых строк — «заголовок» документа. */
function headLines(text, n = 6) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 2).slice(0, n).join('\n');
}

// ── D-319: наши собственные ИСХОДЯЩИЕ письма (информационные) ────────────────
// Инцидент 21.10.2026: Дмитрий Путков прислал «Исх. №261021-03» — наше
// информационное письмо заказчику. В нём есть «выставлен счёт на оплату
// № УТ-2360» (мы ЦИТИРУЕМ чужой счёт), поэтому срабатывал INVOICE_STRONG,
// а банк/р-с были наши — и письмо становилось «счётом» на 19 460 ₽ с нашим
// ИНН в роли поставщика. Создались лишняя заявка #20 и строка реестра #1587.
//
// ПОЧЕМУ ОТДЕЛЬНАЯ ПРОВЕРКА, А НЕ NON_INVOICE_HEAD (замер верификатора на
// 981 реальном PDF): «Исх. №» стоит 11-й строкой (первые 6 заняты бланком с
// реквизитами), а headLines() смотрит только 6 → паттерн там НИКОГДА не
// сработает. Переставлять NON_INVOICE_HEAD ВЫШЕ INVOICE_STRONG нельзя:
// реальный счёт «СЧЁТ на оплату № 7. См. коммерческое предложение…» уедет в
// offer (этот кейс закреплён тестом doc-classifier.test).
//
// Условие строгое: исходящий номер «Исх. №» И наш ИНН где-то в тексте.
// На 981 документе: 5 попаданий, все 5 — наши письма, ложных 0.
const OUTGOING_LETTER_RE = /^\s*Исх\.?\s*№/im;

/** Наш собственный ИНН (кэш на процесс) — чтобы не звать settings на каждый файл. */
let _ownInnCache = null;
async function ownInn(db) {
  if (_ownInnCache !== null) return _ownInnCache;
  try {
    const r = await db.query("SELECT (value_json::jsonb)->>'inn' AS inn FROM settings WHERE key='company_profile' LIMIT 1");
    _ownInnCache = String((r.rows[0] && r.rows[0].inn) || '').replace(/\D/g, '') || '';
  } catch (_) { _ownInnCache = ''; }
  return _ownInnCache;
}
function resetOwnInnCache() { _ownInnCache = null; }

/**
 * Это НАШЕ исходящее письмо, а не счёт поставщика?
 * @param {string} text
 * @param {string} ownInnStr — ИНН нашей организации (пусто → проверяем только «Исх. №»)
 */
function isOwnOutgoingLetter(text, ownInnStr) {
  const t = String(text || '');
  if (!OUTGOING_LETTER_RE.test(t)) return false;
  const inn = String(ownInnStr || '').replace(/\D/g, '');
  if (!inn) return true;   // «Исх. №» + валидный банк уже достаточно редки
  return t.includes(inn);
}

/**
 * Определить тип документа по тексту.
 * @param {string} text
 * @param {{ownInn?: string}} [opts] — ИНН нашей организации: по нему узнаём
 *   собственные исходящие письма (D-319).
 * @returns {{kind:string, is_invoice:boolean, confidence:number, reason:string}}
 */
function classifyDocument(text, opts) {
  const t = String(text || '');
  if (t.trim().length < 20) return { kind: 'unknown', is_invoice: false, confidence: 0, reason: 'too_short' };

  // 0. D-319: НАШЕ исходящее письмо («Исх. №» + наш ИНН) — не счёт, даже если
  //    внутри цитируется чужой счёт. Проверяем ДО INVOICE_STRONG: именно
  //    цитата «выставлен счёт на оплату» и давала ложный invoice.
  const own = (opts && opts.ownInn) || '';
  if (isOwnOutgoingLetter(t, own)) {
    return { kind: 'letter', is_invoice: false, confidence: 0.9, reason: 'own_outgoing_letter' };
  }

  // 1. СНАЧАЛА — явные признаки счёта (стандартные фразы РФ).
  const strong = INVOICE_STRONG.some((re) => re.test(t));
  const bank = BANK_RE.test(t) && RS_RE.test(t);
  if (strong) {
    return { kind: 'invoice', is_invoice: true, confidence: bank ? 0.95 : 0.9, reason: 'strong_marker' + (bank ? '+bank' : '') };
  }

  // 2. Не-счёт по ЗАГОЛОВКУ.
  const head = headLines(t);
  for (const [re, kind] of NON_INVOICE_HEAD) {
    if (re.test(head)) return { kind, is_invoice: false, confidence: 0.85, reason: 'head_' + kind };
  }

  // 3. Косвенные: платёжная сумма + банк; либо банк + слово «счёт».
  const pay = PAY_SUM_RE.test(t);
  if (pay && bank) return { kind: 'invoice', is_invoice: true, confidence: 0.8, reason: 'pay+bank' };
  if (bank && /сч[её]т/i.test(t)) return { kind: 'invoice', is_invoice: true, confidence: 0.65, reason: 'bank+word' };
  if (pay) return { kind: 'invoice', is_invoice: true, confidence: 0.6, reason: 'pay_only' };

  // 4. Остальное — не платёжный документ (или скан, требующий OCR).
  if (/сч[её]т/i.test(t)) return { kind: 'other', is_invoice: false, confidence: 0.4, reason: 'no_bank' };
  return { kind: 'other', is_invoice: false, confidence: 0.35, reason: 'no_markers' };
}

module.exports = { classifyDocument, isOwnOutgoingLetter, ownInn, resetOwnInnCache };
