/**
 * Регрессия: пересчитать прибыль по ВСЕМ работам с расходами — старой и новой
 * моделью, показать где цифры изменились и почему. Ловит случаи, когда правка
 * «одной строки» тихо меняет отчёт другой работы.
 *
 * Запуск: node tests/manual/regression-all-works.js <works.json>
 */
const fs = require('fs');
const vatCalc = require('../../src/services/vat-calc');
const expenseTax = require('../../src/services/expense-tax');

const works = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const money = (v) => Math.round(v * 100) / 100;
const taxRate = 55, incomeTaxRate = 25;

function oldModel(expenses, contractValue, vatPct) {
  // Точная копия расчёта ДО V439: 55% от amount как есть, вычет по vat_amount.
  let total = 0, vatDed = 0, tax = 0;
  for (const e of expenses) {
    const amt = parseFloat(e.amount) || 0;
    total += amt;
    vatDed += expenseTax.calcVatDeductible(e);
    if (expenseTax.isTaxableExpense(e)) {
      tax += Math.round(amt * taxRate / 100 * 100) / 100;
    }
  }
  const vatCharged = money(contractValue * vatPct / (100 + vatPct));
  const rev = money(contractValue - vatCharged);
  const withTax = money(total + tax);
  const before = money(rev - withTax + vatDed);
  const incomeTax = before > 0 ? money(before * incomeTaxRate / 100) : 0;
  return { rev, total: money(total), vatDed: money(vatDed), tax: money(tax), before, net: money(before - incomeTax), incomeTax };
}

function newModel(expenses, contractValue, vatPct) {
  let net = 0, vatDed = 0, tax = 0, gross = 0;
  for (const e of expenses) {
    const r = vatCalc.resolveExpense(e);
    gross += r.amount; net += r.net; vatDed += r.vat;
    tax += expenseTax.calcTaxBurden({ ...e, amount: r.net, vat_amount: 0 }, taxRate);
  }
  const vatCharged = money(contractValue * vatPct / (100 + vatPct));
  const rev = money(contractValue - vatCharged);
  const withTax = money(money(net) + money(tax));
  const before = money(rev - withTax);
  const incomeTax = before > 0 ? money(before * incomeTaxRate / 100) : 0;
  return { rev, net: money(net), gross: money(gross), vatDed: money(vatDed), tax: money(tax), before };
}

function newModel2(expenses, contractValue, vatPct) {
  const r = newModel(expenses, contractValue, vatPct);
  const incomeTax = r.before > 0 ? money(r.before * incomeTaxRate / 100) : 0;
  return { ...r, incomeTax, profitNet: money(r.before - incomeTax) };
}

console.log('work | расходы_старо | расходы_ново | Δ расходов | прибыль_старо | прибыль_ново | Δ прибыли | строк_битых');
console.log('-----|---------------|--------------|------------|---------------|--------------|-----------|-------------');
let changed = 0;
for (const w of works) {
  const exps = w.expenses || [];
  if (!exps.length) continue;
  const o = oldModel(exps, w.contract_value, w.vat_pct || 22);
  const n = newModel2(exps, w.contract_value, w.vat_pct || 22);
  const bad = exps.filter(e => vatCalc.resolveExpense(e).inconsistent).length;
  const dNet = money(n.profitNet - o.net);
  if (Math.abs(dNet) > 0.5 || bad) {
    changed++;
    console.log(
      String(w.id).padEnd(4), '|',
      String(o.total).padStart(13), '|',
      String(n.net).padStart(12), '|',
      String(money(n.net - o.total)).padStart(10), '|',
      String(o.net).padStart(13), '|',
      String(n.profitNet).padStart(12), '|',
      String(dNet).padStart(9), '|',
      String(bad).padStart(11)
    );
  }
}
console.log('');
console.log('Работ с изменениями:', changed);
