'use strict';
/**
 * 06.11.2026: акт / УПД / чек закрывают этап (в т.ч. без номера).
 * Оплата сама по себе не ставит «Закрыто».
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const traffic = require('../src/lib/doc-traffic');

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  PASS', name); }
  catch (e) { fail++; console.log('  FAIL', name, '→', e.message); }
};

console.log('\n=== Закрывающие: акт/УПД/чек ===');

check('УПД без номера = закрывающий', () => {
  assert.strictEqual(traffic.hasClosingDoc({ closing_json: [{ kind: 'УПД' }] }), true);
});
check('Акт без номера = закрывающий', () => {
  assert.strictEqual(traffic.hasClosingDoc({ closing_json: [{ kind: 'Акт', date: '2026-11-05' }] }), true);
});
check('Чек без номера = закрывающий', () => {
  assert.strictEqual(traffic.hasClosingDoc({ closing_json: [{ kind: 'Чек' }] }), true);
});
check('СФ с номером = закрывающий', () => {
  assert.strictEqual(traffic.hasClosingDoc({ closing_json: [{ kind: 'СФ', no: '123' }] }), true);
});
check('пустой closing_json = нет', () => {
  assert.strictEqual(traffic.hasClosingDoc({ closing_json: [] }), false);
});
check('мусор «нет» = нет', () => {
  assert.strictEqual(traffic.hasClosingDoc({ closing_json: [{ kind: 'Иное', no: 'нет' }] }), false);
});
check('sf_received_at = закрывающий', () => {
  assert.strictEqual(traffic.hasClosingDoc({ sf_received_at: '2026-11-01', closing_json: [] }), true);
});
check('Иное без номера = нет', () => {
  assert.strictEqual(traffic.hasClosingDoc({ closing_json: [{ kind: 'Иное' }] }), false);
});

const HUB = fs.readFileSync(path.join(__dirname, '../public/assets/js/doc-hub.js'), 'utf8');
check('фронт: hasClosingDoc есть', () => {
  assert.ok(/function hasClosingDoc\(row\)/.test(HUB));
});
check('фронт: ложное «Закрыто» на [] убрано', () => {
  assert.ok(/hasClosingDoc\(row\)/.test(HUB));
  assert.ok(!/\(row\.pay_status === 'paid' && row\.closing_json && !row\.is_incomplete\)/.test(HUB),
    'старый truthy-массив closing_json ещё в statusLabel');
});
check('фронт: поле «прочее» есть', () => {
  assert.ok(/drOtherNoteField/.test(HUB));
  assert.ok(/Что это за «прочее»/.test(HUB));
});

const REG = fs.readFileSync(path.join(__dirname, '../src/routes/doc-registry.js'), 'utf8');
check('PUT closing_json ставит ops done', () => {
  assert.ok(/patch\.closing_json !== undefined/.test(REG));
  assert.ok(/hasClosingDoc\(trial\)/.test(REG));
  assert.ok(/patch\.ops_status = 'done'/.test(REG));
});
check('mark_paid не закрывает без закрывающих', () => {
  assert.ok(/оплата ≠ закрывающие/.test(REG) || /wait_sf/.test(REG.match(/action === 'mark_paid'[\s\S]{0,800}/)[0]));
  const block = REG.match(/if \(b\.action === 'mark_paid'\)[\s\S]{0,900}/)[0];
  assert.ok(/hasClosingDoc\(doc\)/.test(block));
  assert.ok(!/THEN 'done' ELSE ops_status END/.test(block), 'старый CASE done ещё в mark_paid');
});

console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
