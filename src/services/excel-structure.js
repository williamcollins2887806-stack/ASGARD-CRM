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

/** Словарь: поле → regex по заголовку. Порядок важен: более специфичное выше. */
const COLUMN_RULES = [
  ['clean_count', /количеств\w*\s+чист|чист\w*\s*(количеств|шт|раз)|циклов|повторност/i],
  ['period', /период\s*(выполн|работ)?|срок\w*\s+(выполн|работ)|месяц|квартал|график\w*\s+(работ|выполн)/i],
  ['tubes', /количеств\w*\s+труб|труб\w*\s*(шт|количеств)|число\s+труб/i],
  ['dn_mm', /диаметр|(?<![а-яё])dn(?![а-яё])|(?<![а-яё])ду(?![а-яё])|(?<![а-яё])ø/i],
  ['length_m', /длин\w*\s+трубк|длина\s+труб|суммарн\w*\s+длин|общ\w*\s+длин|(?<![а-яё])l(?![а-яё])/i],
  ['zone', /цех|отделени|участ|корпус|установк|блок|зон[аы]|ось|захватк|этаж/i],
  ['fouling', /характер\s+отлож|тип\s+загрязн|отложени|среда|загрязнен/i],
  ['unit', /ед\.?\s*изм|единиц\w*\s+измер|^ед\.?$|измерени/i],
  ['volume', /количеств|объ[её]м|кол-во|масса|вес|площад|длина|осадок/i],
  ['name', /наименован|позици|работ\w*|аппарат|оборудован|узел|описани/i]
];

/** Заголовок листа — строка, где найдено минимум два поля словаря. */
function detectHeaderRow(rows) {
  let best = { index: -1, score: 0, map: {} };
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i] || [];
    const map = {};
    let score = 0;
    row.forEach((cell, col) => {
      const h = String(cell == null ? '' : cell).trim();
      if (!h || h.length > 80) return;
      for (const [field, re] of COLUMN_RULES) {
        if (map[field] != null) continue;
        if (re.test(h)) { map[field] = col; score += 1; break; }
      }
    });
    if (score > best.score) best = { index: i, score, map };
  }
  // Нужны хотя бы «наименование» и «объём» — иначе это не ведомость.
  if (best.score < 2 || best.map.name == null) return null;
  // Колонка могла «перехватить» поле по слову в заголовке, но быть пустой
  // («Позиция» вместо «Наименование теплообменников»). Проверяем заполненность
  // и при необходимости переключаемся на альтернативу.
  best.map = refineColumns(rows, best.index, best.map);
  return best;
}

/**
 * Уточняет колонки по ФАКТИЧЕСКОЙ заполненности, а не только по заголовку.
 *
 * Пример из практики (#2138, Прил_1): первая подходящая под `name` колонка —
 * «Позиция», она пустая во всех строках, а наименования лежат в следующей
 * («Наименование теплообменников…»). Заголовок о слове «позиция» сработал,
 * а данные — в другой колонке.
 *
 * Правило: для каждого поля собираем всех кандидатов по словарю и берём ту
 * колонку, где больше непустых значений в теле таблицы.
 */
function refineColumns(rows, headerIdx, map) {
  const body = rows.slice(headerIdx + 1, headerIdx + 60);
  if (!body.length) return map;

  const fill = (col) => body.reduce((n, row) => {
    const v = cellText((row || [])[col]);
    return n + (v ? 1 : 0);
  }, 0);

  const out = Object.assign({}, map);
  const taken = new Set(Object.values(map));

  for (const field of ['name', 'volume', 'unit', 'zone', 'period', 'fouling', 'clean_count', 'tubes', 'dn_mm', 'length_m']) {
    const current = out[field];
    const currentFill = current != null ? fill(current) : 0;
    // Достаточно заполнено — не трогаем.
    if (currentFill >= Math.max(2, Math.floor(body.length * 0.25))) continue;

    // Ищем альтернативу по заголовку среди незанятых колонок.
    const headerRow = rows[headerIdx] || [];
    const rule = COLUMN_RULES.find(([f]) => f === field);
    if (!rule) continue;
    let bestCol = current;
    let bestFill = currentFill;
    headerRow.forEach((cell, col) => {
      if (taken.has(col) && col !== current) return;
      const h = cellText(cell);
      if (!h || !rule[1].test(h)) return;
      const f = fill(col);
      if (f > bestFill) { bestFill = f; bestCol = col; }
    });
    if (bestCol !== current && bestFill > currentFill) {
      if (current != null) taken.delete(current);
      out[field] = bestCol;
      taken.add(bestCol);
    }
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
      const nm = get('name');
      if (!nm || nm.length < 3) continue;
      // Служебные строки итогов.
      if (/^(итого|всего|итог)/i.test(nm)) continue;

      const volRaw = get('volume');
      const vol = Number(String(volRaw).replace(/\s/g, '').replace(',', '.'));
      const p = {
        sheet: name,
        row: r + 1,
        name: nm.slice(0, 200),
        volume: Number.isFinite(vol) && vol > 0 ? vol : null,
        unit: get('unit') || null,
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
    lines.push('ПОЗИЦИИ ИЗ ТАБЛИЦ (наименование | объём | ед. | цех | отложения | период | чисток):');
    for (const it of list.slice(0, 900)) {
      const bits = [
        it.name,
        it.volume != null ? String(it.volume) : '—',
        it.unit || '—',
        it.zone || '—',
        it.fouling || '—',
        it.period || '—',
        it.clean_count != null ? String(it.clean_count) : '—'
      ];
      lines.push(bits.join(' | '));
    }
    if (list.length > 900) lines.push(`… ещё ${list.length - 900} позиций (обрезано)`);
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

module.exports = {
  COLUMN_RULES,
  detectHeaderRow,
  parseWorkbook,
  toPromptText,
  cellText
};
