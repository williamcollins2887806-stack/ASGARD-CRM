#!/usr/bin/env node
/**
 * tests/ai-email-analyzer-json.test.js — регрессия D-204.
 *
 * Ловушка, которую закрываем: при обрыве JSON-ответа модели (maxTokens=1024)
 * parseAIResponse молча отдавал fallbackResult() = classification 'other',
 * confidence 0. imap.js считал письмо обработанным (ai_processed_at=NOW()) —
 * и заявка терялась навсегда. В логе AI — 46 строк с confidence=0 (11 уникальных
 * писем); реальные молчаливые потери — #4255/#4256 (ЮНИКС и Завидово, 18.09.2026).
 *
 * Критерий: сбой разбора ДОЛЖЕН быть отличим от честного «other».
 *
 * Запуск: node tests/ai-email-analyzer-json.test.js
 */
'use strict';

const assert = require('assert');
const { parseAIResponse, ANALYSIS_SYSTEM_PROMPT, VALID_CLASSIFICATIONS } = require('../src/services/ai-email-analyzer');
const { stripHtml, bestEmailText } = require('../src/services/email-text');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`\x1b[32mPASS\x1b[0m  ${name}`);
  } catch (e) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  ${name}\n      ${e.message}`);
  }
}

// ── 1. Обрезанный JSON (главный ствол) ────────────────────────────────
test('обрезанный JSON → _parse_failed (НЕ тихий other)', () => {
  const truncated = '{"classification":"direct_request","color":"green","summary":"Пассивация труб';
  const r = parseAIResponse(truncated);
  assert.strictEqual(r._parse_failed, true, '_parse_failed должен быть true');
  assert.strictEqual(r._parse_error, 'json_parse_error');
});

test('пустой ответ модели → _parse_failed', () => {
  const r = parseAIResponse('');
  assert.strictEqual(r._parse_failed, true);
  assert.strictEqual(r._parse_error, 'empty_response');
});

test('null-ответ → _parse_failed', () => {
  const r = parseAIResponse(null);
  assert.strictEqual(r._parse_failed, true);
});

// ── 2. Валидный JSON разбирается ──────────────────────────────────────
test('валидный JSON → direct_request, без _parse_failed', () => {
  const ok = JSON.stringify({
    classification: 'direct_request',
    color: 'green',
    summary: 'Пассивация трубопроводов',
    recommendation: 'Взять в проработку',
    work_type: 'Пассивация',
    confidence: 0.9,
    extracted_customer_name: 'ООО "ЮНИКС"',
    extracted_customer_inn: '7701234567'
  });
  const r = parseAIResponse(ok);
  assert.ok(!r._parse_failed, 'валидный JSON не должен помечаться сбоем');
  assert.strictEqual(r.classification, 'direct_request');
  assert.strictEqual(r.color, 'green');
  assert.strictEqual(r.confidence, 0.9);
  assert.strictEqual(r.extracted_customer_name, 'ООО "ЮНИКС"');
  assert.strictEqual(r.extracted_customer_inn, '7701234567');
});

test('markdown-обёртка ```json ... ``` → парсится', () => {
  const wrapped = '```json\n{"classification":"platform_tender","color":"green","summary":"Тендер","confidence":0.8}\n```';
  const r = parseAIResponse(wrapped);
  assert.ok(!r._parse_failed, 'markdown-обёртка не должна ломать парсинг');
  assert.strictEqual(r.classification, 'platform_tender');
});

test('текст вокруг JSON → вырезается и парсится', () => {
  const noisy = 'Вот результат анализа:\n{"classification":"direct_request","color":"green","summary":"Промывка","confidence":0.7}\nНадеюсь, помог.';
  const r = parseAIResponse(noisy);
  assert.ok(!r._parse_failed, 'текст вокруг JSON не должен ломать парсинг');
  assert.strictEqual(r.classification, 'direct_request');
});

// ── 3. Честный «other» остаётся «other» (не путать со сбоем) ──────────
test('честный other из валидного JSON НЕ помечается _parse_failed', () => {
  const ok = JSON.stringify({ classification: 'other', color: 'red', summary: 'Не наш профиль', confidence: 0.85 });
  const r = parseAIResponse(ok);
  assert.ok(!r._parse_failed, 'честный other — не сбой разбора');
  assert.strictEqual(r.classification, 'other');
  assert.strictEqual(r.confidence, 0.85);
});

// ── 3b. Валидный JSON без валидного класса = сбой разбора (D-204) ─────
test('{} → _parse_failed (missing_classification), а не тихий other', () => {
  const r = parseAIResponse('{}');
  assert.strictEqual(r._parse_failed, true, 'пустой объект — это сбой разбора, а не «не наш профиль»');
  assert.strictEqual(r._parse_error, 'missing_classification');
});

test('{"classification":null} → _parse_failed', () => {
  const r = parseAIResponse('{"classification":null}');
  assert.strictEqual(r._parse_failed, true);
  assert.strictEqual(r._parse_error, 'missing_classification');
});

test('classification вне белого списка → _parse_failed', () => {
  const r = parseAIResponse('{"classification":"status_ok"}');
  assert.strictEqual(r._parse_failed, true);
  assert.strictEqual(r._parse_error, 'missing_classification');
});

test('все классы белого списка проходят без _parse_failed', () => {
  const all = ['direct_request', 'platform_tender', 'tender_invitation', 'addendum_response',
    'commercial_offer', 'information', 'spam', 'personal', 'other'];
  for (const c of all) {
    const r = parseAIResponse(JSON.stringify({ classification: c, confidence: 0.8 }));
    assert.ok(!r._parse_failed, `класс ${c} должен приниматься`);
    assert.strictEqual(r.classification, c);
  }
});

// ── 4. Защита от внутреннего домена в original_sender ─────────────────
test('внутренний домен в original_sender_email вычищается', () => {
  const ok = JSON.stringify({
    classification: 'direct_request',
    original_sender_name: 'Андросов Никита',
    original_sender_email: 'n.androsov@asgard-service.com',
    confidence: 0.8
  });
  const r = parseAIResponse(ok);
  assert.strictEqual(r.original_sender_email, null, 'наш домен не должен попасть как клиент');
  assert.strictEqual(r.original_sender_name, null);
});

test('suggested_pm_name пробрасывается (тема «Для Андросова Никиты»)', () => {
  const ok = JSON.stringify({ classification: 'direct_request', suggested_pm_name: 'Андросов', confidence: 0.8 });
  const r = parseAIResponse(ok);
  assert.strictEqual(r.suggested_pm_name, 'Андросов');
});

// ── 5. Текст письма из HTML (пустой body_text) ────────────────────────
test('stripHtml убирает теги и декодирует сущности', () => {
  const html = '<div>Пассивация&nbsp;труб</div><p>Заказчик &amp; подрядчик</p>';
  const t = stripHtml(html);
  assert.ok(t.includes('Пассивация труб'), 'текст должен остаться');
  assert.ok(!t.includes('<div>'), 'теги должны быть убраны');
  assert.ok(t.includes('&'), 'сущности должны декодироваться');
});

test('bestEmailText: пустой body_text → берём текст из body_html', () => {
  const email = { body_text: '', body_html: '<div>Пассивация трубопроводов компрессоров</div>' };
  const t = bestEmailText(email);
  assert.strictEqual(t, 'Пассивация трубопроводов компрессоров');
});

test('bestEmailText: непустой body_text имеет приоритет', () => {
  const email = { body_text: 'Текст из plain-части письма, он достаточно длинный', body_html: '<div>HTML</div>' };
  assert.strictEqual(bestEmailText(email), 'Текст из plain-части письма, он достаточно длинный');
});

test('bestEmailText: обрывок body_text (<30 симв.) уступает полному HTML', () => {
  const email = { body_text: 'ок', body_html: '<div>Пассивация трубопроводов компрессоров маслосистемы</div>' };
  assert.strictEqual(bestEmailText(email), 'Пассивация трубопроводов компрессоров маслосистемы');
});

// ── 6. Кривая xlsx-ячейка не роняет извлечение ────────────────────────
test('извлечение xlsx-значений устойчиво к объектным ячейкам', () => {
  // Логика повторяет защиту в extractAttachmentTexts (richText/formula/hyperlink).
  const cellValue = (cell) => {
    const raw = cell.value;
    let v = cell.text;
    if (v == null && raw != null) {
      if (typeof raw === 'object') {
        v = raw.text ?? raw.result ?? raw.hyperlink ?? null;
        if (v == null && Array.isArray(raw.richText)) v = raw.richText.map((rt) => rt?.text || '').join('');
      } else v = raw;
    }
    return (v != null && v !== '' && typeof v !== 'object') ? String(v).trim() : '';
  };

  assert.strictEqual(cellValue({ text: null, value: null }), '', 'null-ячейка не должна падать');
  assert.strictEqual(cellValue({ text: 'Объём', value: 'Объём' }), 'Объём');
  assert.strictEqual(cellValue({ text: null, value: { richText: [{ text: 'Пассив' }, { text: 'ация' }] } }), 'Пассивация');
  assert.strictEqual(cellValue({ text: null, value: { formula: 'SUM(A1:A2)', result: 63 } }), '63');
  assert.strictEqual(cellValue({ text: null, value: { text: 'Итого', hyperlink: 'http://x' } }), 'Итого');
  assert.strictEqual(cellValue({ text: undefined, value: 0 }), '0', 'ноль — валидное значение');
});

// ── 7. Рассинхрон промпта и белого списка (D-204) ─────────────────────
test('VALID_CLASSIFICATIONS совпадает с классами из ANALYSIS_SYSTEM_PROMPT', () => {
  // Ловушка: если в промпт добавят класс, а белый список забудут — модель
  // вернёт валидную классификацию, parseAIResponse пометит её missing_classification,
  // и письмо уйдёт в needs_review. Тест ловит это на ревью, а не в проде.
  const m = ANALYSIS_SYSTEM_PROMPT.match(/"classification"\s*:\s*([^\n]+)/);
  assert.ok(m, 'в промпте должна быть строка с "classification"');
  const fromPrompt = m[1]
    .split('|')
    .map(s => s.trim().replace(/,$/, '').trim().replace(/^"|"$/g, '').trim())
    .filter(Boolean)
    .sort();
  const fromList = [...VALID_CLASSIFICATIONS].sort();
  assert.deepStrictEqual(fromList, fromPrompt,
    `белый список и промпт разошлись.\n  список: ${fromList.join(', ')}\n  промпт:  ${fromPrompt.join(', ')}`);
});

// ── Итог ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
