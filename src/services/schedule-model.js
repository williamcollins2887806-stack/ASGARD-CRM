'use strict';
/**
 * schedule-model.js — единая размерность срока и людей.
 *
 * ── Почему одна функция на весь контур ─────────────────────────────────────
 * До этого срок считался в трёх местах по-разному:
 *   • `normalizeCalcPlan` — crewDays / crews;
 *   • `deriveWorkDaysFromWorks` — Σ ceil(people/crewSize)×days / crews;
 *   • клиент `mimir_stages_ui.js` — по параллельным группам.
 * На одном тендере они давали 96 и 19 и 8 суток. Здесь одна формула,
 * которую вызывают все три пути.
 *
 * ── Модель ────────────────────────────────────────────────────────────────
 *   MH          чел·часы — единственный инвариант (из нормы или из ТЗ)
 *   h_net       производительных часов в смене = shift_hours − потери
 *   crew_size   человек в одной бригаде (из globals, не константа 5)
 *   C           число бригад (по фронтам, окну и кадровому резерву)
 *   PS          чел·смен = MH / h_net
 *   work_days   ceil(MH / (crew_size × C × h_net × s))
 *   calendar    trips × (work_days/trips + mob + 2×road)
 *
 * Инвариант денег: Σ qty базовых ролей (master, worker) = PS.
 * Он держится по построению, потому что work_days ∝ 1/(C·s), а qty ∝ C·s.
 *
 * ── Универсальность ───────────────────────────────────────────────────────
 * Ни одно поле не обязательно. `fronts` для стройки — захватка, для сварки —
 * стык, для изоляции — участок трассы; если данных нет, ставится 1 и
 * возвращается предупреждение, а не подставляется выдуманное число.
 */

/** Потери смены по умолчанию (минуты), если globals недоступны. */
const DEFAULT_SHIFT_LOSSES = {
  lunch: 60,
  breaks: 30,
  pzr: 30,
  handover: 15,
  permit: 30
};

/** Предел производительных часов в сутки — с учётом пересменки. */
const MAX_PRODUCTIVE_HOURS_PER_DAY = 24;

/** Минимум суток работ: меньше единицы планировать нельзя. */
const MIN_WORK_DAYS = 1;

/**
 * Ёмкость смены: сколько часов из `shift_hours` реально производительные.
 *
 * Не константа 9,25: при 12-часовой смене потери 165 мин дают 9,25, при
 * 8-часовой те же минуты дают 5,25. Зашитое число ломало бы короткие смены.
 *
 * @param {object} p
 * @param {number} [p.shift_hours=12]
 * @param {object} [p.losses] — минуты: {lunch, breaks, pzr, handover, permit}
 * @returns {{shift_hours:number, loss_min:number, h_net:number, k_shift:number}}
 */
function shiftCapacity(p) {
  const o = p || {};
  const shiftHours = Number(o.shift_hours) > 0 ? Number(o.shift_hours) : 12;
  const l = Object.assign({}, DEFAULT_SHIFT_LOSSES, o.losses || {});
  const lossMin = ['lunch', 'breaks', 'pzr', 'handover', 'permit']
    .reduce((s, k) => s + (Number(l[k]) > 0 ? Number(l[k]) : 0), 0);
  const hNet = Math.max(1, shiftHours - lossMin / 60);
  return {
    shift_hours: shiftHours,
    loss_min: lossMin,
    h_net: Math.round(hNet * 100) / 100,
    k_shift: Math.round((hNet / shiftHours) * 1000) / 1000
  };
}

/**
 * Ёмкость смены с учётом базиса нормы.
 *
 * Если норма «gross» (потери уже внутри минут), добавлять их повторно нельзя:
 * h_net = shift_hours. Если «net» — вычитаем.
 *
 * @param {object} p
 * @param {string} [p.norm_basis] — gross_12h | gross_calendar | net_productive
 * @returns {object} результат shiftCapacity + { applied:boolean, basis:string }
 */
