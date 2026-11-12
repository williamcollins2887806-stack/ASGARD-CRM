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
    // «в течение N дней» — самый шумный шаблон: он ловит сроки уведомлений,
    // оплаты и подачи заявок. В тендере 2131 он дал 7 суток из фразы
    // «уведомить Заказчика в срок не позднее 7 календарных дней» —
    // то есть срок ПИСЬМА вместо срока РАБОТ.
    // Поэтому нужен явный признак работ — ДО или ПОСЛЕ числа:
    // «Выполнить работы в течение 60 дней» и «в течение 60 дней работы».
    new RegExp('(?:выполнени|оказани|проведени|работ)[\\s\\S]{0,30}?в\\s+течение\\s+' + N + '\\s*' + U, 'i'),
    new RegExp('в\\s+течение\\s+' + N + '\\s*' + U
      + '(?:[\\s\\S]{0,40}?(?:выполнени|оказани|проведени|работ))', 'i'),
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
      // После числа смотрим близко, но отсчитываем от КОНЦА совпадения:
      // у шаблона «в течение N дней ... работ» слово про работы стоит
      // после единицы и было бы обрезано срезом от числа.
      const afterNum = normalized.slice(numEnd, numEnd + 60).toLowerCase();
      const WRONG = /гарант|годност|хранени|оплат|заявк|подач[аиу]|уведомлени|рассмотрени|аккредитац|страхован|банковск|техническ[а-яё]*\s+отч[её]т|отч[её]т\s+по\s+(?:проведенн|работ)|акт[аы]?\s+выполненн|конфиденциальн|неразглашен|разглашен|излишне\s+полученн|возврат|давальческ/;
      if (WRONG.test(beforeNear)) continue;
      // Единое широкое окно вокруг числа: стоп-слова конфиденциальности,
      // возврата материалов и давальческих схем могут стоять как до, так и
      // после числа («излишне полученные материалы возвращаются» — после).
      const nearBoth = normalized.slice(Math.max(0, numPos - 140), numEnd + 140).toLowerCase();
      if (/конфиденциальн|неразглашен|разглашен|излишне\s+полученн|давальческ|возвращаю|возврат\s+материал/.test(nearBoth)) continue;
      // «срока начала оказания услуг более чем на 15 календарных дней» —
      // это размер ПРОСРОЧКИ/переноса, а не длительность работ (тендер 2133).
      if (/более\s+чем\s+на|менее\s+чем\s+на|не\s+более\s+чем\s+на|задержк|просрочк|перенос/.test(normalized.slice(Math.max(0, m.index - 60), numEnd + 40).toLowerCase())) continue;
      // «Гарантийный срок НА ВЫПОЛНЕНИЕ РАБОТЫ составляет 12 месяцев» — это
      // гарантия, хотя слова «выполнение работы» рядом. Отличаем от
      // «Гарантия 12 мес. Срок выполнения работ 45 дней»: там перед числом
      // стоит НАШЕ слово («срок выполнения работ»), а здесь — «гарантийный».
      // Какой СРОК определяется этим числом? Ищем ближайшее «срок …» ПЕРЕД
      // числом и смотрим, что за ним: «срок гарантии … 12 месяцев» —
      // гарантия, «срок выполнения работ … 45 дней» — работы.
      //
      // Тендер 2131, прил.3: «Гарантийный срок на выполненные работы:
      // Срок гарантии результата работ (касательно отсутствия утечек…
      // фланцевых соединений после очистки БНК) устанавливается
      // продолжительностью 12 месяцев». Определяющее слово в 200 символах
      // до числа, поэтому узкое окно его не видело и гарантия шла за срок.
      const backFrom = normalized.slice(Math.max(0, numPos - 400), numPos).toLowerCase();
      // «Гарантийные обязательства по выполняемой работе не менее 12 месяцев»:
      // слова «срок» здесь нет вообще, поэтому проверка стоит ВНЕ блока ниже.
      if (/гарантийн[а-яё]*\s+(?:срок|обязательств)/.test(backFrom)) continue;

      const lastSrok = backFrom.lastIndexOf('срок');
      if (lastSrok >= 0) {
        const tail = backFrom.slice(lastSrok, lastSrok + 34);
        // «Срок предоставления оригиналов», «срок рассмотрения претензий»,
        // «срок действия договора» — документооборот, не работы.
        if (/^срок[а-яё]*\s+(?:гарант|годност|предоставлени|направлени|рассмотрени|действи|хранени|оплат|поставки\s+документ)/.test(tail)) continue;
      }

      const beforeWide = normalized.slice(Math.max(0, m.index - 20), numPos).toLowerCase();
      const guarPos = Math.max(beforeWide.lastIndexOf('гарант'), beforeWide.lastIndexOf('годност'));
      if (guarPos >= 0) {
        // «Срок гарантии результата работ … 12 месяцев» — гарантия, хотя
        // слово «работ» стоит рядом. Настоящий срок работ начинается
        // со слов «срок выполнения/оказания/проведения» или «срок работ».
        const workWord = /(срок[а-яё]*\s+(?:выполнени|оказани|проведени)|срок[а-яё]*\s+работ[а-яё]*(?!\s*устанавливается))/.exec(beforeWide);
        if (!workWord || workWord.index < guarPos) continue;
      }
      // «не позднее N дней ДО даты работ» — это дедлайн УВЕДОМЛЕНИЯ,
      // а не длительность работ. Тендер 2131: «в срок не позднее
      // 7 календарных дней до обозначенной даты проведения работ,
      // уведомляет Исполнителя». Слова «работ» рядом есть, поэтому
      // без этой проверки фраза проходила как срок работ.
      const deadlineMark = normalized.slice(Math.max(0, m.index - 40), numEnd + 30).toLowerCase();
      if (/не\s+позднее|не\s+позже|до\s+(?:обозначенн|указанн|назначенн|начала|даты|дня)/.test(deadlineMark)) continue;
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
  // Явный график: «график работ: 01.06–30.06.2026».
  //
  // Ограничение (тендер 2131): диапазон дат искался по ВСЕМУ тексту, и
  // первой попадалась строка извещения «в редакции № 1 от 23.10.2026»
  // плюс дата подачи заявок — выдавало 19 суток как срок работ.
  // Теперь берём только диапазоны, рядом с которыми есть слово про работы
  // или график, и пропускаем те, что стоят рядом с заявкой/извещением.
  const RANGE_RE = /(\d{2}[.\-/]\d{2}[.\-/]\d{4})\s*(?:[-–—]|по|до)\s*(\d{2}[.\-/]\d{2}[.\-/]\d{4})/g;
  const WORK_NEAR = /(график[а-яё]*\s+работ|срок[а-яё]*\s+(?:выполнени|оказани|проведени|работ)|период[а-яё]*\s+(?:выполнени|работ)|выполнени[а-яё]*\s+работ)/i;
  const NOT_WORK_NEAR = /(заявк|извещени|редакци|публикац|подач[аиу]|рассмотрени|прием[ае]?\s+заявок|приём[ае]?\s+заявок|окончани[ея]\s+подачи)/i;

  let rangeMatch;
  while ((rangeMatch = RANGE_RE.exec(t)) !== null) {
    const around = t.slice(Math.max(0, rangeMatch.index - 160), rangeMatch.index + rangeMatch[0].length + 160);
    if (!WORK_NEAR.test(around)) continue;
    if (NOT_WORK_NEAR.test(around)) continue;

    const a = parseRuDate(rangeMatch[1]);
    const b = parseRuDate(rangeMatch[2]);
    if (!a || !b || b <= a) continue;

    // +1 день: 01.06–30.06 — это 30 дней работы, а не 29.
    const days = Math.round((b - a) / 86400000) + 1;
    if (days > 0) {
      return {
        found: true,
        days,
        raw: rangeMatch[0],
        mode: extractMode(t),
        kind: kindOf(days)
      };
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

// ── Периоды заездов ────────────────────────────────────────────────────────
/**
 * Месяцы в русском тексте. Система НЕ должна знать, где заказчик написал
 * график: это может быть ВОР, отдельный файл «График работ», приложение к ТЗ,
 * таблица Excel или просто фраза «работы в сентябре и декабре». Поэтому
 * ищем месяцы по тексту и группируем их в периоды. Это ПОДСКАЗКА модели:
 * решает она, но если промолчит — у нас есть детерминированный ответ.
 */
const MONTHS = [
  ['январ', 1], ['феврал', 2], ['март', 3], ['апрел', 4], ['ма', 5],
  ['июн', 6], ['июл', 7], ['август', 8], ['сентябр', 9], ['октябр', 10],
  ['ноябр', 11], ['декабр', 12]
];

function monthFromWord(w) {
  const s = String(w || '').toLowerCase();
  // «май»/«мая» — короткий корень, проверяем отдельно, чтобы не совпасть
  // с «март»/«мая» внутри других слов.
  if (/^ма[йяею]$/.test(s) || /^мае$/.test(s)) return 5;
  for (const [stem, num] of MONTHS) {
    if (stem === 'ма') continue;
    if (s.startsWith(stem)) return num;
  }
  return null;
}

/**
 * Явные периоды работ: месяцы, диапазоны дат, упоминания выездов/заездов.
 *
 * Возвращает:
 *   { mode, visits: [{label, month, year, start, end, quote}], months: Set, quotes }
 * mode: 'continuous' | 'visits' | 'unknown'
 */
function extractVisitPeriods(text) {
  const t = String(text || '');
  if (!t.trim()) return { mode: 'unknown', visits: [], months: [], quotes: [] };

  const lower = t.toLowerCase();
  const visits = [];
  const monthsFound = new Set();
  const quotes = [];

  // 1. Диапазоны дат с месяцем-словом или числом: «01.09.2027–30.09.2027»,
  //    «сентябрь–декабрь 2027».
  const rangeRe = /(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})\s*(?:[-–—]|по|до)\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/g;
  let m;
  while ((m = rangeRe.exec(t)) !== null) {
    const around = t.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120);
    // Пропускаем подачу заявок/извещения — это не работы.
    if (/заявк|извещени|редакци|публикац|подач[аиу]|окончани[ея]\s+подачи/i.test(around)) continue;
    if (!/(график|период|срок|выполнени|работ|выезд|заезд|остановк)/i.test(around)) continue;
    const a = parseRuDate(m[1]);
    const b = parseRuDate(m[2]);
    if (!a || !b || b < a) continue;
    visits.push({
      label: m[0].replace(/\s+/g, ' ').trim(),
      month: a.getMonth() + 1,
      year: a.getFullYear(),
      start: isoDate(a),
      end: isoDate(b),
      quote: around.replace(/\s+/g, ' ').trim().slice(0, 200)
    });
  }

  // 2. Месяцы словами: «в сентябре», «сентябрь 2027», «сентябрь и декабрь».
  const monthRe = /(январ[а-яё]*|феврал[а-яё]*|март[а-яё]*|апрел[а-яё]*|ма[йяею]|июн[а-яё]*|июл[а-яё]*|август[а-яё]*|сентябр[а-яё]*|октябр[а-яё]*|ноябр[а-яё]*|декабр[а-яё]*)(?:\s+(\d{4}))?/gi;
  let mm;
  const monthHits = [];
  while ((mm = monthRe.exec(lower)) !== null) {
    const num = monthFromWord(mm[1]);
    if (!num) continue;
    const around = lower.slice(Math.max(0, mm.index - 100), mm.index + mm[0].length + 100);
    // Месяцы гарантии/хранения/оплаты — не график работ.
    if (/гарант|годност|хранени|оплат|заявк|подач[аиу]|уведомлени|рассмотрени/i.test(around)) continue;
    monthHits.push({
      month: num,
      year: mm[2] ? Number(mm[2]) : null,
      index: mm.index,
      quote: t.slice(Math.max(0, mm.index - 60), mm.index + mm[0].length + 60)
        .replace(/\s+/g, ' ').trim().slice(0, 200)
    });
    monthsFound.add(num);
  }
  // Месяцы, упомянутые без диапазона, становятся отдельными периодами.
  const seenMonthKey = new Set(visits.map((v) => `${v.year || ''}-${v.month}`));
  for (const h of monthHits) {
    const key = `${h.year || ''}-${h.month}`;
    if (seenMonthKey.has(key)) continue;
    seenMonthKey.add(key);
    const label = `${monthName(h.month)}${h.year ? ' ' + h.year : ''}`;
    visits.push({
      label,
      month: h.month,
      year: h.year,
      // Дата внутри месяца: начало и конец, чтобы график мог рисовать полосу.
      start: h.year ? `${h.year}-${String(h.month).padStart(2, '0')}-01` : null,
      end: h.year ? lastDayOfMonth(h.year, h.month) : null,
      quote: h.quote
    });
  }

  // 3. Явное число выездов/заездов: «4 выезда», «2 заезда бригады».
  const tripRe = /(\d+)\s*(?:выезд[а-яё]*|заезд[а-яё]*)/gi;
  let tr;
  let explicitTripCount = null;
  while ((tr = tripRe.exec(t)) !== null) {
    const n = Number(tr[1]);
    if (n > 0 && n <= 60) explicitTripCount = n;
  }

  // 4. Режим.
  const continuousSignal = /(остановочн[а-яё]*\s+ремонт|во\s+время\s+остановк|в\s+период\s+остановк|непрерывн[а-яё]*\s+(?:работ|выполнени)|без\s+перерыв|единовременн[а-яё]*\s+выезд|одн[а-яё]*\s+выезд)/i.test(t);
  const visitsSignal = /(график[а-яё]*\s+(?:работ|заездов|выездов)|поэтапн[а-яё]*|по\s+месяцам|ежемесячн[а-яё]*|в\s+несколько\s+(?:этапов|заездов|выездов))/i.test(t);

  let mode = 'unknown';
  const uniqueVisits = dedupeVisits(visits);
  // Число выездов без списка периодов — ещё не mode=visits с пустым visits[]:
  // либо есть разложение по месяцам, либо оставляем unknown (РП подтвердит).
  if (uniqueVisits.length >= 2) mode = 'visits';
  else if (continuousSignal && uniqueVisits.length <= 1) mode = 'continuous';
  else if (explicitTripCount && explicitTripCount >= 2 && uniqueVisits.length >= 1) mode = 'visits';
  else if (explicitTripCount && explicitTripCount >= 2 && uniqueVisits.length === 0) mode = 'unknown';
  else if (continuousSignal) mode = 'continuous';
  else if (visitsSignal && uniqueVisits.length >= 1) mode = 'visits';

  return {
    mode,
    visits: uniqueVisits,
    months: [...monthsFound].sort((a, b) => a - b),
    explicit_trip_count: explicitTripCount,
    continuous_signal: continuousSignal,
    visits_signal: visitsSignal,
    unconfirmed: !!(explicitTripCount && explicitTripCount >= 2 && uniqueVisits.length === 0),
    quotes: uniqueVisits.map((v) => v.quote).filter(Boolean).slice(0, 8)
  };
}

function dedupeVisits(list) {
  const out = [];
  const seen = new Set();
  for (const v of list) {
    const key = `${v.year || ''}-${v.month || ''}-${v.start || ''}-${v.end || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.sort((a, b) => {
    if (a.start && b.start) return a.start.localeCompare(b.start);
    return (a.month || 0) - (b.month || 0);
  });
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lastDayOfMonth(year, month) {
  const d = new Date(year, month, 0);
  return isoDate(d);
}

const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function monthName(m) {
  return MONTH_NAMES[Number(m) - 1] || String(m);
}

module.exports = {
  extractSchedule,
  extractMode,
  extractVisitPeriods,
  kindOf,
  toDays,
  monthName,
  monthFromWord
};
