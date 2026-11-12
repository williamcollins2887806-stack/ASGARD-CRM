'use strict';
/**
 * excel-structure.js — структурный разбор табличных ведомостей.
 *
 * ── Зачем ─────────────────────────────────────────────────────────────────
 * `sheet_to_csv` склеивает листы подряд, и колонки теряют смысл: в одном файле
 * 16 колонок, в другом 13, и они смещены. Модель видит «строку чисел» и гадает,
 * где объём, где цех, где период.
 *
 * Здесь колонки определяются по СМЫСЛУ ЗАГОЛОВКА, а не по индексу. Словарь
 * синонимов покрывает разные формулировки заказчиков; неизвестные колонки
 * сохраняются в raw_fields, чтобы новые форматы не терялись.
 *
 * ── Универсальность ───────────────────────────────────────────────────────
 * Ни одно поле не обязательно. У стройки нет «диаметра трубки», у сварки нет
 * «периода по месяцам». Отсутствующая колонка = null, и это нормально.
 */

/**
 * Словарь: поле → regex по заголовку.
 *
 * Порядок важен: более специфичное правило выше. Заголовки бывают двух видов:
 *   • человеческие: «Наименование теплообменников», «Количество чисток»;
 *   • машинные с подчёркиванием: «Наименование_позиция», «Кол_во_чисток»,
 *     «Объём_всего_за_год», «Человек_часов_всего» (дефектная ведомость 2138).
 * Поэтому подчёркивание приравнено к пробелу, а «кол_во» — к «количество».
 *
 * ВАЖНО: \w в JS не матчит кириллицу — только [а-яё].
 */
/**
 * Признаки полей: слова-маркеры с ВЕСАМИ и АНТОНИМАМИ.
 *
 * ── Почему не «одно регулярное выражение на поле» ─────────────────────────
 * Заголовки в реальных ведомостях противоречат друг другу:
 *   «Период выполнения работ»          → период      (+)
 *   «Стоимость выполнения работ в срок» → ДЕНЬГИ       (− для периода)
 *   «Количество труб, шт»               → количество   (− для числа чисток)
 *   «Количество чисток»                 → число чисток (+)
 *
 * Одно regex по подстроке «срок» цепляло денежную колонку, и период
 * схлопывался в одну группу. Здесь каждое слово даёт вклад с весом, а
 * антагонисты вычитают. Колонка выбирается по максимуму — а не по факту
 * первого совпадения.
 *
 * ── Универсальность ──────────────────────────────────────────────────────
 * Список слов — общий русский язык ведомостей, не привязка к тендеру:
 * стройка («захватка», «ось»), сварка («стык»), изоляция («участок»),
 * химия («реагент»), любой Excel с «Наименование / Объём / Ед. изм.».
 * Новые формулировки попадают в raw_fields, а не теряются.
 */
