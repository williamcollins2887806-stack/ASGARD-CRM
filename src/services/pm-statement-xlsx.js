'use strict';

/**
 * pm-statement-xlsx.js — генерация «Выписки РП» (банковский стиль) в XLSX
 * с НАСТОЯЩИМИ формулами Excel (running balance, SUMIFS, COUNTIFS).
 *
 * Используется из GET /api/cash/statement?format=xlsx.
 *
 * Структура XLSX (3 листа, по спеке API_SPEC_PM_STATEMENT.md):
 *   1) «Сводка»          — fio РП, период, общий баланс, разбивка приход/расход
 *                          (все суммы — формулы SUMIF/SUMIFS из «Журнал операций»)
 *   2) «Журнал операций» — хронология операций с running balance (формулы H{i}=H{i-1}+D{i})
 *   3) «По проектам»     — агрегат по work_id (формулы SUMIFS+COUNTIFS)
 *
 * Доп. тех. колонки в журнале (скрытые J, K) — для SUMIFS:
 *   J = source (handover/cash_request/cash_return/cash_expense/worker_payment/work_expense)
 *   K = work_id (число или пусто)
 *
 * Подсветка: статичная заливка строк зелёный/красный + шрифт + numFmt
 * `#,##0.00 ₽;[Red]-#,##0.00 ₽` (Excel сам красит отрицательные красным).
 *
 * Образец визуала: КАО Азот Финотчёт СВОДНЫЙ.xlsx (Desktop/азот/).
 *
 * Зависимость: exceljs (есть в package.json ^4.4.0).
 */

let ExcelJS = null;
let excelLoadError = null;
try {
  ExcelJS = require('exceljs');
} catch (e) {
  excelLoadError = e;
}

// ────────────────────────────────────────────────────────────────────
// Палитра.
// ────────────────────────────────────────────────────────────────────
const FILL_HEADER_DARK = 'FF374151';   // тёмно-серый — шапки таблиц
const FONT_HEADER      = 'FFFFFFFF';   // белый текст на шапке
const FILL_TITLE       = 'FFFFF4D6';   // золотой — баннер «ВЫПИСКА РП»
const FONT_TITLE       = 'FF7A5C00';   // тёмно-золотой
const FILL_SECTION     = 'FFE5E7EB';   // светло-серый — секции в сводке
const FILL_INCOME      = 'FFE6F4EA';   // мягкий зелёный фон для income-строк
const FILL_OUTFLOW     = 'FFFCE8E6';   // мягкий красный фон для outflow-строк
const FILL_OPENING     = 'FFF5F5F5';   // нейтрально-серый — opening/closing
const FONT_INCOME      = 'FF2E7D32';   // зелёный текст (как в спеке)
const FONT_OUTFLOW     = 'FFC62828';   // красный текст (как в спеке)
const BORDER_GREY      = 'FFBDBDBD';
// V264: палитра для info-строк (deньги компании — не из кассы РП)
const FILL_INFO_BANK   = 'FFE8F0FA';   // полупрозрачный голубой — банк компании
const FILL_INFO_SE     = 'FFF0E8F4';   // полупрозрачный лиловый — СЗ-сервис
const FILL_INFO_AUTO   = 'FFFFF4D9';   // полупрозрачный жёлтый — авто-ФОТ
const FONT_INFO        = 'FF6B7280';   // приглушённый серый — info-текст

// Формат «1 234,56 ₽» с красными отрицательными (Excel сам подкрасит).
const RUB_FMT = '#,##0.00" ₽";[Red]-#,##0.00" ₽"';

const thin = { style: 'thin', color: { argb: BORDER_GREY } };
const borderAll = { top: thin, left: thin, bottom: thin, right: thin };

// ────────────────────────────────────────────────────────────────────
// Утилиты.
// ────────────────────────────────────────────────────────────────────
function num(v) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtDateRU(s) {
  if (!s) return '';
  if (typeof s === 'string') {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    return s;
  }
  if (s instanceof Date && !isNaN(s)) {
    const y = s.getFullYear();
    const m = String(s.getMonth() + 1).padStart(2, '0');
    const d = String(s.getDate()).padStart(2, '0');
    return `${d}.${m}.${y}`;
  }
  return String(s);
}

const OPERATION_TYPE_RU = {
  handover:        'Передача от СЗ',
  cash_request:    'Аванс из кассы',
  cash_return:     'Возврат в кассу',
  cash_expense:    'Расход по подотчёту',
  worker_payment:  'Выплата рабочему',
  work_expense:    'Расход по проекту',
};

