'use strict';
/**
 * D-339: тесты НДС. Проверяем «без НДС» и невозможный НДС.
 * Реальные случаи с прода: Ozon 0212923137-0055 (79 905) и -0054 (13 726).
 */
const assert = require('assert');
const ai = require('../src/services/invoice-ai-extract');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); fail++; }
}

console.log('=== 1. validate(): невозможный НДС отбрасывается ===');
t('vat == gross, net == gross → НДС нет (случай Ozon)', () => {
  const r = ai.validate({
    amount_gross: 79905, amount_net: 79905, vat_amount: 79905,
    vat_rate: 22, has_vat: true, lines: []
  });
  assert.strictEqual(r.data.vat_amount, 0, 'НДС должен обнулиться');
  assert.strictEqual(r.data.has_vat, false, 'has_vat должен стать false');
  assert.strictEqual(r.data.amount_net, 79905, 'нетто = сумме');
  assert.ok(r.warnings.includes('vat_impossible_dropped'));
});

t('vat > gross → отбрасывается', () => {
  const r = ai.validate({ amount_gross: 13726, amount_net: 13726, vat_amount: 13726, lines: [] });
  assert.strictEqual(r.data.vat_amount, 0);
});

t('нормальный НДС 22% НЕ трогается', () => {
  const r = ai.validate({ amount_gross: 122, amount_net: 100, vat_amount: 22, vat_rate: 22, lines: [] });
  assert.strictEqual(r.data.vat_amount, 22);
  assert.strictEqual(r.data.has_vat, true);
  assert.strictEqual(r.data.amount_net, 100);
});

t('НДС 5% (льготная ставка) НЕ трогается', () => {
  const r = ai.validate({ amount_gross: 105, amount_net: 100, vat_amount: 5, vat_rate: 5, lines: [] });
  assert.strictEqual(r.data.vat_amount, 5);
});

t('НДС ≈ половина суммы — на грани, но остаётся', () => {
  // Экстремальная, но возможная ситуация: проверим, что порог не режет норму.
  const r = ai.validate({ amount_gross: 200, amount_net: 100, vat_amount: 100, vat_rate: 100, lines: [] });
  // 100/200 = ровно половина → порог `> 0.5` не срабатывает, но ставка 100 недопустима
  assert.strictEqual(r.data.vat_amount, 100);
});

console.log('\n=== 2. mergeWithRegex(): ИИ-ноль «без НДС» побеждает регулярки ===');
t('ИИ: без НДС; регулярки насчитали vat=gross → берём 0', () => {
  const aiData = {
    amount_gross: 79905, amount_net: 79905, vat_amount: 0, has_vat: false,
    invoice_number: '0212923137-0055', counterparty_name: 'Интернет Решения, ООО',
    supplier_name: 'Интернет Решения, ООО', supplier_inn: '7704217370',
    lines: []
  };
  const rx = {
    amount_gross: 79905, amount_net: 79905, vat_amount: 79905, has_vat: true,
    invoice_number: '0212923137-0055', counterparty_name: 'ООО "Интернет Решения"',
    inn: '7704217370', lines: []
  };
  const { parsed, conflicts } = ai.mergeWithRegex(aiData, rx);
  assert.strictEqual(parsed.vat_amount, 0, 'НДС должен быть 0, а не 79 905');
  assert.strictEqual(parsed.has_vat, false);
  assert.ok(conflicts.includes('vat_no_vat_by_ai'));
});

t('ИИ: обычный НДС 22 → регулярки не мешают', () => {
  const aiData = {
    amount_gross: 12200, amount_net: 10000, vat_amount: 2200, has_vat: true, vat_rate: 22,
    invoice_number: '1', counterparty_name: 'ООО Тест', supplier_inn: '7701234567', lines: []
  };
  const rx = { amount_gross: 12200, amount_net: 10000, vat_amount: 2200, has_vat: true, inn: '7701234567', lines: [] };
  const { parsed } = ai.mergeWithRegex(aiData, rx);
  assert.strictEqual(parsed.vat_amount, 2200);
  assert.strictEqual(parsed.has_vat, true);
});

t('ИИ не дал НДС вовсе → берём из регулярок (фолбэк жив)', () => {
  const aiData = {
    amount_gross: 12200, amount_net: 10000, vat_amount: null, has_vat: null,
    invoice_number: '1', counterparty_name: 'ООО Тест', lines: []
  };
  const rx = { amount_gross: 12200, amount_net: 10000, vat_amount: 2200, has_vat: true, inn: '7701234567', lines: [] };
  const { parsed } = ai.mergeWithRegex(aiData, rx);
  assert.strictEqual(parsed.vat_amount, 2200, 'фолбэк на регулярки должен работать');
});

t('ИИ: vat=0 и net==gross, но has_vat не указан → всё равно без НДС', () => {
  const aiData = {
    amount_gross: 5000, amount_net: 5000, vat_amount: 0, has_vat: null,
    invoice_number: '7', counterparty_name: 'ИП Тест', lines: []
  };
  const rx = { amount_gross: 5000, amount_net: 5000, vat_amount: 5000, has_vat: true, inn: null, lines: [] };
  const { parsed } = ai.mergeWithRegex(aiData, rx);
  assert.strictEqual(parsed.vat_amount, 0);
});

console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
if (fail) process.exitCode = 1;
