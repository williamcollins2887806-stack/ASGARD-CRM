'use strict';
/**
 * Склейка документов для промпта: ВОР и ТЗ не должны теряться.
 *
 * Дефект 06.11: на тендере 2133 было 553 тыс. символов в 22 документах,
 * промпт обрезался до 60 тыс., и обрезанным оказывался именно ВОР —
 * модель честно отвечала «перечень оборудования обрезан, объёмы не выводимы»
 * и возвращала 0 позиций.
 *
 * Проверено на провайдере: вход до 300 тыс. символов проходит без ошибки,
 * поэтому лимит поднят. Тесты фиксируют порядок, доли и пометку обрезки.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const SRC = fs.readFileSync(path.join(__dirname, '../src/services/mimir-tender-stages-ai.js'), 'utf8');
const M = /function docsToText\(documents, limit = \d+\) \{[\s\S]*?\n\}/.exec(SRC);
assert.ok(M, 'docsToText не найдена');
// eslint-disable-next-line no-new-func
const docsToText = new Function(`${M[0]}; return docsToText;`)();

check('лимит поднят: 400 тыс. символов по умолчанию', () => {
  assert.ok(/limit = 400000/.test(SRC), 'лимит не поднят до 400 тыс.');
});

check('maxTokens ответа поднят до 32000', () => {
  assert.ok(/maxTokens: 32000/.test(SRC), 'ответ всё ещё режется на 12000');
});

check('ВОР попадает в промпт первым, даже если документов много', () => {
  const docs = [];
  for (let i = 0; i < 20; i++) {
    docs.push({ original_name: `Договор ${i}.pdf`, text: 'договорные условия '.repeat(3000) });
  }
  docs.push({ original_name: 'ВОР № 1 КТЦ.xlsx', text: 'Очистка бункеров 1750 м2; Погрузка 78 т' });

  const out = docsToText(docs, 60000);
  const posVOR = out.indexOf('ВОР № 1');
  const posDog = out.indexOf('Договор 0');
  assert.ok(posVOR >= 0, 'ВОР вообще не попал в промпт');
  assert.ok(posVOR < posDog, `ВОР должен идти раньше договоров: ВОР@${posVOR}, договор@${posDog}`);
});

check('объёмы из ВОР не теряются при большом объёме документов', () => {
  const docs = [{ original_name: 'Договор.pdf', text: 'x'.repeat(400000) }];
  docs.push({ original_name: 'Ведомость объёмов.xlsx', text: 'Позиция А — 1750 м2; Позиция Б — 1353 т' });
  const out = docsToText(docs, 60000);
  assert.ok(/1750 м2/.test(out), 'объём из ведомости потерялся');
  assert.ok(/1353 т/.test(out), 'второй объём потерялся');
});

check('документ с объёмами получает больше места, чем договор', () => {
  // ВОР 20 тыс. символов, договор 200 тыс.: ВОР должен войти целиком.
  const vorText = 'Очистка оборудования 1750 м2. '.repeat(600).slice(0, 20000);
  const docs = [
    { original_name: 'ВОР.xlsx', text: vorText },
    { original_name: 'Договор.pdf', text: 'договор '.repeat(30000) }
  ];
  const out = docsToText(docs, 60000);
  const vorPart = out.slice(out.indexOf('=== ВОР.xlsx ==='), out.indexOf('=== Договор.pdf ==='));
  assert.ok(vorPart.length > 18000, `ВОР получил только ${vorPart.length} симв. — должен почти целиком`);
});

check('каждый документ получает свою долю, а не первый всё', () => {
  const docs = [
    { original_name: 'ТЗ.pdf', text: 'Т'.repeat(200000) },
    { original_name: 'ВОР.xlsx', text: 'В'.repeat(200000) },
    { original_name: 'Смета.docx', text: 'С'.repeat(200000) }
  ];
  const out = docsToText(docs, 60000);
  assert.ok(/=== ТЗ\.pdf ===/.test(out), 'ТЗ пропал');
  assert.ok(/=== ВОР\.xlsx ===/.test(out), 'ВОР пропал');
  assert.ok(/=== Смета\.docx ===/.test(out), 'Смета пропала');
});

check('видно, что документ обрезан', () => {
  const docs = [{ original_name: 'Огромный ТЗ.pdf', text: 'ж'.repeat(300000) }];
  const out = docsToText(docs, 20000);
  assert.ok(/опущена|обрезано/.test(out), 'нет пометки обрезки — модель решит, что документ кончился');
});

check('без документов — пустая строка', () => {
  assert.strictEqual(docsToText([]), '');
  assert.strictEqual(docsToText([{ original_name: 'x.pdf', text: '' }]), '');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