const FIELD_HINTS = {
  // Название позиции: максимум веса — это главная колонка ведомости.
  name: {
    plus: [
      ['наименован', 10], ['название', 8], ['описание', 6], ['позиция', 5],
      ['оборудован', 4], ['аппарат', 3], ['узел', 3], ['стык', 6], ['тег', 5], ['марк', 3], ['работ', 2]
    ],
    minus: []
  },
  // Объём работ: то, что умножается на норму.
  volume: {
    plus: [
      ['объем', 9], ['объём', 9], ['количество', 5], ['кол-во', 5], ['кол_во', 5],
      ['масса', 6], ['вес', 4], ['площад', 6], ['длина', 4], ['осадок', 6],
      ['поверхност', 4], ['суммарн', 3], ['стык', 7], ['переход', 5], ['соединени', 5], ['комплект', 4]
    ],
    // «количество труб» и «количество чисток» — это не объём работ.
    minus: [['труб', -4], ['чист', -5], ['арматур', -4], ['циклов', -4], ['на 1', -3]]
  },
  unit: {
    plus: [['ед', 3], ['изм', 5], ['единиц', 4]],
    minus: []
  },
  // Период = КОГДА делать. Деньги, сроки оплаты и стоимость — не период.
  period: {
    plus: [
      ['период', 8], ['месяц', 7], ['квартал', 6], ['график', 5],
      ['дата', 4], ['срок', 3], ['выполн', 1]
    ],
    minus: [
      ['стоимост', -9], ['цена', -9], ['сумм', -7], ['руб', -7], ['ндс', -7],
      ['оплат', -7], ['итог', -6], ['всего', -3]
    ]
  },
  // Число чисток: сколько раз за год повторяется работа.
  clean_count: {
    plus: [['чист', 9], ['циклов', 7], ['повторност', 7], ['раз', 3]],
    minus: [['труб', -6], ['арматур', -6], ['осадок', -5], ['стоимост', -6]]
  },
  // Число трубок в аппарате — геометрия, не количество работ.
  tubes: {
    plus: [['труб', 6], ['трубок', 6]],
    minus: [['длин', -7], ['суммарн', -6], ['чист', -6], ['диаметр', -6], ['тип', -5]]
  },
  dn_mm: {
    plus: [['диаметр', 8], ['dn', 6], ['ду', 4], ['ø', 6]],
    minus: [['расч', -3]]
  },
  length_m: {
    plus: [['длин', 7], ['протяжен', 6], ['протяжён', 6]],
    minus: [['трубки', -1]]
  },
  zone: {
    plus: [
      ['цех', 9], ['отделени', 7], ['участ', 6], ['корпус', 6], ['установк', 5],
      ['блок', 4], ['зон', 4], ['захватк', 6], ['ось', 4], ['этаж', 5], ['помещени', 6]
    ],
    minus: []
  },
  fouling: {
    plus: [['отложени', 8], ['загрязн', 8], ['характер', 5], ['среда', 4], ['тип отлож', 8]],
    minus: [['тип труб', -8], ['труб', -2]]
  },
  // Тип оборудования — опорное поле, если наименования нет вовсе.
  type: {
    plus: [['тип оборудован', 9], ['оборудован', 5], ['тип', 3]],
    minus: [['труб', -3], ['отлож', -4]]
  },
  subtype: {
    plus: [['подтип', 9], ['пространств', 6], ['исполнени', 5], ['конструкци', 4]],
    minus: []
  },
  // Человеко-часы: если заказчик дал норму, срок считается из неё.
  mh: {
    plus: [['человек час', 10], ['чел час', 9], ['челч', 9], ['человекочас', 10], ['трудоемк', 9], ['трудоёмк', 9], ['mh', 6]],
    minus: [['стоимост', -8], ['на 1 чистку', -3]]
  }
};