const WORKER_PAYMENT_TYPE_RU = {
  salary:   'Зарплата',
  bonus:    'Премия',
  per_diem: 'Суточные',
  advance:  'Аванс рабочему',
  penalty:  'Удержание',
};

function categoryToRu(op) {
  if (op.source === 'worker_payment' && WORKER_PAYMENT_TYPE_RU[op.category]) {
    return WORKER_PAYMENT_TYPE_RU[op.category];
  }
  return op.category || OPERATION_TYPE_RU[op.source] || '—';
}

// V264: человекочитаемая метка источника денег для колонки «Источник» в XLSX.
const SOURCE_KIND_RU = {
  pm_cash:        '📤 Моя касса',
  pm_cash_legacy: '📤 Моя касса',
  company_bank:   '🏦 Банк компании',
  company_se:     '📱 СЗ-сервис',
  auto_fot:       '⚙ Авто-ФОТ',
  other:          '—',
};

function sourceKindLabel(op) {
  if (!op) return '';
  // явный source_kind у строки операции (журнал/выписка) выигрывает
  if (op.source_kind && SOURCE_KIND_RU[op.source_kind] != null) {
    return SOURCE_KIND_RU[op.source_kind];
  }
  // дефолт: всё что не info — это «📤 Моя касса» (income+outflow из подотчёта РП)
  if (op.type === 'income' || op.type === 'outflow') return SOURCE_KIND_RU.pm_cash;
  return '—';
}

// V264: цвет фона строки info-операций по источнику.
function infoFillFor(sourceKind) {
  if (sourceKind === 'company_bank') return FILL_INFO_BANK;
  if (sourceKind === 'company_se')   return FILL_INFO_SE;
  if (sourceKind === 'auto_fot')     return FILL_INFO_AUTO;
  return FILL_OPENING;
}

/**
 * Главный API: сгенерировать Buffer XLSX.
 */
