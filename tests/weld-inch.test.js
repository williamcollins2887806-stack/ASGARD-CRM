'use strict';
/**
 * Сварка: дюймы через два сортамента, длина шва с поправкой на стенку.
 *
 * Исследование 06.11.2026 предупредило о трёх ошибках:
 *  1) «нормы НАКС» не существует — НАКС это аттестация, нормы в ЕНиР/ГЭСН;
 *  2) дюймы нельзя умножать на 25,4: 2″ это DN50 и OD 60,3 мм (EN) или 57 (ГОСТ);
 *  3) заварка течи не переводится в метры шва — это отдельная ремонтная работа.
 */
const assert = require('assert');
const uc = require('../src/services/unit-convert');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// ── Дюймы: два сортамента ──────────────────────────────────────────────────
check('2″ по EN = 60,3 мм, по ГОСТ = 57,0 мм', () => {
  assert.strictEqual(uc.inchToMm('2', 'eu').od_mm, 60.3);
  assert.strictEqual(uc.inchToMm('2', 'gost').od_mm, 57.0);
});

check('4″ по EN = 114,3, по ГОСТ = 108', () => {
  assert.strictEqual(uc.inchToMm('4', 'eu').od_mm, 114.3);
  assert.strictEqual(uc.inchToMm('4', 'gost').od_mm, 108.0);
});

check('6″ по EN = 168,3, по ГОСТ = 159 (было ошибочно 165)', () => {
  assert.strictEqual(uc.inchToMm('6', 'eu').od_mm, 168.3);
  assert.strictEqual(uc.inchToMm('6', 'gost').od_mm, 159.0);
});

check('14″ по EN = 355,6, по ГОСТ = 377', () => {
  assert.strictEqual(uc.inchToMm('14', 'eu').od_mm, 355.6);
  assert.strictEqual(uc.inchToMm('14', 'gost').od_mm, 377.0);
});

check('20″ по EN = 508, по ГОСТ = 530', () => {
  assert.strictEqual(uc.inchToMm('20', 'eu').od_mm, 508.0);
  assert.strictEqual(uc.inchToMm('20', 'gost').od_mm, 530.0);
});

check('сортамент виден в результате', () => {
  assert.strictEqual(uc.inchToMm('2', 'eu').standard, 'eu');
  assert.strictEqual(uc.inchToMm('2', 'gost').standard, 'gost');
});

check('дробные дюймы работают: 1 1/2″ = DN40', () => {
  const r = uc.inchToMm('1 1/2');
  assert.strictEqual(r.dn_mm, 40);
  assert.strictEqual(r.od_mm, 48.3);
});

check('дюймы НЕ умножаются на 25,4', () => {
  // 2 × 25,4 = 50,8 — это ошибка, занижает длину шва на 19%.
  const right = uc.inchToMm('2', 'eu').od_mm;
  assert.ok(right > 55, 'должно быть 60,3, а не 50,8: ' + right);
});

// ── Длина шва и поправка на стенку ─────────────────────────────────────────
check('один стык Ду159 = 0,4995 м шва', () => {
  assert.strictEqual(uc.weldLengthPerJoint(159), 0.4995);
});

check('толстостенная труба: поправка на внутренний диаметр > 10%', () => {
  // D114 × S6: S/D = 0.053 < 0.1 — поправка не критична.
  const thin = uc.weldLengthDetailed(114, 6);
  assert.ok(thin.diffPct < 12, 'для S6 разница около 11%: ' + thin.diffPct);

  // D325 × S22: S/D = 0.068 — тоже не критично.
  const mid = uc.weldLengthDetailed(325, 22);
  assert.ok(mid.diffPct > 0, 'поправка должна быть посчитана');

  // D159 × S20: S/D = 0.126 > 0.1 — применять корневой проход.
  const thick = uc.weldLengthDetailed(159, 20);
  assert.strictEqual(thick.useRoot, true, 'для толстой стенки нужен корневой проход');
  assert.ok(thick.root < thick.outer, 'корень короче наружного');
});

check('без толщины стенки поправка не выдумывается', () => {
  const r = uc.weldLengthDetailed(159, 0);
  assert.strictEqual(r.diffPct, 0, 'без стенки разницы нет');
  assert.strictEqual(r.useRoot, false);
});

// ── Трубки: по внутреннему диаметру ───────────────────────────────────────
check('площадь трубки 25×2 по внутреннему меньше наружного на 19%', () => {
  const inner = uc.tubeAreaM2(25, 3, { inner: true, wallMm: 2 });
  const outer = uc.tubeAreaM2(25, 3, { inner: false, wallMm: 2 });
  const diffPct = (outer - inner) / outer * 100;
  assert.ok(diffPct > 15 && diffPct < 23, `должно быть около 19%: ${diffPct.toFixed(1)}%`);
});

check('трубка 20×1 L=3 по внутреннему = 0,1696 м²', () => {
  assert.strictEqual(uc.tubeAreaM2(20, 3, { inner: true, wallMm: 1 }), 0.1696);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