function shiftCapacityForBasis(p) {
  const o = p || {};
  const basis = String(o.norm_basis || 'net_productive');
  const caps = shiftCapacity(o);
  if (basis === 'gross_12h' || basis === 'gross_calendar') {
    return Object.assign({}, caps, {
      h_net: caps.shift_hours,
      k_shift: 1,
      applied: false,
      basis
    });
  }
  return Object.assign({}, caps, { applied: true, basis });
}

/**
 * Фронты — сколько бригад может работать ОДНОВРЕМЕННО.
 *
 * Заезды фронты не делят: это разные оси (одновременность vs последовательные
 * визиты). Внутри одного аппарата всегда один фронт — вторая бригада ждёт
 * наряд-допуск и мешает первой.
 *
 * @param {object} p
 * @param {number} [p.objects] — сколько аппаратов/тегов в позиции
 * @param {string} [p.kind] — apparatus | sections | captures | posts | manual
 * @param {number} [p.manual] — ручной ввод РП
 * @returns {{fronts:number, source:string, warning:string|null}}
 */
function resolveFronts(p) {
  const o = p || {};
  const manual = Number(o.manual) > 0 ? Math.round(Number(o.manual)) : 0;
  if (manual > 0) return { fronts: manual, source: 'manual', warning: null };

  const objects = Number(o.objects) > 0 ? Math.round(Number(o.objects)) : 0;
  if (objects > 0) return { fronts: objects, source: 'objects', warning: null };

  const kind = String(o.kind || '').trim();
  if (kind === 'sections' || kind === 'captures' || kind === 'posts') {
    return { fronts: 1, source: kind, warning: `${kind}: число фронтов не задано, принят 1` };
  }
  return {
    fronts: 1,
    source: 'default',
    warning: 'фронты не определены — срок может быть завышен, проверьте число аппаратов/захваток'
  };
}

/**
 * Сколько бригад нужно и сколько физически возможно.
 *
 * @param {object} p
 * @param {number} p.mh — чел·часы
 * @param {number} p.h_net
 * @param {number} p.crew_size
 * @param {number} p.shifts_per_day
 * @param {number|null} p.window_days
 * @param {number} p.trips
 * @param {number} p.mob_days
 * @param {number} p.road_days
 * @param {number} p.fronts
 * @param {number} p.max_crews
 * @param {number|null} p.available_crews
 * @returns {{C:number, C_need:number|null, C_phys:number, C_org:number|null, W_work:number|null, shortfall:object|null}}
 */