async function generateStatementXlsx({ pm, period, summary, operations }) {
  if (!ExcelJS) {
    const err = new Error(
      'exceljs не установлен. Установите: npm install exceljs' +
      (excelLoadError ? ` (require error: ${excelLoadError.message})` : '')
    );
    err.code = 'EXCELJS_MISSING';
    throw err;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'АСГАРД CRM';
  wb.created = new Date();

  // Журнал строим первым: он нужен summary/by-project для ссылок-формул.
  // Но в Excel порядок листов = порядок добавления → нужен ('Сводка','Журнал','По проектам').
  // Поэтому: сначала готовим layout-инфо для журнала (диапазоны), затем создаём листы.
  const journalLayout = computeJournalLayout({ operations, summary });

  buildSheetSummary(wb, { pm, period, summary, journalLayout });
  buildSheetJournal(wb, { pm, period, summary, operations, journalLayout });
  buildSheetByProject(wb, { summary, operations, journalLayout });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ────────────────────────────────────────────────────────────────────
// Расчёт layout «Журнала» — нужен для формул на других листах.
// ────────────────────────────────────────────────────────────────────
function computeJournalLayout({ operations }) {
  const ops = operations || [];
  // Шапка = ряд 1. Opening = ряд 2. Первая операция = ряд 3.
  const HEADER_ROW = 1;
  const OPENING_ROW = 2;
  const FIRST_OP_ROW = 3;
  const LAST_OP_ROW = FIRST_OP_ROW + ops.length - 1; // если ops.length === 0 → -1
  const TOTAL_ROW = (ops.length > 0 ? LAST_OP_ROW : OPENING_ROW) + 1;

  // Колонки (1-based) — V264 добавила «Источник» (I) перед «Балансом» (J):
  //   A=№, B=Дата, C=Тип, D=Сумма, E=Категория, F=Описание, G=Контрагент,
  //   H=Работа, I=Источник, J=Баланс,
  //   K=source(hidden), L=work_id(hidden), M=source_kind(hidden, для SUMIFS)
  return {
    sheet: 'Журнал операций',
    headerRow: HEADER_ROW,
    openingRow: OPENING_ROW,
    firstOpRow: FIRST_OP_ROW,
    lastOpRow: LAST_OP_ROW,
    totalRow: TOTAL_ROW,
    opCount: ops.length,
    // общее число колонок (включая скрытые)
    columnCount: 13,
    // последняя видимая колонка (для границ/autofilter)
    lastVisibleCol: 10,
    // ссылки-строки для формул (с экранированием имени листа одинарными кавычками)
    sheetRef: "'Журнал операций'",
    amountColLetter: 'D',
    sourceColLetter: 'K',
    workIdColLetter: 'L',
    sourceKindColLetter: 'M',
    categoryColLetter: 'E',
    typeColLetter: 'C',
    balanceColLetter: 'J',
    sourceLabelColLetter: 'I',
  };
}

// ────────────────────────────────────────────────────────────────────
// Лист 1: «Сводка» — формулы SUMIF/SUMIFS
// ────────────────────────────────────────────────────────────────────
function buildSheetSummary(wb, { pm, period, summary, journalLayout }) {
  const ws = wb.addWorksheet('Сводка');
  ws.getColumn(1).width = 42;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 14;

  // ── Заголовок-баннер
  ws.mergeCells('A1:C1');
  const title = ws.getCell('A1');
  title.value = 'ВЫПИСКА РП — Подотчёт';
  title.font = { bold: true, size: 14, color: { argb: FONT_TITLE } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_TITLE } };
  ws.getRow(1).height = 24;

  ws.mergeCells('A2:C2');
  ws.getCell('A2').value = pm?.name || '—';
  ws.getCell('A2').alignment = { horizontal: 'center' };
  ws.getCell('A2').font = { bold: true, color: { argb: FONT_TITLE } };

  ws.mergeCells('A3:C3');
  ws.getCell('A3').value =
    `Период: ${fmtDateRU(period.from)} – ${fmtDateRU(period.to)} · Сформировано ${fmtDateRU(new Date())}`;
  ws.getCell('A3').alignment = { horizontal: 'center' };

  // Краткие ссылки на диапазоны журнала для формул
  const jr = journalLayout;
  const opRange = jr.opCount > 0
    ? `${jr.sheetRef}!$${jr.amountColLetter}$${jr.firstOpRow}:$${jr.amountColLetter}$${jr.lastOpRow}`
    : null;
  const typeRange = jr.opCount > 0
    ? `${jr.sheetRef}!$${jr.typeColLetter}$${jr.firstOpRow}:$${jr.typeColLetter}$${jr.lastOpRow}`
    : null;
  const srcRange = jr.opCount > 0
    ? `${jr.sheetRef}!$${jr.sourceColLetter}$${jr.firstOpRow}:$${jr.sourceColLetter}$${jr.lastOpRow}`
    : null;
  const catRange = jr.opCount > 0
    ? `${jr.sheetRef}!$${jr.categoryColLetter}$${jr.firstOpRow}:$${jr.categoryColLetter}$${jr.lastOpRow}`
    : null;
  const openingCellRef = `${jr.sheetRef}!$${jr.balanceColLetter}$${jr.openingRow}`;

  let row = 5;

  // ── Секция 1: Общий баланс
  row = section(ws, row, '1. ОБЩИЙ БАЛАНС');

  // Остаток на начало (просто число с ссылкой на ячейку opening журнала)
  row = kvFormula(ws, row, 'Остаток на начало периода',
    `=${openingCellRef}`,
    num(summary.opening_balance),
    { fill: FILL_OPENING, bold: true });

  // Σ Приход — сумма всех положительных операций (по type="income"); SUMIF суммирует D-колонку.
  // Здесь amount у income положителен, у outflow — отрицателен. SUMIFS по C="↑ *" сложно
  // (звёздочки), проще через source = (любой income source). Делаем универсально:
  // Σ Приход = SUMIF(D-range, ">0")
  if (opRange) {
    row = kvFormula(ws, row, 'Σ Приход',
      `=SUMIF(${opRange},">0")`,
      num(summary.total_in),
      { color: 'income' });

    // Σ Расход — суммируем отрицательные и инвертируем знак: -SUMIF(D, "<0")
    row = kvFormula(ws, row, 'Σ Расход',
      `=-SUMIF(${opRange},"<0")`,
      num(summary.total_out),
      { color: 'outflow' });
  } else {
    row = kvFormula(ws, row, 'Σ Приход', 0, 0, { color: 'income' });
    row = kvFormula(ws, row, 'Σ Расход', 0, 0, { color: 'outflow' });
  }

  // Остаток на конец = opening + Σприход - Σрасход (ссылки на ячейки строки выше)
  // opening = B{row-3}, прих = B{row-2}, расх = B{row-1}
  const openR = row - 3;
  const inR   = row - 2;
  const outR  = row - 1;
  row = kvFormula(ws, row, 'Остаток на конец',
    `=B${openR}+B${inR}-B${outR}`,
    num(summary.closing_balance),
    { bold: true, fill: FILL_OPENING });
  row += 1;

  // ── Секция 2: Приход по источникам
  row = section(ws, row, '2. ПРИХОД ПО ИСТОЧНИКАМ');
  if (srcRange && typeRange) {
    row = kvFormula(ws, row, 'Передачи от СЗ',
      `=SUMIFS(${opRange},${srcRange},"handover")`,
      num((summary.breakdown_in || {}).handovers_received),
      { color: 'income' });
    row = kvFormula(ws, row, 'Авансы из кассы Асгарда',
      `=SUMIFS(${opRange},${srcRange},"cash_request")`,
      num((summary.breakdown_in || {}).cash_advances_issued),
      { color: 'income' });
    if (num((summary.breakdown_in || {}).se_cash_legacy)) {
      row = kvFormula(ws, row, 'Передачи от СЗ (старая схема)',
        `=SUMIFS(${opRange},${srcRange},"se_cash_legacy")`,
        num(summary.breakdown_in.se_cash_legacy),
        { color: 'income' });
    }
  } else {
    row = kvFormula(ws, row, 'Передачи от СЗ',          0, 0, { color: 'income' });
    row = kvFormula(ws, row, 'Авансы из кассы Асгарда', 0, 0, { color: 'income' });
  }
  if (Array.isArray(summary.by_category_in) && summary.by_category_in.length) {
    row += 1;
    row = subsection(ws, row, 'Детализация по категории');
    for (const it of summary.by_category_in) {
      const f = catRange
        ? `=SUMIFS(${opRange},${catRange},${cellStr(it.key || it.label)})`
        : null;
      row = kvFormula(ws, row, `  ${it.label}${it.count ? `  (${it.count})` : ''}`,
        f, num(it.amount), { color: 'income' });
    }
  }
  row += 1;

  // ── Секция 3: Расход по категориям
  row = section(ws, row, '3. РАСХОД ПО КАТЕГОРИЯМ');
  if (srcRange) {
    row = kvFormula(ws, row, 'Возврат в кассу Асгарда',
      `=-SUMIFS(${opRange},${srcRange},"cash_return")`,
      num((summary.breakdown_out || {}).cash_returns_confirmed),
      { color: 'outflow' });
    row = kvFormula(ws, row, 'Выплаты рабочим',
      `=-SUMIFS(${opRange},${srcRange},"worker_payment")`,
      num((summary.breakdown_out || {}).worker_payments),
      { color: 'outflow' });
    row = kvFormula(ws, row, 'Материалы / прямые расходы',
      `=-SUMIFS(${opRange},${srcRange},"work_expense")`,
      num((summary.breakdown_out || {}).work_expenses_direct),
      { color: 'outflow' });
    row = kvFormula(ws, row, 'Прочее (отчётность по подотчёту)',
      `=-SUMIFS(${opRange},${srcRange},"cash_expense")`,
      num((summary.breakdown_out || {}).cash_expenses),
      { color: 'outflow' });
  } else {
    row = kvFormula(ws, row, 'Возврат в кассу Асгарда',       0, 0, { color: 'outflow' });
    row = kvFormula(ws, row, 'Выплаты рабочим',                0, 0, { color: 'outflow' });
    row = kvFormula(ws, row, 'Материалы / прямые расходы',     0, 0, { color: 'outflow' });
    row = kvFormula(ws, row, 'Прочее (отчётность по подотчёту)', 0, 0, { color: 'outflow' });
  }

  if (Array.isArray(summary.by_category_out) && summary.by_category_out.length) {
    row += 1;
    row = subsection(ws, row, 'Детализация по категории');
    for (const it of summary.by_category_out) {
      const f = (catRange && opRange)
        ? `=-SUMIFS(${opRange},${catRange},${cellStr(it.key || it.label)})`
        : null;
      row = kvFormula(ws, row, `  ${it.label}${it.count ? `  (${it.count})` : ''}`,
        f, num(it.amount), { color: 'outflow' });
    }
  }

  // ── V264 Секция: «Из этого справочно» — деньги КОМПАНИИ работникам.
  // НЕ влияет на баланс РП (закрывающий остаток уже посчитан). Чисто инфо.
  row += 1;
  row = section(ws, row, 'СПРАВОЧНО · ВЫПЛАТЫ ДЕНЬГАМИ КОМПАНИИ');
  const info = summary.breakdown_info || {};
  const sourceKindRange = jr.opCount > 0
    ? `${jr.sheetRef}!$${jr.sourceKindColLetter}$${jr.firstOpRow}:$${jr.sourceKindColLetter}$${jr.lastOpRow}`
    : null;

  if (opRange && sourceKindRange) {
    row = kvFormula(ws, row, '🏦 Банк компании',
      `=SUMIFS(${opRange},${sourceKindRange},"company_bank")`,
      num(info.info_company_bank), { fill: FILL_INFO_BANK });
    row = kvFormula(ws, row, '📱 СЗ-сервис',
      `=SUMIFS(${opRange},${sourceKindRange},"company_se")`,
      num(info.info_company_se), { fill: FILL_INFO_SE });
    row = kvFormula(ws, row, '⚙ Авто-ФОТ',
      `=SUMIFS(${opRange},${sourceKindRange},"auto_fot")`,
      num(info.info_auto_fot), { fill: FILL_INFO_AUTO });
  } else {
    row = kvFormula(ws, row, '🏦 Банк компании', 0, 0, { fill: FILL_INFO_BANK });
    row = kvFormula(ws, row, '📱 СЗ-сервис',     0, 0, { fill: FILL_INFO_SE });
    row = kvFormula(ws, row, '⚙ Авто-ФОТ',       0, 0, { fill: FILL_INFO_AUTO });
  }

  // Freeze top banner
  ws.views = [{ state: 'frozen', ySplit: 4 }];
}

// строковый литерал для формулы Excel: "value" с экранированием " → ""
function cellStr(s) {
  const v = String(s == null ? '' : s).replace(/"/g, '""');
  return `"${v}"`;
}

function section(ws, row, text) {
  ws.mergeCells(`A${row}:C${row}`);
  const c = ws.getCell(`A${row}`);
  c.value = text;
  c.font = { bold: true, size: 11 };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_SECTION } };
  c.alignment = { vertical: 'middle' };
  ws.getRow(row).height = 18;
  return row + 1;
}

