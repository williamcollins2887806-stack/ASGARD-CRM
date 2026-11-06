'use strict';
/**
 * Срок и режим работ из текста ТЗ.
 *
 * Задача от заказчика (06.11): если в ТЗ есть график — брать оттуда, а не
 * выдумывать. Нужно понимать, месяц работы или год, и какой период
 * (круглосуточно / в окно остановки / свободный).
 *
 * Функция НЕ выдумывает: если срока нет, возвращает found: false, и РП
 * обязан заполнить его руками перед просчётом.
 */

const WORD_NUM = {
  один: 1, одна: 1, две: 2, два: 2, три: 3, четыре: 4, пять: 5,
  шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  четырнадцать: 14, пятнадцать: 15, двадцать: 20, тридцать: 30,
  сорок: 40, 'сорок пять': 45, шестьдесят: 60, девяносто: 90
};

function numFromWord(w) {
  const k = String(w || '').toLowerCase();
  if (WORD_NUM[k]) return WORD_NUM[k];
  const n = Number(k);
  return Number.isFinite(n) ? n : null;
}

/** Приводит «1 (один) месяц» / «20 календарных дней» к дням. */
function toDays(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  const u = String(unit || '').toLowerCase();
  if (/год|лет/.test(u)) return Math.round(v * 365);
  if (/месяц/.test(u)) return Math.round(v * 30);
  if (/недел/.test(u)) return Math.round(v * 7);
  if (/смен/.test(u)) return v;                 // смены приводим как дни (2 смены = 1 сутки?) — оставляем как есть
  if (/час/.test(u)) return Math.max(1, Math.round(v / 8));
  return v;                                     // дни / сутки / календарные дни
}

/**
 * @param {string} text — текст ТЗ и документов
 * @returns {{found: boolean, days: number|null, raw: string|null, mode: string|null, kind: string|null}}
 */
function extractSchedule(text) {
  const t = String(text || '');
  if (!t.trim()) return { found: false, days: null, raw: null, mode: null, kind: null };

  // «1 (один) месяц» → «1 месяц», чтобы число и единица стояли рядом.
  const normalized = t.replace(/(\d+)\s*\(\s*[^)]{1,30}\)\s*([а-яё]+)/gi, '$1 $2');

  const numberWord = '\\d+(?:[.,]\\d+)?|' + Object.keys(WORD_NUM).filter((k) => !k.includes(' ')).join('|');
  // Единица ищется рядом с числом отдельно: «45 календарных дней»
  // не помещается в одну группу из-за слова «календарных».
  const UNIT_NEAR = '(?:календарн\[а-яё]*\\s+)?(?:дн(?:ей|я|и|ём|ем)?|день|сут(?:ок|ки)?|месяц\[а-яё]*|мес|год\[а-яё]*|лет|недел\[а-яё]*|смен\[а-яё]*)';
  const N = '(\\d+(?:[.,]\\d+)?)';
  const U = '(' + UNIT_NEAR + ')';

  // Приоритет формулировкам про СРОК ВЫПОЛНЕНИЯ, а не про срок подачи заявки.
  // [\s\S] вместо . — в ТЗ срок часто отделён переносом строки.
  const patterns = [
    new RegExp('срок[\\s\\S]{0,40}?(?:выполнени|оказани|проведени|работ)[\\s\\S]{0,60}?' + N + '\\s*' + U, 'i'),
    new RegExp('(?:продолжительность|период)[\\s\\S]{0,40}?(?:работ|выполнени|оказани)[\\s\\S]{0,40}?' + N + '\\s*' + U, 'i'),
    new RegExp('в\\s+течение\\s+' + N + '\\s*' + U, 'i'),
    new RegExp(N + '\\s*' + U + '\\s+с\\s+(?:даты|момента|дня)\\s+(?:заключени|подписани|передачи|начала)', 'i')
  ];

  for (const re of patterns) {
    const m = re.exec(normalized);
    if (!m) continue;
    // Берём первую группу, которая похожа на число: в шаблонах их может быть
    // несколько из-за вложенных групп.
    let numStr = null;
    let unitStr = null;
    for (let i = 1; i < m.length; i += 1) {
      if (m[i] == null) continue;
      if (numStr == null && /^\d+([.,]\d+)?$/.test(m[i])) { numStr = m[i]; continue; }
      if (numStr != null && unitStr == null && /[а-яё]/i.test(m[i])) { unitStr = m[i]; break; }
    }
    if (numStr == null) continue;
    const days = toDays(numStr.replace(',', '.'), unitStr || '');
    if (!(days > 0)) continue;
    // Отсекаем срок подачи заявки: рядом «заявк»/«подач» — это не срок работ.
    const around = normalized.slice(Math.max(0, m.index - 70), m.index + m[0].length + 50).toLowerCase();
    if (/заявк|подач[аиу]|прием[ае]?\s+заявок|приём[ае]?\s+заявок/.test(around)) continue;
    return {
      found: true,
      days,
      raw: m[0].replace(/\s+/g, ' ').trim(),
      mode: extractMode(t),
      kind: kindOf(days)
    };
  }

  // Явный график: «график работ: 01.06–30.06.2026».
  const range = /(\d{2}[.\-/]\d{2}[.\-/]\d{4})\s*(?:[-–—]|по|до)\s*(\d{2}[.\-/]\d{2}[.\-/]\d{4})/.exec(t);
  if (range) {
    const a = parseRuDate(range[1]);
    const b = parseRuDate(range[2]);
    if (a && b && b > a) {
      const days = Math.round((b - a) / 86400000);
      if (days > 0) {
        return {
          found: true,
          days,
          raw: range[0],
          mode: extractMode(t),
          kind: kindOf(days)
        };
      }
    }
  }

  return { found: false, days: null, raw: null, mode: extractMode(t), kind: null };
}

/** Режим работ: остановка / круглосуточно / свободный график. */
function extractMode(text) {
  const t = String(text || '').toLowerCase();
  if (/остановочн|во\s+время\s+остановк|в\s+период\s+остановк|ремонтн[а-яё]*\s+остановк|остановк[а-яё]*\s+оборудован/.test(t)) return 'stop';
  if (/круглосуточн|24\/7|без\s+остановки\s+производства|не\s+останавливая/.test(t)) return 'around';
  if (/свободн[а-яё]*\s+график|по\s+согласованию\s+с\s+заказчиком|в\s+удобное\s+время/.test(t)) return 'free';
  return null;
}

/** Масштаб работ — чтобы РП сразу видел, месяц это или год. */
function kindOf(days) {
  if (days <= 2) return 'дни';
  if (days <= 10) return 'до_двух_недель';
  if (days <= 31) return 'месяц';
  if (days <= 92) return 'квартал';
  if (days <= 365) return 'год';
  return 'больше_года';
}

function parseRuDate(s) {
  const m = /(\d{2})[.\-/](\d{2})[.\-/](\d{4})/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = { extractSchedule, extractMode, kindOf, toDays };
