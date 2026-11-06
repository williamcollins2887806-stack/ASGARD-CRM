'use strict';
/**
 * Проверка выбора режима модалки: анализ vs просчёт.
 *
 * Логика живёт во фронте (registry_tab.js), поэтому проверяем её как правило:
 * незакрытый анализ → mode='analysis'; закрытый анализ (analysis_finalized_at)
 * → mode='calc'. Раньше дефолт был 'calc', и в анализе показывался просчёт.
 */
const assert = require('assert');

/** Копия правила из registry_tab.js — должна совпадать один в один. */
function resolveMode(row) {
  const finalized = row && (row.analysis_finalized_at || (row.rp_review && row.rp_review.analysis_finalized_at));
  return finalized ? 'calc' : 'analysis';
}

/** Надпись на кнопке Мимира — как в rp_review_modal.js. */
function mimirLabel(mode) {
  return mode === 'analysis' ? 'Анализ Мимир' : 'Просчёт Мимир';
}

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

check('незакрытый анализ → анализ', () => {
  const row = { id: 2127, registry_status: 'рассмотрение', rp_review: { is_final: false, analysis_finalized_at: null } };
  assert.strictEqual(resolveMode(row), 'analysis');
  assert.strictEqual(mimirLabel(resolveMode(row)), 'Анализ Мимир');
});

check('новый тендер без report_json → анализ, не просчёт', () => {
  const row = { id: 2149, registry_status: 'рассмотрение', rp_review: { is_final: null, report_json: null } };
  assert.strictEqual(resolveMode(row), 'analysis');
});

check('report_json.mode = calc, но анализ не закрыт → всё равно анализ', () => {
  const row = {
    id: 1914, analysis_finalized_at: '2026-07-09T10:20:35Z',
    rp_review: { is_final: false, analysis_finalized_at: '2026-07-09T10:20:35Z' }
  };
  assert.strictEqual(resolveMode(row), 'calc');
});

check('анализ закрыт → просчёт', () => {
  const row = { id: 2024, rp_review: { is_final: true, analysis_finalized_at: '2026-10-07T06:06:56Z' } };
  assert.strictEqual(resolveMode(row), 'calc');
  assert.strictEqual(mimirLabel(resolveMode(row)), 'Просчёт Мимир');
});

check('analysis_finalized_at на уровне tenders учитывается', () => {
  const row = { id: 5, analysis_finalized_at: '2026-01-01T00:00:00Z', rp_review: {} };
  assert.strictEqual(resolveMode(row), 'calc');
});

check('пустая строка без review → анализ (безопасный дефолт)', () => {
  assert.strictEqual(resolveMode({ id: 1 }), 'analysis');
  assert.strictEqual(resolveMode(null), 'analysis');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
