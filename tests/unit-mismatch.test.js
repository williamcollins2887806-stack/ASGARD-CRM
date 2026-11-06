'use strict';
/**
 * Единица объёма должна совпадать с той, что ждёт норма.
 *
 * Дефект 06.11 (тендер 2131): в ВОР объёмы трубок заданы в погонных метрах
 * («102 516 п.м»), а норма tubes.gdo считает ШТУКИ. Модель подставила число
 * как штуки — расчёт дал 739 855 суток (2000 лет). Проверка на абсурд это
 * не поймала: объём и срок были согласованы между собой.
 */
const assert = require('assert');
const { checkUnitMatchesNorm } = require('../src/services/norm-sanity');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

check('п.м без длины трубки — отказ с запросом length_m', () => {
  const r = checkUnitMatchesNorm({ category: 'tubes', method: 'gdo', unit: 'п.м', value: 102516 });
  assert.strictEqual(r.ok, false, 'нельзя считать п.м как штуки');
  assert.ok(r.missing.includes('length_m'), 'нужен запрос длины трубки');
});

check('п.м с длиной 6 м пересчитывается в трубки', () => {
  const r = checkUnitMatchesNorm({
    category: 'tubes', method: 'gdo', unit: 'п.м', value: 102516, params: { length_m: 6 }
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.converted, true);
  assert.strictEqual(r.value, 17086, '102516/6 = 17086: ' + r.value);
});

check('разные записи погонного метра распознаются', () => {
  for (const u of ['п.м', 'пм', 'пог.м', 'погонный метр', 'м.п.']) {
    const r = checkUnitMatchesNorm({ category: 'tubes', method: 'gdo', unit: u, value: 600 });
    assert.strictEqual(r.ok, false, `«${u}» не распознан как погонный метр`);
  }
});

check('штуки и трубки проходят без пересчёта', () => {
  assert.strictEqual(checkUnitMatchesNorm({ category: 'tubes', method: 'gdo', unit: 'шт', value: 500 }).ok, true);
  assert.strictEqual(checkUnitMatchesNorm({ category: 'tubes', method: 'gdo', unit: 'трубки', value: 500 }).ok, true);
});

check('ёмкость в штуках — отказ: нужен объём в м³', () => {
  const r = checkUnitMatchesNorm({ category: 'vessels', method: 'clean', unit: 'шт', value: 10 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.missing.includes('volume_m3'));
});

check('м² для трубного пучка пропускается (переводится отдельно)', () => {
  assert.strictEqual(checkUnitMatchesNorm({ category: 'tubes', method: 'gdo', unit: 'м²', value: 500 }).ok, true);
});

check('пустые данные не роняют проверку', () => {
  assert.strictEqual(checkUnitMatchesNorm({}).ok, true);
  assert.strictEqual(checkUnitMatchesNorm({ category: 'tubes', value: 0 }).ok, true);
});

check('в движке проверка стоит до physicalInputError', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(path.join(__dirname, '../src/services/work-norms.js'), 'utf8');
  const iUnit = SRC.indexOf('checkUnitMatchesNorm');
  const iPhys = SRC.indexOf('const physErr = physicalInputError', iUnit);
  assert.ok(iUnit > 0, 'проверка единиц не подключена');
  assert.ok(iPhys > iUnit, 'проверка единиц должна идти до физических проверок');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
