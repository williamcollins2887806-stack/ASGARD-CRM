'use strict';
/**
 * Извлекает из табеля Excel отметки, относящиеся к работе 1937
 * «Обезжиривание кислородопровода АО УММ-2» (= Святогор).
 *
 * Легенда внизу каждого листа сопоставляет цвет ячейки с названием работы.
 * Берём ТОЛЬКО метки по НАЗВАНИЮ (цвет переиспользуется между месяцами):
 *   «Обезжир Кислородоропровода АО УММ-2 …», «ЗиссерАО УММ-2», «Зиссер СВЯТОГОР».
 *
 * Usage: node tools/umm2-extract-marks.js "<путь к табелю.xlsx>"
 * Результат: tools/umm2-marks.json
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || 'C:/Users/Nikita-ASGARD/Downloads/Табель (3).xlsx';
const LABEL_RE = /(обезжир.*умм|умм[\s-]*2|святогор)/i;

const MONTHS = {
  янв: 1, январь: 1, фев: 2, февр: 2, февраль: 2, мар: 3, март: 3, апр: 4, апрель: 4,
  май: 5, июн: 6, июнь: 6, июл: 7, июль: 7, авг: 8, август: 8, сен: 9, сент: 9, сентябрь: 9,
  окт: 10, октябрь: 10, ноя: 11, ноябрь: 11, дек: 12, декабрь: 12
};
function parseSheet(name) {
  const m = String(name).toLowerCase().match(/([а-яё]+)\s*(\d{4})/);
  if (!m) return null;
  const mon = MONTHS[m[1]];
  return mon ? { year: +m[2], month: mon } : null;
}
function cv(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text) return v.text;
    if (v.result != null) return String(v.result);
    if (v.formula) return '=' + v.formula;
    return '';
  }
  return String(v);
}
function fillOf(cell) {
  const f = cell.fill; if (!f || f.type !== 'pattern') return '';
  const fg = f.fgColor || {};
  if (fg.argb) return '#' + String(fg.argb).slice(-6).toUpperCase();
  if (fg.theme != null) return 'TH' + fg.theme + (fg.tint ? ('/' + fg.tint.toFixed(2)) : '');
  return '';
}
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const out = [];
  for (const ws of wb.worksheets) {
    const p = parseSheet(ws.name);
    if (!p) continue;
    if (p.year === 2025 && p.month < 10) continue; // только с октября 2025
    if (p.year > 2026) continue;

    const labels = {}; // label -> color
    for (let r = 1; r <= ws.rowCount; r++) {
      const t = cv(ws.getRow(r).getCell(1).value).trim();
      if (!t) continue;
      const fl = fillOf(ws.getRow(r).getCell(1));
      if (!fl) continue;
      if (cv(ws.getRow(r).getCell(2).value).trim() === t) labels[t] = fl;
    }
    const labelByColor = {};
    for (const [lbl, fl] of Object.entries(labels)) if (LABEL_RE.test(lbl)) labelByColor[fl] = lbl;
    const ummColors = new Set(Object.keys(labelByColor));
    if (!ummColors.size) continue;

    for (let r = 1; r <= ws.rowCount; r++) {
      const who = cv(ws.getRow(r).getCell(1).value).trim();
      if (!who || labels[who]) continue;
      let isWorker = false;
      for (let cn = 2; cn <= 32; cn++) { const c = ws.getRow(r).getCell(cn); if (typeof c.value === 'number' && c.value > 0) { isWorker = true; break; } }
      if (!isWorker) continue;
      for (let cn = 2; cn <= 32; cn++) {
        const c = ws.getRow(r).getCell(cn);
        if (typeof c.value !== 'number' || c.value <= 0) continue;
        const fl = fillOf(c);
        if (!ummColors.has(fl)) continue;
        const day = cn - 1;
        if (day > daysInMonth(p.year, p.month)) continue;
        const d = p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        out.push({ fio: who, day: d, points: c.value, label: labelByColor[fl], sheet: ws.name });
      }
    }
  }
  const seen = new Set();
  const uniq = out.filter((o) => { const k = o.fio + '|' + o.day; if (seen.has(k)) return false; seen.add(k); return true; });
  const dest = path.join(__dirname, 'umm2-marks.json');
  fs.writeFileSync(dest, JSON.stringify(uniq, null, 2));
  console.log('УММ-2 отметок:', uniq.length, '→', dest);
  const bySheet = {}; for (const o of uniq) bySheet[o.sheet] = (bySheet[o.sheet] || 0) + 1;
  console.log('по листам:', JSON.stringify(bySheet));
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
