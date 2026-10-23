'use strict';
/**
 * D-347: тесты политики повторов ИИ.
 * Смысл: инфраструктурный сбой (нет денег / 5xx / таймаут) НЕ убивает письмо.
 * Реальный инцидент 23.10.2026: 4 счёта потеряны из-за пустого баланса.
 */
const assert = require('assert');
const p = require('../src/services/ai-retry-policy');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); fail++; }
}

console.log('=== 1. Классификация ошибок ===');
const infraCodes = ['provider_error', 'empty_response', 'timeout', 'network_error',
  'rate_limited', 'no_credit', 'quota_exceeded', 'auth_error', 'sanitize_error'];
for (const code of infraCodes) {
  t(`${code} → infra`, () => assert.strictEqual(p.classifyAiError(code), 'infra'));
}
const contentCodes = ['json_parse_error', 'missing_classification', 'truncated', 'invalid_schema'];
for (const code of contentCodes) {
  t(`${code} → content`, () => assert.strictEqual(p.classifyAiError(code), 'content'));
}
t('неизвестный код → infra (безопаснее: не теряем письмо)', () => {
  assert.strictEqual(p.classifyAiError('что-то-новое'), 'infra');
});
t('пустой код → infra', () => assert.strictEqual(p.classifyAiError(''), 'infra'));

console.log('\n=== 2. canRetry: инфраструктурный сбой НЕ тратит попытки ===');
t('infra, попыток 3 (лимит исчерпан) → ВСЁ РАВНО берём (это инцидент 23.10)', () => {
  const row = { ai_attempts: 3, ai_last_error_class: 'infra', email_date: new Date() };
  assert.strictEqual(p.canRetry(row, 3), true, 'письмо должно остаться в очереди');
});
t('infra, 10 сбоев → берём (счётчик инфра не ограничивает)', () => {
  const row = { ai_attempts: 0, ai_infra_failures: 10, ai_last_error_class: 'infra', email_date: new Date() };
  assert.strictEqual(p.canRetry(row, 3), true);
});
t('infra, письмо старше 7 суток → НЕ берём (потолок по возрасту)', () => {
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  const row = { ai_attempts: 0, ai_last_error_class: 'infra', email_date: old };
  assert.strictEqual(p.canRetry(row, 3), false);
});
t('infra, письмо 6 суток → берём', () => {
  const recent = new Date(Date.now() - 6 * 24 * 3600 * 1000);
  const row = { ai_attempts: 0, ai_last_error_class: 'infra', email_date: recent };
  assert.strictEqual(p.canRetry(row, 3), true);
});

console.log('\n=== 3. canRetry: контентный сбой тратит попытки ===');
t('content, попыток 1 → берём', () => {
  assert.strictEqual(p.canRetry({ ai_attempts: 1, ai_last_error_class: 'content', email_date: new Date() }, 3), true);
});
t('content, попыток 3 → НЕ берём (кривое письмо нельзя крутить вечно)', () => {
  assert.strictEqual(p.canRetry({ ai_attempts: 3, ai_last_error_class: 'content', email_date: new Date() }, 3), false);
});

console.log('\n=== 4. Человек взял письмо → автоповторы прекращены ===');
t('ai_needs_manual=true → НЕ берём (даже infra)', () => {
  assert.strictEqual(p.canRetry({ ai_attempts: 0, ai_last_error_class: 'infra', ai_needs_manual: true, email_date: new Date() }, 3), false);
});
t('ai_needs_manual=false → берём', () => {
  assert.strictEqual(p.canRetry({ ai_attempts: 0, ai_last_error_class: 'infra', ai_needs_manual: false, email_date: new Date() }, 3), true);
});

console.log('\n=== 5. Краевые случаи ===');
t('null → false (не падаем)', () => assert.strictEqual(p.canRetry(null, 3), false));
t('нет email_date у infra → берём (нет данных о возрасте)', () => {
  assert.strictEqual(p.canRetry({ ai_attempts: 0, ai_last_error_class: 'infra' }, 3), true);
});
t('нет ai_last_error_class → считаем infra', () => {
  assert.strictEqual(p.canRetry({ ai_attempts: 3, email_date: new Date() }, 3), true);
});

console.log('\n=== 6. Потолок по возрасту настраивается ===');
t('INFRA_MAX_AGE_HOURS = 168 (7 суток) по умолчанию', () => {
  assert.strictEqual(p.INFRA_MAX_AGE_HOURS, 168);
});

console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
if (fail) process.exitCode = 1;