function subsection(ws, row, text) {
  ws.mergeCells(`A${row}:C${row}`);
  const c = ws.getCell(`A${row}`);
  c.value = text;
  c.font = { italic: true, color: { argb: 'FF6B7280' } };
  return row + 1;
}

/**
 * Записать пару «лейбл/значение». Значение может быть:
 *   - строка-формула (начинается с '=') — кладём {formula, result}
 *   - число — кладём как число
 */
function kvFormula(ws, row, label, formulaOrNumber, resultNumber, opts = {}) {
  const lbl = ws.getCell(`A${row}`);
  lbl.value = label;
  if (opts.bold) lbl.font = { bold: true };
  if (opts.fill) lbl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };

  const val = ws.getCell(`B${row}`);
  if (typeof formulaOrNumber === 'string' && formulaOrNumber.startsWith('=')) {
    val.value = { formula: formulaOrNumber.slice(1), result: num(resultNumber) };
  } else {
    val.value = num(formulaOrNumber);
  }
  val.numFmt = RUB_FMT;
  val.alignment = { horizontal: 'right' };

  const fontParts = {};
  if (opts.bold) fontParts.bold = true;
  if (opts.color === 'income')  fontParts.color = { argb: FONT_INCOME };
  if (opts.color === 'outflow') fontParts.color = { argb: FONT_OUTFLOW };
  if (Object.keys(fontParts).length) val.font = fontParts;

  if (opts.fill) val.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };

  return row + 1;
}

