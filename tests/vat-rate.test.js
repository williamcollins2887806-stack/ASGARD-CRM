/**
 * V412: ставка НДС — 22/20/10/7/5/0 (заказчик 19.10.2026: «НДС не только 22%»).
 */
const ai = require('../src/services/invoice-ai-extract');
let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== Ставка от ИИ сохраняется (все допустимые) ===');
for (const rate of [22, 20, 10, 7, 5, 0]) {
  const v = ai.validate(ai.normalize({ amount_gross: 1000, amount_net: rate ? 1000 / (1 + rate / 100) : 1000, vat_rate: rate, lines: [] }));
  ok(Number(v.data.vat_rate) === rate, rate + '% сохранена (' + v.data.vat_rate + ')');
}

console.log('\n=== Вывод ставки из сумм (модель не указала) ===');
for (const [rate, gross] of [[22, 1220], [20, 1200], [10, 1100], [5, 1050]]) {
  const net = Math.round(gross / (1 + rate / 100) * 100) / 100;
  const v = ai.validate(ai.normalize({ amount_gross: gross, amount_net: net, vat_amount: Math.round((gross - net) * 100) / 100, lines: [] }));
  ok(Number(v.data.vat_rate) === rate, `${rate}% выведена из ${gross}/${net} → ${v.data.vat_rate}`);
}

console.log('\n=== Недопустимая ставка отбрасывается ===');
const bad = ai.validate(ai.normalize({ amount_gross: 1000, vat_rate: 33, lines: [] }));
ok(bad.data.vat_rate == null, '33% отброшена (' + bad.data.vat_rate + ')');
ok(bad.warnings.includes('vat_rate_unknown'), 'предупреждение vat_rate_unknown');

console.log('\n=== «Без НДС» — ставки нет (это НЕ 0%) ===');
const noVat = ai.validate(ai.normalize({ amount_gross: 1000, amount_net: 1000, vat_amount: 0, has_vat: false, vat_rate: 22, lines: [] }));
ok(noVat.data.vat_rate == null, 'ставка снята при has_vat=false (' + noVat.data.vat_rate + ')');
ok(noVat.data.has_vat === false, 'has_vat=false');

console.log('\n=== Нетто выводится из суммы и НДС ===');
const n = ai.validate(ai.normalize({ amount_gross: 1220, vat_amount: 220, lines: [] }));
ok(Math.abs(n.data.amount_net - 1000) < 0.01, 'нетто = 1220 − 220 = ' + n.data.amount_net);

console.log('\n────────────────────────────────────────');
console.log('ИТОГ НДС-ставок: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
