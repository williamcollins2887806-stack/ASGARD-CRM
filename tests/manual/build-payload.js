/**
 * Собрать payload financial-summary из выгрузки расходов — теми же формулами,
 * что src/routes/works.js. Нужен, чтобы проверить РЕНДЕР отчёта на реальных числах.
 *
 * Запуск: node tests/manual/build-payload.js <expenses.json> <contract> <vat_pct> <out.json>
 */
const fs = require('fs');
const vatCalc = require('../../src/services/vat-calc');
const expenseTax = require('../../src/services/expense-tax');

const [, , expFile, contractArg, vatArg, outFile] = process.argv;
const contractValue = Number(contractArg);
const vatPct = Number(vatArg);
const taxRate = 55, incomeTaxRate = 25;
const expenses = JSON.parse(fs.readFileSync(expFile, 'utf8'));
const money = (v) => Math.round(v * 100) / 100;

const catMap = {};
let gross = 0, net = 0, vatDed = 0, tax = 0, taxBase = 0;
const issues = [];

for (const e of expenses) {
  const cat = e.category || 'other';
  const r = vatCalc.resolveExpense(e);
  if (!catMap[cat]) catMap[cat] = { category: cat, sum: 0, sumGross: 0, vat: 0, count: 0, vatDeductible: 0, taxBurden: 0, items: [] };
  catMap[cat].sum += r.net;
  catMap[cat].sumGross += r.gross;
  catMap[cat].vat += r.vat;
  catMap[cat].count++;
  catMap[cat].items.push({
    ...e,
    amount_gross: r.gross, amount_net: r.net, vat_deductible: r.vat,
    vat_rate_pct: r.rate, vat_basis_resolved: r.basis, inconsistent: r.inconsistent
  });
  gross += r.gross; net += r.net; vatDed += r.vat;
  if (r.inconsistent) {
    const rawNet = e.amount_ex_vat != null ? vatCalc.money(e.amount_ex_vat) : null;
    const rawVat = vatCalc.money(e.vat_amount);
    const rawAmount = vatCalc.money(e.amount);
    const diff = rawNet != null ? Math.abs(rawAmount - (rawNet + rawVat)) : 0;
    const severity = (diff <= 100 || diff <= rawAmount * 0.01) ? 'rounding' : 'material';
    issues.push({
      expense_id: e.id, category: cat, supplier: e.supplier || null, date: e.date || null,
      amount: rawAmount, vat_amount: rawVat, amount_net: rawNet != null ? rawNet : r.net,
      diff: Math.round(diff * 100) / 100, severity,
      reason: 'sum_does_not_add_up',
      detail: severity === 'rounding' ? 'расхождение в пределах округления' : 'сумма не равна нетто + НДС; база не определена'
    });
  }
  const t = expenseTax.calcTaxBurden({ ...e, amount: r.net, vat_amount: 0 }, taxRate);
  if (t > 0) { catMap[cat].taxBurden += t; tax += t; taxBase += r.net; }
}

for (const c of Object.values(catMap)) {
  c.sum = money(c.sum); c.sumGross = money(c.sumGross); c.vat = money(c.vat);
  c.vatDeductible = money(c.vatDeductible); c.taxBurden = money(c.taxBurden);
}

const vatCharged = money(contractValue * vatPct / (100 + vatPct));
const revenueExVat = money(contractValue - vatCharged);
const totalWithTax = money(money(net) + money(tax));
const profitBefore = money(revenueExVat - totalWithTax);
const incomeTax = profitBefore > 0 ? money(profitBefore * incomeTaxRate / 100) : 0;
const netProfit = money(profitBefore - incomeTax);
const margin = revenueExVat > 0 ? Math.round(netProfit / revenueExVat * 1000) / 10 : 0;

const payload = {
  work_id: 406,
  work_title: 'Выполнение СМР по замене оголовка факельного совмещённого (ОФС) МЛСП «Приразломная»',
  contract_value: contractValue,
  vat_pct: vatPct,
  tax_rate: taxRate,
  work_meta: {
    work_number: null,
    customer_name: 'ООО «Газпром нефть шельф»',
    customer_inn: '7736588510',
    pm_name: 'Андросов Никита Андреевич',
    pm_id: 14,
    city: 'МЛСП «Приразломная», Печорское море',
    object_name: null,
    work_status: 'Работы сдали',
    tender_id: 1237,
    completed_at: null,
    cost_plan: 50000000,
    cost_fact: money(gross),
    cost_plan_set: true,
    cost_fact_set: true
  },
  crew: [
    { id: 89, full_name: 'Ермошин Артем Степанович', position: 'Мастер-прораб', shifts: 19, hours: 209, earned: 247000, point_value: 500 },
    { id: 14, full_name: 'Андросов Никита Андреевич', position: 'Руководитель проектов', shifts: 4, hours: 44, earned: 27000, point_value: 500 },
    { id: 10165, full_name: 'Нохрин Рамазан Алифбекович', position: null, shifts: 3, hours: 33, earned: 25500, point_value: 500 },
    { id: 10166, full_name: 'Духаев Ислам Зияудинович', position: null, shifts: 3, hours: 33, earned: 25500, point_value: 500 },
    { id: 10167, full_name: 'Забелин Евгений Алексеевич', position: null, shifts: 3, hours: 33, earned: 25500, point_value: 500 }
  ],
  tender: { id: 1237, tender_title: 'Конкурентный отбор', customer_name: 'ООО «Газпром нефть шельф»', created_at: '2026-03-01T10:00:00.000Z', status: null },
  estimate: null,
  revenue: { with_vat: contractValue, ex_vat: revenueExVat, vat_charged: vatCharged },
  expenses: {
    categories: Object.values(catMap).sort((a, b) => b.sum - a.sum),
    total: money(net),
    total_gross: money(gross),
    total_vat_inside: money(gross - net),
    total_with_tax: totalWithTax
  },
  vat: { charged: vatCharged, deductible: money(vatDed), payable: money(vatCharged - vatDed) },
  taxes: { rate: taxRate, burden: money(tax), base: money(taxBase) },
  profit: { before_tax: profitBefore, income_tax_rate: incomeTaxRate, income_tax: incomeTax, net: netProfit, margin },
  data_quality: {
    inconsistent: issues, inconsistent_count: issues.length,
    material_count: issues.filter(i => i.severity === 'material').length,
    rounding_count: issues.filter(i => i.severity === 'rounding').length,
    inconsistent_amount: money(issues.reduce((s, i) => s + (i.amount || 0), 0)),
    ok: issues.length === 0
  },
  timeline: { start_plan: null, end_plan: '2026-08-31', start_fact: '2026-08-07', end_fact: '2026-08-25' },
  payments: { items: [], total: 0, confirmed: 0, pending: 0, receivables: contractValue, payment_pct: 0, overdue: 0 },
  incomes: { items: [], total: 0, confirmed: 0 }
};

fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
console.log('payload →', outFile);
console.log('прибыль', netProfit, 'маржа', margin + '%', 'расходы без НДС', money(net));
console.log('проверка столбика: ', money(revenueExVat - money(net) - money(tax) - profitBefore));