/** Нормализует заголовок: подчёркивания → пробелы, нижний регистр. */
function normHeader(h) {
  return String(h == null ? '' : h)
    .toLowerCase()
    .replace(/[_\u00a0\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Считает, насколько заголовок соответствует полю.
 * Возвращает число: > 0 — подходит, чем больше, тем лучше; <= 0 — не подходит.
 *
 * @param {string} field
 * @param {string} header
 * @returns {number}
 */
function scoreField(field, header) {
  const hints = FIELD_HINTS[field];
  if (!hints) return 0;
  const h = normHeader(header);
  if (!h) return 0;
  let score = 0;
  for (const [word, w] of hints.plus) {
    if (h.includes(word)) score += w;
  }
  for (const [word, w] of hints.minus) {
    if (h.includes(word)) score += w;   // w отрицательный
  }
  return score;
}

/** Порог: ниже него заголовок не считается полем. */
const MIN_FIELD_SCORE = 3;

/**
 * Единица измерения ВНУТРИ заголовка колонки объёма.
 *
 * Заказчики называют колонки «Площадь_м2», «Объем_емкости_м3», «Осадок_т»,
 * «Площадь поверхности м2»: единица стоит в заголовке, в данных — только
 * число, отдельной колонки единиц нет. Без этого позиция получала unit=null,
 * и дедуп не мог сопоставить её с той же позицией из другого файла.
 *
 * @param {string} header — текст заголовка
 * @returns {string|null} единица или null
 */
function unitFromColumnHeader(header) {
  const s = normHeader(header);
  if (!s) return null;
  // Явные обозначения меры — ищем как ОТДЕЛЬНЫЙ сегмент: в «суммарная»
  // подстрока «мм» есть, но миллиметрами она не является.
  const segs = s.split(/[^а-яёa-z0-9]+/).filter(Boolean);
  const MEASURES = {
    'м2': 'м2', 'м²': 'м2', 'квм': 'м2', 'кв': 'м2',
    'м3': 'м3', 'м³': 'м3', 'кубм': 'м3', 'куб': 'м3',
    'пм': 'п.м', 'мп': 'п.м', 'погм': 'п.м',
    'мм': 'мм', 'см': 'см', 'км': 'км',
    'шт': 'шт', 'т': 'т', 'тн': 'т', 'тонн': 'т', 'кг': 'кг', 'г': 'г',
    'компл': 'компл', 'л': 'л', 'мл': 'мл', 'гкал': 'гкал', 'квт': 'кВт'
  };
  for (let i = segs.length - 1; i >= 0; i -= 1) {
    const seg = segs[i];
    if (MEASURES[seg]) return MEASURES[seg];
    // Одиночное «м» — метры, но только у колонок длины/протяжённости:
    // «Суммарная длина трубок, м», «Длина трубопровода, м». Иначе «м»
    // в заголовке ничего не значит.
    if (seg === 'м' && /длин|протяж|длина/.test(s)) return 'м';
  }
  return null;
}

/** Поля, которые ищем в заголовке. */
const FIELDS = Object.keys(FIELD_HINTS);

/**
 * Заголовок листа — строка, где лучше всего совпали поля.
 *
 * Для каждого поля берём колонку с МАКСИМАЛЬНЫМ весом, а не первую попавшуюся.
 * Колонка достаётся сильнейшему претенденту: иначе «Стоимость работ в срок»
 * забирала поле period только потому, что стоит левее «Периода».
 */
function detectHeaderRow(rows) {
  let best = { index: -1, score: 0, map: {} };
  const limit = Math.min(rows.length, 30);

  for (let i = 0; i < limit; i += 1) {
    const row = rows[i] || [];
    const cands = [];
    row.forEach((cell, col) => {
      const h = cellText(cell);
      if (!h || h.length > 90) return;
      for (const field of FIELDS) {
        const sc = scoreField(field, h);
        if (sc >= MIN_FIELD_SCORE) cands.push({ col, field, score: sc });
      }
    });
    if (!cands.length) continue;

    // Сначала раздаём колонки самым сильным совпадениям.
    cands.sort((a, b) => b.score - a.score);
    const map = {};
    const usedCols = new Set();
    for (const c of cands) {
      if (map[c.field] != null) continue;
      if (usedCols.has(c.col)) continue;
      map[c.field] = c.col;
      usedCols.add(c.col);
    }

    const score = Object.keys(map).length;
    if (score > best.score) best = { index: i, score, map };
  }

  // Ведомость обязана иметь наименование и хоть какой-то объём.
  if (best.score < 2 || best.map.name == null) return null;
  // Объём мог не найтись: в ведомости чистки его задаёт ГЕОМЕТРИЯ
  // (трубки × диаметр × длина), и объём считается, а не лежит колонкой.
  const hasMeasure = best.map.volume != null || best.map.mh != null
    || best.map.tubes != null || best.map.length_m != null;
  if (!hasMeasure) return null;

  best.map = refineColumns(rows, best.index, best.map);
  return best;
}

/**
 * Уточняет колонки по ФАКТИЧЕСКОЙ заполненности.
 *
 * Заголовок может наврать: «Позиция» стоит левее «Наименования» и пуста во
 * всех строках, а данные лежат правее. Поэтому для каждого поля берём
 * колонку, где больше непустых значений в теле таблицы.
 */
function refineColumns(rows, headerIdx, map) {
  const body = rows.slice(headerIdx + 1, headerIdx + Math.min(80, rows.length));
  if (!body.length) return map;

  const fill = (col) => body.reduce((n, row) => {
    const v = cellText((row || [])[col]);
    return n + (v ? 1 : 0);
  }, 0);

  const headerRow = rows[headerIdx] || [];
  const out = Object.assign({}, map);

  // Объём: если «объёмных» колонок несколько, берём ОБЩИЙ («всего за год»),
  // а не «на 1 чистку». Иначе объём работ занижается в число чисток раз.
  let yearlyCol = -1;
  headerRow.forEach((cell, col) => {
    const h = normHeader(cell);
    const isVol = h.includes('объем') || h.includes('объём');
    const isTotal = h.includes('всего') || h.includes('за год') || h.includes('год');
    if (isVol && isTotal && fill(col) > 0) yearlyCol = col;
  });
  if (yearlyCol >= 0) out.volume = yearlyCol;

  for (const field of FIELDS) {
    const current = out[field];
    const currentFill = current != null ? fill(current) : 0;
    // Достаточно заполнено — не трогаем.
    if (currentFill >= Math.max(2, Math.floor(body.length * 0.25))) continue;
    if (field === 'volume' && yearlyCol >= 0) continue;

    let bestCol = current;
    let bestFill = currentFill;
    headerRow.forEach((cell, col) => {
      const h = cellText(cell);
      if (!h) return;
      if (scoreField(field, h) < MIN_FIELD_SCORE) return;
      const f = fill(col);
      // Колонка уже отдана другому полю и там заполнена — не отбираем.
      const owner = Object.keys(out).find((k) => k !== field && out[k] === col);
      if (owner && fill(col) >= bestFill) return;
      if (f > bestFill) { bestFill = f; bestCol = col; }
    });
    if (bestCol !== current && bestFill > currentFill) out[field] = bestCol;
  }
  return out;
}

/** Значение ячейки → строка (без объектов ExcelJS и дат). */
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
    if (v.w != null) return String(v.w).trim();
    return '';
  }
  return String(v).trim();
}

/** Строки листа (двумерный массив) из книги SheetJS. */
function sheetRows(XLSX, sheet) {
  if (!sheet) return [];
  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1, blankrows: false, defval: '', raw: false
  });
  return Array.isArray(aoa) ? aoa : [];
}

