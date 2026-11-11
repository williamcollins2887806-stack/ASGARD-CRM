'use strict';
/**
 * Тесты расчётной модели. Проверяют ИНВАРИАНТЫ, а не конкретные числа:
 * инвариант не зависит от формулы и не закрепляет дефект.
 */

const path = require('path');
const sm = require(path.join(__dirname, '..', 'src', 'services', 'schedule-model'));

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS ' + name); }
  catch (e) { fail += 1; console.log('FAIL ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ` expected ${b}, got ${a}`);
}
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error((msg || '') + ` expected ~${b}, got ${a}`);
}

// ── Ёмкость смены ───────────────────────────────────────────────────────────
check('h_net: 12 ч минус 165 минут = 9,25', () => {
  const c = sm.shiftCapacity({ shift_hours: 12 });
  eq(c.loss_min, 165);
  near(c.h_net, 9.25, 0.01);
  near(c.k_shift, 0.771, 0.002);
});

check('h_net: 8 ч при тех же потерях = 5,25 (не константа 9,25)', () => {
  const c = sm.shiftCapacity({ shift_hours: 8 });
  near(c.h_net, 5.25, 0.01);
});

check('gross-норма: потери не вычитаются повторно', () => {
  const c = sm.shiftCapacityForBasis({ shift_hours: 12, norm_basis: 'gross_12h' });
  eq(c.h_net, 12);
  eq(c.applied, false);
});

check('net-норма: потери вычитаются', () => {
  const c = sm.shiftCapacityForBasis({ shift_hours: 12, norm_basis: 'net_productive' });
  near(c.h_net, 9.25, 0.01);
  eq(c.applied, true);
});

// ── Фронты ──────────────────────────────────────────────────────────────────
check('fronts: без данных = 1 и предупреждение, а не выдумка', () => {
  const f = sm.resolveFronts({});
  eq(f.fronts, 1);
  eq(f.source, 'default');
  if (!f.warning) throw new Error('должно быть предупреждение');
});

check('fronts: objects задаёт число фронтов', () => {
  eq(sm.resolveFronts({ objects: 12 }).fronts, 12);
});

check('fronts: ручной ввод РП главнее', () => {
  eq(sm.resolveFronts({ objects: 12, manual: 3 }).fronts, 3);
});

// ── Инвариант денег ─────────────────────────────────────────────────────────
check('инвариант суммы qty = PS на s=1..3 и C=1..3', () => {
  const MH = 5760;
  for (const s of [1, 2, 3]) {
    for (const fronts of [1, 2, 3]) {
      const r = sm.resolveSchedule({
        mh: MH, shift_hours: 12, crew_size: 5, shifts_per_day: s,
        fronts, max_crews: 6, trips: 1
      });
      // Без окна бригады подбираются от объёма, поэтому C может быть меньше
      // fronts — проверяем не «C = fronts», а сам инвариант.
      if (r.crews < 1 || r.crews > fronts) throw new Error('C=' + r.crews + ' при fronts=' + fronts);
      const qty = r.crew_size * r.crews * r.work_days * r.shifts_per_day;
      const tol = r.crew_size * r.crews * r.shifts_per_day;
      if (Math.abs(qty - r.ps) > tol) {
        throw new Error('s=' + s + ' fronts=' + fronts + ': qty=' + qty + ', PS=' + r.ps + ', tol=' + tol);
      }
    }
  }
});

check('инвариант не зависит от s: PS одинаков при 1/2 сменах', () => {
  const a = sm.resolveSchedule({ mh: 5760, shift_hours: 12, crew_size: 5, shifts_per_day: 1, fronts: 1 });
  const b = sm.resolveSchedule({ mh: 5760, shift_hours: 12, crew_size: 5, shifts_per_day: 2, fronts: 1 });
  near(a.ps, b.ps, 0.1, 'PS не должен зависеть от смен');
});

check('смены сокращают срок примерно вдвое', () => {
  const a = sm.resolveSchedule({ mh: 5760, shift_hours: 12, crew_size: 5, shifts_per_day: 1, fronts: 1 });
  const b = sm.resolveSchedule({ mh: 5760, shift_hours: 12, crew_size: 5, shifts_per_day: 2, fronts: 1 });
  const ratio = a.work_days / b.work_days;
  if (ratio < 1.8 || ratio > 2.2) throw new Error('отношение срока ' + ratio);
});