function planCrews(p) {
  const o = p || {};
  const mh = Math.max(0, Number(o.mh) || 0);
  const hNet = Math.max(1, Number(o.h_net) || 1);
  const crewSize = Math.max(1, Number(o.crew_size) || 1);
  const s = Math.max(1, Number(o.shifts_per_day) || 1);
  const trips = Math.max(1, Math.round(Number(o.trips) || 1));
  const mob = Math.max(0, Number(o.mob_days) || 0);
  const road = Math.max(0, Number(o.road_days) || 0);
  const maxCrews = Math.max(1, Number(o.max_crews) || 6);
  const fronts = Math.max(1, Number(o.fronts) || 1);

  // Кадровый резерв: если его нет, это null, а не 6 — иначе clamp
  // молча обрежет бригады по выдуманному числу.
  const avail = Number(o.available_crews) > 0 ? Math.round(Number(o.available_crews)) : null;
  const C_org = avail;

  // Физический потолок: не больше фронтов и не больше людей.
  // null в min() даёт 0, поэтому ветвимся явно.
  // Различаем два случая, которые раньше сливались в fronts = 1:
  //   • фронты ИЗВЕСТНЫ и равны 1 — это один аппарат, вторая бригада туда
  //     не встанет физически (жаться до 1 обязательно);
  //   • фронты НЕИЗВЕСТНЫ (`fronts_known: false`) — данных о числе объектов
  //     нет. Тогда окно заказчика — законное основание поставить несколько
  //     бригад, и потолок задаёт max_crews, а не выдуманная единица.
  const frontsKnown = o.fronts_known !== false;
  const C_phys = C_org == null ? fronts : Math.min(fronts, C_org);
  const C_capForWindow = frontsKnown ? Math.min(fronts, maxCrews) : maxCrews;

  const windowDays = Number(o.window_days) > 0 ? Number(o.window_days) : null;
  // Окно под РАБОТУ: вычитаем дорогу и мобилизацию на все заезды.
  const W_work = windowDays != null ? windowDays - trips * (mob + 2 * road) : null;

  let C_need = null;
  if (W_work != null && W_work > 1 && mh > 0) {
    C_need = Math.ceil(mh / (W_work * crewSize * hNet * s));
  }

  let C;
  if (C_need == null) {
    // Окна нет или оно съедено дорогой: подбираем от объёма.
    // Осторожно: не размножаем бригады «по объёму» без нужды.
    const crewDays = mh / (crewSize * hNet * s);
    C = crewDays > 90 ? maxCrews : (crewDays > 30 ? Math.min(2, maxCrews) : 1);
  } else {
    C = Math.max(1, Math.min(C_need, C_capForWindow));
  }
  C = Math.max(1, Math.min(C, C_capForWindow));

  // Дефицит: нужно больше, чем можно поставить.
  let shortfall = null;
  if (C_need != null && C_need > C_capForWindow) {
    shortfall = {
      C_need,
      C_have: C,
      C_phys,
      C_org,
      W_work: W_work != null ? Math.round(W_work * 10) / 10 : null,
      message: `в окно не влезаем: нужно ${C_need} бр. при потолке ${C_capForWindow} — `
        + 'сдвиньте срок, добавьте смен или разбейте на этапы'
    };
  }

  return {
    C,
    C_need,
    C_phys,
    C_org,
    W_work: W_work != null ? Math.round(W_work * 10) / 10 : null,
    shortfall
  };
}

/**
 * Главная функция: срок, календарь, пик людей.
 *
 * @param {object} p
 * @param {number} p.mh — чел·часы
 * @param {number} [p.shift_hours=12]
 * @param {object} [p.losses] — минуты потерь смены
 * @param {string} [p.norm_basis]
 * @param {number} [p.crew_size=5]
 * @param {number} [p.shifts_per_day=1]
 * @param {number} [p.trips=1]
 * @param {number} [p.mob_days=0]
 * @param {number} [p.road_days=0]
 * @param {number|null} [p.window_days]
 * @param {number} [p.fronts=1]
 * @param {number} [p.max_crews=6]
 * @param {number|null} [p.available_crews]
 * @returns {object}
 */
