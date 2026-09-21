#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * tests/ai-email-pipeline-guards.test.js — регрессия D-204 на порядок/защиты конвейера писем.
 *
 * Появилось из находок независимого L3-верификатора (20.09.2026). Каждая проверка
 * фиксирует уже сделанную правку, чтобы её нельзя было «откатить молча»:
 *
 *  C. `analyzeOneEmail` не должен фиксировать `ai_processed_at` раньше, чем создана
 *     заявка. Иначе сбой `createPreTenderFromEmail` оставляет письмо «обработанным»
 *     без заявки — ровно класс D-204, только с другой стороны. Плюс сбой создания
 *     заявки обязан пробрасываться (а не глотаться в console.error), чтобы сработала
 *     catch-ветка со счётчиком попыток.
 *  E. Лимит попыток обязан эскалироваться уведомлением человеку в ОБЕИХ ветках
 *     (_parse_failed и catch), иначе письмо молча выпадает из выборки — «чёрная дыра».
 *  H. `IMAP_DISABLED=1` обязан гасить и сортировщик папок (он ходит в IMAP каждые 5 мин),
 *     а не только imap.init()/startPersonalPolling().
 *  B. Оба потребителя `analyzeEmail` (imap.js и routes/inbox_applications_ai.js) должны
 *     брать текст письма через общий util `bestEmailText`, а не сырой `body_text`:
 *     у HTML-only писем (Яндекс/Fwd) он пуст — из-за этого и терялись #4255/#4256.
 *
 * Проверки статические (по исходникам) + поведенческие (функции email-text).
 * Запуск: node -r dotenv/config tests/ai-email-pipeline-guards.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const lineIndexOf = (src, needle) => src.split(/\r?\n/).findIndex((l) => l.includes(needle));

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

const imap = read('src/services/imap.js');
const index = read('src/index.js');
const route = read('src/routes/inbox_applications_ai.js');

// ─────────────────────────────────────────────────────────────────────────────
// C. Порядок фиксации ai_processed_at
// ─────────────────────────────────────────────────────────────────────────────

test('C1 создание заявки идёт ДО фиксации ai_processed_at', () => {
  const create = lineIndexOf(imap, 'createPreTenderFromEmail(emailId');
  const fix = lineIndexOf(imap, 'step 4: AI-разбор зафиксирован');
  assert.ok(create > 0, 'не найден вызов createPreTenderFromEmail');
  assert.ok(fix > 0, 'не найдена точка фиксации (step 4)');
  assert.ok(create < fix, `фиксация (${fix}) должна быть ПОСЛЕ создания заявки (${create})`);
});

test('C2 сбой создания заявки пробрасывается, а не глотается', () => {
  const thrown = lineIndexOf(imap, 'pre_tender creation failed');
  assert.ok(thrown > 0, 'сбой создания заявки должен бросать ошибку наверх (счётчик попыток + уведомление)');
  const fix = lineIndexOf(imap, 'step 4: AI-разбор зафиксирован');
  assert.ok(thrown < fix, 'throw обязан быть до фиксации, иначе письмо снова «обработано» без заявки');
});

test('C3 updateEmailAiClassification не вызывается до создания заявки', () => {
  const create = lineIndexOf(imap, 'createPreTenderFromEmail(emailId');
  // Вызовы функции (не её объявление) — строки с завершающей `(` и без `async function`.
  const callLines = imap
    .split(/\r?\n/)
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => l.includes('updateEmailAiClassification(') && !l.includes('async function'))
    .map(({ n }) => n);
  assert.ok(callLines.length >= 1, 'не найден вызов updateEmailAiClassification');
  for (const n of callLines) {
    assert.ok(n > create, `вызов на строке ${n} должен быть ПОСЛЕ создания заявки (${create})`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Эскалация лимита попыток в обеих ветках
// ─────────────────────────────────────────────────────────────────────────────

test('E1 уведомление об исчерпании попыток есть и в catch-ветке', () => {
  assert.ok(
    /исчерпал попытки/.test(imap),
    'catch-ветка обязана уведомлять руководство при достижении AI_MAX_ATTEMPTS (иначе «чёрная дыра»)'
  );
  assert.ok(
    /error-branch needs_review notify failed/.test(imap),
    'нужен лог сбоя самого уведомления'
  );
});

test('E2 обе ветки эскалируют на AI_MAX_ATTEMPTS', () => {
  const hits = imap.match(/>= AI_MAX_ATTEMPTS/g) || [];
  assert.ok(hits.length >= 2, `ожидалось >=2 эскалации (parse_failed + catch), найдено ${hits.length}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// H. IMAP_DISABLED гасит и сортировщик папок
// ─────────────────────────────────────────────────────────────────────────────

test('H1 folder sorter закрыт guard-ом IMAP_DISABLED', () => {
  const guard = index.indexOf("IMAP_DISABLED === '1'");
  const sorter = index.indexOf('email-folder-sorter');
  assert.ok(guard > 0, 'в index.js нет guard-а IMAP_DISABLED для сортировщика');
  assert.ok(sorter > guard, 'initCrmFolders должен быть внутри else-ветки guard-а');
  assert.ok(/folder sorter не запускается/.test(index), 'нужен явный лог «не запускается» для стенда');
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Оба потребителя analyzeEmail берут текст через bestEmailText
// ─────────────────────────────────────────────────────────────────────────────

test('B1 routes/inbox_applications_ai.js использует bestEmailText, а не сырой body_text', () => {
  assert.ok(
    /bodyText:\s*bestEmailText\(email\)/.test(route),
    'второй потребитель analyzeEmail обязан брать текст через bestEmailText (HTML-only письма)'
  );
  assert.ok(
    /require\('\.\.\/services\/email-text'\)/.test(route),
    'нет импорта общего util email-text'
  );
});

test('B2 в imap.js analyzeEmail вызывается с общим util, а не с сырым body_text', () => {
  assert.ok(
    /const effectiveBodyText = bestEmailText\(email\)/.test(imap),
    'imap.js должен вычислять текст письма через bestEmailText(email)'
  );
  assert.ok(
    /bodyText:\s*effectiveBodyText/.test(imap),
    'imap.js должен передавать эффективный текст (не сырой body_text)'
  );
});

test('B2b ни один потребитель в imap.js не передаёт сырой email.body_text', () => {
  const bad = imap
    .split(/\r?\n/)
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /bodyText:\s*email\.body_text/.test(l))
    .map(({ n }) => n);
  assert.deepStrictEqual(bad, [], `сырой body_text остался на строках: ${bad.join(', ')}`);
});

test('B3 bestEmailText действительно поднимает текст из HTML при пустом body_text', () => {
  const { bestEmailText } = require('../src/services/email-text');
  const html = '<div>Пассивация трубопроводов компрессоров</div><p>Объём: 12 узлов</p>';
  const got = bestEmailText({ body_text: '   ', body_html: html });
  assert.ok(/Пассивация трубопроводов/.test(got), `HTML не сконвертирован: ${got}`);
  assert.ok(!/</.test(got), `в тексте остались теги: ${got}`);
});

test('B4 непустой body_text имеет приоритет над HTML', () => {
  const { bestEmailText } = require('../src/services/email-text');
  const plain = 'Обычное текстовое письмо с достаточной длиной тела.';
  const got = bestEmailText({ body_text: plain, body_html: '<div>ДРУГОЕ</div>' });
  assert.strictEqual(got, plain);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