check('пик людей растёт со сменами', () => {
  const a = sm.resolveSchedule({ mh: 5760, shift_hours: 12, crew_size: 5, shifts_per_day: 1, fronts: 2 });
  const b = sm.resolveSchedule({ mh: 5760, shift_hours: 12, crew_size: 5, shifts_per_day: 2, fronts: 2 });
  eq(a.headcount_peak * 2, b.headcount_peak);
});

// ── Бригады и физика ────────────────────────────────────────────────────────
check('один аппарат: бригад не больше 1', () => {
  const r = sm.resolveSchedule({ mh: 3660, shift_hours: 12, crew_size: 5, shifts_per_day: 2, fronts: 1 });
  eq(r.crews, 1);
});

check('61 аппарат: бригад больше 1 при большом объёме', () => {
  const r = sm.resolveSchedule({
    mh: 5760 * 10, shift_hours: 12, crew_size: 5, shifts_per_day: 2,
    fronts: 61, max_crews: 6, window_days: 30
  });
  if (r.crews <= 1) throw new Error('бригад ' + r.crews);
});

check('available_crews = null не даёт Infinity', () => {
  const r = sm.resolveSchedule({
    mh: 5760, shift_hours: 12, crew_size: 5, shifts_per_day: 1,
    fronts: 4, available_crews: null
  });
  if (!Number.isFinite(r.work_days)) throw new Error('work_days=' + r.work_days);
  eq(r.crews_org, null);
});

check('окно съедено дорогой: нет Infinity', () => {
  const r = sm.resolveSchedule({
    mh: 5760, shift_hours: 12, crew_size: 5, shifts_per_day: 1,
    fronts: 2, window_days: 10, trips: 3, mob_days: 4, road_days: 2
  });
  if (!Number.isFinite(r.work_days)) throw new Error('work_days=' + r.work_days);
  eq(r.crews_needed, null);
});

check('3×12 = 36 ч в сутки отклоняется', () => {
  const r = sm.resolveSchedule({ mh: 5760, shift_hours: 12, crew_size: 5, shifts_per_day: 3, fronts: 1 });
  if (r.shifts_per_day >= 3) throw new Error('принято ' + r.shifts_per_day);
  if (!r.warnings.some((w) => /больше 24/.test(w))) throw new Error('нет предупреждения');
});

check('3×8 = 24 ч допустимо', () => {
  const r = sm.resolveSchedule({ mh: 5760, shift_hours: 8, crew_size: 5, shifts_per_day: 3, fronts: 1 });
  eq(r.shifts_per_day, 3);
});

// ── Крайние случаи ──────────────────────────────────────────────────────────
check('1 позиция: срок >= 1 сут, нет NaN', () => {
  const r = sm.resolveSchedule({ mh: 40, shift_hours: 12, crew_size: 5, shifts_per_day: 1, fronts: 1 });
  if (!(r.work_days >= 1)) throw new Error('work_days=' + r.work_days);
});

check('500 позиций считается быстро и без NaN', () => {
  const t0 = Date.now();
  const r = sm.resolveSchedule({
    mh: 5760 * 8, shift_hours: 12, crew_size: 5, shifts_per_day: 2,
    fronts: 20, max_crews: 6, window_days: 90
  });
  if (!Number.isFinite(r.work_days)) throw new Error('NaN');
  if (Date.now() - t0 > 200) throw new Error('медленно');
});

check('20 заездов: календарь учитывает дорогу на каждый', () => {
  const r = sm.resolveSchedule({
    mh: 5760, shift_hours: 12, crew_size: 5, shifts_per_day: 1,
    fronts: 1, trips: 20, mob_days: 4, road_days: 2
  });
  const expected = 20 * (r.work_days / 20 + 4 + 4);
  near(r.calendar_days, expected, 0.5);
});

check('нулевой объём: work_days = null, без деления на ноль', () => {
  const r = sm.resolveSchedule({ mh: 0, shift_hours: 12, crew_size: 5, shifts_per_day: 1, fronts: 1 });
  eq(r.work_days, null);
});

console.log('\nитог: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
