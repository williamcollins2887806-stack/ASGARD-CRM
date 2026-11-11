'use strict';
/**
 * time-budget.js — потери времени трёх уровней.
 *
 * ── Почему не один коэффициент ────────────────────────────────────────────
 * В проекте был `k_irv = 0.82` («ПЗР, обед, переходы, инструктажи»), и он
 * смешивал три разных вещи в одно число, применялся в двух ветках из шести и
 * не доходил ни до РП, ни до календаря. Здесь три уровня, у каждого свой
 * адресат:
 *
 *   A. Внутрисменные  — обед, перекуры, ПЗР, передача, наряд.
 *                       Уменьшают ёмкость смены (12 ч → 9,25 ч).
 *   B. Структурные    — наряд на аппарат, обвязка, переходы, перевозы,
 *                       леса, приёмка. Считаются в ЧАСАХ на весь объём и
 *                       идут отдельной строкой сметы. Не прячутся в норме.
 *   C. Календарные    — ожидание доступа, окно останова, погода.
 *                       Меняют календарь и резерв, но не ФОТ работы.
 *
 * ── Правило против двойного счёта ─────────────────────────────────────────
 * Если норма «gross» (потери уже внутри минут), A-потери повторно не
 * вычитаются. Признак — params_json.norm_basis. B-потери добавляются всегда:
 * переходов и нарядов нет ни в одной норме на трубку.
 *
 * ── Универсальность ───────────────────────────────────────────────────────
 * Все входы опциональны. У сварки нет «цехов», у стройки нет «аппаратов» —
 * отсутствующее поле даёт 0 потерь этого вида и предупреждение, а не
 * выдуманное число.
 */

/** Значения по умолчанию — если globals недоступны. */
const DEFAULTS = {
  // A: минуты внутри смены
  lunch: 60,
  breaks: 30,
  pzr: 30,
  handover: 15,
  permit: 30,
  // B: часы на единицу
  permit_setup_h: 1,
  move_intra_h: 0.67,
  reloc_inter_zone_h: 4,
  hookup_h: 1,
  scaffold_h: 4,
  accept_h: 2
};

/**
 * Приводит карту глобалов из БД к профилю потерь.
 * @param {object} [globals] — { shift_lunch_min: 60, move_intra_h: 0.67, ... }
 * @returns {object} профиль с полями в единицах своего уровня
 */