// ────────────────────────────────────────────────────────────────────
// Лист 2: «Журнал операций» — running balance через формулы H{i}=H{i-1}+D{i}
// ────────────────────────────────────────────────────────────────────
function buildSheetJournal(wb, { operations, summary, journalLayout }) {
  const ws = wb.addWorksheet('Журнал операций');

  // V264: новая колонка «Источник» (I) перед «Балансом» (J).
  // Колонки: A=№, B=Дата, C=Тип, D=Сумма, E=Категория, F=Описание, G=Контрагент,
  //          H=Работа, I=Источник, J=Баланс,
  //          K=source(hidden), L=work_id(hidden), M=source_kind(hidden, для SUMIFS)
  const headers = ['№', 'Дата', 'Тип', 'Сумма ₽', 'Категория', 'Описание', 'Контрагент', 'Работа', 'Источник', 'Баланс ₽', 'source', 'work_id', 'source_kind'];
  const widths  = [6, 12, 22, 16, 22, 42, 28, 36, 20, 16, 14, 10, 16];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  // Скрываем тех. колонки K/L/M
  ws.getColumn(11).hidden = true;
  ws.getColumn(12).hidden = true;
  ws.getColumn(13).hidden = true;

  const LAST_VIS = journalLayout.lastVisibleCol; // 10 (J = Баланс)
  const LAST_COL = journalLayout.columnCount;    // 13

  // Шапка
  const hdrRow = journalLayout.headerRow;
  const hdr = ws.getRow(hdrRow);
  headers.forEach((h, i) => {
    const c = hdr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: FONT_HEADER } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_HEADER_DARK } };
    // правое выравнивание: D (4=Сумма), J (10=Баланс)
    c.alignment = { vertical: 'middle', horizontal: (i === 3 || i === 9) ? 'right' : 'left' };
    c.border = borderAll;
  });
  hdr.height = 22;
  ws.views = [{ state: 'frozen', ySplit: hdrRow }];

  // ── Opening row (баланс на начало периода)
  const openR = journalLayout.openingRow;
  const opening = num(summary.opening_balance);
  ws.getCell(`C${openR}`).value = 'Остаток на начало периода';
  ws.getCell(`C${openR}`).font = { italic: true, color: { argb: 'FF6B7280' } };
  const bal0 = ws.getCell(`${journalLayout.balanceColLetter}${openR}`);
  bal0.value = opening;
  bal0.numFmt = RUB_FMT;
  bal0.alignment = { horizontal: 'right' };
  bal0.font = { bold: true };
  for (let i = 1; i <= LAST_COL; i++) {
    const c = ws.getRow(openR).getCell(i);
    if (i <= LAST_VIS) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_OPENING } };
    c.border = borderAll;
  }

  // ── Operations
  let runningBalance = opening;
  (operations || []).forEach((op, idx) => {
    const r = journalLayout.firstOpRow + idx;
    const isInfo   = op.type === 'info';
    const isIncome = op.type === 'income';
    const amt = num(op.amount); // amount уже отрицательный для outflow, положительный для info
    // V264: info-строки НЕ меняют running balance
    if (!isInfo) runningBalance += amt;

    const row = ws.getRow(r);
    row.getCell(1).value = idx + 1;
    row.getCell(2).value = fmtDateRU(op.date);
    if (isInfo) {
      row.getCell(3).value = `ℹ инфо · ${OPERATION_TYPE_RU[op.source] || op.source || ''}`;
    } else {
      row.getCell(3).value = isIncome
        ? `↑ ${OPERATION_TYPE_RU[op.source] || op.source || 'income'}`
        : `↓ ${OPERATION_TYPE_RU[op.source] || op.source || 'outflow'}`;
    }

    // Сумма — обычное число, с numFmt для красного на отрицательных
    row.getCell(4).value = amt;
    row.getCell(4).numFmt = RUB_FMT;
    row.getCell(4).alignment = { horizontal: 'right' };

    row.getCell(5).value = categoryToRu(op);
    row.getCell(6).value = op.description || '';
    row.getCell(7).value = op.counterparty || '';
    row.getCell(8).value = op.work_title
      ? `${op.work_title}${op.work_id ? ` (#${op.work_id})` : ''}`
      : (op.work_id ? `#${op.work_id}` : '—');

    // V264: I — «Источник»
    row.getCell(9).value = sourceKindLabel(op);
    row.getCell(9).alignment = { horizontal: 'left' };

    // ── J = Баланс ₽
    // Для income/outflow — ФОРМУЛА: =J{prev}+D{r}
    // Для info — ССЫЛКА на J{prev} (running не меняется)
    const prevR = r === journalLayout.firstOpRow ? journalLayout.openingRow : r - 1;
    const balCell = row.getCell(10);
    if (isInfo) {
      balCell.value = {
        formula: `${journalLayout.balanceColLetter}${prevR}`,
        result: runningBalance,
      };
    } else {
      balCell.value = {
        formula: `${journalLayout.balanceColLetter}${prevR}+D${r}`,
        result: runningBalance,
      };
    }
    balCell.numFmt = RUB_FMT;
    balCell.alignment = { horizontal: 'right' };

    // Тех. колонки K/L/M
    row.getCell(11).value = op.source || (isInfo ? 'info' : (isIncome ? 'income' : 'outflow'));
    row.getCell(12).value = op.work_id == null ? '' : op.work_id;
    row.getCell(13).value = op.source_kind || (isInfo ? 'other' : 'pm_cash');

    // ── Подсветка
    let fillFg, fontFg;
    if (isInfo) {
      fillFg = infoFillFor(op.source_kind);
      fontFg = FONT_INFO;
    } else if (isIncome) {
      fillFg = FILL_INCOME;
      fontFg = FONT_INCOME;
    } else {
      fillFg = FILL_OUTFLOW;
      fontFg = FONT_OUTFLOW;
    }
    row.getCell(3).font = { color: { argb: fontFg }, bold: !isInfo, italic: isInfo };
    row.getCell(4).font = { color: { argb: fontFg }, bold: !isInfo, italic: isInfo };
    if (isInfo) {
      // приглушённый шрифт во всех ячейках info-строки
      for (let i = 5; i <= LAST_VIS; i++) {
        row.getCell(i).font = { color: { argb: fontFg }, italic: true };
      }
    }

    for (let i = 1; i <= LAST_COL; i++) {
      const cell = row.getCell(i);
      cell.border = borderAll;
      if (i <= LAST_VIS) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillFg } };
      }
    }
  });

  // ── Итоговая строка
  const tR = journalLayout.totalRow;
  const totalRow = ws.getRow(tR);
  totalRow.getCell(3).value = 'ИТОГО за период';
  totalRow.getCell(3).font = { bold: true };

  if (journalLayout.opCount > 0) {
    // V264: SUM по type<>"info" (info-строки не должны попадать в total).
    // Excel: SUMIFS(D-range, C-range, "<>ℹ инфо*") — но префиксы динамические.
    // Проще: используем скрытую колонку source_kind через SUMIFS:
    //   =SUMIFS(D, source_kind, "pm_cash") + ... — но это сложно.
    // Самый надёжный путь: формула =SUMIF(D,"<>0", D) недопустима с фильтром.
    // Реально info-amounts положительные, но мы хотим их исключить.
    // Решение: формула =SUM(D)-SUMIFS(D, K(source), "?", source_kind, "company_bank")...
    // Слишком хрупко. Берём готовое значение из summary как result + формулу
    // как сумму только outflow и income.
    const dRange = `D${journalLayout.firstOpRow}:D${journalLayout.lastOpRow}`;
    const sourceKindRange = `${journalLayout.sourceKindColLetter}${journalLayout.firstOpRow}:${journalLayout.sourceKindColLetter}${journalLayout.lastOpRow}`;
    // итог = sum(всё) − sum(info: company_bank+company_se+auto_fot)
    totalRow.getCell(4).value = {
      formula: `SUM(${dRange})-SUMIFS(${dRange},${sourceKindRange},"company_bank")-SUMIFS(${dRange},${sourceKindRange},"company_se")-SUMIFS(${dRange},${sourceKindRange},"auto_fot")`,
      result: num(summary.total_in) - num(summary.total_out),
    };
  } else {
    totalRow.getCell(4).value = 0;
  }
  totalRow.getCell(4).numFmt = RUB_FMT;
  totalRow.getCell(4).font = { bold: true };
  totalRow.getCell(4).alignment = { horizontal: 'right' };

  // Closing balance = ссылка на последнюю формулу баланса (или на opening, если ops пустой)
  const closingRef = journalLayout.opCount > 0
    ? `${journalLayout.balanceColLetter}${journalLayout.lastOpRow}`
    : `${journalLayout.balanceColLetter}${journalLayout.openingRow}`;
  const closingCell = totalRow.getCell(10);
  closingCell.value = {
    formula: closingRef,
    result: num(summary.closing_balance),
  };
  closingCell.numFmt = RUB_FMT;
  closingCell.font = { bold: true };
  closingCell.alignment = { horizontal: 'right' };

  for (let i = 1; i <= LAST_COL; i++) {
    if (i <= LAST_VIS) {
      totalRow.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_SECTION } };
    }
    totalRow.getCell(i).border = borderAll;
  }

  // AutoFilter по основным колонкам A..J (без скрытых тех.)
  ws.autoFilter = {
    from: { row: hdrRow, column: 1 },
    to:   { row: hdrRow, column: LAST_VIS },
  };
}

