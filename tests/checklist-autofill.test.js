'use strict';
/**
 * Предзаполнение чек-листа анализа из разбора Мимира.
 *
 * Дефект 07.11.2026: у всех 14 тендеров чек-лист был пуст (0 ответов),
 * а закрытие анализа требует 10 обязательных ответов. Из-за этого фаза
 * calc не наступала, и обучение справочника не пополнялось с июля.
 *
 * Правило: заполняем только то, что есть в документах. Вопросы для звонка
 * заказчику Мимир не выдумывает.
 */
const assert = require('assert');
const { buildPrefill, mergePrefill } = require('../src/services/checklist-autofill');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// ── 1. Плановость ───────────────────────────────────────────────────────────
check('плановая работа определяется по слову «график»', () => {
  const r = buildPrefill({ text: 'Работы выполняются согласно графику ППР заказчика' });
  assert.ok(r.q4, 'q4 не заполнен');
  assert.ok(/планов/i.test(r.q4.value), 'не распознана плановость: ' + r.q4.value);
});

check('внеплановая работа определяется по «аварийн»', () => {
  const r = buildPrefill({ text: 'Вызов на внеплановые и аварийные работы' });
  assert.ok(/внеплан|аварийн/i.test(r.q4.value), r.q4.value);
});

check('нет признаков плановости — подсказка, а не выдуманный ответ', () => {
  const r = buildPrefill({ text: 'Очистка теплообменника' });
  assert.ok(r.q4, 'q4 не заполнен — анализ не закрыть');
  assert.ok(/не указано/i.test(r.q4.value), 'факт выдуман: ' + r.q4.value);
  assert.strictEqual(r.q4.confidence, 'low', 'подсказка должна быть low');
  assert.strictEqual(r.q4.source, 'требует звонка');
});

// ── 2. Отклонения по объёмам (q10) ──────────────────────────────────────────
check('позиции по паспорту дают предупреждение об отклонении', () => {
  const r = buildPrefill({
    dv: { positions: [
      { volume: 100, volume_source: 'passport' },
      { volume: 200, volume_source: 'vor' }
    ] }
  });
  assert.ok(r.q10, 'q10 не заполнен');
  assert.ok(/паспорт/i.test(r.q10.value), 'нет упоминания паспорта: ' + r.q10.value);
  assert.strictEqual(r.q10.confidence, 'low', 'занижена осторожность');
});

check('позиции без объёма тоже дают отклонение', () => {
  const r = buildPrefill({ dv: { positions: [{ volume: null }, { volume: 50, volume_source: 'vor' }] } });
  assert.ok(/без объёма/i.test(r.q10.value), r.q10.value);
});

check('объёмы из ВОР — отклонений не требуется', () => {
  const r = buildPrefill({ dv: { positions: [{ volume: 100, volume_source: 'vor' }] } });
  assert.ok(/отклонений не требуется/i.test(r.q10.value), r.q10.value);
});

// ── 3. Бюджет, торги, решение ───────────────────────────────────────────────
check('НМЦК вытаскивается из текста', () => {
  const r = buildPrefill({ text: 'Начальная максимальная цена договора 12 500 000 руб.' });
  assert.ok(r.q5, 'q5 не заполнен');
  assert.ok(/12/.test(r.q5.value), r.q5.value);
});

check('переторжка распознаётся', () => {
  const r = buildPrefill({ text: 'Предусмотрена переторжка в ходе закупки' });
  assert.ok(r.q8 && /переторжк/i.test(r.q8.value), r.q8 && r.q8.value);
});

check('тендерный комитет распознаётся', () => {
  const r = buildPrefill({ text: 'Решение принимает тендерный комитет заказчика' });
  assert.ok(r.q9 && /комитет/i.test(r.q9.value), r.q9 && r.q9.value);
});

// ── 4. Технические вопросы ──────────────────────────────────────────────────
check('допуски собираются списком', () => {
  const r = buildPrefill({ text: 'Работы на высоте, требуется НАКС у сварщиков' });
  assert.ok(r.tech6, 'tech6 не заполнен');
  assert.ok(/высот/i.test(r.tech6.value), r.tech6.value);
  assert.ok(/НАКС/i.test(r.tech6.value), r.tech6.value);
});

check('наряд-допуск даёт вопрос про наблюдающего', () => {
  const r = buildPrefill({ text: 'Работы внутри аппарата по наряду-допуску' });
  assert.ok(r.tech4 && /наблюдающ/i.test(r.tech4.value), r.tech4 && r.tech4.value);
});

check('пропускной режим распознаётся', () => {
  const r = buildPrefill({ text: 'На объекте действует пропускной режим' });
  assert.ok(r.tech7 && /пропуск/i.test(r.tech7.value), r.tech7 && r.tech7.value);
});

check('режим «круглосуточно» из ТЗ', () => {
  const r = buildPrefill({ text: 'работы', schedule: { mode: 'around' } });
  assert.ok(r.tech2 && /круглосуточн/i.test(r.tech2.value), r.tech2 && r.tech2.value);
});

// ── 5. Каждый ответ несёт источник ──────────────────────────────────────────
check('у каждого ответа указан источник и доверие', () => {
  const r = buildPrefill({
    text: 'Работы по графику ППР, требуются допуски на высоту, пропускной режим',
    dv: { positions: [{ volume: 100, volume_source: 'passport' }] }
  });
  const keys = Object.keys(r);
  assert.ok(keys.length > 0, 'ничего не заполнено');
  for (const k of keys) {
    assert.ok(r[k].source, `${k}: нет источника`);
    assert.ok(['low', 'medium', 'high'].includes(r[k].confidence), `${k}: доверие «${r[k].confidence}»`);
  }
});

// ── 6. Ответы РП не затираются ──────────────────────────────────────────────
check('ответ РП приоритетнее предзаполнения', () => {
  const existing = { q4: 'РП уже позвонил: работа внеплановая' };
  const merged = mergePrefill(existing, buildPrefill({ text: 'работы по графику' }));
  assert.strictEqual(merged.q4, 'РП уже позвонил: работа внеплановая', 'ответ РП затёрт');
});

check('пустой ответ РП заполняется', () => {
  const existing = { q4: '   ' };
  const merged = mergePrefill(existing, { q4: { value: 'плановая', source: 'документы', confidence: 'medium' } });
  assert.ok(merged.q4 && merged.q4.value === 'плановая', 'пустое не заполнилось');
});

check('пустой контекст не падает и даёт подсказки для звонка', () => {
  const empty = buildPrefill();
  assert.ok(empty && typeof empty === 'object', 'вернулось не объект');
  // Без документов всё равно есть напоминания «уточняется у заказчика» —
  // иначе анализ не закрыть, а очередь стоит.
  assert.ok(empty.q1 && /уточняется/.test(empty.q1.value), 'нет подсказки по q1');
  assert.strictEqual(empty.q1.source, 'требует звонка');
  assert.strictEqual(empty.q1.confidence, 'low');
  assert.deepStrictEqual(buildPrefill(null), buildPrefill());
  assert.deepStrictEqual(mergePrefill(null, null), {});
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
