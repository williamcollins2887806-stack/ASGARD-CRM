'use strict';
/**
 * D-335: выгрузка счетов БЕЗ объекта в Excel для заказчика.
 * Разбивка по листам: свод, офис, склад, работы, прочее + «в оплате» отдельно.
 */
const fs = require('fs');
const path = require('path');
let XLSX;
try { XLSX = require('xlsx'); } catch (_) { XLSX = null; }

const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tmp-no-work.json'), 'utf8'));
console.log('строк:', rows.length);

if (!XLSX) { console.error('нет модуля xlsx'); process.exit(1); }

const KIND = { office: 'Офис/АХО', warehouse: 'Склад/материалы', work: 'Работы', other: 'Прочее' };

function rowOut(r) {
  const d = r.invoice_date ? String(r.invoice_date).slice(0, 4) : '';
  return {
    'ID': r.id,
    'Год': d,
    'Номер счёта': r.invoice_number || '',
    'Дата счёта': r.invoice_date ? String(r.invoice_date).slice(0, 10) : '',
    'Контрагент': r.counterparty_name || '',
    'ИНН': r.counterparty_inn || '',
    'Сумма с НДС': Number(r.amount_gross) || 0,
    'НДС': Number(r.vat_amount) || 0,
    'Вид расхода': KIND[r.spend_kind] || (r.spend_kind || ''),
    'Ответственный': r.owner_name || '',
    'Статус оплаты': r.pay_status_pi || '(нет заявки)',
    'Привязан к заявке': r.payment_invoice_id ? ('#' + r.payment_invoice_id) : 'НЕТ',
    'Причина неполноты': Array.isArray(r.incomplete_reasons) ? r.incomplete_reasons.join(', ') : '',
    'Что нужно сделать': r.payment_invoice_id
      ? 'ВЫБРАТЬ ОБЪЕКТ — расход упадёт в проект'
      : (r.spend_kind === 'office'
          ? 'Офис — уже в реестре офисных расходов, объект не нужен'
          : (r.spend_kind === 'warehouse'
              ? 'Склад/материалы — учесть на складе или привязать к объекту'
              : 'Архив (оплата прошла вне CRM) — расход надо учесть по факту'))
  };
}

const wb = XLSX.utils.book_new();

// Лист «Свод»
const agg = {};
let totS = 0;
for (const r of rows) {
  const k = r.spend_kind || 'other';
  agg[k] = agg[k] || { n: 0, s: 0, noPay: 0 };
  agg[k].n++;
  agg[k].s += Number(r.amount_gross) || 0;
  totS += Number(r.amount_gross) || 0;
  if (!r.payment_invoice_id) agg[k].noPay++;
}
const yearOf = (r) => (r.invoice_date ? String(r.invoice_date).slice(0, 4) : '—');
const y2025 = rows.filter((r) => yearOf(r) === '2025');
const y2026 = rows.filter((r) => yearOf(r) === '2026');
const sum = (a) => a.reduce((s, r) => s + (Number(r.amount_gross) || 0), 0);

const summary = [
  {
    'Показатель': 'ВСЕГО БЕЗ ОБЪЕКТА',
    'Строк': rows.length,
    'Сумма': totS,
    'Без заявки (архив)': rows.filter((r) => !r.payment_invoice_id).length,
    'В оплате': rows.filter((r) => r.payment_invoice_id).length
  },
  {
    'Показатель': '  из них 2025 год — исторический импорт',
    'Строк': y2025.length,
    'Сумма': sum(y2025),
    'Без заявки (архив)': y2025.filter((r) => !r.payment_invoice_id).length,
    'В оплате': y2025.filter((r) => r.payment_invoice_id).length
  },
  {
    'Показатель': '  из них 2026 год',
    'Строк': y2026.length,
    'Сумма': sum(y2026),
    'Без заявки (архив)': y2026.filter((r) => !r.payment_invoice_id).length,
    'В оплате': y2026.filter((r) => r.payment_invoice_id).length
  },
  {},
  {
    'Показатель': 'ПО ВИДАМ РАСХОДА',
    'Строк': '',
    'Сумма': '',
    'Без заявки (архив)': '',
    'В оплате': ''
  },
  ...['office', 'other', 'warehouse', 'work'].map((k) => ({
    'Показатель': '  ' + KIND[k],
    'Строк': agg[k] ? agg[k].n : 0,
    'Сумма': agg[k] ? agg[k].s : 0,
    'Без заявки (архив)': agg[k] ? agg[k].noPay : 0,
    'В оплате': agg[k] ? (agg[k].n - agg[k].noPay) : 0
  }))
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Свод');

// Листы по видам
for (const [k, title] of [['office', 'Офис'], ['warehouse', 'Склад'], ['work', 'Работы'], ['other', 'Прочее']]) {
  const sub = rows.filter((r) => (r.spend_kind || 'other') === k).map(rowOut);
  if (sub.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sub), title);
}

// Лист «В оплате без объекта» — самое важное
const inPay = rows.filter((r) => r.payment_invoice_id).map(rowOut);
if (inPay.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inPay), 'В оплате без объекта');

// Лист «196 исторических» — то, что просил заказчик
if (y2025.length) {
  const hist = y2025.slice().sort((a, b) => (Number(b.amount_gross) || 0) - (Number(a.amount_gross) || 0)).map(rowOut);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hist), '2025 исторические');
}

// Лист «Офис без привязки к офисному реестру»
const officeNoLink = rows.filter((r) => r.spend_kind === 'office' && !r.office_expense_id).map(rowOut);
if (officeNoLink.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(officeNoLink), 'Офис без связи');

const out = path.join(__dirname, '..', 'reports', 'Счета без объекта.xlsx');
fs.mkdirSync(path.dirname(out), { recursive: true });
XLSX.writeFile(wb, out);
console.log('сохранено:', out);
console.log('листов:', wb.SheetNames.join(' | '));
console.log('офисных без связи с office_expenses:', officeNoLink.length);
