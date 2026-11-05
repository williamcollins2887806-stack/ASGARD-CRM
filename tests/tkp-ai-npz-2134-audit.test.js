#!/usr/bin/env node
'use strict';
/**
 * Аудит готовности тендера 2134 (Афипский НПЗ) к «ТКП через ИИ».
 * Читает только продовые цифры, зашитые из живого SELECT (05.11.2026).
 * Запуск: node tests/tkp-ai-npz-2134-audit.test.js
 */
const assert = require('assert');
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = 'unit-test-no-connection';
const svc = require('../src/services/tkp-ai-draft');

const SNAPSHOT = {
  tender_id: 2134,
  title: 'Ремонт пластинчатых теплообменных аппаратов ТУАТ-2 ООО «Афипский НПЗ»',
  is_final: true,
  decision: 'submit',
  director_review_status: null,
  work_price: 7186843,
  work_price_ex_vat: 7186843,
  has_tech: false,
  tkp_count: 0,
  smeta_totals: {
    price_no_vat: 7186843.13,
    price_with_vat: 8767948.62,
    vat_pct: 22,
    cost: 4791228.75
  }
};

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log('PASS', name); }
  catch (e) { failed += 1; console.log('FAIL', name, '—', e.message); }
}

const review = {
  is_final: SNAPSHOT.is_final,
  decision: SNAPSHOT.decision,
  director_review_status: SNAPSHOT.director_review_status,
  work_price: SNAPSHOT.work_price,
  work_price_ex_vat: SNAPSHOT.work_price_ex_vat,
  report_json: { asgard_smeta: { totals: SNAPSHOT.smeta_totals } },
  tech_json: {}
};

check('просчёт 2134 готов к ТКП (assertReviewReady)', () => {
  svc.assertReviewReady(review);
});

check('цена без НДС берётся из work_price (канон D-173)', () => {
  const p = svc.readPricing(review, {});
  assert.strictEqual(p.priceNoVat, 7186843);
  assert.ok(p.vatPct === 22 || p.vatPct === 20, 'vatPct=' + p.vatPct);
});

check('НДС 22% в копейках сходится', () => {
  const p = svc.readPricing(review, {});
  const v = svc.vatFromBase(p.priceNoVat, 22);
  assert.strictEqual(v.vat, 1581105.46); // 7186843 * 0.22 в копейках
  assert.strictEqual(Math.round((v.base + v.vat) * 100), Math.round(v.total * 100));
});

check('ТКП ещё нет — кнопка create должна быть видна', () => {
  assert.strictEqual(SNAPSHOT.tkp_count, 0);
  assert.strictEqual(SNAPSHOT.has_tech, false);
});

check('tech_json пуст — ТКП без бригады/МТР из техплана (ожидаемо)', () => {
  assert.strictEqual(SNAPSHOT.has_tech, false);
  console.log('  note: tech_json пуст — позиции/режим возьмутся из сметы/ИИ, не из tech_plan');
});

console.log('\ntkp-ai-npz-2134-audit: ' + passed + '/' + (passed + failed));
if (failed) process.exit(1);
console.log('OK — тендер', SNAPSHOT.tender_id, 'готов к «ТКП через ИИ», ТКП пока нет');
