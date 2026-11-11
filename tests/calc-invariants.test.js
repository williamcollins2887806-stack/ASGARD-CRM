'use strict';
/**
 * Сквозные инварианты контура: ДВ → MH → люди → срок → смета → цена.
 *
 * ── Что здесь проверяется ─────────────────────────────────────────────────
 * Не конкретные числа (они зависят от данных тендера), а СООТНОШЕНИЯ,
 * которые обязаны держаться при любом наборе:
 *
 *   1. MH не зависит от числа людей: это объём работы, а не расписание.
 *   2. Срок падает при росте людей и смен, но MH не меняется.
 *   3. Σ qty базовых ролей в смете = PS = MH / h_net (инвариант денег).
 *   4. Цена растёт с ростом выездов (дорога и проживание умножаются).
 *   5. Цена НЕ падает при росте числа бригад (люди те же, срок короче).
 *   6. Смета берёт срок из плана, а не считает свой (один срок на контур).
 *
 * Ловушка, которую эти тесты закрывают: формула срока ∝ 1/C при qty без C
 * давала ФОТ, падающий пропорционально числу бригад. Деньги «исчезали»
 * ровно там, где людей становилось больше.
 */

const path = require('path');
const sm = require(path.join(__dirname, '..', 'src', 'services', 'schedule-model'));
const tb = require(path.join(__dirname, '..', 'src', 'services', 'time-budget'));
const cp = require(path.join(__dirname, '..', 'src', 'services', 'crew-plan'));
const smeta = require(path.join(__dirname, '..', 'src', 'services', 'asgard-smeta'));
const st = require(path.join(__dirname, '..', 'src', 'services', 'mimir-tender-stages'));

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS ' + name); }
  catch (e) { fail += 1; console.log('FAIL ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error((msg || '') + ` expected ~${b}, got ${a}`);
}

/** Типовая позиция ДВ на 219 аппаратов. */
function dvFor(count, extra) {
  return Array.from({ length: count }, (_, i) => Object.assign({
    name: 'Теплообменник поз. ' + (1100 + i),
    objects: 1,
    people: 5,
    unit: 'шт',
    volume: 1
  }, extra || {}));
}

// ── 1. MH — объём, а не расписание ──────────────────────────────────────────
check('MH не зависит от числа людей и смен', () => {
  const mh = 5760;
  const a = sm.resolveSchedule({ mh, crew_size: 5, shifts_per_day: 1, fronts: 1 });
  const b = sm.resolveSchedule({ mh, crew_size: 8, shifts_per_day: 2, fronts: 4 });
  eq(a.mh, b.mh, 'MH изменился');
  near(a.ps, b.ps, 0.5, 'PS изменился');
});

check('срок падает при росте смен', () => {
  const mh = 5760;
  const one = sm.resolveSchedule({ mh, shifts_per_day: 1, crew_size: 5, fronts: 1 });
  const two = sm.resolveSchedule({ mh, shifts_per_day: 2, crew_size: 5, fronts: 1 });
  if (!(two.work_days < one.work_days)) throw new Error(one.work_days + ' → ' + two.work_days);
});

check('пик людей растёт со сменами, сменная — нет', () => {
  const mh = 5760;
  const one = sm.resolveSchedule({ mh, shifts_per_day: 1, crew_size: 5, fronts: 2 });
  const two = sm.resolveSchedule({ mh, shifts_per_day: 2, crew_size: 5, fronts: 2 });
  eq(one.headcount_shift, two.headcount_shift, 'сменная численность изменилась');
  eq(two.headcount_peak, one.headcount_peak * 2);
});

// ── 2. Инвариант денег в смете ──────────────────────────────────────────────
check('Σ qty базовых ролей = PS (s=1..2, C=1..3)', () => {
  const mh = 5760;
  for (const s of [1, 2]) {
    for (const C of [1, 2, 3]) {
      const r = sm.resolveSchedule({ mh, shifts_per_day: s, crew_size: 5, fronts: C, trips: 1 });
      const qty = r.crew_size * r.crews * r.work_days * r.shifts_per_day;
      const tol = r.crew_size * r.crews * r.shifts_per_day;
      if (Math.abs(qty - r.ps) > tol) {
        throw new Error('s=' + s + ' C=' + C + ': qty=' + qty + ' PS=' + r.ps);
      }
    }
  }
});

check('ФОТ базовых ролей не падает при росте бригад (деньги не исчезают)', () => {
  // Инвариант про БАЗОВЫЕ роли (мастер + рабочий): их суммарные чел·смены
  // равны PS и не зависят от того, как мы разложили работу по бригадам.
  //
  // ИТР сюда не входит намеренно: он один на объект и работает ровно
  // столько суток, сколько идут работы. Две бригады заканчивают вдвое
  // быстрее — ИТР честно стоит вдвое меньше. Это не утечка денег.
  const baseRowsSum = (est) => (est.rows || [])
    .filter((r) => r.id === 'a2' || r.id === 'a3')
    .reduce((s, r) => s + (Number(r.sum) || 0), 0);

  const one = smeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { shift_hours: 12, work_days: 20, markup: 1.2, calc_formula_version: 2 },
    crew: [{ code: 'itr', role: 'ИТР', count: 1 },
      { code: 'master', role: 'Мастер', count: 1 },
      { code: 'worker', role: 'Слесарь', count: 4 }],
    works: []
  });
  const two = smeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { shift_hours: 12, work_days: 10, markup: 1.2, calc_formula_version: 2 },
    crew: [{ code: 'itr', role: 'ИТР', count: 1 },
      { code: 'master', role: 'Мастер', count: 2 },
      { code: 'worker', role: 'Слесарь', count: 8 }],
    works: []
  });

  const a = baseRowsSum(one);
  const b = baseRowsSum(two);
  if (a <= 0) throw new Error('базовые роли не посчитаны: ' + a);
  if (Math.abs(a - b) > a * 0.02) {
    throw new Error('ФОТ базовых ролей разъехался: ' + a + ' → ' + b);
  }
});