function resolveSchedule(p) {
  const o = p || {};
  const mh = Math.max(0, Number(o.mh) || 0);
  const shiftHours = Number(o.shift_hours) > 0 ? Number(o.shift_hours) : 12;
  const s = Math.max(1, Number(o.shifts_per_day) || 1);

  // Валидация: производительных часов в сутки не больше 24 (с пересменкой).
  const productivePerDay = s * shiftHours;
  const shiftWarn = productivePerDay > MAX_PRODUCTIVE_HOURS_PER_DAY
    ? `смен ${s} × ${shiftHours} ч = ${productivePerDay} ч в сутки — больше 24, отклонено`
    : null;
  const effectiveS = productivePerDay > MAX_PRODUCTIVE_HOURS_PER_DAY
    ? Math.max(1, Math.floor(MAX_PRODUCTIVE_HOURS_PER_DAY / shiftHours))
    : s;

  const caps = shiftCapacityForBasis({
    shift_hours: shiftHours,
    losses: o.losses,
    norm_basis: o.norm_basis
  });
  const crewSize = Math.max(1, Number(o.crew_size) || 5);
  const trips = Math.max(1, Math.round(Number(o.trips) || 1));

  const crews = planCrews({
    mh, h_net: caps.h_net, crew_size: crewSize, shifts_per_day: effectiveS,
    window_days: o.window_days, trips, mob_days: o.mob_days, road_days: o.road_days,
    fronts: o.fronts, max_crews: o.max_crews, available_crews: o.available_crews,
    // Прокидываем признак: если фронты не заданы вообще, окно может
    // увеличить число бригад. Если заданы (даже 1) — это физический предел.
    fronts_known: o.fronts_known !== false
  });

  const dailyCapacity = crewSize * crews.C * caps.h_net * effectiveS;
  const rawDays = dailyCapacity > 0 ? mh / dailyCapacity : 0;
  const workDays = mh > 0 ? Math.max(MIN_WORK_DAYS, Math.ceil(rawDays)) : null;

  const mob = Math.max(0, Number(o.mob_days) || 0);
  const road = Math.max(0, Number(o.road_days) || 0);
  const calendarDays = workDays != null
    ? trips * (workDays / trips + mob + 2 * road)
    : null;

  const ps = caps.h_net > 0 ? mh / caps.h_net : 0;

  return {
    // Инварианты
    mh,
    h_net: caps.h_net,
    k_shift: caps.k_shift,
    loss_min: caps.loss_min,
    ps: Math.round(ps * 10) / 10,

    // Состав
    crew_size: crewSize,
    crews: crews.C,
    crews_needed: crews.C_need,
    crews_physical: crews.C_phys,
    crews_org: crews.C_org,
    shifts_per_day: effectiveS,
    shift_hours: shiftHours,
    work_window: crews.W_work,

    // Люди
    headcount_shift: crewSize * crews.C,
    headcount_peak: crewSize * crews.C * effectiveS,

    // Срок
    work_days: workDays,
    work_days_raw: Math.round(rawDays * 100) / 100,
    work_days_per_trip: workDays != null ? Math.round((workDays / trips) * 10) / 10 : null,
    calendar_days: calendarDays != null ? Math.round(calendarDays * 10) / 10 : null,
    trips,

    // Диагностика
    shortfall: crews.shortfall,
    warnings: [
      shiftWarn,
      caps.applied === false
        ? `норма ${caps.basis}: потери смены уже внутри, h_net = shift_hours`
        : null,
      crews.shortfall ? crews.shortfall.message : null
    ].filter(Boolean)
  };
}

/**
 * Проверка, что миграции расчётной модели накатаны.
 *
 * Без неё шаги читают `crew_span` = undefined → NaN в сроке и ФОТ.
 * Вызывается на старте приложения и перед прогоном расчёта.
 *
 * @param {object} db — клиент pg
 * @returns {Promise<{ok:boolean, missing:string[]}>}
 */
async function assertMigrationsReady(db) {
  const required = ['crew_span', 'master_span', 'observer_ratio', 'shift_lunch_min'];
  if (!db || typeof db.query !== 'function') {
    return { ok: false, missing: required, error: 'no db client' };
  }
  try {
    const r = await db.query(
      'SELECT key FROM work_norm_globals WHERE key = ANY($1::text[])',
      [required]
    );
    const have = new Set((r.rows || []).map((x) => x.key));
    const missing = required.filter((k) => !have.has(k));
    return { ok: missing.length === 0, missing };
  } catch (e) {
    return { ok: false, missing: required, error: e.message };
  }
}

module.exports = {
  DEFAULT_SHIFT_LOSSES,
  MAX_PRODUCTIVE_HOURS_PER_DAY,
  MIN_WORK_DAYS,
  shiftCapacity,
  shiftCapacityForBasis,
  resolveFronts,
  planCrews,
  resolveSchedule,
  assertMigrationsReady
};