/**
 * Разбирает книгу: на каждом листе находит заголовок, сопоставляет колонки,
 * возвращает строки как объекты с полями из словаря.
 *
 * @param {object} XLSX — модуль xlsx
 * @param {object} wb — workbook
 * @returns {{sheets:Array, positions:Array, periods:Array, stats:object}}
 */
function parseWorkbook(XLSX, wb) {
  const sheets = [];
  const positions = [];

  for (const name of (wb && wb.SheetNames) || []) {
    const rows = sheetRows(XLSX, wb.Sheets[name]);
    if (!rows.length) continue;

    const head = detectHeaderRow(rows);
    const sheet = {
      name,
      rows: rows.length,
      header_row: head ? head.index : null,
      columns: head ? Object.keys(head.map) : [],
      mapped: head ? head.map : {},
      positions: 0
    };

    if (!head) { sheets.push(sheet); continue; }

    const map = head.map;
    const known = new Set(Object.values(map));
    // Неизвестные колонки — в raw_fields, чтобы не терять новые форматы.
    const rawCols = [];
    const headerRow = rows[head.index] || [];
    headerRow.forEach((cell, col) => {
      const h = cellText(cell);
      if (h && !known.has(col)) rawCols.push({ col, title: h.slice(0, 60) });
    });

    for (let r = head.index + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const get = (f) => (map[f] != null ? cellText(row[map[f]]) : '');
      let nm = get('name');
      // Пустая колонка «Наименование» — берём тег из незанятой: «203/1-4»,
      // «Р-1103», «Е-603». Без этого листы Прил_6/Прил_7 давали 0 позиций
      // при реальных 38 (тендер 2138).
      if (nm && /^[-–—\s]+$/.test(nm)) nm = '';
      if (!nm) {
        // Есть лист, где имя вообще не задано, а позиция опознаётся по
        // «Тип оборудования» + «Подтип» (дефектная ведомость). Тогда имя —
        // это тип, иначе 673 позиции сольются в одну.
        const t = get('type') || '';
        const sub = get('subtype') || '';
        if (t) nm = [t, sub].filter(Boolean).join(' — ').slice(0, 160);
      }
      if (!nm) {
        let best = '';
        for (let c = 0; c < row.length; c += 1) {
          if (known.has(c)) continue;
          const v = cellText(row[c]);
          if (v.length < 2 || v.length > 80) continue;
          if (/^(итого|всего|итог|услуг|линии)/i.test(v)) continue;
          // Прочерк и чистые числа — не имя.
          if (/^[-–—\s]+$/.test(v)) continue;
          if (/^[\d.,\s]+$/.test(v)) continue;
          if (v.length > best.length) best = v;
        }
        nm = best;
      }
      if (!nm) {
        // Нет названия и тега — но объём есть. Позицию нельзя терять:
        // в Прил_6 тендера 2138 наименование пустое у всех строк, а объём
        // осадка и площадь заданы. Имя строим по номеру позиции, честно
        // помечая, что это номер, а не описание.
        const nums = row.slice(0, 3).map((c) => cellText(c))
          .filter((v) => /^\d{1,4}$/.test(v));
        if (nums.length) nm = 'поз. ' + nums.join('/');
      }
      if (!nm) continue;
      // Позиция без объёма и без единицы — служебная строка, не работа.
      // Пустые строки в конце листа (Прил_4 r35–r38) давали фиктивные
      // позиции с volume = null.
      const volPeek = cellText(map.volume != null ? row[map.volume] : '');
      // Мера может быть геометрической: трубки x длина, диаметр, площадь.
      // Ведомости чисток задают объём так, а не колонкой «Объём».
      const geomPeek = cellText(map.tubes != null ? row[map.tubes] : '')
        || cellText(map.length_m != null ? row[map.length_m] : '');
      if (!volPeek && !geomPeek && !get('unit')) continue;
      // Служебные строки итогов.
      if (/^(итого|всего|итог|услуг|линии)/i.test(nm)) continue;

      const volRaw = get('volume');
      const volDirect = Number(String(volRaw).replace(/\s/g, '').replace(',', '.'));
      // Объёма колонкой нет — считаем из геометрии. Для чистки трубок это
      // трубки × длина (погонные метры). Единицу ставим по тому, что посчитали.
      let vol = volDirect;
      let geomUnit = null;
      if (!(Number.isFinite(vol) && vol > 0)) {
        const tubes = Number(String(get('tubes')).replace(/\s/g, '').replace(',', '.'));
        const lenRaw = Number(String(get('length_m')).replace(/\s/g, '').replace(',', '.'));
        if (Number.isFinite(lenRaw) && lenRaw > 0) {
          const headCell = cellText(map.length_m != null ? rows[head.index][map.length_m] : '');
          // ВАЖНО (найдено на тендере 2138, 12.11.2026):
          //  1. «мм» — это ОТДЕЛЬНЫЙ сегмент заголовка. Подстрока «мм» есть
          //     внутри слова «суММарная», и проверка /мм/i пересчитывала
          //     метры как миллиметры (5475 м → 5,475 м), а потом ещё
          //     умножала на число трубок. Объём завышался в 899 раз.
          //  2. «Суммарная длина трубок, м» — это УЖЕ сумма по всем трубкам.
          //     Умножение на количество трубок считало её дважды.
          // Два дефекта взаимно маскировались: 899 × 5475 / 1000 ≈ 4922
          // выглядело правдоподобно и не бросалось в глаза.
          const isTotalLen = /суммарн/.test(String(headCell).toLowerCase());
          const inMm = /(^|[^а-яё])мм([^а-яё]|$)/.test(String(headCell).toLowerCase());
          const lenM = inMm ? lenRaw / 1000 : lenRaw;
          if (isTotalLen) {
            vol = lenM;
          } else if (Number.isFinite(tubes) && tubes > 0) {
            vol = tubes * lenM;
          } else {
            vol = lenM;
          }
          geomUnit = 'п.м';
        }
      }
      const p = {
        sheet: name,
        row: r + 1,
        name: nm.slice(0, 200),
        volume: Number.isFinite(vol) && vol > 0 ? vol : null,
        // Единица: колонка «Ед. изм.» → вычисленная геометрия → заголовок
        // колонки объёма («Площадь_м2», «Объем_емкости_м3»).
        unit: get('unit') || geomUnit
          || (volPeek ? unitFromColumnHeader(cellText(map.volume != null ? rows[head.index][map.volume] : '')) : null)
          || null,
        zone: get('zone') || null,
        fouling: get('fouling') || null,
        period: get('period') || null,
        clean_count: (() => {
          const cc = Number(String(get('clean_count')).replace(',', '.'));
          return Number.isFinite(cc) && cc > 0 ? Math.round(cc) : null;
        })(),
        dn_mm: (() => { const v = Number(get('dn_mm').replace(',', '.')); return v > 0 ? v : null; })(),
        length_m: (() => { const v = Number(get('length_m').replace(',', '.')); return v > 0 ? v : null; })(),
        tubes: (() => { const v = Number(get('tubes').replace(',', '.')); return v > 0 ? v : null; })(),
        // Человеко-часы: если заказчик сам дал норму, срок считается из неё,
        // а не выдумывается. Без этого «Человек_часов_всего» терялся, и
        // дефектная ведомость шла в расчёт без трудозатрат.
        mh: (() => {
          const v = Number(String(get('mh')).replace(/\s/g, '').replace(',', '.'));
          return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
        })(),
        raw_fields: rawCols.length
          ? rawCols.reduce((acc, c) => {
            const v = cellText(row[c.col]);
            if (v) acc[c.title] = v.slice(0, 120);
            return acc;
          }, {})
          : null
      };
      positions.push(p);
      sheet.positions += 1;
    }

    sheets.push(sheet);
  }

  // Периоды: сколько позиций в каждом. Это график заездов из документа.
  const periodMap = new Map();
  for (const p of positions) {
    if (!p.period) continue;
    const key = String(p.period).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key) continue;
    const cur = periodMap.get(key) || { label: String(p.period).trim(), count: 0, works: 0 };
    cur.count += 1;
    cur.works += p.clean_count && p.clean_count > 1 ? p.clean_count : 1;
    periodMap.set(key, cur);
  }
  const periods = [...periodMap.values()].sort((a, b) => b.count - a.count);

  return {
    sheets,
    positions,
    periods,
    stats: {
      sheets: sheets.length,
      sheets_with_table: sheets.filter((s) => s.header_row != null).length,
      positions: positions.length,
      with_volume: positions.filter((p) => p.volume != null).length,
      with_period: positions.filter((p) => p.period).length,
      with_zone: positions.filter((p) => p.zone).length,
      // Сколько позиций пришли с готовыми трудозатратами от заказчика.
      with_mh: positions.filter((p) => p.mh != null).length,
      total_mh: Math.round(positions.reduce((s, p) => s + (Number(p.mh) || 0), 0)),
      periods: periods.length
    }
  };
}

