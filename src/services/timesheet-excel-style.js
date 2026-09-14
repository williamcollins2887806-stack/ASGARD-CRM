'use strict';

/**
 * Единый стиль Excel-выгрузки табеля (timesheet-v2, field-manage, global).
 * Наполнение колонок может отличаться; chrome + цвета смен + легенда — общие.
 * Легенда рисуется на том же листе под таблицей.
 */

const SHIFT_ALIASES = {
  road: 'travel',
  standby: 'waiting',
  airplane: 'travel',
  plane: 'travel'
};

/** ARGB fills / fonts — пастель читаемая в Excel */
const SHIFT_STYLE = {
  day:        { fill: 'FFE8F5E9', font: 'FF166534', label: 'День' },
  night:      { fill: 'FFD6E4FF', font: 'FF1E40AF', label: 'Ночь' },
  travel:     { fill: 'FFCFFAFE', font: 'FF0E7490', label: 'Дорога / самолёт' },
  ship:       { fill: 'FFFFF3CD', font: 'FF92610A', label: 'Корабль' },
  helicopter: { fill: 'FFFFF8E1', font: 'FFB45309', label: 'Вертолёт' },
  training:   { fill: 'FFFCE7F3', font: 'FF9D174D', label: 'Обучение' },
  medical:    { fill: 'FFFEE2E2', font: 'FFB91C1C', label: 'Медосмотр' },
  waiting:    { fill: 'FFFFEDD5', font: 'FFC2410C', label: 'Ожидание' },
  half:       { fill: 'FFF3F4F6', font: 'FF4B5563', label: 'Полдня' },
  warehouse:  { fill: 'FFEDE9FE', font: 'FF6D28D9', label: 'Склад' },
  office:     { fill: 'FF92D050', font: 'FF3F6B10', label: 'Офис' },
  remote:     { fill: 'FFFFC000', font: 'FF7A5C00', label: 'Удалённая работа' }
};

const LEGEND_ORDER = [
  'day', 'night', 'travel', 'ship', 'helicopter', 'training', 'medical', 'waiting', 'half', 'warehouse', 'office', 'remote'
];

/** Общий chrome: золотые шапки как в timesheet-v2 */
const CHROME = {
  FILL_GOLD: 'FFFFF4D6',
  FONT_GOLD_DARK: 'FF7A5C00',
  FILL_TOTAL: 'FFFFE9B0',
  FILL_TOTAL_ACCENT: 'FFD4A843',
  FILL_ZEBRA: 'FFFAFAFA',
  FILL_WEEKEND: 'FFFDE8E8',
  FILL_ROW_ALT: 'FFF7FAFD',
  FILL_SUM_CELL: 'FFFFF9E6',
  BORDER_GREY: 'FFBDBDBD',
  FONT_MUTED: 'FF555555',
  FONT_TITLE: 'FF1A2B4A',
  FONT_WEEKEND: 'FFCC0000',
  FONT_ACCENT: 'FF92610A',
  RUB_FMT: '#,##0" ₽";[Red]-#,##0" ₽"',
  RUB_FMT_DASH: '#,##0" ₽";[Red]-#,##0" ₽";"—"'
};

function thinBorder(argb) {
  const c = { argb: argb || CHROME.BORDER_GREY };
  const thin = { style: 'thin', color: c };
  return { top: thin, left: thin, bottom: thin, right: thin };
}

function goldFill() {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: CHROME.FILL_GOLD } };
}

function totalFill() {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: CHROME.FILL_TOTAL } };
}

function solidFill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/**
 * Заголовок листа «ТАБЕЛЬ — …» (строка 1, merge 1..totalCols).
 */
function applyTitleRow(ws, totalCols, titleText) {
  ws.mergeCells(1, 1, 1, totalCols);
  const t = ws.getCell(1, 1);
  t.value = titleText;
  t.font = { bold: true, size: 14, color: { argb: CHROME.FONT_GOLD_DARK } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  t.fill = goldFill();
  ws.getRow(1).height = 26;
  return t;
}

/**
 * Стиль ячейки шапки таблицы (золотой фон).
 */
function applyHeaderCell(cell, opts = {}) {
  const isWeekend = !!opts.weekend;
  cell.font = {
    bold: true,
    size: opts.size || 10,
    color: { argb: isWeekend ? CHROME.FONT_WEEKEND : CHROME.FONT_GOLD_DARK }
  };
  cell.fill = solidFill(isWeekend ? CHROME.FILL_WEEKEND : CHROME.FILL_GOLD);
  cell.alignment = opts.alignment || { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = thinBorder();
}

function canonShift(raw) {
  const s = String(raw || 'day').toLowerCase();
  return SHIFT_ALIASES[s] || s;
}

function styleForShift(raw) {
  const key = canonShift(raw);
  return SHIFT_STYLE[key] || SHIFT_STYLE.day;
}

function applyShiftCell(cell, pts, shiftRaw) {
  const st = styleForShift(shiftRaw);
  const n = Number(pts);
  cell.value = Number.isFinite(n) && n > 0 ? Math.round(n) : (Number.isFinite(n) ? 0 : '');
  if (cell.value === '') {
    cell.value = null;
  }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } };
  cell.font = { size: 9, bold: Number(cell.value) >= 18, color: { argb: st.font } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.numFmt = '0';
}

/**
 * Блок легенды под таблицей на том же листе.
 * @param {import('exceljs').Worksheet} ws
 * @param {number} startRow — первая свободная строка после ИТОГО
 * @param {object} [opts]
 * @param {number} [opts.colSpan=6]
 * @returns {number} next free row
 */
function appendLegendBelow(ws, startRow, opts = {}) {
  const colSpan = opts.colSpan || 6;
  let r = startRow + 1;
  ws.mergeCells(r, 1, r, Math.max(2, colSpan));
  const title = ws.getCell(r, 1);
  title.value = 'ЛЕГЕНДА (цвет ячейки = тип смены; в ячейке — только баллы)';
  title.font = { bold: true, size: 10, color: { argb: CHROME.FONT_TITLE } };
  title.alignment = { vertical: 'middle' };
  ws.getRow(r).height = 18;
  r += 1;

  let col = 1;
  for (const key of LEGEND_ORDER) {
    const st = SHIFT_STYLE[key];
    if (!st) continue;
    if (col > colSpan) {
      r += 1;
      col = 1;
    }
    const sample = ws.getCell(r, col);
    sample.value = '  ';
    sample.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } };
    sample.border = thinBorder();
    const lab = ws.getCell(r, col + 1);
    lab.value = st.label;
    lab.font = { size: 9, color: { argb: st.font } };
    lab.alignment = { vertical: 'middle' };
    col += 2;
  }
  return r + 2;
}

module.exports = {
  SHIFT_STYLE,
  LEGEND_ORDER,
  SHIFT_ALIASES,
  CHROME,
  canonShift,
  styleForShift,
  applyShiftCell,
  appendLegendBelow,
  thinBorder,
  goldFill,
  totalFill,
  solidFill,
  applyTitleRow,
  applyHeaderCell
};