// ────────────────────────────────────────────────────────────────────
// Лист 3: «По проектам» — формулы SUMIFS+COUNTIFS
// ────────────────────────────────────────────────────────────────────
function buildSheetByProject(wb, { operations, summary, journalLayout }) {
  const ws = wb.addWorksheet('По проектам');

  const headers = ['Работа', 'Кол-во операций', 'Σ приход ₽', 'Σ расход ₽', 'Net ₽'];
  const widths  = [42, 18, 18, 18, 18];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const hdr = ws.getRow(1);
  headers.forEach((h, i) => {
    const c = hdr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: FONT_HEADER } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_HEADER_DARK } };
    c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right' };
    c.border = borderAll;
  });
  hdr.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Агрегация: предпочитаем summary.by_work, иначе сами.
  let agg;
  if (Array.isArray(summary.by_work) && summary.by_work.length) {
    agg = summary.by_work.map(w => ({
      work_id: w.work_id,
      work_title: w.work_title,
      ops: num(w.ops),
      in: num(w.in),
      out: num(w.out),
      net: num(w.net != null ? w.net : (num(w.in) - num(w.out))),
    }));
  } else {
    const map = new Map();
    for (const op of operations || []) {
      const key = op.work_id == null ? '__none__' : String(op.work_id);
      let row = map.get(key);
      if (!row) {
        row = {
          work_id: op.work_id == null ? null : op.work_id,
          work_title: op.work_title || (op.work_id == null ? 'Без привязки' : `#${op.work_id}`),
          ops: 0, in: 0, out: 0,
        };
        map.set(key, row);
      }
      row.ops += 1;
      const a = num(op.amount);
      if (a >= 0) row.in += a;
      else row.out += -a;
    }
    agg = [...map.values()].map(r => ({ ...r, net: r.in - r.out }));
    agg.sort((a, b) => (b.in + b.out) - (a.in + a.out));
  }

  // ── Подготовим строковые ссылки на диапазоны журнала
  const jr = journalLayout;
  const hasOps = jr.opCount > 0;
  const opRange   = hasOps ? `${jr.sheetRef}!$${jr.amountColLetter}$${jr.firstOpRow}:$${jr.amountColLetter}$${jr.lastOpRow}` : null;
  const workRange = hasOps ? `${jr.sheetRef}!$${jr.workIdColLetter}$${jr.firstOpRow}:$${jr.workIdColLetter}$${jr.lastOpRow}` : null;

  let r = 2;
  for (const w of agg) {
    const row = ws.getRow(r);
    row.getCell(1).value = w.work_title || (w.work_id ? `#${w.work_id}` : 'Без привязки');

    // work_id для формул: число или "" (пустое)
    const wIdLiteral = w.work_id == null ? '""' : String(w.work_id);

    if (hasOps) {
      // Кол-во операций = COUNTIF(K-range, work_id)
      row.getCell(2).value = {
        formula: `COUNTIF(${workRange},${wIdLiteral})`,
        result: num(w.ops),
      };
      // Σ приход = SUMIFS(D, K=workId, D>0)
      row.getCell(3).value = {
        formula: `SUMIFS(${opRange},${workRange},${wIdLiteral},${opRange},">0")`,
        result: num(w.in),
      };
      // Σ расход = -SUMIFS(D, K=workId, D<0)
      row.getCell(4).value = {
        formula: `-SUMIFS(${opRange},${workRange},${wIdLiteral},${opRange},"<0")`,
        result: num(w.out),
      };
      // Net = C - D (на ЭТОМ листе: C = приход, D = расход)
      row.getCell(5).value = {
        formula: `C${r}-D${r}`,
        result: num(w.net),
      };
    } else {
      row.getCell(2).value = 0;
      row.getCell(3).value = 0;
      row.getCell(4).value = 0;
      row.getCell(5).value = 0;
    }

    row.getCell(2).alignment = { horizontal: 'right' };
    row.getCell(2).font = { bold: true };
    row.getCell(3).numFmt = RUB_FMT;
    row.getCell(3).font = { color: { argb: FONT_INCOME } };
    row.getCell(4).numFmt = RUB_FMT;
    row.getCell(4).font = { color: { argb: FONT_OUTFLOW } };
    row.getCell(5).numFmt = RUB_FMT;
    row.getCell(5).font = { bold: true };
    for (let i = 1; i <= 5; i++) row.getCell(i).border = borderAll;
    r++;
  }

  // ── Итоговая строка
  if (agg.length) {
    const totalRow = ws.getRow(r);
    totalRow.getCell(1).value = 'ИТОГО';
    totalRow.getCell(1).font = { bold: true };

    const firstAgg = 2;
    const lastAgg = r - 1;

    totalRow.getCell(2).value = {
      formula: `SUM(B${firstAgg}:B${lastAgg})`,
      result: agg.reduce((a, w) => a + num(w.ops), 0),
    };
    totalRow.getCell(2).alignment = { horizontal: 'right' };
    totalRow.getCell(2).font = { bold: true };

    totalRow.getCell(3).value = {
      formula: `SUM(C${firstAgg}:C${lastAgg})`,
      result: agg.reduce((a, w) => a + num(w.in), 0),
    };
    totalRow.getCell(3).numFmt = RUB_FMT;
    totalRow.getCell(3).font = { bold: true, color: { argb: FONT_INCOME } };

    totalRow.getCell(4).value = {
      formula: `SUM(D${firstAgg}:D${lastAgg})`,
      result: agg.reduce((a, w) => a + num(w.out), 0),
    };
    totalRow.getCell(4).numFmt = RUB_FMT;
    totalRow.getCell(4).font = { bold: true, color: { argb: FONT_OUTFLOW } };

    totalRow.getCell(5).value = {
      formula: `C${r}-D${r}`,
      result: agg.reduce((a, w) => a + num(w.net), 0),
    };
    totalRow.getCell(5).numFmt = RUB_FMT;
    totalRow.getCell(5).font = { bold: true };

    for (let i = 1; i <= 5; i++) {
      totalRow.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_SECTION } };
      totalRow.getCell(i).border = borderAll;
    }
  }
}

module.exports = {
  generateStatementXlsx,
  isAvailable: () => !!ExcelJS,
};