/**
 * Компактный текст для промпта: шапка листа + строки «наименование | объём |
 * единица | цех | период». Плюс блок периодов — чтобы модель не гадала.
 */
function toPromptText(parsed) {
  const p = parsed || {};
  const list = Array.isArray(p.positions) ? p.positions : [];
  const lines = [];

  if (Array.isArray(p.sheets) && p.sheets.length) {
    lines.push('СТРУКТУРА ФАЙЛА (колонки определены по заголовкам):');
    for (const s of p.sheets) {
      lines.push(`  ${s.name}: строк ${s.rows}, позиций ${s.positions || 0}`
        + (s.columns && s.columns.length ? `, колонки: ${s.columns.join(', ')}` : ''));
    }
  }

  if (list.length) {
    lines.push('');
    lines.push('ПОЗИЦИИ ИЗ ТАБЛИЦ (наименование | объём | ед. | цех | отложения | период | чисток | геометрия):');
    // НЕ обрезаем список. Раньше стоял `slice(0, 900)`, и на ведомости
    // больше 900 строк остаток молча исчезал — модель физически не могла
    // вернуть то, чего не видела. Если текст не влезает в контекст, это
    // решает ai-call-budget нарезкой по строкам, а не тихая потеря здесь.
    for (const it of list) {
      const bits = [
        it.name,
        it.volume != null ? String(it.volume) : '—',
        it.unit || '—',
        it.zone || '—',
        it.fouling || '—',
        it.period || '—',
        it.clean_count != null ? String(it.clean_count) : '—'
      ];
      // Геометрия — источник объёма. Без неё модель видит только «4922 п.м»
      // и делает вывод «диаметра и длины нет, пересчитать нельзя», после
      // чего отказывается заполнять позиции. Это было на #2138: 675 строк
      // на входе, 0 позиций на выходе при полных данных в файле.
      const geo = [];
      if (it.dn_mm != null) geo.push('Ø' + it.dn_mm);
      if (it.length_m != null) geo.push('L=' + it.length_m);
      if (it.tubes != null) geo.push('N=' + it.tubes);
      if (it.mh != null) geo.push('мh=' + it.mh);
      bits.push(geo.length ? geo.join(' ') : '—');
      lines.push(bits.join(' | '));
    }
    lines.push('');
    lines.push('ПОЯСНЕНИЕ К ГЕОМЕТРИИ: объём в п.м УЖЕ посчитан как N × L');
    lines.push('(число трубок × суммарная длина). Пересчитывать его не нужно и');
    lines.push('паспортных данных запрашивать не нужно — это готовый объём работ.');
    lines.push('Ø — диаметр трубки, мм; L — длина, м; N — число трубок.');
    // Никакой обрезки и никакой пометки «ещё N позиций»: список полный.
  }

  if (Array.isArray(p.periods) && p.periods.length) {
    lines.push('');
    lines.push('ПЕРИОДЫ (из документа, это график заездов):');
    for (const per of p.periods) {
      lines.push(`  ${per.label}: позиций ${per.count}, работ ${per.works}`);
    }
  }

  return lines.join('\n');
}