// ── 3. Смета берёт срок из плана ────────────────────────────────────────────
check('смета v2 не перезаписывает срок из works', () => {
  const est = smeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { work_days: 12, calc_formula_version: 2 },
    crew: [{ code: 'master', role: 'Мастер', count: 1 }, { code: 'worker', role: 'Слесарь', count: 4 }],
    works: [{ name: 'Мойка', people: 5, days: 40 }]
  });
  eq(est.params.work_days, 12, 'срок перезаписан');
});

check('смета v1 (наследие) по-прежнему выводит срок из works', () => {
  const est = smeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { work_days: 12, calc_formula_version: 1 },
    crew: [{ code: 'master', role: 'Мастер', count: 1 }, { code: 'worker', role: 'Слесарь', count: 4 }],
    works: [{ name: 'Мойка', people: 5, days: 40 }]
  });
  eq(est.params.work_days, 40, 'легаси-поведение сломано');
});

// ── 4. Выезды: дорога и проживание умножаются ───────────────────────────────
check('цена растёт с числом выездов', () => {
  const base = {
    template: 'asgard_v1',
    crew: [{ code: 'master', role: 'Мастер', count: 1 }, { code: 'worker', role: 'Слесарь', count: 4 }],
    works: []
  };
  const one = smeta.recalcAsgardSmeta(Object.assign({}, base, {
    params: { work_days: 10, trip_count: 1, road_days: 2, mob_days: 4, calc_formula_version: 2 }
  }));
  const six = smeta.recalcAsgardSmeta(Object.assign({}, base, {
    params: { work_days: 10, trip_count: 6, road_days: 2, mob_days: 4, calc_formula_version: 2 }
  }));
  if (!(six.totals.cost > one.totals.cost)) {
    throw new Error('6 выездов не дороже 1: ' + one.totals.cost + ' → ' + six.totals.cost);
  }
});

// ── 5. Строка непроизводственных операций ───────────────────────────────────
check('A7 появляется при структурных потерях и = 0 без них', () => {
  const crew = [{ code: 'master', role: 'Мастер', count: 1 }, { code: 'worker', role: 'Слесарь', count: 4 }];
  const withLoss = smeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { work_days: 10, apparatus_count: 20, zone_count: 3, crews: 2, calc_formula_version: 2 },
    crew, works: []
  });
  const without = smeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { work_days: 10, apparatus_count: 0, zone_count: 0, calc_formula_version: 2 },
    crew, works: []
  });
  const a7 = (withLoss.rows || []).find((r) => r.id === 'a7');
  const a7z = (without.rows || []).find((r) => r.id === 'a7');
  if (!a7 || !(a7.qty > 0)) throw new Error('A7 пустая при 20 аппаратах');
  if (a7z && a7z.qty > 0) throw new Error('A7 начислена без потерь');
});

// ── 6. Сквозной прогон: ДВ → план → смета ───────────────────────────────────
check('сквозной: 219 позиций дают связный план и смету', () => {
  const positions = dvFor(219, { days: 0.5, shifts: 1 });
  const plan = st.normalizeCalcPlan({ positions }, { max_parallel_posts: 2 });

  // План обязан дать людей и срок, а не null.
  if (!(plan.people_total > 0)) throw new Error('people_total = ' + plan.people_total);
  if (!(plan.work_days > 0)) throw new Error('work_days = ' + plan.work_days);
  // Человеко-часы ненулевые: без них срок — гадание.
  if (!(plan.man_hours > 0)) throw new Error('man_hours = ' + plan.man_hours);

  // Смета на основе плана: срок тот же, состав тот же.
  const est = smeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    crew: plan.crew,
    params: {
      work_days: plan.work_days,
      shifts_per_day: plan.shifts_per_day || 2,
      shift_hours: plan.shift_hours || 12,
      trip_count: plan.trip_count || 1,
      calc_formula_version: 2
    },
    works: plan.positions.map((p) => ({ name: p.name, people: p.people, days: p.days }))
  });
  eq(est.params.work_days, plan.work_days, 'срок разъехался');
  if (!(est.totals.price_no_vat > 0)) throw new Error('цена 0');
});

