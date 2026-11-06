'use strict';
/**
 * Входы нормы из позиции ДВ.
 *
 * КОРЕНЬ, который здесь закрепляется: входы нормы берутся из
 * input_schema_json категории, а НЕ из списка «если категория — подставь
 * такое-то число». В прежнем коде были выдуманные значения
 * (cycles: 2, dn_mm: 159, manways: 2, cells: 1, diameter_mm: 25, length_m: 6),
 * и расчёт шёл по числам, которых в ТЗ не было.
 */
const assert = require('assert');
const { inputsForPosition, classifyUnit } = require('../src/services/norm-inputs');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// Каталог как в БД (V312/V314): каждая категория объявляет свои поля.
const catalog = {
  categories: [
    {
      code: 'tubes',
      input_schema_json: {
        methods: {
          gdo: {
            fields: [
              { key: 'tubes', label: 'Трубки', unit: 'шт' },
              { key: 'diameter_mm', label: 'Ø', unit: 'мм' },
              { key: 'length_m', label: 'Длина трубки', unit: 'м' }
            ]
          },
          gmo: {
            fields: [
              { key: 'tubes', label: 'Трубки', unit: 'шт' },
              { key: 'diameter_mm', label: 'Ø', unit: 'мм' }
            ]
          }
        }
      }
    },
    {
      code: 'vessels',
      input_schema_json: {
        methods: {
          clean: {
            fields: [
              { key: 'volume_m3', label: 'Объём', unit: 'м³' },
              { key: 'manways', label: 'Лазы', unit: 'шт', optional: true }
            ]
          }
        }
      }
    },
    {
      code: 'boilers',
      input_schema_json: {
        methods: {
          chem: {
            fields: [
              { key: 'circuit_m3', label: 'Объём контура', unit: 'м³' },
              { key: 'cycles', label: 'Число циклов', unit: 'шт' }
            ]
          },
          mech: {
            fields: [{ key: 'surface_m2', label: 'Площадь', unit: 'м²' }]
          }
        }
      }
    },
    {
      code: 'pipelines',
      input_schema_json: {
        methods: {
          hydro: {
            fields: [
              { key: 'length_m', label: 'Длина', unit: 'м' },
              { key: 'dn_mm', label: 'Ду', unit: 'мм' }
            ]
          }
        }
      }
    },
    {
      code: 'insulation',
      input_schema_json: {
        methods: {
          insul: {
            fields: [
              { key: 'surface_m2', label: 'Площадь', unit: 'м²' },
              { key: 'diameter_mm', label: 'Ø трубы', unit: 'мм' }
            ]
          }
        }
      }
    }
  ]
};

// ── 1. Ключи совпадают со схемой ─────────────────────────────────────────────
check('категория ёмкостей: volume_m3, как ждёт vessels.clean', () => {
  const out = inputsForPosition(
    { category_code: 'vessels', method_code: 'clean', volume: 340, unit: 'м³' }, catalog);
  assert.strictEqual(out.volume_m3, 340, 'объём не попал в volume_m3: ' + JSON.stringify(out));
});

check('трубки: реальный Ø из dn_mm попадает в diameter_mm', () => {
  // Именно здесь ломалось: ДВ приносит dn_mm, норма читает diameter_mm.
  const out = inputsForPosition({
    category_code: 'tubes', method_code: 'gdo', volume: 1112, unit: 'труб',
    conversion_params: { dn_mm: 25, length_m: 4.6 }
  }, catalog);
  assert.strictEqual(out.tubes, 1112);
  assert.strictEqual(out.diameter_mm, 25, 'Ø потерян или выдуман: ' + JSON.stringify(out));
  assert.strictEqual(out.length_m, 4.6, 'длина потеряна или выдумана: ' + JSON.stringify(out));
});

// ── 2. Ничего не выдумывается ────────────────────────────────────────────────
check('нет Ø в ДВ — нет diameter_mm (не подставляется 25)', () => {
  const out = inputsForPosition({
    category_code: 'tubes', method_code: 'gdo', volume: 800, unit: 'труб',
    conversion_params: { length_m: 4.6 }
  }, catalog);
  assert.strictEqual(out.tubes, 800);
  assert.strictEqual(out.diameter_mm, undefined,
    'диаметр выдуман: ' + JSON.stringify(out));
});

check('нет длины в ДВ — нет length_m (не подставляется 6)', () => {
  const out = inputsForPosition({
    category_code: 'tubes', method_code: 'gdo', volume: 800, unit: 'труб',
    conversion_params: { dn_mm: 25 }
  }, catalog);
  assert.strictEqual(out.length_m, undefined, 'длина выдумана: ' + JSON.stringify(out));
});

check('cycles не выдумывается для химии', () => {
  const out = inputsForPosition(
    { category_code: 'boilers', method_code: 'chem', volume: 12, unit: 'м³' }, catalog);
  assert.strictEqual(out.circuit_m3, 12);
  assert.strictEqual(out.cycles, undefined,
    'число циклов выдумано: ' + JSON.stringify(out));
});

check('manways не выдумывается', () => {
  const out = inputsForPosition(
    { category_code: 'vessels', method_code: 'clean', volume: 100, unit: 'м³' }, catalog);
  assert.strictEqual(out.manways, undefined, 'лазы выдуманы: ' + JSON.stringify(out));
});

check('dn_mm 159 не подставляется стыкам без данных', () => {
  const out = inputsForPosition(
    { category_code: 'pipelines', method_code: 'hydro', volume: 120, unit: 'м' }, catalog);
  assert.strictEqual(out.length_m, 120, 'длина не попала');
  assert.strictEqual(out.dn_mm, undefined, 'Ду выдуман: ' + JSON.stringify(out));
});