/**
 * Нормализация ярлыка периода для сравнения перечней.
 * «октябрь 2027», «Октябрь-2027», «10.2027» → один ключ.
 */
function normalizePeriodKey(raw) {
  const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const months = [
    ['январ', '01'], ['феврал', '02'], ['март', '03'], ['апрел', '04'],
    ['ма[йяею]', '05'], ['июн', '06'], ['июл', '07'], ['август', '08'],
    ['сентябр', '09'], ['октябр', '10'], ['ноябр', '11'], ['декабр', '12']
  ];
  let mm = null;
  let yy = null;
  for (const [stem, num] of months) {
    if (new RegExp(stem, 'i').test(s)) { mm = num; break; }
  }
  const y = s.match(/(20\d{2})/);
  if (y) yy = y[1];
  const numDate = s.match(/\b(\d{1,2})[./\-](\d{4})\b/) || s.match(/\b(\d{4})[./\-](\d{1,2})\b/);
  if (numDate) {
    if (numDate[1].length === 4) { yy = numDate[1]; mm = String(numDate[2]).padStart(2, '0'); }
    else { mm = String(numDate[1]).padStart(2, '0'); yy = numDate[2]; }
  }
  if (mm && yy) return yy + '-' + mm;
  if (mm) return 'm' + mm;
  return s;
}

