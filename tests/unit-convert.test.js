'use strict';
/**
 * Пересчёт единиц из ВОР в единицу нормы.
 *
 * Принцип: НЕ УГАДЫВАТЬ. Нет толщины слоя или плотности — вернуть missing,
 * а не подставить «примерное» молча. Допущение — только если разрешено
 * явно, и тогда с пометкой.
 *
 * Формулы проверены по ГОСТ (см. шапку unit-convert.js).
 */
const assert = require('assert');
const uc = require('../src/services/unit-convert');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const R = (over) => Object.assign({
  category_code: 'vessels', method_code: 'clean',
  from_unit: 'м²', to_field: 'volume_m3',
  formula_kind: 'multiply', needs_param: 'thickness_mm', fallback_typical: 50
}, over);

// ── Нормализация единиц ────────────────────────────────────────────────────
check('единицы нормализуются: м2 → м², м3 → м³, л → литр', () => {
  assert.strictEqual(uc.normUnit('м2'), 'м²');
  assert.strictEqual(uc.normUnit('M3'), 'м³');
  assert.strictEqual(uc.normUnit('л'), 'литр');
  assert.strictEqual(uc.normUnit('трубок'), 'трубки');
  assert.strictEqual(uc.normUnit('дюйм'), 'дюйм');
});