// ── 3. Единицы разводятся правильно ──────────────────────────────────────────
check('погонные метры идут в длину, а не в объём', () => {
  const out = inputsForPosition(
    { category_code: 'pipelines', method_code: 'hydro', volume: 250, unit: 'п.м' }, catalog);
  assert.strictEqual(out.length_m, 250);
  assert.strictEqual(out.volume_m3, undefined);
});

check('м³ не уезжает в длину', () => {
  const out = inputsForPosition(
    { category_code: 'boilers', method_code: 'chem', volume: 30, unit: 'м³' }, catalog);
  assert.strictEqual(out.length_m, undefined, 'объём превратился в длину: ' + JSON.stringify(out));
});

check('м² идёт в площадь с Ø из ДВ', () => {
  const out = inputsForPosition({
    category_code: 'insulation', method_code: 'insul', volume: 1750, unit: 'м²',
    conversion_params: { thickness_mm: 50 }
  }, catalog);
  assert.strictEqual(out.surface_m2, 1750);
  assert.strictEqual(out.thickness_mm, 50, 'толщина потеряна');
  assert.strictEqual(out.diameter_mm, undefined, 'Ø выдуман');
});

// ── 4. Неизвестный метод ─────────────────────────────────────────────────────
check('метода нет в каталоге — объём не теряется', () => {
  const out = inputsForPosition(
    { category_code: 'vessels', method_code: 'brand_new', volume: 77, unit: 'м³' }, catalog);
  assert.strictEqual(out.volume_m3, 77, 'объём потерян для нового метода: ' + JSON.stringify(out));
});

check('нет каталога вовсе — работает по единице', () => {
  const out = inputsForPosition(
    { category_code: 'vessels', method_code: 'clean', volume: 55, unit: 'м³' }, null);
  assert.strictEqual(out.volume_m3, 55);
});

// ── 5. Единицы ───────────────────────────────────────────────────────────────
check('единицы распознаются', () => {
  assert.strictEqual(classifyUnit('м³').isM3, true);
  assert.strictEqual(classifyUnit('м3').isM3, true);
  assert.strictEqual(classifyUnit('м²').isM2, true);
  assert.strictEqual(classifyUnit('трубки').isTube, true);
  assert.strictEqual(classifyUnit('стык').isJoint, true);
  // Ключевое: м³ не должен считаться погонным метром.
  assert.strictEqual(classifyUnit('м³').isRunM, false);
  assert.strictEqual(classifyUnit('м²').isRunM, false);
});

check('погонный метр распознаётся во всех написаниях', () => {
  // Дефект 06.11 (тендер 2127): «450 п.м.» с точкой на конце не распознавалось,
  // и каналы уходили пустыми.
  for (const u of ['п.м.', 'п.м', 'п. м.', 'пм', 'пог.м', 'пог. м', 'м.п.', 'мп', 'м', 'метр']) {
    assert.strictEqual(classifyUnit(u).isRunM, true, `«${u}» не распознан как погонный метр`);
  }
  assert.strictEqual(classifyUnit('м³').isRunM, false);
});

check('тонны и литры распознаются', () => {
  assert.strictEqual(classifyUnit('т').isTon, true);
  assert.strictEqual(classifyUnit('тонн').isTon, true);
  assert.strictEqual(classifyUnit('л').isLitre, true);
  assert.strictEqual(classifyUnit('м³').isTon, false);
});

check('погонные метры уходят в длину, даже с точкой', () => {
  const out = inputsForPosition(
    { category_code: 'vent_sewer', method_code: 'sewer', volume: 450, unit: 'п.м.' }, catalog);
  assert.strictEqual(out.length_m, 450, 'длина потеряна: ' + JSON.stringify(out));
});

check('пустая позиция не падает', () => {
  assert.deepStrictEqual(inputsForPosition({}, catalog), {});
  assert.deepStrictEqual(inputsForPosition(null, null), {});
});

// ── 6. Нулевой объём и нестандартные единицы ─────────────────────────────────
check('нулевой объём не даёт surface_m2: 0', () => {
  // Дефект 06.11 (тендер 2143): в норму уходило {"surface_m2":0},
  // и она считала ноль работ вместо «укажите объём».
  const out = inputsForPosition(
    { category_code: 'boilers', method_code: 'mech', volume: 0, unit: 'м²' }, catalog);
  assert.deepStrictEqual(out, {}, 'передан нулевой объём: ' + JSON.stringify(out));
  assert.strictEqual(out.surface_m2, undefined);
});

check('тонны с плотностью пересчитываются в м³', () => {
  // Тендер 2127: 1353 т шлака, плотность 1.3 т/м³ → 1040.77 м³.
  const out = inputsForPosition({
    category_code: 'vessels', method_code: 'clean', volume: 1353, unit: 'т',
    conversion_params: { density_t_m3: 1.3 }
  }, catalog);
  assert.strictEqual(out.volume_m3, 1040.77, 'пересчёт неверен: ' + JSON.stringify(out));
  assert.strictEqual(out.density_t_m3, 1.3);
});

check('тонны без плотности — уходят в пересчёт, норма попросит плотность', () => {
  const out = inputsForPosition(
    { category_code: 'vessels', method_code: 'clean', volume: 500, unit: 'т' }, catalog);
  assert.strictEqual(out._measured_value, 500);
  assert.strictEqual(out.volume_m3, undefined, 'объём посчитан без плотности');
  assert.strictEqual(out.density_t_m3, undefined, 'плотность выдумана');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