/**
 * Сравнение двух разобранных перечней: насколько они совпадают.
 *
 * Зачем: заказчик присылает ОДИН перечень в двух файлах — «Форма тендерного
 * предложения» (7 приложений) и «Дефектная ведомость» с теми же объёмами.
 * Имена разные, объёмы и периоды те же. Складывать их нельзя: 603 + 688 =
 * 1291 при реальных 688, и раздутое ожидание включает нарезку на 52 порции.
 *
 * ── Три отпечатка, а не два (тендер 2138, 12.11.2026) ─────────────────────
 * Объём+единица и объём+единица+период сравнивают позиции один-в-один. Этого
 * мало: в «Форме» объём трубчатых аппаратов задан ГЕОМЕТРИЕЙ (трубки × длина),
 * в дефектной ведомости — готовой колонкой. Даже после исправления расчёта
 * объёмы расходятся на проценты, и построчный отпечаток даёт ratio 0 при
 * 599 общих названиях из 601. Получалось 675 + 673 = 1348 позиций.
 *
 * Поэтому третий отпечаток — по НАБОРУ НАЗВАНИЙ. Он ловит именно этот случай
 * и не выдаёт ложных совпадений: разные приложения одного файла (Прил_1 vs
 * Прил_2) дают name-ratio 0,11, а один перечень в двух вёрстках — 1,0.
 *
 * @param {Array} a — позиции первого перечня
 * @param {Array} b — позиции второго
 * @returns {{overlap:number, ratio:number, sameList:boolean,
 *            ratio_volume:number, ratio_name:number}}
 */
