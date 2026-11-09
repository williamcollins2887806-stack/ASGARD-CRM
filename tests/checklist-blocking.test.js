'use strict';

/**
 * Блокирующий код ошибки при незаполненном чек-листе.
 *
 * ── Зачем ─────────────────────────────────────────────────────────────────
 * Верификатор 09.11.2026 провёл мутацию: переименовал
 * `code: 'CHECKLIST_INCOMPLETE'` — тесты остались зелёными, потому что этого
 * пути никто не покрывал. А именно этот код фронт показывает пользователю как
 * «Заполните обязательные вопросы чек-листа». Сломать его молча нельзя.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + ' — ' + e.message); }
}

const pmDuty = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'pm-duty.js'), 'utf8');
const checklist = require(path.join(__dirname, '..', 'src', 'services', 'analysis-checklist.js'));

check('эндпоинт отдаёт код CHECKLIST_INCOMPLETE', () => {
  assert.ok(/code:\s*'CHECKLIST_INCOMPLETE'/.test(pmDuty),
    'код не найден — фронт перестанет понимать, чего не хватает');
});

check('ответ содержит список отсутствующих вопросов', () => {
  const block = pmDuty.slice(pmDuty.indexOf("code: 'CHECKLIST_INCOMPLETE'") - 400);
  assert.ok(/missing:\s*v\.missing/.test(block), 'нет поля missing в ответе');
});

check('проверка выполняется до сохранения ответов', () => {
  const idx = pmDuty.indexOf("code: 'CHECKLIST_INCOMPLETE'");
  const insert = pmDuty.indexOf('INSERT INTO tender_analysis_checklists', idx);
  assert.ok(idx > 0 && insert > idx, 'сохранение идёт раньше проверки — данные пройдут в обход');
});

check('validateAnswers реально находит незаполненные', () => {
  // Сигнатура: template — МАССИВ вопросов, answers — { id: строковое значение }.
  const template = [
    { id: 'q1', required: true, text: 'Сроки?' },
    { id: 'q2', required: true, text: 'Объёмы?' }
  ];
  const bad = checklist.validateAnswers(template, {});
  assert.strictEqual(bad.ok, false, 'пустые ответы признаны полными');
  assert.ok(Array.isArray(bad.missing) && bad.missing.length === 2, 'перечислены не все пропуски');

  const good = checklist.validateAnswers(template, { q1: '30 дней', q2: 'по ведомости' });
  assert.strictEqual(good.ok, true, 'заполненные ответы отвергнуты');

  const partial = checklist.validateAnswers(template, { q1: '30 дней' });
  assert.strictEqual(partial.ok, false, 'частичное заполнение признано полным');
  assert.strictEqual(partial.missing.length, 1, 'не указан один пропуск');
});

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
