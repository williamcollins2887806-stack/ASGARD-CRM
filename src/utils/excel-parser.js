'use strict';
/**
 * АСГАРД CRM — общий парсер Excel товарных списков (счёт/УПД/накладная/КП/прайс).
 * Используется в catalog-import.js (УПД→каталог) и warehouse-cart.js (Excel→корзина).
 *
 * Стратегия:
 *  1) пытаемся распознать заголовки по названиям колонок (название/поставщик/кол-во/цена/артикул/ед);
 *  2) если заголовков нет — позиционная эвристика (первая длинная строка = имя, первое число = кол-во,
 *     последнее число = цена).
 * Возвращает: [{ name, article, quantity, unit, unit_price, supplier_name }]
 */

function cell(v) { return (v && v.text) ? v.text : v; }
function toNum(v) { const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? null : n; }

// Сопоставление заголовка колонки с логическим полем
function classifyHeader(h) {
  const s = String(h || '').toLowerCase().trim();
  if (!s) return null;
  if (/наимен|товар|назв|номенклат|позиц|материал|description|name/.test(s)) return 'name';
  if (/поставщ|производ|бренд|supplier|vendor/.test(s)) return 'supplier_name';
  if (/кол-?во|колич|qty|quantity|штук|кол\b/.test(s)) return 'quantity';
  if (/цена|сумма|стоим|price|cost/.test(s)) return 'unit_price';
  if (/артик|код|sku|article/.test(s)) return 'article';
  if (/ед\.?\s*изм|единиц|unit|ед\b/.test(s)) return 'unit';
  return null;
}

/**
 * @param {Buffer} buffer — содержимое .xlsx/.xls
 * @returns {Promise<Array<{name,article,quantity,unit,unit_price,supplier_name}>>}
 */
async function parseProcurementExcel(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  // 1) попытка распознать заголовки в первой строке
  const headerRow = ws.getRow(1);
  const colMap = {};            // columnIndex(1-based) -> field
  let mapped = 0;
  (headerRow.values || []).forEach((v, idx) => {
    if (idx === 0) return;      // exceljs values[0] всегда undefined
    const f = classifyHeader(cell(v));
    if (f && !Object.values(colMap).includes(f)) { colMap[idx] = f; mapped++; }
  });

  const items = [];

  if (mapped >= 2 && colMap && Object.values(colMap).includes('name')) {
    // ── режим по заголовкам ──
    ws.eachRow((row, idx) => {
      if (idx === 1) return;    // заголовок
      const rec = { name: '', article: '', quantity: 1, unit: 'шт', unit_price: null, supplier_name: null };
      for (const [ci, field] of Object.entries(colMap)) {
        const raw = cell(row.getCell(parseInt(ci)).value);
        if (raw == null || raw === '') continue;
        if (field === 'quantity') rec.quantity = toNum(raw) || 1;
        else if (field === 'unit_price') rec.unit_price = toNum(raw);
        else rec[field] = String(raw).trim();
      }
      if (rec.name && rec.name.length > 1) items.push(rec);
    });
  } else {
    // ── позиционная эвристика (как в исходном catalog-import) ──
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const vals = (row.values || []).map(cell);
      const name = (vals.find(v => typeof v === 'string' && v.trim().length > 1) || '').toString().trim();
      if (!name) return;
      const nums = vals.filter(v => typeof v === 'number' || (typeof v === 'string' && /^\d/.test(v)));
      const qty = toNum(nums[0]) || 1;
      const price = nums.length ? toNum(nums[nums.length - 1]) : null;
      items.push({ name, article: '', quantity: qty, unit: 'шт', unit_price: price, supplier_name: null });
    });
  }

  return items;
}

module.exports = { parseProcurementExcel };