check('сквозной: 1 позиция не даёт абсурда', () => {
  const plan = st.normalizeCalcPlan({
    positions: [{ name: 'Мойка', people: 2, days: 1 }]
  }, { max_parallel_posts: 1 });
  if (!(plan.work_days >= 1)) throw new Error('work_days=' + plan.work_days);
  if (!Number.isFinite(plan.man_hours)) throw new Error('man_hours NaN');
});

// ── 7. Универсальность: типы работ ──────────────────────────────────────────
check('стройка (захватки, нет аппаратов): план считается', () => {
  const plan = st.normalizeCalcPlan({
    positions: [
      { name: 'Устройство фундамента', people: 6, days: 15, unit: 'м3', volume: 100 },
      { name: 'Кладка стен', people: 4, days: 20, unit: 'м3', volume: 60 }
    ]
  }, { max_parallel_posts: 2 });
  if (!(plan.work_days > 0)) throw new Error('срок 0');
  if (!(plan.people_total > 0)) throw new Error('люди 0');
});

check('сварка: сварщик попадает в состав', () => {
  const plan = st.normalizeCalcPlan({
    positions: [{ name: 'Сварка стыков трубопровода', people: 3, days: 5, hazard: ['fire'] }]
  });
  if (!plan.crew.some((r) => r.role_code === 'welder')) {
    throw new Error('нет сварщика: ' + plan.crew.map((r) => r.role_code).join(','));
  }
});

check('химия: химик попадает в состав', () => {
  const plan = st.normalizeCalcPlan({
    positions: [{ name: 'Кислотная промывка котла', people: 4, days: 6 }]
  });
  if (!plan.crew.some((r) => r.role_code === 'chemist')) {
    throw new Error('нет химика: ' + plan.crew.map((r) => r.role_code).join(','));
  }
});

// ── 8. Потери: три уровня связаны с h_net ───────────────────────────────────
check('A-потери влияют на h_net, B — нет (это отдельная строка)', () => {
  const budget = tb.buildTimeBudget({
    shift_hours: 12,
    norm_basis: 'net_productive',
    crew_per_shift: 5,
    structural: { apparatus: 20, zones: 3, posts: 2 }
  });
  near(budget.in_shift.h_net, 9.25, 0.01);
  if (!(budget.structural.hours > 0)) throw new Error('B-потери = 0');
});

check('gross-норма: h_net = shift_hours, A не вычитаются', () => {
  const budget = tb.buildTimeBudget({ shift_hours: 12, norm_basis: 'gross_12h', crew_per_shift: 5 });
  eq(budget.in_shift.h_net, 12);
  eq(budget.in_shift.applied, false);
});

// ── 9. Состав бригады: отсутствие регресса ──────────────────────────────────
check('химик не теряется, если hazard пуст (регресс-контроль)', () => {
  const plan = cp.planPositionCrew({
    position: { name: 'Обработка', tech_equip: 'раствор кислоты', hazard: [], people: 3 }
  });
  if (!plan.roles.some((r) => r.role_code === 'chemist')) throw new Error('химик пропал');
});

check('наблюдающих столько же, сколько исполнителей внутри аппарата', () => {
  const plan = cp.planPositionCrew({
    position: { name: 'Чистка внутренней поверхности ёмкости', people: 5 }
  });
  const workers = plan.roles.find((r) => r.role_code === 'worker').count;
  const observers = plan.roles.find((r) => r.role_code === 'observer').count;
  eq(observers, workers, 'наблюдающих ' + observers + ' при ' + workers + ' исполнителях');
});

// ── 10. Устойчивость к мусору ───────────────────────────────────────────────
check('мусорные данные не дают NaN в цене', () => {
  const est = smeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    crew: [{ code: 'worker', role: 'Слесарь', count: 3 }],
    params: { work_days: 5, trip_count: 0, road_days: 'abc', shift_hours: null },
    works: [{ name: '', people: null, days: null }]
  });
  if (!Number.isFinite(est.totals.price_no_vat)) throw new Error('цена NaN');
});

check('500 позиций: план считается менее чем за 2 с', () => {
  const positions = dvFor(500, { days: 0.5 });
  const t0 = Date.now();
  const plan = st.normalizeCalcPlan({ positions }, { max_parallel_posts: 3 });
  const ms = Date.now() - t0;
  if (ms > 2000) throw new Error(ms + ' мс');
  if (!(plan.work_days > 0)) throw new Error('срок 0');
});

console.log('\nитог: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
