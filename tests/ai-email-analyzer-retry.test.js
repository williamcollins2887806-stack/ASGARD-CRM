#!/usr/bin/env node
/**
 * tests/ai-email-analyzer-retry.test.js — регрессия D-204 на retry-цикл analyzeEmail.
 *
 * Ствол: reasoning-модель deepseek-v4-pro при maxTokens=1024 отдаёт весь бюджет
 * в reasoning_tokens, content пустой, stopReason='length'. Без retry письмо
 * уходило в тихий 'other' и терялось.
 *
 * Здесь проверяем ПОВЕДЕНИЕ цикла (ad-hoc-проверка стала частью гейта):
 *  1) обрыв на первом вызове → повтор с удвоенным бюджетом → валидный результат;
 *  2) обрыв на всех вызовах → бюджет упирается в ceiling, попытки ограничены,
 *     результат помечен _parse_failed/needs_review (письмо не потеряется молча);
 *  3) успех с первого раза → повторного вызова НЕТ.
 *
 * ai-provider и extractAttachmentTexts подменяются: сети и БД нет.
 *
 * Запуск: node -r dotenv/config tests/ai-email-analyzer-retry.test.js
 */
'use strict';

const assert = require('assert');

const providerPath = require.resolve('../src/services/ai-provider');
const analyzerPath = require.resolve('../src/services/ai-email-analyzer');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`\x1b[32mPASS\x1b[0m  ${name}`); })
    .catch((e) => { failed++; console.log(`\x1b[31mFAIL\x1b[0m  ${name}\n      ${e.message}`); });
}

function installProvider(script) {
  const calls = [];
  const provider = require(providerPath);
  provider.complete = async (opts) => {
    calls.push(opts.maxTokens);
    const reply = script(calls.length - 1);
    return {
      text: reply.text, stopReason: reply.stopReason,
      model: 'deepseek/deepseek-v4-pro', provider: 'openai',
      usage: { inputTokens: 100, outputTokens: 10 }, durationMs: 1
    };
  };
  provider.completeAnalytics = provider.complete;
  provider.getWorkloadData = async () => ({ total: 0 });
  return calls;
}

const validJson = JSON.stringify({
  classification: 'direct_request', color: 'green',
  summary: 'Пассивация трубопроводов', recommendation: 'Взять в проработку',
  confidence: 0.9
});

async function runAnalyze() {
  // Свежий require анализатора на каждый сценарий — чтобы не тянуть старое состояние.
  delete require.cache[analyzerPath];
  const analyzer = require(analyzerPath);
  analyzer.getWorkloadData = async () => ({ total: 0 });
  return analyzer.analyzeEmail({
    emailId: 424242,
    subject: 'Fwd: Пассивация трубопровод',
    bodyText: 'Пересылаю запрос на пассивацию трубопроводов компрессоров.',
    fromEmail: 'n.androsov@asgard-service.com',
    fromName: 'Андросов Никита',
    attachmentNames: []
  });
}

(async () => {
  // ── 1. Обрыв на первом вызове → повтор и успех ───────────────────────
  let calls = installProvider((i) => i === 0
    ? { text: '', stopReason: 'length' }
    : { text: validJson, stopReason: 'stop' });
  await test('обрыв → повтор с удвоенным бюджетом → direct_request', async () => {
    const res = await runAnalyze();
    assert.deepStrictEqual(calls, [4096, 8192], `бюджеты: ${JSON.stringify(calls)}`);
    assert.strictEqual(res.classification, 'direct_request');
    assert.ok(!res._parse_failed, 'успешный повтор не должен помечаться сбоем');
    assert.strictEqual(res._raw.attempts, 2);
  });

  // ── 2. Обрыв всегда → конечное число попыток, _parse_failed ──────────
  calls = installProvider(() => ({ text: '', stopReason: 'length' }));
  await test('постоянный обрыв → попытки ограничены, _parse_failed + needs_review', async () => {
    const res = await runAnalyze();
    assert.strictEqual(calls.length, 3, `попыток должно быть 3, получено ${calls.length}`);
    assert.deepStrictEqual(calls, [4096, 8192, 16384], `бюджеты: ${JSON.stringify(calls)}`);
    assert.ok(!calls.includes(32768), 'бюджет не должен превышать ceiling');
    assert.strictEqual(res._parse_failed, true);
    assert.strictEqual(res.needs_review, true);
    assert.strictEqual(res.confidence, 0);
  });

  // ── 3. Валидный JSON без класса → _parse_failed (после retry) ────────
  calls = installProvider(() => ({ text: '{}', stopReason: 'stop' }));
  await test('валидный JSON без класса → retry → _parse_failed (не тихий other)', async () => {
    const res = await runAnalyze();
    assert.strictEqual(calls.length, 3, 'пустой JSON должен триггерить retry');
    assert.strictEqual(res._parse_failed, true);
    assert.strictEqual(res._parse_error, 'missing_classification');
    assert.strictEqual(res.needs_review, true);
  });

  // ── 4. Успех с первого раза → повторного вызова нет ──────────────────
  calls = installProvider(() => ({ text: validJson, stopReason: 'stop' }));
  await test('успех с первого раза → ровно один вызов', async () => {
    const res = await runAnalyze();
    assert.deepStrictEqual(calls, [4096]);
    assert.strictEqual(res.classification, 'direct_request');
    assert.strictEqual(res._raw.attempts, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