function profileFromGlobals(globals) {
  const g = globals || {};
  const num = (k, d) => {
    const v = Number(g[k]);
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  return {
    // A — минуты
    lunch: num('shift_lunch_min', DEFAULTS.lunch),
    breaks: num('shift_breaks_min', DEFAULTS.breaks),
    pzr: num('shift_pzr_min', DEFAULTS.pzr),
    handover: num('shift_handover_min', DEFAULTS.handover),
    permit: num('permit_daily_min', DEFAULTS.permit),
    // B — часы
    permit_setup_h: num('permit_setup_h', DEFAULTS.permit_setup_h),
    move_intra_h: num('move_intra_h', DEFAULTS.move_intra_h),
    reloc_inter_zone_h: num('reloc_inter_zone_h', DEFAULTS.reloc_inter_zone_h),
    hookup_h: num('hookup_h', DEFAULTS.hookup_h),
    scaffold_h: num('scaffold_h', DEFAULTS.scaffold_h),
    accept_h: num('accept_h', DEFAULTS.accept_h)
  };
}

/**
 * Уровень A: сколько минут смены уходит на непроизводственные нужды.
 * @param {object} profile
 * @returns {{minutes:number, by_kind:object}}
 */
function inShiftLosses(profile) {
  const p = Object.assign({}, DEFAULTS, profile || {});
  const byKind = {
    lunch: Number(p.lunch) || 0,
    breaks: Number(p.breaks) || 0,
    pzr: Number(p.pzr) || 0,
    handover: Number(p.handover) || 0,
    permit: Number(p.permit) || 0
  };
  const minutes = Object.values(byKind).reduce((s, v) => s + v, 0);
  return { minutes, by_kind: byKind };
}

/**
 * Уровень B: структурные потери в ЧАСАХ на весь объём.
 *
 * Логика (F − P): первый аппарат каждой бригады перехода не требует, поэтому
 * из числа аппаратов вычитаем число бригад. На одном аппарате это даёт 0 —
 * правильно: переходить некуда.
 *
 * @param {object} p
 * @param {number} [p.apparatus] — число аппаратов/фронтов
 * @param {number} [p.zones] — число цехов/зон
 * @param {number} [p.posts] — одновременно работающих бригад
 * @param {number} [p.permitCount] — нарядов (0 = по числу аппаратов)
 * @param {number} [p.hookupCount] — аппаратов с обвязкой (0 = 0)
 * @param {number} [p.sections] — секций лесов
 * @param {number} [p.stages] — этапов приёмки
 * @param {object} [p.profile]
 * @returns {{hours:number, by_kind:object, warnings:string[]}}
 */
function structuralLosses(p) {
  const o = p || {};
  const prof = Object.assign({}, DEFAULTS, o.profile || {});
  // ВАЖНО: 0 — это ЗНАЧЕНИЕ, а не «нет данных». Раньше `n > 0 ? n : d`
  // превращал явный 0 в дефолт, и отключить потерю было нельзя
  // (move_intra_h: 0 всё равно давало 0,67 ч на переход).
  const num = (v, d = 0) => {
    if (v == null || v === '') return d;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };

  const apparatus = num(o.apparatus);
  const zones = num(o.zones);
  const posts = Math.max(1, num(o.posts, 1));
  const permits = o.permitCount != null ? num(o.permitCount) : apparatus;
  const hookups = num(o.hookupCount);
  const sections = num(o.sections);
  const stages = num(o.stages);

  const warnings = [];

  // Переходы: (F − P), не меньше нуля.
  const moves = apparatus > 0 ? Math.max(0, apparatus - posts) : 0;
  const moveHours = moves * prof.move_intra_h;

  // Перевозы: (Z − P), не меньше нуля.
  const relocs = zones > 0 ? Math.max(0, zones - posts) : 0;
  const relocHours = relocs * prof.reloc_inter_zone_h;

  const permitHours = permits * prof.permit_setup_h;
  const hookupHours = hookups * prof.hookup_h;
  const scaffoldHours = sections * prof.scaffold_h;
  const acceptHours = stages * prof.accept_h;

  if (apparatus <= 0 && zones <= 0 && permits <= 0) {
    warnings.push('потери B не учтены: не заданы аппараты/цехи/наряды');
  }

  const byKind = {
    move: round2(moveHours),
    reloc: round2(relocHours),
    permit: round2(permitHours),
    hookup: round2(hookupHours),
    scaffold: round2(scaffoldHours),
    accept: round2(acceptHours)
  };
  const hours = Object.values(byKind).reduce((s, v) => s + v, 0);

  return { hours: round2(hours), by_kind: byKind, warnings };
}

/**
 * Уровень C: календарные потери.
 *
 * Ожидание и погода НЕ входят в ФОТ работы: люди либо не на объекте, либо
 * это предмет перевыставления заказчику. Возвращаются отдельно с виновником.
 *
 * @param {object} p
 * @param {number} p.trips
 * @param {number} [p.waitDays] — ожидание на заезд
 * @param {number} [p.weatherDays] — погодные на заезд
 * @param {string} [p.blame] — customer | ours | force_majeure
 * @returns {{days:number, per_trip:number, blame:string, in_cost:boolean}}
 */
function calendarLosses(p) {
  const o = p || {};
  const trips = Math.max(1, Number(o.trips) || 1);
  const wait = Math.max(0, Number(o.waitDays) || 0);
  const weather = Math.max(0, Number(o.weatherDays) || 0);
  const perTrip = wait + weather;
  const days = perTrip * trips;
  const blame = ['customer', 'ours', 'force_majeure'].includes(String(o.blame))
    ? String(o.blame)
    : 'customer';
  return {
    days: round2(days),
    per_trip: round2(perTrip),
    blame,
    // В себестоимость идёт только если виноваты не мы.
    in_cost: blame !== 'ours'
  };
}

/**
 * Сводка всех трёх уровней.
 *
 * @param {object} p
 * @returns {object}
 */
function buildTimeBudget(p) {
  const o = p || {};
  const profile = o.profile || profileFromGlobals(o.globals);
  const shiftHours = Number(o.shift_hours) > 0 ? Number(o.shift_hours) : 12;
  const basis = String(o.norm_basis || 'net_productive');

  const inShift = inShiftLosses(profile);
  // Профиль из structural главнее общего: он позволяет точечно отключить
  // вид потерь (например, move_intra_h: 0 для одного расчёта).
  const structuralProfile = Object.assign(
    {},
    profile,
    (o.structural && o.structural.profile) || {}
  );
  const structural = structuralLosses(Object.assign({}, o.structural, { profile: structuralProfile }));
  const calendar = calendarLosses(Object.assign({}, o.calendar, { trips: o.trips }));

  // Применяются ли A-потери: только если норма «net».
  const applyInShift = basis !== 'gross_12h' && basis !== 'gross_calendar';
  const hNet = applyInShift
    ? Math.max(1, shiftHours - inShift.minutes / 60)
    : shiftHours;

  // B-потери в чел·сменах: часы / производительных часов в смене.
  // Умножаем на людей в смене, потому что часы структурных потерь — это
  // работа ВСЕЙ бригады (переход, наряд, обвязка).
  const crewPerShift = Math.max(1, Number(o.crew_per_shift) || 1);
  const lossPersonHours = structural.hours * crewPerShift;
  const lossShifts = hNet > 0 ? lossPersonHours / hNet : 0;

  return {
    profile,
    basis,
    // A
    in_shift: {
      minutes: inShift.minutes,
      by_kind: inShift.by_kind,
      applied: applyInShift,
      shift_hours: shiftHours,
      h_net: round2(hNet)
    },
    // B
    structural: {
      hours: structural.hours,
      by_kind: structural.by_kind,
      person_hours: round2(lossPersonHours),
      shifts: round2(lossShifts),
      crew_per_shift: crewPerShift
    },
    // C
    calendar,
    warnings: [].concat(structural.warnings || [])
  };
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

module.exports = {
  DEFAULTS,
  profileFromGlobals,
  inShiftLosses,
  structuralLosses,
  calendarLosses,
  buildTimeBudget
};