// ── Ёмкости: м² × толщина → м³ ─────────────────────────────────────────────
check('1750 м² × 50 мм = 87,5 м³', () => {
  const r = uc.convert({ fromUnit: 'м²', value: 1750, toField: 'volume_m3', rule: R(), params: { thickness_mm: 50 } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 87.5);
  assert.strictEqual(r.assumed, false);
});

check('без толщины — отказ, а не выдумка', () => {
  const r = uc.convert({ fromUnit: 'м²', value: 1750, toField: 'volume_m3', rule: R(), params: {}, defaults: {} });
  assert.strictEqual(r.ok, false, 'нельзя считать без толщины');
  assert.ok(r.missing.includes('thickness_mm'), 'missing должен содержать thickness_mm');
});

check('толщина из типового — с пометкой «допущение»', () => {
  const r = uc.convert({
    fromUnit: 'м²', value: 1750, toField: 'volume_m3', rule: R(),
    params: {}, allowAssumed: true
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 87.5);
  assert.strictEqual(r.assumed, true, 'должно быть помечено как допущение');
  assert.ok(/допущение/.test(r.note), 'в пометке должно быть слово «допущение»');
});

// ── Ёмкости: тонны / плотность → м³ ────────────────────────────────────────
check('1353 т / 1,3 т/м³ = 1040,8 м³', () => {
  const r = uc.convert({
    fromUnit: 'т', value: 1353, toField: 'volume_m3',
    rule: R({ from_unit: 'т', formula_kind: 'divide', needs_param: 'density_t_m3', fallback_typical: null }),
    params: { density_t_m3: 1.3 }
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 1040.769);
});

check('без плотности — отказ', () => {
  const r = uc.convert({
    fromUnit: 'т', value: 1353, toField: 'volume_m3',
    rule: R({ from_unit: 'т', formula_kind: 'divide', needs_param: 'density_t_m3', fallback_typical: null }),
    params: {}
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.missing.includes('density_t_m3'));
});

// ── Литры ──────────────────────────────────────────────────────────────────
check('5000 литров = 5 м³', () => {
  const r = uc.convert({
    fromUnit: 'литр', value: 5000, toField: 'volume_m3',
    rule: R({ from_unit: 'литр', formula_kind: 'divide', needs_param: null, factor: 1000 })
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 5);
});

// ── Пластины: f·(N−2), не f·N ──────────────────────────────────────────────
check('12 пластин по 0,2 м² = 2,0 м² (формула f·(N−2))', () => {
  const r = uc.convert({
    fromUnit: 'пластины', value: 12, toField: 'surface_m2',
    rule: R({ category_code: 'plates', method_code: 'hydro_dis', from_unit: 'пластины', to_field: 'surface_m2', needs_param: 'area_per_plate_m2', fallback_typical: 0.5 }),
    params: { area_per_plate_m2: 0.2 }
  });
  assert.strictEqual(r.ok, true);
  // f·(N−2) = 0,2 × 10 = 2,0. Формула f·N дала бы 2,4 (+20%).
  assert.strictEqual(r.value, 2, 'должно быть 2,0, а не 2,4: ' + r.value);
});

// ── Дюймы ──────────────────────────────────────────────────────────────────
check('2 дюйма → наружный 60,3 мм', () => {
  const r = uc.convert({ fromUnit: 'дюйм', value: 2, toField: 'dn_mm', rule: R({ ...R, formula_kind: 'dn_from_inch' }).constructor && {
    formula_kind: 'dn_from_inch', needs_param: null, from_unit: 'дюйм', to_field: 'dn_mm'
  } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 60.3);
});

check('4 дюйма → наружный 114,3 мм', () => {
  const r = uc.convert({
    fromUnit: 'дюйм', value: 4, toField: 'dn_mm',
    rule: { formula_kind: 'dn_from_inch', needs_param: null, from_unit: 'дюйм', to_field: 'dn_mm' }
  });
  assert.strictEqual(r.value, 114.3);
});

// ── Шов трубы ──────────────────────────────────────────────────────────────
check('один стык Ду159 = 0,4995 м шва', () => {
  assert.strictEqual(uc.weldLengthPerJoint(159), 0.4995);
});

check('100 м шва при Ду159 = 200 стыков', () => {
  const r = uc.convert({
    fromUnit: 'м', value: 100, toField: 'joints',
    rule: { formula_kind: 'pipe_weld_length', needs_param: 'dn_mm', from_unit: 'м', to_field: 'joints' },
    params: { dn_mm: 159 }
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 200.2);
});

// ── Площадь трубки ─────────────────────────────────────────────────────────
check('площадь трубки 20 мм L=3 по внутреннему = 0,1696 м²', () => {
  const a = uc.tubeAreaM2(20, 3, { inner: true, wallMm: 1 });
  assert.strictEqual(a, 0.1696);
});

check('500 м² при трубке 20×3 = 2948 трубок', () => {
  const r = uc.convert({
    fromUnit: 'м²', value: 500, toField: 'tubes',
    rule: { formula_kind: 'sum_area', needs_param: 'diameter_mm', from_unit: 'м²', to_field: 'tubes' },
    params: { diameter_mm: 20, length_m: 3 }
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.value > 2900 && r.value < 3000, 'около 2948: ' + r.value);
});

// ── Геометрия цилиндра ─────────────────────────────────────────────────────
check('цилиндр D=20 м, H=12 м: объём и площадь по формуле', () => {
  const v = uc.cylinderVolumeM3(20, 12);
  const s = uc.cylinderSurfaceM2(20, 12, 1);
  assert.ok(v > 3700 && v < 3800, 'объём около 3770: ' + v);
  assert.ok(s > 1060 && s < 1070, 'площадь около 1068: ' + s);
  // S/V = 4/D + 1/H должен давать тот же порядок.
  const ratio = s / v;
  const formula = 4 / 20 + 1 / 12;
  assert.ok(Math.abs(ratio - formula) < 0.01, `S/V=${ratio.toFixed(3)} против формулы ${formula.toFixed(3)}`);
});

// ── Отказы ─────────────────────────────────────────────────────────────────
check('нет правила пересчёта — честный отказ', () => {
  const r = uc.convert({ fromUnit: 'шт', value: 10, toField: 'volume_m3', rule: null });
  assert.strictEqual(r.ok, false);
  assert.ok(/нет правила/.test(r.note), 'должно сказать про отсутствие правила');
});

check('нулевой объём — отказ', () => {
  const r = uc.convert({ fromUnit: 'м²', value: 0, toField: 'volume_m3', rule: R() });
  assert.strictEqual(r.ok, false);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
