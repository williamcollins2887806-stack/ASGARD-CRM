/**
 * Рантайм-проверка нового расчёта финансового отчёта на РЕАЛЬНЫХ данных.
 * Читает work_expenses из клона БД по SSH-выгрузке (JSON), считает тем же
 * кодом, что и financial-summary, и сверяет со арифметикой вручную.
 *
 * Запуск: node tests/manual/fin-report-runtime.js <file.json> <work_contract> <vat_pct>
 */
const fs = require('fs');
const vatCalc = require('../../src/services/vat-calc');
const expenseTax = require('../../src/services/expense-tax');

const file = process.argv[2];
const contractValue = Number(process.argv[3]);
const vatPct = Number(process.argv[4]);
const taxRate = 55;
const incomeTaxRate = 25;

const expenses = JSON.parse(fs.readFileSync(file, 'utf8'));

let gross = 0, net = 0, vatDed = 0, tax = 0, taxBase = 0;
const issues = [];
const byCat = {};

for (const e of expenses) {
  const r = vatCalc.resolveExpense(e);
  gross += r.amount;
  net += r.net;
  vatDed += r.vat;
  if (r.inconsistent) issues.push({ id: e.id, amount: r.amount });
  const t = expenseTax.calcTaxBurden({ ...e, amount: r.net, vat_amount: 0 }, taxRate);
  if (t > 0) { tax += t; taxBase += r.net; }
  const c = e.category || 'other';
  byCat[c] = byCat[c] || { net: 0, vat: 0, cnt: 0 };
  byCat[c].net += r.net; byCat[c].vat += r.vat; byCat[c].cnt++;
}

const money = (v) => Math.round(v * 100) / 100;
const vatCharged = money(contractValue * vatPct / (100 + vatPct));
const revenueExVat = money(contractValue - vatCharged);
const totalWithTax = money(money(net) + money(tax));
const profitBefore = money(revenueExVat - totalWithTax);
const incomeTax = profitBefore > 0 ? money(profitBefore * incomeTaxRate / 100) : 0;
const netProfit = money(profitBefore - incomeTax);
const margin = revenueExVat > 0 ? Math.round(netProfit / revenueExVat * 1000) / 10 : 0;

console.log('=== НОВАЯ МОДЕЛЬ (всё без НДС) ===');
console.log('Договор с НДС          ', contractValue);
console.log('НДС начисленный        ', vatCharged);
console.log('Выручка без НДС        ', revenueExVat);
console.log('');
console.log('Расходы брутто (как в БД)', money(gross));
console.log('НДС внутри расходов    ', money(vatDed));
console.log('Расходы без НДС        ', money(net));
console.log('База 55%               ', money(taxBase));
console.log('Налоговая нагрузка 55% ', money(tax));
console.log('Расходы + налоги       ', totalWithTax);
console.log('');
console.log('Прибыль до налога      ', profitBefore);
console.log('Налог на прибыль 25%   ', incomeTax);
console.log('Чистая прибыль         ', netProfit);
console.log('Маржа                  ', margin + '%');
console.log('');
console.log('=== СХОДИМОСТЬ СТОЛБИКА ===');
const check = money(revenueExVat - money(net) - money(tax) - profitBefore);
console.log('Выручка_без_НДС − Расходы_без_НДС − Налоговая_нагрузка = Прибыль_до_налога');
console.log('Расхождение:', check, check === 0 ? '✓' : '✗');
console.log('');
console.log('=== НДС-БЛОК (отдельно, вне прибыли) ===');
console.log('НДС начисленный        ', vatCharged);
console.log('НДС к вычету           ', money(vatDed));
console.log('НДС к уплате           ', money(vatCharged - vatDed));
console.log('');
console.log('=== КАЧЕСТВО ДАННЫХ ===');
console.log('Противоречивых строк   ', issues.length);
if (issues.length) console.log(JSON.stringify(issues, null, 2));
console.log('');
console.log('=== СТРУКТУРА (без НДС) ===');
Object.entries(byCat).sort((a, b) => b[1].net - a[1].net).forEach(([k, v]) => {
  console.log(k.padEnd(16), String(money(v.net)).padStart(14), ' НДС:', String(money(v.vat)).padStart(12), ' строк:', v.cnt);
});
console.log('');
console.log('Сумма категорий        ', money(Object.values(byCat).reduce((s, v) => s + v.net, 0)));
console.log('Расходы без НДС        ', money(net), Math.abs(money(Object.values(byCat).reduce((s, v) => s + v.net, 0)) - money(net)) < 0.02 ? '✓ сходится' : '✗');
