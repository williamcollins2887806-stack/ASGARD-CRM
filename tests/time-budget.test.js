'use strict';
/**
 * Тесты потерь времени. Проверяют три уровня, защиту от двойного счёта
 * и универсальность (нет аппаратов → нет переходов, а не выдумка).
 */

const path = require('path');
const tb = require(path.join(__dirname, '..', 'src', 'services', 'time-budget'));

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

// ── Уровень A ───────────────────────────────────────────────────────────────
check('A: сумма потерь смены по умолчанию 165 минут', () => {
  eq(tb.inShiftLosses({}).minutes, 165);
});

check('A: состав потерь по видам', () => {
  const l = tb.inShiftLosses({});
  eq(l.by_kind.lunch, 60);
  eq(l.by_kind.breaks, 30);
  eq(l.by_kind.pzr, 30);
  eq(l.by_kind.handover, 15);
  eq(l.by_kind.permit, 30);
});

check('A: h_net не зашит в 9,25 — при 12 ч считается', () => {
  const b = tb.buildTimeBudget({ shift_hours: 12, norm_basis: 'net_productive' });
  near(b.in_shift.h_net, 9.25, 0.01);
});

check('A: при 8-часовой смене h_net = 5,25', () => {
  const b = tb.buildTimeBudget({ shift_hours: 8, norm_basis: 'net_productive' });
  near(b.in_shift.h_net, 5.25, 0.01);
});

check('A: gross-норма — потери не вычитаются повторно', () => {
  const b = tb.buildTimeBudget({ shift_hours: 12, norm_basis: 'gross_12h' });
  eq(b.in_shift.applied, false);
  eq(b.in_shift.h_net, 12);
});

check('A: gross_calendar тоже не добавляет A-потери', () => {
  const b = tb.buildTimeBudget({ shift_hours: 12, norm_basis: 'gross_calendar' });
  eq(b.in_shift.applied, false);
});

// ── Уровень B ───────────────────────────────────────────────────────────────
check('B: один аппарат — ноль переходов (переходить некуда)', () => {
  const s = tb.structuralLosses({ apparatus: 1, posts: 1 });
  eq(s.by_kind.move, 0);
});

check('B: переходы = (аппараты − посты) × часы', () => {
  const s = tb.structuralLosses({ apparatus: 5, posts: 2, profile: { move_intra_h: 1 } });
  eq(s.by_kind.move, 3);
});

check('B: перевозы = (цехи − посты) × часы', () => {
  const s = tb.structuralLosses({ zones: 5, posts: 2, profile: { reloc_inter_zone_h: 4 } });
  eq(s.by_kind.reloc, 12);
});

check('B: наряды по числу аппаратов, если не заданы', () => {
  const s = tb.structuralLosses({ apparatus: 10, posts: 1, profile: { permit_setup_h: 1 } });
  eq(s.by_kind.permit, 10);
});

check('B: явное число нарядов важнее', () => {
  const s = tb.structuralLosses({ apparatus: 10, permitCount: 3, posts: 1, profile: { permit_setup_h: 1 } });
  eq(s.by_kind.permit, 3);
});

check('B: нет данных — ноль и предупреждение, а не выдумка', () => {
  const s = tb.structuralLosses({});
  eq(s.hours, 0);
  if (!s.warnings.some((w) => /не учтены/.test(w))) throw new Error('нет предупреждения');
});

check('B: обвязка считается только по заданным аппаратам', () => {
  const s = tb.structuralLosses({ apparatus: 10, hookupCount: 4, posts: 1, profile: { hookup_h: 2 } });
  eq(s.by_kind.hookup, 8);
});

// ── Уровень C ───────────────────────────────────────────────────────────────
check('C: ожидание умножается на заезды', () => {
  const c = tb.calendarLosses({ trips: 4, waitDays: 2 });
  eq(c.days, 8);
});

check('C: виновник по умолчанию — заказчик', () => {
  eq(tb.calendarLosses({ trips: 1, waitDays: 1 }).blame, 'customer');
});

check('C: наша вина не идёт в себестоимость', () => {
  const c = tb.calendarLosses({ trips: 1, waitDays: 1, blame: 'ours' });
  eq(c.in_cost, false);
});

// ── Сводка ──────────────────────────────────────────────────────────────────
check('сводка: B-потери в чел·сменах учитывают бригаду', () => {
  const b = tb.buildTimeBudget({
    shift_hours: 12, norm_basis: 'net_productive', crew_per_shift: 5,
    structural: { apparatus: 10, posts: 1, profile: { permit_setup_h: 1, move_intra_h: 0, reloc_inter_zone_h: 0 } }
  });
  // 10 нарядов × 1 ч = 10 ч; × 5 чел = 50 чел·ч; / 9,25 = 5,41 чел·смены.
  // Переходы выключены профилем (move_intra_h = 0), иначе +9 ч.
  near(b.structural.hours, 10, 0.1);
  near(b.structural.person_hours, 50, 0.1);
  near(b.structural.shifts, 5.41, 0.1);
});

check('сводка: пустой вход не падает', () => {
  const b = tb.buildTimeBudget({});
  if (!b.in_shift || !b.structural || !b.calendar) throw new Error('неполный результат');
});

// ── Универсальность: разные типы работ ──────────────────────────────────────
check('стройка (захватки, нет аппаратов): переходы не выдумываются', () => {
  const s = tb.structuralLosses({ apparatus: 0, zones: 0, posts: 1 });
  eq(s.by_kind.move, 0);
  eq(s.by_kind.reloc, 0);
});

check('сварка (стыки): наряды считаются, переходы по стыкам — через apparatus', () => {
  const s = tb.structuralLosses({ apparatus: 20, posts: 2, profile: { move_intra_h: 0.5 } });
  eq(s.by_kind.move, 9);
});

check('изоляция (леса): секции дают часы', () => {
  const s = tb.structuralLosses({ sections: 3, profile: { scaffold_h: 4 } });
  eq(s.by_kind.scaffold, 12);
});

console.log('\nитог: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
