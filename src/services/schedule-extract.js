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
  // 2027 «лет» — это не срок работ, а год, на который заключён договор.
  // Именно так тендер 2131 получил 739 855 суток (2027 × 365).
  if (/год|лет/.test(u)) {
    if (v >= 100) return null;        // 100+ «лет» — это дата, а не длительность
    return Math.round(v * 365);
  }
  if (/месяц/.test(u)) return Math.round(v * 30);
  if (/недел/.test(u)) return Math.round(v * 7);
  if (/смен/.test(u)) return v;                 // смены приводим как дни (2 смены = 1 сутки?) — оставляем как есть
  if (/час/.test(u)) return Math.max(1, Math.round(v / 8));
  return v;                                     // дни / сутки / календарные дни
}

/**
 * Похоже ли число на календарный год, а не на длительность.
 * «Тендер на 2027 год», «в 2026 г.», «2027–2029 гг.» — это период,
 * в который попадают работы, а НЕ их срок.
 */
function looksLikeYear(numStr, around) {
  const v = Number(String(numStr).replace(',', '.'));
  if (!(v >= 1900 && v <= 2200)) return false;
  // Год рядом с «г.», «год», «году», «гг.» или с датой.
  return /(^|[^\d])(г\.|год|году|года|годах|гг\.|г\.г\.)/i.test(String(around || ''));
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
    // Ищем ВСЕ совпадения, а не первое: в фразе «срок гарантии 12 мес.,
    // срок выполнения работ 60 дней» первое совпадение — гарантия,
    // и раньше оно глушило правильный ответ (60).
    //
    // Ограничение на число проверок: в таблице на 400 тыс. символов шаблон
    // «в течение N дней» даёт тысячи совпадений, и перебор всех занимает
    // минуты. 400 первых — с запасом: верный срок почти всегда в начале ТЗ.
    const gre = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    let tried = 0;
    while ((m = gre.exec(normalized)) !== null) {
      if (m[0].length === 0) { gre.lastIndex += 1; continue; }
      tried += 1;
      if (tried > 400) break;

      // Берём ПОСЛЕДНЮЮ пару «число + единица» в совпадении.
      // В фразе «срок гарантии 12 месяцев, срок выполнения работ 60 дней»
      // шаблон захватывает оба срока, и первая пара (12 месяцев) — гарантия,
      // а не срок работ. Правильная — последняя.
      let numStr = null;
      let unitStr = null;
      for (let i = 1; i < m.length; i += 1) {
        if (m[i] == null) continue;
        if (/^\d+([.,]\d+)?$/.test(m[i])) {
          const next = m[i + 1];
          if (next != null && /[а-яё]/i.test(next)) { numStr = m[i]; unitStr = next; }
        }
      }
      if (numStr == null) continue;

      // Календарный год — это период работ, а не их длительность.
      // Тендер 2131 («чистка на 2027 год») дал 739 855 суток = 2027 × 365.
      if (looksLikeYear(numStr, normalized.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40))) continue;

      const days = toDays(numStr.replace(',', '.'), unitStr || '');
      if (!(days > 0)) continue;

    // Отсекаем НЕ срок работ. Проверено на реальных ТЗ прода 06.11:
    // «срок гарантии 12 месяцев» давал 360 суток, «в течение 3 дней»
    // (уведомление) — 3 суток, срок подачи заявки — тоже ловился.
    //
    // Окно смотрим УЗКО и только ПОСЛЕ числа: в фразе «срок гарантии 12 мес.,
    // срок выполнения работ 60 дней» запретное слово относится к первому
    // сроку, но стояло ДО второго числа и глушило правильный ответ.
      // Окно — ТОЛЬКО вокруг найденного числа, а не всего совпадения:
      // в «срок гарантии 12 мес., срок выполнения работ 60 дней» слово
      // «гарантии» стоит в начале совпадения и глушило правильные 60.
      const numPos = m.index + m[0].lastIndexOf(numStr);
      const numEnd = numPos + numStr.length;
      const before = normalized.slice(Math.max(0, numPos - 70), numPos).toLowerCase();
      // Вплотную к числу (30 знаков) — определяющее слово: «срок ВЫПОЛНЕНИЯ
      // РАБОТ 60 дней» против «срок ГАРАНТИИ 12 месяцев».
      const beforeNear = normalized.slice(Math.max(0, numPos - 30), numPos).toLowerCase();
      // После числа смотрим до следующего числа: «30 дней. Гарантия 24 месяца» —
      // «гарантия» относится уже к другому сроку, а не к этим 30 дням.
      // Определяющее слово стоит ПЕРЕД числом («срок ГАРАНТИИ 12» против
      // «срок ВЫПОЛНЕНИЯ РАБОТ 60»), поэтому проверяем преимущественно before.
      const afterNum = normalized.slice(numEnd, numEnd + 30).toLowerCase();
      const WRONG = /гарант|годност|хранени|оплат|заявк|подач[аиу]|уведомлени|рассмотрени|аккредитац|страхован|банковск|техническ[а-яё]*\s+отч[её]т|отч[её]т\s+по\s+(?:проведенн|работ)|акт[аы]?\s+выполненн/;
      if (WRONG.test(beforeNear)) continue;
      // Запрет дальше, но вплотную — слова о работах: это верный срок.
      if (WRONG.test(before)) {
        const workNear = /(выполнен|оказан|проведен|работ|чистк|зачистк|ремонт)/.test(beforeNear);
        if (!workNear) continue;
      }

      // Сумма/цена рядом — тоже не срок.
      if (/(руб|₽|ндс|стоимост|цен[аы]|бюджет)/.test(before + afterNum)) continue;
      // Срок подачи заявки — не срок работ.
      if (/заявк|подач[аиу]|прием[ае]?\s+заявок|приём[ае]?\s+заявок/.test(before + afterNum)) continue;
      return {
        found: true,
        days,
        result: null,
        raw: m[0].replace(/\s+/g, ' ').trim(),
        // Нормализованное значение для сверки: то самое «60 дней».
        phrase: normalized.slice(numPos, numEnd + 20).replace(/\s+/g, ' ').trim(),
        mode: extractMode(t),
        kind: kindOf(days)
      };
    }
  }

  // Явный график: «график работ: 01.06–30.06.2026».
  const range = /(\d{2}[.\-/]\d{2}[.\-/]\d{4})\s*(?:[-–—]|по|до)\s*(\d{2}[.\-/]\d{2}[.\-/]\d{4})/.exec(t);  if (range) {
    const a = parseRuDate(range[1]);
    const b = parseRuDate(range[2]);
    if (a && b && b > a) {
      // +1 день: 01.06–30.06 — это 30 дней работы, а не 29.
      // Раньше разница дат давала на сутки меньше, и график заказчика
      // не совпадал с планом.
      const days = Math.round((b - a) / 86400000) + 1;
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
