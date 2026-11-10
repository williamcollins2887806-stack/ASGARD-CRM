'use strict';
/**
 * Смета должна расти от объёма работ, а человеко-смены — пересчитываться при
 * правке режима смен.
 *
 * ── Почему эти тесты появились (10.11.2026) ────────────────────────────────
 * На проде 10 закрытых просчётов имели одинаковую структуру: ФОТ = бригада ×
 * сутки, а объём работ (сотни позиций ведомости) в деньгах не участвовал.
 * Тендер на 600 позиций и тендер на 6 позиций при одной бригаде давали одну
 * цену. Плюс «Смен в сутки» в техплане не меняло строки A: смены были прибиты
 * в crew[] при сборке сметы из анализа.
 *
 * Тесты фиксируют оба требования, чтобы дефект не вернулся.
 */

const assert = require('assert');
const smeta = require('../src/services/asgard-smeta');
const stages = require('../src/services/mimir-tender-stages');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + ' — ' + e.message); }
}

function positions(n, people, days) {
  const out = [];
  for (let i = 1; i <= n; i += 1) {
    out.push({ id: 'p' + i, name: 'Работа ' + i, people, days, shifts: 2, shift_hours: 12, source: 'norm' });
  }
  return { positions: out };
}

check('план: человеко-сутки = people × days (а не сумма суток)', () => {
  const plan = stages.normalizeCalcPlan(positions(10, 5, 2), {});
  // 10 позиций × 5 чел × 2 сут = 100 чел·суток
  assert.strictEqual(plan.person_days, 100, 'person_days=' + plan.person_days);
  // Бригады по 5: каждая позиция — одна бригада × 2 сут = 20 бригадо-суток
  assert.strictEqual(plan.total_crew_days, 20, 'total_crew_days=' + plan.total_crew_days);
});

check('план: больше объём → больше срок', () => {
  const small = stages.normalizeCalcPlan(positions(6, 5, 2), {});
  const big = stages.normalizeCalcPlan(positions(600, 5, 2), {});
  assert.ok(big.work_days > small.work_days * 5,
    `срок почти не вырос: 6 поз. → ${small.work_days}, 600 поз. → ${big.work_days}`);
});

check('план: больше объём → больше человеко-часов', () => {
  const small = stages.normalizeCalcPlan(positions(6, 5, 2), {});
  const big = stages.normalizeCalcPlan(positions(600, 5, 2), {});
  assert.ok(big.man_hours > small.man_hours * 50,
    `трудозатраты не выросли: ${small.man_hours} → ${big.man_hours}`);
});

function estFor(workDays, shifts) {
  return {
    params: { work_days: workDays, shifts_per_day: shifts, shift_hours: 12 },
    crew: [
      { code: 'itr', role: 'ИТР (РП)', count: 1 },
      { code: 'master', role: 'Мастер', count: 1 },
      { code: 'worker', role: 'Слесарь', count: 4 }
    ],
    rows: []
  };
}

check('смета: срок из плана влияет на себестоимость', () => {
  const a = smeta.recalcAsgardSmeta(estFor(10, 2));
  const b = smeta.recalcAsgardSmeta(estFor(30, 2));
  assert.ok(b.totals.cost > a.totals.cost * 2,
    `себестоимость почти не выросла при сроке 10→30: ${a.totals.cost} → ${b.totals.cost}`);
});

check('смены 2→3 пересчитывают строки A1/A2/A3', () => {
  const a = smeta.recalcAsgardSmeta(estFor(10, 2));
  const b = smeta.recalcAsgardSmeta(estFor(10, 3));
  const qty = (e, code) => (e.rows.find((r) => r.code === code) || {}).qty;
  assert.strictEqual(qty(a, 'A2'), 20, 'A2 при 2 сменах = ' + qty(a, 'A2'));
  assert.strictEqual(qty(b, 'A2'), 30, 'A2 при 3 сменах не пересчитан: ' + qty(b, 'A2'));
  assert.strictEqual(qty(b, 'A3'), 120, 'A3 не пересчитан: ' + qty(b, 'A3'));
});

check('смены 2→3 пересчитывают person_shifts и man_hours', () => {
  const a = smeta.recalcAsgardSmeta(estFor(10, 2));
  const b = smeta.recalcAsgardSmeta(estFor(10, 3));
  assert.ok(b.totals.person_shifts > a.totals.person_shifts,
    `person_shifts не выросли: ${a.totals.person_shifts} → ${b.totals.person_shifts}`);
  assert.ok(b.totals.man_hours > a.totals.man_hours,
    `man_hours не выросли: ${a.totals.man_hours} → ${b.totals.man_hours}`);
  // Инвариант: человеко-смены = сумма количеств по строкам секции A
  // (это те смены, за которые платим в ФОТ). Раньше считали только
  // рабочих и мастеров, и знаменатель расходился со сметой.
  const aSum = (est) => est.rows
    .filter((r) => r.kind === 'line' && r.section === 'A')
    .reduce((s, r) => s + (Number(r.qty) || 0), 0);
  assert.strictEqual(b.totals.person_shifts, aSum(b),
    `person_shifts ${b.totals.person_shifts} ≠ Σ строк A ${aSum(b)}`);
});

check('явно заданные смены роли перебивают режим объекта', () => {
  const est = estFor(10, 3);
  est.crew[2] = { code: 'worker', role: 'Слесарь', count: 4, shifts_per_day: 2, shifts_locked: true };
  const r = smeta.recalcAsgardSmeta(est);
  assert.strictEqual(r.rows.find((x) => x.code === 'A3').qty, 80, 'A3 = ' + r.rows.find((x) => x.code === 'A3').qty);
  assert.strictEqual(r.rows.find((x) => x.code === 'A2').qty, 30, 'A2 = ' + r.rows.find((x) => x.code === 'A2').qty);
});

check('перечень работ попадает в смету справочным блоком W', () => {
  const est = estFor(10, 2);
  est.works = [{ name: 'Чистка АВО', unit: 'м2', volume: 350, people: 5, days: 2, volume_source: 'вор' }];
  const r = smeta.recalcAsgardSmeta(est);
  const w = r.rows.filter((x) => x.section === 'W');
  assert.ok(w.length >= 2, 'блок W не собран: ' + w.length);
  const line = w.find((x) => x.kind === 'info' && /Чистка АВО/.test(x.name));
  assert.ok(line, 'работа не попала в блок W');
  assert.ok(/вор/.test(String(line.note)), 'источник объёма не показан: ' + line.note);
});

check('блок W не входит в себестоимость', () => {
  const a = smeta.recalcAsgardSmeta(estFor(10, 2));
  const b = estFor(10, 2);
  b.works = [{ name: 'Чистка АВО', unit: 'м2', volume: 350, people: 5, days: 2 }];
  const c = smeta.recalcAsgardSmeta(b);
  assert.strictEqual(c.totals.cost, a.totals.cost, 'перечень работ задвоил себестоимость');
});

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
