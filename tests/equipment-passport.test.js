'use strict';
/**
 * Паспортные данные оборудования — когда в тендере нет ВОР.
 *
 * Требование РП 07.11.2026: «Бывает что в документации нет ВОР. Бывает
 * просто ТЗ, и это не должно быть блокером. Тогда ИИ должен из ТЗ сам
 * понимать какие объёмы».
 *
 * Здесь закрепляется: марка аппарата из ТЗ → понятный объём работ.
 * Ничего не выдумывается: только паспортные характеристики производителя.
 */
const assert = require('assert');
const ep = require('../src/services/equipment-passport');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

async function checkAsync(name, fn) {
  try { await fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// ── 1. Своя база ────────────────────────────────────────────────────────────
check('марка ПСВ находится по точному имени', () => {
  const eq = ep.lookupEquipment('ПСВ-315');
  assert.ok(eq, 'ПСВ-315 не найдена');
  assert.strictEqual(eq.surface_m2, 315);
  assert.ok(eq.tube_l_m > 0 && eq.tube_d_mm > 0, 'нет параметров трубок');
});

check('марка находится внутри длинной строки', () => {
  // Как в реальном ТЗ: «подогреватель сетевой воды ПСВ-315».
  const eq = ep.lookupEquipment('подогреватель сетевой воды ПСВ-315');
  assert.ok(eq, 'марка в строке не найдена');
  assert.strictEqual(eq.surface_m2, 315);
});

check('РВС находится с номером аппарата', () => {
  const eq = ep.lookupEquipment('РВС-5000 №3');
  assert.ok(eq, 'РВС-5000 не найден');
  assert.strictEqual(eq.volume_m3, 5000);
  assert.ok(eq.wall_m2 > 0, 'нет площади стенок');
});

check('неизвестная марка возвращает null, а не догадку', () => {
  assert.strictEqual(ep.lookupEquipment('ХХХ-9999'), null);
  assert.strictEqual(ep.lookupEquipment(''), null);
  assert.strictEqual(ep.lookupEquipment(null), null);
});

// ── 2. Обогащение позиций ───────────────────────────────────────────────────
(async () => {
  await checkAsync('трубки ПСВ: считает число трубок по площади и геометрии', async () => {
    const p = await ep.enrichPosition({
      name: 'Очистка трубок подогревателя ПСВ-315',
      category_code: 'tubes', method_code: 'gdo',
      volume: null, unit: 'труб'
    });
    assert.ok(Number(p.volume) > 0, 'объём не заполнен');
    // S=315 м², d=24 мм, L=4.6 м → N = 315 / (π·0.024·4.6) ≈ 908
    assert.ok(p.volume > 500 && p.volume < 1500, 'странное число трубок: ' + p.volume);
    assert.strictEqual(p.conversion_params.length_m, 4.6, 'длина трубки не подставлена');
    assert.strictEqual(p.conversion_params.dn_mm, 24, 'диаметр не подставлен');
    assert.strictEqual(p.confidence, 'low', 'нет пометки «требует проверки»');
    assert.ok(/паспорт/.test(p.problem || ''), 'нет пояснения в problem');
  });

  await checkAsync('ёмкость РВС: переводит в площадь стенок, а не в «1 шт»', async () => {
    const p = await ep.enrichPosition({
      name: 'Зачистка внутренней поверхности РВС-5000',
      category_code: 'vessels', method_code: 'clean',
      volume: null, unit: 'м³'
    });
    assert.ok(Number(p.volume) > 0, 'объём не заполнен');
    assert.strictEqual(p.unit, 'м²', 'объём резервуара нельзя считать как м³ зачистки');
    assert.ok(p.volume > 1000, 'площадь стенок подозрительно мала: ' + p.volume);
  });

  await checkAsync('котёл: подставляет площадь поверхностей нагрева', async () => {
    const p = await ep.enrichPosition({
      name: 'Очистка поверхностей нагрева котла КВГМ-100',
      category_code: 'boilers', method_code: 'mech',
      volume: null, unit: 'м²'
    });
    assert.ok(Number(p.volume) > 1000, 'площадь котла не подставлена: ' + p.volume);
  });

  await checkAsync('позиция с готовым объёмом не трогается', async () => {
    const src = { name: 'Очистка РВС-5000', volume: 250, unit: 'м³', category_code: 'vessels' };
    const p = await ep.enrichPosition(src);
    assert.strictEqual(p.volume, 250, 'готовый объём переписан');
    assert.strictEqual(p.confidence, undefined, 'позиция без нужды помечена low');
  });

  await checkAsync('неизвестная марка: объём остаётся пустым, не выдумывается', async () => {
    const p = await ep.enrichPosition({
      name: 'Очистка аппарата ХХХ-9999', volume: null, unit: 'м³'
    }, { allowWeb: false });
    assert.strictEqual(p.volume, null, 'объём выдуман: ' + p.volume);
  });

  await checkAsync('марка без нужной величины не подставляется', async () => {
    // Пластинчатый аппарат, а считаем в м³ — подставить нечего.
    const p = await ep.enrichPosition({
      name: 'Промывка АН150', category_code: 'plates', method_code: 'chem_cip',
      volume: null, unit: 'м³'
    }, { allowWeb: false });
    assert.ok(p.volume == null, 'подставлено неподходящее значение: ' + p.volume);
  });

  await checkAsync('пакетное обогащение считает количество', async () => {
    const res = await ep.enrichPositions([
      { name: 'ПСВ-315 трубки', category_code: 'tubes', method_code: 'gdo', volume: null, unit: 'труб' },
      { name: 'РВС-5000', category_code: 'vessels', method_code: 'clean', volume: null, unit: 'м³' },
      { name: 'Прочее', volume: 100, unit: 'м³' }
    ], { allowWeb: false });
    assert.strictEqual(res.enriched, 2, 'обогащено ' + res.enriched + ', ожидалось 2');
    assert.strictEqual(res.positions.length, 3);
  });

  console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
  process.exitCode = fail ? 1 : 0;
})();
