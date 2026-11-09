'use strict';

/**
 * Тесты разделения разбора на три роли.
 *
 * ── Зачем разделять ────────────────────────────────────────────────────────
 * Один промпт «разбери ведомость и посчитай нормы» просит слишком многого:
 * на больших документах модель подменяет объёмы, придумывает нормы, путает
 * строки. Каждая роль отвечает за одно — и результат проверяем отдельно.
 */

const assert = require('assert');
const path = require('path');

const agents = require(path.join(__dirname, '..', 'src', 'services', 'dv-agents.js'));

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

// ── 1. Промпты ─────────────────────────────────────────────────────────────
check('роль объёмов запрещает считать нормы и стоимость', () => {
  const s = agents.VOLUME_SYSTEM;
  assert.ok(/НЕ считаешь стоимость/i.test(s), 'нет запрета считать стоимость');
  assert.ok(/НЕ подбираешь нормы/i.test(s), 'нет запрета подбирать нормы');
  assert.ok(/Не придумывай число/i.test(s), 'нет запрета выдумывать объём');
});

check('правило «одна строка = одна позиция» в промпте', () => {
  assert.ok(/одна строка перечня — одна позиция/i.test(agents.ONE_ROW_ONE_POSITION));
  assert.ok(agents.VOLUME_SYSTEM.includes(agents.ONE_ROW_ONE_POSITION),
    'правило не вставлено в промпт роли объёмов');
});

check('роль норм запрещает выдумывать коды', () => {
  const s = agents.NORM_SYSTEM;
  assert.ok(/Не выдумывай код/i.test(s), 'нет запрета выдумывать код');
  assert.ok(/null/i.test(s), 'нет указания вернуть null');
});

check('роль контекста не угадывает отложения', () => {
  const s = agents.CONTEXT_SYSTEM;
  assert.ok(/fouling: "unknown"/.test(s), 'нет значения по умолчанию');
  assert.ok(/Не угадывай/i.test(s), 'нет запрета угадывать');
});

// ── 2. Разбор ответа роли ──────────────────────────────────────────────────
check('pickArray достаёт массив по имени', () => {
  const parsed = { positions: [{ name: 'A' }, { name: 'B' }], rows_seen: 2 };
  assert.strictEqual(agents.pickArray(parsed, 'positions').length, 2);
});

check('pickArray не падает на мусоре', () => {
  assert.deepStrictEqual(agents.pickArray(null, 'positions'), []);
  assert.deepStrictEqual(agents.pickArray({}, 'positions'), []);
  assert.deepStrictEqual(agents.pickArray({ positions: 'нет' }, 'positions'), []);
  assert.deepStrictEqual(agents.pickArray({ positions: [null, 1, {}] }, 'positions'), [{}]);
});

// ── 3. Склейка ─────────────────────────────────────────────────────────────
check('склейка соединяет объём, норму и контекст по названию', () => {
  const merged = agents.mergeAgents({
    volumes: [{ name: 'Очистка трубок', volume: 7200, unit: 'п.м',
      source_ref: { document: 'ВОР.xlsx', fragment: 'п.1' } }],
    norms: [{ name: 'Очистка трубок', category_code: 'tubes', method_code: 'gdo' }],
    context: [{ name: 'Очистка трубок', equipment_type: 'теплообменник', fouling: 'heavy' }]
  });
  assert.strictEqual(merged.length, 1);
  const m = merged[0];
  assert.strictEqual(m.volume, 7200);
  assert.strictEqual(m.category_code, 'tubes');
  assert.strictEqual(m.fouling, 'heavy');
  assert.strictEqual(m.equipment_type, 'теплообменник');
  assert.strictEqual(m.needs_classification, undefined, 'готовая позиция помечена проблемной');
});

check('позиция без нормы помечается на проверку', () => {
  const merged = agents.mergeAgents({
    volumes: [{ name: 'Странная работа', volume: 10, unit: 'шт' }],
    norms: [{ name: 'Странная работа', category_code: null, method_code: null }],
    context: []
  });
  assert.strictEqual(merged[0].needs_classification, true,
    'позиция без нормы не помечена');
});

check('позиция без объёма помечается на проверку', () => {
  const merged = agents.mergeAgents({
    volumes: [{ name: 'Работа', volume: null, unit: 'м3' }],
    norms: [{ name: 'Работа', category_code: 'vessels', method_code: 'clean' }],
    context: []
  });
  assert.strictEqual(merged[0].needs_classification, true);
});

check('роль норм не ответила — объёмы сохраняются', () => {
  // Частичный результат лучше пустого: если роль упала, позиции не теряем.
  const merged = agents.mergeAgents({
    volumes: [{ name: 'A', volume: 1, unit: 'м3' }, { name: 'B', volume: 2, unit: 'м3' }],
    norms: [],
    context: []
  });
  assert.strictEqual(merged.length, 2, 'позиции потеряны');
});

check('источник объёма проставляется из документа', () => {
  const merged = agents.mergeAgents({
    volumes: [{ name: 'A', volume: 1, unit: 'м3', source_ref: { document: 'ВОР' } }],
    norms: [], context: []
  });
  assert.strictEqual(merged[0].volume_source, 'vor');
  const noSrc = agents.mergeAgents({ volumes: [{ name: 'B', volume: 1, unit: 'м3' }], norms: [], context: [] });
  assert.strictEqual(noSrc[0].volume_source, 'tz');
});

// ── 4. Проверка полноты ────────────────────────────────────────────────────
check('полный разбор проходит проверку', () => {
  const r = agents.checkCompleteness(300, 300);
  assert.strictEqual(r.complete, true);
  assert.strictEqual(r.note, null);
});

check('недобор помечается с числами', () => {
  const r = agents.checkCompleteness(673, 353);
  assert.strictEqual(r.complete, false);
  assert.ok(r.note.includes('673'), 'нет числа увиденных');
  assert.ok(r.note.includes('353'), 'нет числа выписанных');
});

check('допуск 10 процентов на подстроки', () => {
  // Часть строк — заголовки и подстроки, они не позиции.
  assert.strictEqual(agents.checkCompleteness(300, 275).complete, true);
  assert.strictEqual(agents.checkCompleteness(300, 260).complete, false);
});

check('нет перечня — проверка не нужна', () => {
  assert.strictEqual(agents.checkCompleteness(0, 0).complete, true);
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