function compareLists(a, b) {
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  if (!listA.length || !listB.length) {
    return { overlap: 0, ratio: 0, ratio_volume: 0, ratio_name: 0, sameList: false };
  }

  const volUnit = (p) => {
    const vol = Number(p.volume);
    // Позиция без объёма не даёт объёмного отпечатка. Иначе все такие
    // позиции получают ключ «—|» и два РАЗНЫХ перечня без объёмов
    // сравниваются как идентичные (ratio 1) — ложное схлопывание.
    if (!(Number.isFinite(vol) && vol > 0)) return null;
    const unit = String(p.unit || '').toLowerCase().replace(/\s+/g, '').trim();
    return vol.toFixed(2) + '|' + unit;
  };
  const sig = (p) => {
    const vu = volUnit(p);
    return vu == null ? null : vu + '|' + normalizePeriodKey(p.period);
  };

  const ratioOf = (fn) => {
    const setA = new Set();
    const setB = new Set();
    for (const p of listA) { const k = fn(p); if (k != null) setA.add(k); }
    for (const p of listB) { const k = fn(p); if (k != null) setB.add(k); }
    // Один из перечней не дал ни одного отпечатка — сравнивать нечем.
    // Не 0 и не 1: сигнал просто отсутствует, решение примет другой отпечаток.
    if (!setA.size || !setB.size) return { overlap: 0, ratio: 0, available: false };
    let common = 0;
    for (const x of setA) if (setB.has(x)) common += 1;
    return {
      overlap: common,
      ratio: common / Math.max(1, Math.min(setA.size, setB.size)),
      available: true
    };
  };

  // Названия: нормализуем регистр, кавычки и «поз.» — это одна и та же
  // позиция, записанная по-разному («Теплообменник поз. 1901»).
  const normName = (p) => String(p && p.name ? p.name : '')
    .toLowerCase()
    .replace(/[«»"'`]/g, '')
    .replace(/\bпоз\.?\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const withPeriod = ratioOf(sig);
  const volumeOnly = ratioOf(volUnit);
  const byName = ratioOf(normName);

  // Отпечаток по названиям — отдельное правило, а не «ещё один голос».
  // Названия позиций уникальны внутри перечня, поэтому 90 % совпадения
  // означает тот же перечень (на 2138 — 599 из 601 при объёмном ratio 0).
  // Разные приложения того же файла дают 0,11, так что запас большой.
  const nameSaysSame = byName.available && byName.ratio >= 0.7;
  const bestOfVolume = Math.max(withPeriod.ratio, volumeOnly.ratio);
  const bestRatio = Math.max(bestOfVolume, byName.ratio);
  const bestOverlap = Math.max(withPeriod.overlap, volumeOnly.overlap, byName.overlap);

  // 70 % — порог: одна и та же ведомость в другой вёрстке совпадает почти
  // целиком, а разные перечни одного заказчика — нет.
  return {
    overlap: bestOverlap,
    ratio: Math.round(bestRatio * 100) / 100,
    ratio_volume: Math.round(volumeOnly.ratio * 100) / 100,
    ratio_name: Math.round(byName.ratio * 100) / 100,
    sameList: nameSaysSame || bestOfVolume >= 0.7
  };
}

module.exports = {
  FIELD_HINTS,
  scoreField,
  normHeader,
  unitFromColumnHeader,
  MIN_FIELD_SCORE,
  detectHeaderRow,
  parseWorkbook,
  toPromptText,
  cellText,
  compareLists,
  normalizePeriodKey
};
