'use strict';

/**
 * Справочник норм Асгарда — загрузка, math preview-calc, markdown для Мимира.
 * Без LLM: только формулы.
 */

function ceil(n) {
  return Math.ceil(Number(n) || 0);
}

async function loadGlobals(db) {
  const { rows } = await db.query(
    `SELECT key, value_num, value_text, label, unit, sort_order
     FROM work_norm_globals ORDER BY sort_order, key`
  );
  const map = {};
  for (const r of rows) {
    map[r.key] = r.value_num != null ? Number(r.value_num) : r.value_text;
  }
  return { rows, map };
}

async function loadCatalog(db, { category } = {}) {
  const globals = await loadGlobals(db);
  const catSql = category
    ? `SELECT * FROM work_norm_categories WHERE code = $1 AND is_active ORDER BY sort_order`
    : `SELECT * FROM work_norm_categories WHERE is_active ORDER BY sort_order`;
  const { rows: categories } = await db.query(catSql, category ? [category] : []);

  const ratesParams = category ? [category] : [];
  const { rows: rates } = await db.query(
    `SELECT * FROM work_norm_rates
     WHERE is_active ${category ? 'AND category_code = $1' : ''}
     ORDER BY category_code, sort_order, id`,
    ratesParams
  );

  const { rows: coeffs } = await db.query(
    `SELECT * FROM work_norm_coeffs WHERE is_active
     ${category ? 'AND (category_code IS NULL OR category_code = $1)' : ''}
     ORDER BY coeff_code`,
    category ? [category] : []
  );

  const { rows: chemistry } = await db.query(
    `SELECT * FROM work_norm_chemistry WHERE is_active ORDER BY name`
  );

  const { rows: equipment } = await db.query(
    `SELECT * FROM work_norm_equipment WHERE is_active
     ${category ? 'AND (category_code IS NULL OR category_code = $1)' : ''}
     ORDER BY category_code NULLS FIRST, name`,
    category ? [category] : []
  );

  let experiences = [];
  try {
    const expParams = category ? [category] : [];
    const { rows } = await db.query(
      `SELECT * FROM work_norm_experiences
       WHERE status IN ('confirmed','published','draft')
       ${category ? 'AND category_code = $1' : ''}
       ORDER BY
         CASE status WHEN 'published' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT 200`,
      expParams
    );
    experiences = rows;
  } catch (_) { /* V310 ещё нет */ }

  return {
    globals: globals.map,
    globalsRows: globals.rows,
    categories,
    // Нормы с вычисленным базисом: params_json.norm_basis, а если его нет —
    // по calc_kind. Без этого защита от двойного счёта потерь мертва: она
    // работает только когда флаг передан, а передавать его было некому
    // (все вызовы шли без norm_basis — нашёл верификатор).
    rates: rates.map((r) => Object.assign({}, r, {
      norm_basis: resolveNormBasis(r)
    })),
    coeffs,
    chemistry,
    equipment,
    experiences
  };
}

/**
 * Базис нормы: содержит ли она внутрисменные потери.
 *
 * gross_12h      — норма посчитана с коэффициентом (k_irv): потери ВНУТРИ.
 * gross_calendar — норма в календарных сутках: смены её не сокращают.
 * net_productive — норма «чистая»: потери нужно добавлять.
 *
 * Явное поле params_json.norm_basis главнее: его ставит миграция V487 и
 * может переопределить человек через админку.
 *
 * @param {object} rate — строка work_norm_rates
 * @returns {'gross_12h'|'gross_calendar'|'net_productive'}
 */
function resolveNormBasis(rate) {
  const r = rate || {};
  const explicit = r.params_json && r.params_json.norm_basis;
  if (explicit === 'gross_12h' || explicit === 'gross_calendar' || explicit === 'net_productive') {
    return explicit;
  }
  const kind = String(r.calc_kind || '');
  if (kind === 'min_per_unit') return 'gross_12h';
  if (kind === 'days_per_unit' || kind === 'fixed_days') return 'gross_calendar';
  return 'net_productive';
}

const CALC_KIND_LABELS = {
  per_unit_shift: 'выработка за смену исполнителя',
  days_per_unit: 'сутки на единицу',
  min_per_unit: 'минуты на единицу',
  mh_per_unit: 'чел·ч на единицу',
  kg_per_m: 'кг реагента на метр',
  fixed_days: 'фиксированные сутки на объект',
  hours_per_cycle: 'часы на цикл / контур'
};

function isTruthyFlag(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** Ближайший ключ в params.by_diameter / by_dn */
function lookupBySize(table, size) {
  if (!table || size == null || size === '') return null;
  const key = String(size);
  if (table[key] != null) return Number(table[key]);
  const n = Number(size);
  if (!(n > 0)) return null;
  const keys = Object.keys(table)
    .map(Number)
    .filter((k) => k > 0)
    .sort((a, b) => a - b);
  if (!keys.length) return null;
  let best = keys[0];
  for (const k of keys) {
    if (Math.abs(k - n) < Math.abs(best - n)) best = k;
  }
  // для Ø/Ду: берём ближайший ≤ size, иначе ближайший
  const le = keys.filter((k) => k <= n);
  if (le.length) best = le[le.length - 1];
  return Number(table[String(best)]);
}

function methodMeta(catRow, methodCode) {
  const methods = Array.isArray(catRow?.methods_json) ? catRow.methods_json : [];
  return methods.find((m) => m.code === methodCode) || null;
}

/** Трубки: прямое число или секции × трубок/секц. */
function resolveTubes(inputs, trace) {
  let tubes = Number(inputs.tubes) || 0;
  if (!(tubes > 0) && Number(inputs.sections) > 0 && Number(inputs.tubes_per_section) > 0) {
    tubes = Number(inputs.sections) * Number(inputs.tubes_per_section);
    if (trace) trace.push(`${inputs.sections} секц. × ${inputs.tubes_per_section} = ${tubes} труб`);
  }
  return tubes;
}

/** Площадь пластин: м² или plates × area_per_plate */
function resolveSurfaceM2(inputs, trace) {
  let m2 = Number(inputs.surface_m2) || 0;
  if (!(m2 > 0) && Number(inputs.plates_count) > 0 && Number(inputs.area_per_plate_m2) > 0) {
    m2 = Number(inputs.plates_count) * Number(inputs.area_per_plate_m2);
    if (trace) trace.push(`${inputs.plates_count} пластин × ${inputs.area_per_plate_m2} м² = ${m2} м²`);
  }
  return m2;
}

/** Пластин всего: plates_count или qty × plates_in_pack */
function resolvePlatesCount(inputs, trace) {
  let n = Number(inputs.plates_count) || 0;
  if (!(n > 0) && Number(inputs.qty) > 0 && Number(inputs.plates_in_pack) > 0) {
    n = Number(inputs.qty) * Number(inputs.plates_in_pack);
    if (trace) trace.push(`${inputs.qty} пак. × ${inputs.plates_in_pack} = ${n} пластин`);
  }
  return n;
}

/**
 * Жёсткая проверка физ. полей по category/method/rate.
 * Возвращает строку ошибки или null.
 */
function expectedInputField(category, method, rateCode, kind) {
  // Основное поле, которое читает норма. Нужно для пересчёта единиц:
  // если его нет в inputs, но есть объём в другой единице — приводим.
  if (category === 'vessels') return 'volume_m3';
  if (category === 'tubes' && (method === 'gdo' || method === 'gmo')) return 'tubes';
  if (category === 'tubes' && method === 'chem') return 'tubes';
  if (category === 'avo' && method === 'tubes') return 'tubes';
  if (category === 'avo' && method === 'outer') return 'surface_m2';
  if (category === 'plates' && method === 'hydro_dis') return 'surface_m2';
  if (category === 'plates' && method === 'chem_cip') return 'circuit_m3';
  if (category === 'boilers' && method === 'chem') return 'circuit_m3';
  if (category === 'boilers') return 'surface_m2';
  if (category === 'pipelines') return method === 'hydrotest' ? 'circuit_m3' : 'length_m';
  if (category === 'chem_circuits') return 'circuit_m3';
  if (category === 'towers_hvac' && method === 'tower') return 'surface_m2';
  if (category === 'towers_hvac' && method === 'pneumo') return 'length_m';
  if (category === 'towers_hvac') return 'circuit_m3';
  if (category === 'vent_sewer' && method === 'disinfect') return 'surface_m2';
  if (category === 'vent_sewer') return 'length_m';
  if (category === 'repair_weld' && method === 'weld') return 'joints';
  if (category === 'repair_weld' && method === 'cutting') return 'length_m';
  if (category === 'repair_weld' && method === 'plates_pack') return 'plates_count';
  if (category === 'repair_weld' && method === 'compabloc') return 'surface_m2';
  if (category === 'repair_weld' && method === 'fire_works') return 'points';
  if (category === 'insulation') return 'surface_m2';
  if (category === 'mount' && method === 'flange') return 'joints';
  if (category === 'mount' && method === 'rigging') return 'lifts';
  if (category === 'mount') return 'qty';
  return null;
}

/** Правило пересчёта единицы из справочника (V472). */
async function loadConversionRule(db, category, method, fromUnit, toField) {
  const uc = require('./unit-convert');
  const u = uc.normUnit(fromUnit);
  try {
    const { rows } = await db.query(
      `SELECT * FROM work_norm_unit_conversions
        WHERE category_code = $1 AND is_active
          AND (method_code IS NULL OR method_code = $2)
          AND to_field = $3
          AND lower(from_unit) = lower($4)
        ORDER BY CASE WHEN method_code = $2 THEN 0 ELSE 1 END, id
        LIMIT 1`,
      [category, method, toField, u]
    );
    return rows[0] || null;
  } catch (_) {
    // Таблицы может не быть (миграция не применена) — не ломаем расчёт.
    return null;
  }
}

/** Типовые толщина и плотность по типу отложений (V472). */
async function loadLayerDefaults(db, depositType) {
  if (!depositType) return {};
  try {
    const { rows } = await db.query(
      `SELECT * FROM work_norm_layer_defaults WHERE deposit_type = $1 AND is_active LIMIT 1`,
      [String(depositType)]
    );
    const r = rows[0];
    if (!r) return {};
    return {
      thickness_mm: Number(r.thickness_typical_mm) || null,
      density_t_m3: Number(r.density_typical_t_m3) || null
    };
  } catch (_) {
    return {};
  }
}

function physicalInputError(category, method, rateCode, kind, inputs) {
  if (category === 'avo' && method === 'outer') {
    if (!(resolveSurfaceM2(inputs) > 0)) {
      return 'Укажите площадь, м² (секции без площади не считаем — размеры разные)';
    }
  }
  if (category === 'avo' && method === 'tubes') {
    if (!(resolveTubes(inputs) > 0)) return 'Укажите трубки (или секции × трубок/секц.)';
    if (!(Number(inputs.diameter_mm) > 0)) return 'Укажите Ø трубки, мм';
    if (!(Number(inputs.length_m) > 0)) return 'Укажите длину трубки, м';
  }
  if (category === 'tubes' && method === 'gdo') {
    if (!(resolveTubes(inputs) > 0)) return 'Укажите число трубок';
    // Ø НЕ обязателен: без него норма берёт базовую ставку мин/трубку
    // (см. расчёт ниже: «Ø не указан — базовая мин/труб без калибровки»).
    // Требовать Ø жёстко — значит выбрасывать в «эксперт» все тендеры,
    // где в ВОР дана только длина трубки, как в 2131 (30 позиций).
    if (!(Number(inputs.length_m) > 0)) return 'Укажите длину трубки, м';
  }
  if (category === 'tubes' && method === 'gmo') {
    if (!(resolveTubes(inputs) > 0)) return 'Укажите число трубок';
  }
  if (category === 'tubes' && method === 'chem') {
    if (!(resolveTubes(inputs) > 0)) return 'Укажите число трубок';
    if (!(Number(inputs.circuit_m3) > 0)) return 'Укажите объём контура, м³';
  }
  if (category === 'plates' && method === 'hydro_dis') {
    if (!(resolveSurfaceM2(inputs) > 0)) {
      return 'Укажите площадь пластин, м² (или пластины × м²/пластину). Аппарат без площади не считаем';
    }
  }
  if (category === 'plates' && method === 'chem_cip') {
    if (!(Number(inputs.circuit_m3) > 0)) return 'Укажите объём контура, м³';
    if (!(Number(inputs.cycles) > 0)) return 'Укажите число циклов';
  }
  if (category === 'boilers' && method === 'chem') {
    if (!(Number(inputs.circuit_m3) > 0)) return 'Укажите объём контура, м³';
    if (!(Number(inputs.cycles) > 0)) return 'Укажите число циклов';
  }
  if (category === 'boilers' && (method === 'hydro' || method === 'mech')) {
    if (!(Number(inputs.surface_m2) > 0)) return 'Укажите площадь, м² (котёл как шт не считаем)';
  }
  if (category === 'boilers' && method === 'complex') {
    if (!(Number(inputs.surface_m2) > 0)) return 'Укажите площадь, м²';
    if (!(Number(inputs.circuit_m3) > 0)) return 'Укажите объём контура, м³';
  }
  if (category === 'vessels') {
    if (!(Number(inputs.volume_m3) > 0)) return 'Укажите объём ёмкости, м³';
  }
  if (category === 'pipelines') {
    if (!(Number(inputs.length_m) > 0)) return 'Укажите длину, м';
    if (!(Number(inputs.dn_mm) > 0)) return 'Укажите Ду, мм';
  }
  if (category === 'chem_circuits') {
    if (!(Number(inputs.circuit_m3) > 0)) return 'Укажите объём контура, м³';
    if (!(Number(inputs.cycles) > 0)) return 'Укажите число циклов';
  }
  if (category === 'towers_hvac' && method === 'tower') {
    if (!(Number(inputs.surface_m2) > 0)) return 'Укажите площадь орошения, м²';
  }
  if (category === 'towers_hvac' && (method === 'heating' || method === 'itp')) {
    if (!(Number(inputs.circuit_m3) > 0)) return 'Укажите объём системы, м³ (не число объектов)';
  }
  if (category === 'towers_hvac' && method === 'pneumo') {
    if (!(Number(inputs.length_m) > 0)) return 'Укажите длину сети, м';
  }
  if (category === 'vent_sewer' && method === 'vent') {
    if (!(Number(inputs.length_m) > 0)) return 'Укажите длину воздуховодов, м';
  }
  if (category === 'vent_sewer' && method === 'disinfect') {
    if (!(Number(inputs.surface_m2) > 0)) return 'Укажите площадь, м²';
  }
  if (category === 'vent_sewer' && method === 'sewer') {
    if (!(Number(inputs.length_m) > 0)) return 'Укажите длину, м';
  }
  if (category === 'repair_weld' && method === 'compabloc') {
    if (!(resolveSurfaceM2(inputs) > 0)) return 'Укажите площадь пластин, м²';
  }
  if (category === 'repair_weld' && method === 'plates_pack') {
    if (!(resolvePlatesCount(inputs) > 0) && !(Number(inputs.surface_m2) > 0)) {
      return 'Укажите число пластин (или пакеты × пластин в пакете)';
    }
  }
  if (category === 'repair_weld' && method === 'weld') {
    if (!(Number(inputs.joints) > 0)) return 'Укажите число стыков';
    if (!(Number(inputs.dn_mm) > 0)) return 'Укажите Ду, мм';
  }
  if (category === 'repair_weld' && method === 'cutting') {
    if (!(Number(inputs.length_m) > 0)) return 'Укажите длину реза, м';
  }
  if (category === 'repair_weld' && method === 'fire_works') {
    if (!(Number(inputs.points) > 0)) return 'Укажите число огневых точек';
  }
  if (category === 'mount' && (method === 'mount' || method === 'dismount')) {
    if (!(Number(inputs.qty) > 0)) return 'Укажите количество аппаратов/узлов';
  }
  if (category === 'mount' && method === 'rigging') {
    if (!(Number(inputs.lifts) > 0)) return 'Укажите число подъёмов/операций';
  }
  if (category === 'mount' && method === 'flange') {
    if (!(Number(inputs.joints) > 0)) return 'Укажите число стыков/фланцев';
  }
  if (category === 'insulation') {
    if (!(Number(inputs.surface_m2) > 0)) return 'Укажите площадь, м²';
    if (!(Number(inputs.diameter_mm) > 0)) return 'Укажите Ø трубы, мм';
  }

  // generic: days_per_unit без физ. объёма — запрет для «штучных» primary
  if (kind === 'days_per_unit' && rateCode && /_days$|days_per/.test(rateCode)) {
    const physical =
      resolveSurfaceM2(inputs) > 0 ||
      Number(inputs.volume_m3) > 0 ||
      Number(inputs.circuit_m3) > 0 ||
      Number(inputs.length_m) > 0 ||
      resolveTubes(inputs) > 0;
    if (!physical && (Number(inputs.apparatus) > 0 || Number(inputs.boilers) > 0 ||
        Number(inputs.sections) > 0 || Number(inputs.objects) > 0 || Number(inputs.qty) > 0)) {
      return 'Срок от физ. объёма (м²/м³/м/трубки×Ø×L), не от числа аппаратов/котлов/секций';
    }
  }
  return null;
}

function calcKindLabel(kind) {
  return CALC_KIND_LABELS[kind] || kind || '—';
}

/**
 * Отличает «нормы нет» от «не хватает входных данных».
 * Фолбэк допустим только во втором смысле — когда нормы физически нет.
 * Если не указан объём, Мимир должен спросить (этап clarify), а не выдумывать срок.
 */
function isMissingNormError(message) {
  const m = String(message || '');
  if (!m) return false;
  // «Укажите …» / «Укажите объём» — это нехватка данных, не отсутствие нормы.
  if (/^укажите/i.test(m)) return false;
  return /нет нормы|не заполнена|нет подходящей/i.test(m);
}

/**
 * Честный фолбэк «нормы в справочнике нет».
 *
 * Требование заказчика (05.11.2026): Мимир НЕ падает и не молчит, если нормы нет.
 * Он считает сам, говорит, что расчёт не по справочнику, и после успешного
 * просчёта норма появляется в справочнике (см. createRateFromEstimate).
 *
 * Возвращает объект той же формы, что previewCalc (ok/results/crew/trace),
 * плюс `fallback: true` и `basis: 'mimir_expert'`, чтобы UI и промпт показали
 * честную пометку, а не подсунули выдуманную норму под видом справочной.
 */
function buildFallbackPreview({ category_code, method_code, inputs, workDays, crew, reason, source }) {
  const fouling = 'medium';
  const shiftHours = 12;
  const shiftsPerDay = 2;
  const wd = Number(workDays) > 0 ? Math.ceil(Number(workDays)) : null;
  if (wd == null) {
    return {
      ok: false,
      fallback: true,
      error: reason || 'Нормы нет, и Мимир не дал срок — нужен объём/уточнение',
      trace: ['fallback: нет нормы и нет оценки срока']
    };
  }
  const master = Number(crew && crew.master) || 1;
  const exec = Number(crew && crew.exec) || 3;
  const observers = Number(crew && crew.observers) || 0;
  const posts = 1;
  const peoplePerShift = master + exec + observers;
  const personShifts = wd * peoplePerShift * shiftsPerDay * posts;
  return {
    ok: true,
    fallback: true,
    basis: 'mimir_expert',
    category_code: category_code || null,
    method_code: method_code || null,
    rate: {
      id: null,
      code: null,
      name: source || 'Оценка Мимира (нормы в справочнике нет)',
      unit: null,
      calc_kind: null,
      rate_used: null,
      fouling
    },
    crew: { master, exec, observers, posts, shifts_per_day: shiftsPerDay, shift_hours: shiftHours },
    results: {
      work_days: wd,
      person_shifts: personShifts,
      man_hours: Math.round(personShifts * shiftHours),
      reagent_kg: null,
      setup_days: null,
      flow_days: null
    },
    trace: [
      '⚠️ НОРМЫ В СПРАВОЧНИКЕ НЕТ — расчёт не по справочнику',
      reason ? `причина: ${reason}` : null,
      `оценка Мимира: ${wd} сут, бригада ${master}м+${exec}сл`,
      'после сохранения просчёта норма будет создана в справочнике'
    ].filter(Boolean)
  };
}

/** derived_metric → calc_kind справочника (для publish и тестов). */
function metricToCalcKind(metric) {
  if (!metric) return null;
  if (metric === 'days_per_section' || metric === 'days_per_unit') return 'days_per_unit';
  if (
    metric === 'm2_per_shift' || metric === 'm3_per_shift' || metric === 'm_per_shift' ||
    metric === 'tubes_per_shift' || metric === 'joints_per_shift' || metric === 'plates_per_shift'
  ) {
    return 'per_unit_shift';
  }
  if (metric === 'hours_per_cycle') return 'hours_per_cycle';
  if (metric === 'kg_per_m') return 'kg_per_m';
  if (metric === 'mh_per_m3' || metric === 'mh_per_m2' || metric === 'mh_per_100_tubes') {
    return 'mh_per_unit';
  }
  if (metric === 'min_per_tube') return 'min_per_unit';
  return null;
}

function resolveSetupParam(val, fouling) {
  if (val == null) return 0;
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'object') {
    const f = String(fouling || 'medium').toLowerCase();
    if (f === 'loose' || f === 'light' || f === 'лёгкие' || f === 'легкие') {
      return Number(val.light ?? val.loose ?? val.medium ?? 0) || 0;
    }
    if (f === 'hard' || f === 'heavy' || f === 'тяжёлые' || f === 'тяжелые') {
      return Number(val.heavy ?? val.hard ?? val.medium ?? 0) || 0;
    }
    return Number(val.medium ?? val.light ?? val.heavy ?? 0) || 0;
  }
  return Number(val) || 0;
}

function isProtectedResearchBasis(basis) {
  const b = String(basis || '').toLowerCase();
  return b === 'research_seed' || b === 'research';
}

const RATE_SNAPSHOT_COLS = [
  'id', 'category_code', 'method_code', 'object_code', 'code', 'name', 'unit', 'calc_kind',
  'rate_loose', 'rate_medium', 'rate_hard', 'rate_default', 'crew_json', 'params_json',
  'basis', 'notes', 'is_active', 'sort_order'
];

function rateSnapshot(row) {
  if (!row) return null;
  const out = {};
  for (const k of RATE_SNAPSHOT_COLS) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  return out;
}

function blendRateValue(mode, prev, next) {
  if (next == null || next === '') return prev;
  const n = Number(next);
  if (!(n >= 0) && n !== 0) return prev;
  if (mode === 'note_only') return prev;
  if (mode === 'replace' || prev == null) return n;
  if (mode === 'average' && prev != null) {
    return Math.round(((Number(prev) + n) / 2) * 100) / 100;
  }
  return n;
}

/**
 * Подбор rate для publish: target_rate_id → primary_rate_code → code → method+calc_kind.
 * Без «первой нормы только по calc_kind без method».
 */
async function findRateForPublish(db, exp, { calcKind, code }) {
  if (exp.target_rate_id) {
    const { rows } = await db.query(
      `SELECT * FROM work_norm_rates WHERE id = $1 AND is_active`,
      [exp.target_rate_id]
    );
    if (rows[0]) return rows[0];
  }

  const catRow = await loadCategory(db, exp.category_code);
  const meta = methodMeta(catRow, exp.method_code);
  const primaryCode = meta && meta.primary_rate_code;

  if (primaryCode) {
    const { rows } = await db.query(
      `SELECT * FROM work_norm_rates WHERE category_code = $1 AND code = $2 AND is_active`,
      [exp.category_code, primaryCode]
    );
    if (rows[0]) return rows[0];
  }

  if (code) {
    const { rows } = await db.query(
      `SELECT * FROM work_norm_rates WHERE category_code = $1 AND code = $2 AND is_active`,
      [exp.category_code, code]
    );
    if (rows[0]) return rows[0];
  }

  if (exp.method_code && calcKind) {
    const { rows } = await db.query(
      `SELECT * FROM work_norm_rates
       WHERE category_code = $1 AND method_code IS NOT DISTINCT FROM $2
         AND calc_kind = $3 AND is_active
       ORDER BY sort_order, id
       LIMIT 1`,
      [exp.category_code, exp.method_code, calcKind]
    );
    return rows[0] || null;
  }

  return null;
}

async function resolveRateForPatch(db, { rateId, code, categoryCode }) {
  if (rateId) {
    const { rows } = await db.query(`SELECT * FROM work_norm_rates WHERE id = $1`, [Number(rateId)]);
    if (!rows[0]) {
      const err = new Error('Норма не найдена по id');
      err.statusCode = 404;
      throw err;
    }
    return rows[0];
  }
  if (categoryCode && code) {
    const { rows } = await db.query(
      `SELECT * FROM work_norm_rates WHERE category_code = $1 AND code = $2`,
      [categoryCode, code]
    );
    if (!rows[0]) {
      const err = new Error(`Норма не найдена: ${categoryCode}/${code}`);
      err.statusCode = 404;
      throw err;
    }
    return rows[0];
  }
  const err = new Error('Укажите rateId или пару categoryCode+code');
  err.statusCode = 400;
  throw err;
}

/**
 * Единая точка правки/создания нормы с audit log.
 */
async function applyNormPatch(db, opts) {
  const {
    rateId,
    code,
    categoryCode,
    values = {},
    mode = 'average',
    source,
    user,
    force,
    comment,
    paramsPatch,
    crewPatch,
    name,
    unit,
    calcKind,
    methodCode
  } = opts || {};

  let rateRow = null;
  let created = false;
  try {
    rateRow = await resolveRateForPatch(db, { rateId, code, categoryCode });
  } catch (e) {
    if (e.statusCode !== 404 || !categoryCode || !code) throw e;
    rateRow = null;
  }

  const publishMode = mode || 'average';
  const c = String(comment || '').trim();
  if (c.length < 5) {
    const err = new Error('Комментарий обязателен (минимум 5 символов)');
    err.statusCode = 400;
    throw err;
  }

  if (!rateRow) {
    if (!categoryCode || !code || !name || !unit) {
      const err = new Error('Для создания нормы нужны categoryCode, code, name, unit');
      err.statusCode = 400;
      throw err;
    }
    const params = paramsPatch && typeof paramsPatch === 'object' ? { ...paramsPatch } : {};
    if (values.by_diameter && typeof values.by_diameter === 'object') {
      params.by_diameter = { ...(params.by_diameter || {}), ...values.by_diameter };
    }
    const crew = crewPatch && typeof crewPatch === 'object' ? crewPatch : { master: 1, exec: 3 };
    const { rows } = await db.query(
      `INSERT INTO work_norm_rates (
        category_code, method_code, code, name, unit, calc_kind,
        rate_loose, rate_medium, rate_hard, rate_default,
        crew_json, params_json, basis, notes, sort_order, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,50,$15)
      RETURNING *`,
      [
        categoryCode,
        methodCode || null,
        code,
        name,
        unit,
        calcKind || 'per_unit_shift',
        values.rate_loose ?? null,
        values.rate_medium ?? null,
        values.rate_hard ?? null,
        values.rate_default ?? null,
        JSON.stringify(crew),
        JSON.stringify(params),
        source || 'field',
        source ? `источник: ${source}` : null,
        user?.id || null
      ]
    );
    rateRow = rows[0];
    created = true;
    await writeChangeLog(db, {
      entity_type: 'rate',
      entity_id: String(rateRow.id),
      category_code: rateRow.category_code,
      action: 'create',
      before: null,
      after: rateSnapshot(rateRow),
      comment: c,
      user
    });
    return { before: null, after: rateSnapshot(rateRow), created: true };
  }

  const before = rateSnapshot(rateRow);
  if (isProtectedResearchBasis(rateRow.basis) && !force) {
    const err = new Error(
      'Норма с basis research/research_seed — правка только с force=true (осознанное перезаписывание)'
    );
    err.statusCode = 400;
    throw err;
  }

  let notes = rateRow.notes || '';
  if (isProtectedResearchBasis(rateRow.basis) && force) {
    notes = [notes, 'force: перезапись research_seed'].filter(Boolean).join('; ').slice(0, 2000);
  }
  if (source) {
    notes = [notes, `источник: ${source}`].filter(Boolean).join('; ').slice(0, 2000);
  }

  const params = { ...(rateRow.params_json || {}) };
  if (paramsPatch && typeof paramsPatch === 'object') {
    Object.assign(params, paramsPatch);
  }
  if (values.by_diameter && typeof values.by_diameter === 'object') {
    const by = { ...(params.by_diameter || {}) };
    for (const [k, v] of Object.entries(values.by_diameter)) {
      if (publishMode === 'average' && by[k] != null) {
        by[k] = Math.round(((Number(by[k]) + Number(v)) / 2) * 100) / 100;
      } else if (publishMode !== 'note_only') {
        by[k] = Number(v);
      }
    }
    params.by_diameter = by;
  }

  const crew = crewPatch && typeof crewPatch === 'object'
    ? { ...(rateRow.crew_json || {}), ...crewPatch }
    : (rateRow.crew_json || {});

  let rate_loose = rateRow.rate_loose;
  let rate_medium = rateRow.rate_medium;
  let rate_hard = rateRow.rate_hard;
  let rate_default = rateRow.rate_default;

  if (publishMode !== 'note_only') {
    if (values.rate_loose !== undefined) rate_loose = blendRateValue(publishMode, rate_loose, values.rate_loose);
    if (values.rate_medium !== undefined) rate_medium = blendRateValue(publishMode, rate_medium, values.rate_medium);
    if (values.rate_hard !== undefined) rate_hard = blendRateValue(publishMode, rate_hard, values.rate_hard);
    if (values.rate_default !== undefined) rate_default = blendRateValue(publishMode, rate_default, values.rate_default);
  }

  const { rows } = await db.query(
    `UPDATE work_norm_rates SET
       name = COALESCE($2, name),
       unit = COALESCE($3, unit),
       calc_kind = COALESCE($4, calc_kind),
       rate_loose = $5,
       rate_medium = $6,
       rate_hard = $7,
       rate_default = $8,
       crew_json = $9::jsonb,
       params_json = $10::jsonb,
       notes = $11,
       method_code = COALESCE($12, method_code),
       updated_at = NOW(),
       updated_by = $13
     WHERE id = $1 RETURNING *`,
    [
      rateRow.id,
      name ?? null,
      unit ?? null,
      calcKind ?? null,
      rate_loose,
      rate_medium,
      rate_hard,
      rate_default,
      JSON.stringify(crew),
      JSON.stringify(params),
      notes || null,
      methodCode ?? null,
      user?.id || null
    ]
  );
  const after = rateSnapshot(rows[0]);
  await writeChangeLog(db, {
    entity_type: 'rate',
    entity_id: String(rateRow.id),
    category_code: after.category_code,
    action: 'update',
    before,
    after,
    comment: c,
    user
  });
  return { before, after, created: false };
}

async function revertLastRateChange(db, rateId, user, comment) {
  const id = Number(rateId);
  if (!id) {
    const err = new Error('rateId обязателен');
    err.statusCode = 400;
    throw err;
  }
  const { rows: logRows } = await db.query(
    `SELECT * FROM work_norm_change_log
     WHERE entity_type = 'rate' AND entity_id = $1
       AND action IN ('update', 'create', 'publish')
     ORDER BY id DESC
     LIMIT 1`,
    [String(id)]
  );
  const entry = logRows[0];
  if (!entry || !entry.before_json) {
    const err = new Error('Нет записи для отката');
    err.statusCode = 404;
    throw err;
  }
  const before = entry.before_json;
  const { rows: curRows } = await db.query(`SELECT * FROM work_norm_rates WHERE id = $1`, [id]);
  if (!curRows[0]) {
    const err = new Error('Норма не найдена');
    err.statusCode = 404;
    throw err;
  }
  const current = rateSnapshot(curRows[0]);

  const { rows } = await db.query(
    `UPDATE work_norm_rates SET
       name = $2, unit = $3, calc_kind = $4,
       rate_loose = $5, rate_medium = $6, rate_hard = $7, rate_default = $8,
       crew_json = $9::jsonb, params_json = $10::jsonb,
       notes = $11, method_code = $12, is_active = COALESCE($13, is_active),
       updated_at = NOW(), updated_by = $14
     WHERE id = $1 RETURNING *`,
    [
      id,
      before.name,
      before.unit,
      before.calc_kind,
      before.rate_loose,
      before.rate_medium,
      before.rate_hard,
      before.rate_default,
      JSON.stringify(before.crew_json || {}),
      JSON.stringify(before.params_json || {}),
      before.notes,
      before.method_code ?? null,
      before.is_active,
      user?.id || null
    ]
  );

  await writeChangeLog(db, {
    entity_type: 'rate',
    entity_id: String(id),
    category_code: rows[0].category_code,
    action: 'revert',
    before: current,
    after: rateSnapshot(rows[0]),
    comment: String(comment || '').trim(),
    user
  });
  return { before: current, after: rateSnapshot(rows[0]), reverted_from_log_id: entry.id };
}

/**
 * days ≈ setup + qty/productivity — простая регрессия или решение по двум точкам.
 */
function fitRateFromPoints(points) {
  const pts = (points || [])
    .map((p) => ({
      qty: Number(p.qty),
      days: Number(p.days),
      fouling: p.fouling || 'medium'
    }))
    .filter((p) => p.qty > 0 && p.days > 0);
  if (pts.length < 1) {
    return { setup_days: 0, productivity: null, mh_per_unit: null, trace: 'нет точек' };
  }
  if (pts.length === 1) {
    const p = pts[0];
    return {
      setup_days: 0,
      productivity: Math.round((p.qty / p.days) * 1000) / 1000,
      mh_per_unit: null,
      trace: `1 точка: prod=${p.qty}/${p.days}`
    };
  }
  const n = pts.length;
  let sumQ = 0; let sumD = 0; let sumQQ = 0; let sumQD = 0;
  for (const p of pts) {
    sumQ += p.qty;
    sumD += p.days;
    sumQQ += p.qty * p.qty;
    sumQD += p.qty * p.days;
  }
  const denom = n * sumQQ - sumQ * sumQ;
  let setup = 0;
  let invProd = 0;
  if (Math.abs(denom) > 1e-9) {
    invProd = (n * sumQD - sumQ * sumD) / denom;
    setup = (sumD - invProd * sumQ) / n;
  } else {
    const p0 = pts[0];
    const p1 = pts[pts.length - 1];
    invProd = (p1.days - p0.days) / (p1.qty - p0.qty);
    setup = p0.days - invProd * p0.qty;
  }
  if (setup < 0) setup = 0;
  const productivity = invProd > 0 ? Math.round((1 / invProd) * 1000) / 1000 : null;
  return {
    setup_days: Math.round(setup * 1000) / 1000,
    productivity,
    mh_per_unit: null,
    trace: `регрессия: setup=${setup.toFixed(3)}, prod=${productivity}`
  };
}

async function computeExperienceDelta(db, exp) {
  if (!exp || !(Number(exp.derived_value) > 0)) return null;
  const calcKind = metricToCalcKind(exp.derived_metric);
  const code = exp.derived_metric
    ? `exp_${exp.category_code}_${exp.derived_metric}`
    : null;
  const rateRow = await findRateForPublish(db, exp, { calcKind, code });
  if (!rateRow) return null;
  const published = pickRate(rateRow, exp.fouling || 'medium');
  if (!(published > 0)) return null;
  const derived = Number(exp.derived_value);
  return Math.round(((derived - published) / published) * 10000) / 100;
}

function pickRate(rateRow, fouling) {
  const f = String(fouling || 'medium').toLowerCase();
  if (f === 'loose' || f === 'light' || f === 'лёгкие' || f === 'легкие') {
    return Number(rateRow.rate_loose ?? rateRow.rate_default);
  }
  if (f === 'hard' || f === 'heavy' || f === 'тяжёлые' || f === 'тяжелые' || f === 'coke') {
    return Number(rateRow.rate_hard ?? rateRow.rate_default);
  }
  return Number(rateRow.rate_medium ?? rateRow.rate_default);
}

function applyCoeffs(value, coeffs, selectedCodes) {
  let v = value;
  const applied = [];
  const set = new Set(selectedCodes || []);
  for (const c of coeffs || []) {
    if (!set.has(c.coeff_code)) continue;
    const m = Number(c.multiplier) || 1;
    if (c.applies_to === 'productivity' && m > 0) {
      // productivity multiplier >1 means harder → more time → divide rate or multiply days
      v = v * m;
      applied.push({ code: c.coeff_code, multiplier: m });
    }
  }
  return { value: v, applied };
}

/**
 * Math-only preview.
 * body: { category_code, method_code?, rate_code?, inputs: {}, fouling?, coeffs?: [], posts? }
 */
async function previewCalc(db, body) {
  const category = body.category_code;
  const method = body.method_code || null;
  const inputs = body.inputs || {};
  const fouling = body.fouling || 'medium';
  let selectedCoeffs = [...(body.coeffs || [])];

  const globals = (await loadGlobals(db)).map;
  const shiftHours = Number(globals.shift_hours) || 12;
  const shiftsPerDay = Number(globals.shifts_per_day) || 2;
  const kIrv = Number(globals.k_irv) || 0.82;
  const maxPosts = Number(body.posts) || Number(globals.max_parallel_posts) || 2;

  const { rows: catRows } = await db.query(
    `SELECT * FROM work_norm_categories WHERE code = $1 AND is_active`,
    [category]
  );
  const catRow = catRows[0] || null;
  const meta = methodMeta(catRow, method);

  const { rows: rates } = await db.query(
    `SELECT * FROM work_norm_rates
     WHERE category_code = $1 AND is_active
       AND ($2::text IS NULL OR method_code IS NULL OR method_code = $2)
     ORDER BY
       CASE WHEN method_code = $2 THEN 0 WHEN method_code IS NULL THEN 1 ELSE 2 END,
       sort_order, id`,
    [category, method]
  );

  // pipelines chem_ops: без контура → fallback м/смену
  let preferredCode = body.rate_code || (meta && meta.primary_rate_code) || null;
  if (
    category === 'pipelines' && method === 'chem_ops' && !body.rate_code &&
    !(Number(inputs.circuit_m3) > 0 || Number(inputs.cycles) > 0)
  ) {
    preferredCode = 'pipe_chem_m_day';
  }

  let rateRow = null;
  if (preferredCode) {
    rateRow = rates.find((r) => r.code === preferredCode) || null;
  }
  if (!rateRow && method) {
    rateRow = rates.find((r) => r.method_code === method) || null;
  }
  if (!rateRow) rateRow = rates[0] || null;
  if (!rateRow) {
    return { error: 'Нет нормы для этой категории/метода', trace: [] };
  }

  // Нормализация входов: площадь из пластин, трубки из секций
  const normTrace = [];
  const surf = resolveSurfaceM2(inputs, normTrace);
  if (surf > 0 && !(Number(inputs.surface_m2) > 0)) inputs.surface_m2 = surf;
  const tubesResolved = resolveTubes(inputs, normTrace);
  if (tubesResolved > 0 && !(Number(inputs.tubes) > 0)) inputs.tubes = tubesResolved;
  const platesN = resolvePlatesCount(inputs, normTrace);
  if (platesN > 0 && !(Number(inputs.plates_count) > 0)) inputs.plates_count = platesN;
  // plates_pack primary считает пластины как volume
  if (category === 'repair_weld' && method === 'plates_pack' && platesN > 0 && !(Number(inputs.joints) > 0)) {
    inputs.tubes = platesN; // per_unit_shift читает tubes|... — подставим ниже явно
  }
  // ITP/heating: circuit_m3 как volume для per_uni_shift
  if ((method === 'itp' || method === 'heating') && Number(inputs.circuit_m3) > 0) {
    // ok — per_unit_shift уже берёт circuit_m3
  }

  // ── Площадь из объёма, когда единица совпадает ──────────────────────────
  // Часть норм считает площадь (`surface_m2`): авo.outer, plates.hydro_dis,
  // boilers, towers_hvac. В ВОР эта же величина лежит в `volume` с единицей
  // «м2» — заказчику так удобнее, пересчёт не нужен.
  //
  // Без этого норма отвечала «Укажите площадь, м²» на 83 позициях АВО из
  // #2138, хотя площадь была в объёме (10.546 м²). Проверено: с surface_m2
  // норма сразу даёт сутки.
  //
  // Правило общее и безопасное: подставляем ТОЛЬКО когда единица позиции
  // действительно площадь. Для «шт», «т», «м3» подстановки нет — иначе
  // штуки стали бы квадратными метрами.
  const volUnit = String(inputs.unit || inputs._measured_unit || inputs.measured_unit || '')
    .toLowerCase().replace(/\s+/g, '');
  const isAreaUnit = /^(м2|м²|кв\.?м|квм|m2)$/.test(volUnit);
  const volValue = Number(inputs.volume) || Number(inputs._measured_value) || Number(inputs.measured_value) || 0;
  if (isAreaUnit && volValue > 0 && !(Number(inputs.surface_m2) > 0)) {
    inputs.surface_m2 = volValue;
    normTrace.push(`площадь ${volValue} м² взята из объёма (единица совпадает)`);
  }

  // ── Пересчёт альтернативных единиц (V472) ────────────────────────────────
  // В ВОР объём приходит как удобно заказчику: м², тонны, литры, дюймы.
  // Норма считает в своей единице. Если ожидаемого поля нет, а для единицы
  // есть правило пересчёта — приводим. При нехватке параметра (толщина,
  // плотность) НЕ выдумываем: возвращаем needs_input с точным списком.
  const unitConv = require('./unit-convert');
  const sanityCheck = require('./norm-sanity');
  let conversionNote = null;
  let conversionAssumed = false;
  try {
    const needField = expectedInputField(category, method, rateRow.code, rateRow.calc_kind);
    const haveIt = needField ? Number(inputs[needField]) > 0 : true;
    const measuredUnit = inputs._measured_unit || inputs.measured_unit || null;
    const measuredValue = Number(inputs._measured_value || inputs.measured_value) || 0;

    if (needField && !haveIt && measuredUnit && measuredValue > 0) {
      const rule = await loadConversionRule(db, category, method, measuredUnit, needField);
      if (rule) {
        const cv = unitConv.convert({
          category, method,
          fromUnit: measuredUnit,
          value: measuredValue,
          toField: needField,
          params: inputs,
          rule,
          defaults: await loadLayerDefaults(db, inputs.deposit_type),
          allowAssumed: inputs._allow_assumed === true,
          fouling: inputs.fouling
        });
        if (cv.ok) {
          inputs[needField] = cv.value;
          conversionNote = cv.trace.join('; ');
          conversionAssumed = !!cv.assumed;
          normTrace.push('пересчёт: ' + conversionNote);
          if (cv.assumed) {
            normTrace.push('⚠ пересчёт по типовому значению — это допущение');
          }
        } else if (cv.missing && cv.missing.length) {
          return {
            error: `Нужно уточнить: ${cv.missing.join(', ')}. ${cv.note || ''}`.trim(),
            needs_input: true,
            missing: cv.missing,
            rate: rateRow,
            trace: normTrace
          };
        }
      }
    }
  } catch (_) {
    // Пересчёт не должен ломать расчёт: если что-то пошло не так,
    // работаем как раньше — с исходными полями.
  }

  // ── Проверка единицы против нормы (06.11) ────────────────────────────────
  // Норма tubes.gdo считает ШТУКИ трубок, а ВОР часто даёт погонные метры.
  // Без этой проверки «102 516 п.м» считалось как 102 516 трубок и давало
  // срок 739 855 суток. Пересчитываем через длину трубки либо отказываем.
  try {
    const unitCheck = sanityCheck.checkUnitMatchesNorm({
      category, method,
      unit: inputs._measured_unit || inputs.measured_unit || inputs.unit,
      value: Number(inputs._measured_value || inputs.measured_value) || 0,
      params: {
        length_m: Number(inputs.length_m) || null,
        diameter_mm: Number(inputs.diameter_mm) || null,
        wall_mm: Number(inputs.wall_mm) || null
      }
    });
    if (!unitCheck.ok) {
      return {
        error: `Нужно уточнить: ${unitCheck.note}`,
        needs_input: true,
        missing: unitCheck.missing || [],
        rate: rateRow,
        trace: normTrace
      };
    }
    if (unitCheck.converted) {
      const field = expectedInputField(category, method, rateRow.code, rateRow.calc_kind);
      if (field) inputs[field] = unitCheck.value;
      normTrace.push('единица: ' + unitCheck.note);
    }
  } catch (_) { /* проверка не должна ломать расчёт */ }

  const physErr = physicalInputError(category, method, rateRow.code, rateRow.calc_kind, inputs);
  if (physErr) {
    return { error: physErr, rate: rateRow, trace: normTrace };
  }

  const { rows: coeffs } = await db.query(
    `SELECT * FROM work_norm_coeffs WHERE is_active
     AND (category_code IS NULL OR category_code = $1)`,
    [category]
  );

  // ОЗП-флаг → коэффициент ozp
  if (isTruthyFlag(inputs.ozp) && !selectedCoeffs.includes('ozp')) {
    selectedCoeffs.push('ozp');
  }
  // биоплёнка градирни → hard уже в fouling; height для vent если нужно — через coeffs UI

  const crew = rateRow.crew_json || {};
  let exec = Number(crew.exec) || 3;
  let master = Number(crew.master) || 1;
  const posts = Math.max(1, Math.min(maxPosts, Number(body.posts) || maxPosts));

  // ОЗП: наблюдающий 1:1 к посту (минимум +1 на смену)
  if (crew.observer_rule === '1:1' || isTruthyFlag(inputs.ozp)) {
    exec = exec; // слесари как в норме
    // observer учитываем в person_shifts ниже через +1 к людям смены
  }
  const observers =
    (crew.observer_rule === '1:1' || isTruthyFlag(inputs.ozp)) ? Math.max(1, posts) : 0;

  let rawRate = pickRate(rateRow, isTruthyFlag(inputs.biofouling) ? 'hard' : fouling);
  if (!(rawRate > 0) && rateRow.calc_kind !== 'fixed_days') {
    return {
      error: 'Норма не заполнена (rate_default пустой) — РП должен внести значение',
      rate: rateRow,
      trace: ['rate_default = null']
    };
  }

  const trace = [...normTrace];
  let personShifts = 0;
  let workDays = 0;
  let manHours = 0;
  let reagentKg = null;
  let extraDays = 0;
  let setupDaysBreakdown = null;
  let flowDaysBreakdown = null;

  const params = rateRow.params_json || {};
  const kind = rateRow.calc_kind;
  const peoplePerShift = exec + master + observers;

  function finalizeFromDays(days) {
    workDays = Math.max(0, ceil(days));
    personShifts = workDays * peoplePerShift * shiftsPerDay * posts;
    manHours = personShifts * shiftHours;
  }

  if (kind === 'days_per_unit') {
    const units = Number(
      inputs.sections ?? inputs.apparatus ?? inputs.boilers ?? inputs.objects ??
      inputs.qty ?? inputs.volume_m3 ?? 1
    );
    let daysPer = rawRate;
    if (isTruthyFlag(inputs.acid) && rateRow.code === 'boiler_chem_days') {
      daysPer *= 1.15;
      trace.push('кислотная промывка ×1.15 к суткам');
    }
    if (isTruthyFlag(inputs.gasket_replace)) {
      daysPer += 0.5;
      trace.push('замена уплотнений +0.5 сут/апп.');
    }
    const adj = applyCoeffs(daysPer, coeffs, selectedCoeffs);
    let totalPostDays = units * adj.value;

    // пластинчатые: если есть площадь — max с м²-нормой
    if (category === 'plates' && method === 'hydro_dis' && Number(inputs.surface_m2) > 0) {
      const m2Rate = rates.find((r) => r.code === 'plates_m2_shift');
      if (m2Rate) {
        const m2Per = pickRate(m2Rate, fouling);
        if (m2Per > 0) {
          const m2Crew = m2Rate.crew_json || {};
          const m2Exec = Number(m2Crew.exec) || 2;
          const execShifts = Number(inputs.surface_m2) / m2Per;
          const daysFromM2 = execShifts / Math.max(1, m2Exec * shiftsPerDay * posts);
          if (daysFromM2 > totalPostDays / posts) {
            totalPostDays = daysFromM2 * posts;
            trace.push(`площадь ${inputs.surface_m2} м² → ${daysFromM2.toFixed(2)} сут (max с сут/апп.)`);
          }
        }
      }
    }

    workDays = ceil(totalPostDays / posts);
    adj.applied.forEach((a) => trace.push(`коэфф. ${a.code} ×${a.multiplier}`));
    trace.push(`${units} ед. × ${adj.value.toFixed(2)} сут/ед. = ${totalPostDays.toFixed(2)} пост·сут`);
    trace.push(`постов ${posts} → work_days = ⌈${totalPostDays.toFixed(2)}/${posts}⌉ = ${workDays}`);
    finalizeFromDays(workDays);
  } else if (kind === 'fixed_days') {
    const units = Number(inputs.objects ?? inputs.qty ?? 1);
    const adj = applyCoeffs(rawRate * units, coeffs, selectedCoeffs);
    finalizeFromDays(adj.value);
    trace.push(`фиксированные сутки ${adj.value} → work_days=${workDays}`);
    adj.applied.forEach((a) => trace.push(`коэфф. ${a.code} ×${a.multiplier}`));
  } else if (kind === 'hours_per_cycle') {
    const cycles = Number(inputs.cycles) > 0 ? Number(inputs.cycles) : 1;
    let hoursPer = rawRate;
    if (isTruthyFlag(inputs.acid) && (rateRow.code === 'boiler_chem_hours' || category === 'boilers')) {
      const mult = Number(params.acid_mult) || 1.15;
      hoursPer *= mult;
      trace.push(`кислота ×${mult} к часам цикла`);
    }
    const adj = applyCoeffs(hoursPer, coeffs, selectedCoeffs);
    const totalHours = cycles * adj.value;
    workDays = ceil(totalHours / (shiftHours * shiftsPerDay * posts));
    personShifts = workDays * peoplePerShift * shiftsPerDay * posts;
    manHours = personShifts * shiftHours;
    if (Number(inputs.circuit_m3) > 0) {
      trace.push(`контур ${inputs.circuit_m3} м³ (реагент отдельно; на длительность не влияет)`);
    }
    trace.push(`${cycles} цикл(ов) × ${adj.value} ч = ${totalHours} ч`);
    trace.push(`work_days=⌈${totalHours}/(${shiftHours}×${shiftsPerDay}×${posts})⌉=${workDays}`);
    adj.applied.forEach((a) => trace.push(`коэфф. ${a.code} ×${a.multiplier}`));
  } else if (kind === 'per_unit_shift') {
    let volume = Number(
      inputs.tubes ?? inputs.joints ?? inputs.plates_count ?? inputs.surface_m2 ?? inputs.length_m ??
      inputs.circuit_m3 ?? inputs.volume_m3 ?? inputs.qty ?? 0
    );
    if (!(volume > 0) && Number(inputs.sections) > 0 && Number(inputs.tubes_per_section) > 0) {
      volume = Number(inputs.sections) * Number(inputs.tubes_per_section);
      trace.push(`${inputs.sections} × ${inputs.tubes_per_section} = ${volume} труб`);
    }
    if (!(volume > 0) && category === 'repair_weld' && method === 'plates_pack') {
      volume = resolvePlatesCount(inputs, trace);
    }
    if (!(volume > 0)) {
      return {
        error: 'Укажите объём (м² / м³ / м / трубки / пластины)',
        rate: rateRow,
        trace
      };
    }

    let effRate = rawRate;
    const byDia = lookupBySize(params.by_diameter, inputs.diameter_mm);
    if (byDia != null && (rateRow.unit || '').includes('труб')) {
      effRate = byDia;
      trace.push(`Ø${inputs.diameter_mm} → ${effRate} ${rateRow.unit}`);
    }
    for (const c of coeffs) {
      if (!selectedCoeffs.includes(c.coeff_code)) continue;
      const m = Number(c.multiplier) || 1;
      if (m > 1) {
        effRate = effRate / m;
        trace.push(`коэфф. ${c.coeff_code} ÷${m} → выработка ${effRate.toFixed(2)}`);
      }
    }

    const useNonlinear = params.setup_days != null || Number(params.productivity) > 0;
    if (useNonlinear) {
      const sd = resolveSetupParam(params.setup_days, fouling);
      let prodPerDay = Number(params.productivity) > 0
        ? Number(params.productivity)
        : effRate * Math.max(1, exec) * shiftsPerDay;
      if (prodPerDay > 0) {
        flowDaysBreakdown = volume / prodPerDay;
        setupDaysBreakdown = sd;
        workDays = ceil(sd + flowDaysBreakdown);
        personShifts = workDays * peoplePerShift * shiftsPerDay * posts;
        manHours = personShifts * shiftHours;
        trace.push(
          `нелинейно: setup ${sd} сут + flow ${volume}/${prodPerDay.toFixed(2)}` +
          ` → work_days=${workDays}`
        );
      }
    }

    if (setupDaysBreakdown == null) {
      const execShiftsNeeded = volume / effRate;
      const execPerDay = exec * shiftsPerDay * posts;
      workDays = ceil(execShiftsNeeded / Math.max(1, execPerDay));
      personShifts = workDays * peoplePerShift * shiftsPerDay * posts;
      manHours = personShifts * shiftHours;
      trace.push(`${volume} / ${effRate.toFixed(2)} = ${execShiftsNeeded.toFixed(2)} исполн.·смен`);
      trace.push(`бригада ${master}м+${exec}сл` +
        (observers ? `+${observers}набл` : '') +
        `, смен/сут ${shiftsPerDay}, постов ${posts} → work_days=${workDays}`);
    }

    // котёл complex: + часы химии по контуру
    if (category === 'boilers' && method === 'complex' && Number(inputs.circuit_m3) > 0) {
      const chemRate = rates.find((r) => r.code === 'boiler_chem_hours');
      if (chemRate) {
        const cyc = Number(inputs.cycles) > 0 ? Number(inputs.cycles) : 1;
        let h = pickRate(chemRate, fouling) * cyc;
        if (isTruthyFlag(inputs.acid)) h *= 1.15;
        const chemDays = ceil(h / (shiftHours * shiftsPerDay * posts));
        workDays += chemDays;
        personShifts = workDays * peoplePerShift * shiftsPerDay * posts;
        manHours = personShifts * shiftHours;
        trace.push(`+ химия ${cyc} цикл × ${pickRate(chemRate, fouling)} ч → +${chemDays} сут`);
      }
    }

    // пластины: замена уплотнений
    if (isTruthyFlag(inputs.gasket_replace)) {
      workDays += 1;
      personShifts = workDays * peoplePerShift * shiftsPerDay * posts;
      manHours = personShifts * shiftHours;
      trace.push('замена уплотнений +1 сут');
    }
  } else if (kind === 'min_per_unit') {
    let tubes = resolveTubes(inputs, trace);
    if (!(tubes > 0)) {
      return {
        error: 'Укажите число трубок (или секции × трубок/секц.) и Ø + длину трубки',
        rate: rateRow,
        trace
      };
    }
    let minPer = rawRate;
    const byDia = lookupBySize(params.by_diameter, inputs.diameter_mm);
    if (byDia != null) {
      minPer = byDia;
      trace.push(`Ø${inputs.diameter_mm} → ${minPer} мин/труб`);
    } else if (!(Number(inputs.diameter_mm) > 0)) {
      trace.push('Ø не указан — базовая мин/труб без калибровки по диаметру');
    }
    const lengthRef = Number(params.length_ref_m) || 6;
    if (Number(inputs.length_m) > 0 && lengthRef > 0) {
      const factor = Number(inputs.length_m) / lengthRef;
      minPer *= factor;
      trace.push(`L=${inputs.length_m} м ×(L/${lengthRef}) → ${minPer.toFixed(2)} мин/труб`);
    } else {
      trace.push('длина трубки не указана — без поправки L/6');
    }
    const adj = applyCoeffs(minPer, coeffs, selectedCoeffs);
    const totalMin = tubes * adj.value;
    const productiveMinPerShift = shiftHours * 60 * kIrv;
    const execShifts = totalMin / productiveMinPerShift;
    const execPerDay = exec * shiftsPerDay * posts;
    workDays = ceil(execShifts / Math.max(1, execPerDay));
    adj.applied.forEach((a) => trace.push(`коэфф. ${a.code} ×${a.multiplier}`));
    trace.push(`${tubes} труб × ${adj.value.toFixed(2)} мин = ${totalMin.toFixed(0)} мин`);
    trace.push(`продуктивных мин/смену ${productiveMinPerShift.toFixed(0)} (КИРВ ${kIrv}) → ${execShifts.toFixed(2)} исп.·смен`);
    finalizeFromDays(workDays);
  } else if (kind === 'mh_per_unit') {
    let u = 1;
    let mhPer = rawRate;
    if (rateRow.code === 'tubes_chem_100' && inputs.tubes) {
      u = Number(inputs.tubes) / 100;
    } else if (rateRow.code === 'vessel_mh_per_m3' && inputs.volume_m3) {
      u = Number(inputs.volume_m3);
    } else if (rateRow.code === 'insul_mh_m2' && inputs.surface_m2) {
      u = Number(inputs.surface_m2);
      const byDia = lookupBySize(params.by_diameter, inputs.diameter_mm);
      if (byDia != null) {
        mhPer = byDia;
        trace.push(`Ø${inputs.diameter_mm} → ${mhPer} чел·ч/м² (ЕНиР)`);
      }
      const cover = Number(inputs.cover);
      if (cover === 1 && params.cover_metal_mult) {
        mhPer *= Number(params.cover_metal_mult);
        trace.push(`покрытие металл ×${params.cover_metal_mult}`);
      } else if (cover === 2 && params.cover_polymer_mult) {
        mhPer *= Number(params.cover_polymer_mult);
        trace.push(`покрытие полимер ×${params.cover_polymer_mult}`);
      }
      if (Number(inputs.layers) > 1) {
        mhPer *= Number(inputs.layers);
        trace.push(`слои ×${inputs.layers}`);
      }
    } else if (inputs.surface_m2) {
      u = Number(inputs.surface_m2);
    } else if (inputs.volume_m3) {
      u = Number(inputs.volume_m3);
    } else if (inputs.boilers) {
      u = Number(inputs.boilers);
    } else if (inputs.apparatus) {
      u = Number(inputs.apparatus);
    }

    const adj = applyCoeffs(mhPer * u, coeffs, selectedCoeffs);
    let baseMh = adj.value;
    if (params.setup_mh != null) {
      const setupMh = resolveSetupParam(params.setup_mh, fouling);
      baseMh = setupMh + adj.value;
      trace.push(`setup ${setupMh} чел·ч + ${adj.value.toFixed(1)} чел·ч на объём`);
    }
    const peoplePerDay = peoplePerShift * shiftsPerDay * posts;
    // чел·ч → смены исполнителей (делим на shiftHours), затем на людей/день
    const rawPersonShifts = baseMh / shiftHours;
    workDays = ceil(rawPersonShifts / Math.max(1, peoplePerDay));
    personShifts = workDays * peoplePerDay;
    manHours = personShifts * shiftHours;
    trace.push(`трудоёмкость ${baseMh.toFixed(1)} чел·ч → work_days=${workDays}`);
    adj.applied.forEach((a) => trace.push(`коэфф. ${a.code} ×${a.multiplier}`));
  } else if (kind === 'kg_per_m') {
    const length = Number(inputs.length_m) || 0;
    if (!(length > 0)) return { error: 'Укажите длину, м', rate: rateRow, trace: [] };
    let kgPerM = rawRate;
    const byDn = lookupBySize(params.by_dn, inputs.dn_mm);
    if (byDn != null) {
      kgPerM = byDn;
      trace.push(`Ду${inputs.dn_mm} → ${kgPerM} кг/м`);
    }
    reagentKg = length * kgPerM;
    const { rows: laborRows } = await db.query(
      `SELECT * FROM work_norm_rates WHERE category_code=$1 AND method_code=$2 AND calc_kind='fixed_days' AND is_active LIMIT 1`,
      [category, method]
    );
    workDays = laborRows[0] ? ceil(pickRate(laborRows[0], fouling)) : 2;
    personShifts = workDays * peoplePerShift * shiftsPerDay * posts;
    manHours = personShifts * shiftHours;
    trace.push(`реагент ${length} м × ${kgPerM} кг/м = ${reagentKg.toFixed(1)} кг`);
    trace.push(`трудоёмкость (выдержка/промывка) work_days=${workDays}`);
  } else {
    return { error: `Неизвестный calc_kind: ${kind}`, rate: rateRow, trace: [] };
  }

  // ГДО: выемка пучка / межтрубное — доп. сутки
  if (category === 'tubes' && method === 'gdo') {
    if (isTruthyFlag(inputs.bundle_pull)) {
      const pull = rates.find((r) => r.code === 'tubes_bundle_pull_days');
      if (pull) {
        const d = pickRate(pull, fouling) || 1;
        extraDays += d;
        trace.push(`выемка пучка +${d} сут`);
      }
    }
    if (isTruthyFlag(inputs.shell_side)) {
      const shell = rates.find((r) => r.code === 'tubes_shell_days');
      if (shell) {
        const d = pickRate(shell, fouling) || 1.5;
        extraDays += d;
        trace.push(`межтрубное +${d} сут`);
      }
    }
    if (extraDays > 0) {
      workDays += ceil(extraDays);
      personShifts = workDays * peoplePerShift * shiftsPerDay * posts;
      manHours = personShifts * shiftHours;
    }
  }

  return {
    ok: true,
    category_code: category,
    method_code: method,
    rate: {
      id: rateRow.id,
      code: rateRow.code,
      name: rateRow.name,
      unit: rateRow.unit,
      calc_kind: rateRow.calc_kind,
      rate_used: rawRate,
      fouling: isTruthyFlag(inputs.biofouling) ? 'hard' : fouling
    },
    crew: {
      master, exec, observers, posts,
      shifts_per_day: shiftsPerDay, shift_hours: shiftHours
    },
    results: {
      work_days: workDays,
      person_shifts: personShifts,
      man_hours: Math.round(manHours),
      reagent_kg: reagentKg != null ? Math.round(reagentKg * 10) / 10 : null,
      setup_days: setupDaysBreakdown != null ? Math.round(setupDaysBreakdown * 1000) / 1000 : null,
      flow_days: flowDaysBreakdown != null ? Math.round(flowDaysBreakdown * 1000) / 1000 : null
    },
    trace
  };
}

/** work_type (Mimir) → коды категорий норм для сужения промпта */
const WORK_TYPE_CATEGORY_HINT = {
  HYDRO_DYN: ['tubes', 'avo', 'plates'],
  HYDRO_MECH: ['tubes', 'avo'],
  CHEM: ['chem_circuits', 'boilers', 'pipelines', 'plates', 'tubes'],
  HVAC: ['vent_sewer', 'towers_hvac'],
  MOUNT: ['mount', 'repair_weld'],
  INSULATION: ['insulation'],
  DIAG: ['tubes', 'plates', 'boilers'],
  CLEANING: null
};

function filterCatalogByWorkType(catalog, workTypeHint) {
  if (!catalog || !workTypeHint) return catalog;
  const codes = WORK_TYPE_CATEGORY_HINT[String(workTypeHint).toUpperCase()];
  if (!codes || !codes.length) return catalog;
  const set = new Set(codes);
  return {
    ...catalog,
    categories: (catalog.categories || []).filter((c) => set.has(c.code)),
    rates: (catalog.rates || []).filter((r) => set.has(r.category_code)),
    experiences: (catalog.experiences || []).filter((e) => set.has(e.category_code))
  };
}

function toPromptMarkdown(catalog, workTypeHint) {
  if (!catalog) return '(справочник норм CRM пуст)';
  const scoped = filterCatalogByWorkType(catalog, workTypeHint);
  const lines = [];
  lines.push('═══ СПРАВОЧНИК НОРМ CRM (приоритет над MODULE §3.5 при конфликте) ═══');
  lines.push('Globals: ' + Object.entries(scoped.globals || catalog.globals || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(', '));
  lines.push('');
  const cats = scoped.categories || [];
  for (const cat of cats) {
    lines.push(`### ${cat.title} (${cat.code})`);
    const rates = (scoped.rates || catalog.rates || []).filter((r) => r.category_code === cat.code);
    for (const r of rates) {
      const def = r.rate_default != null ? r.rate_default : '—';
      const crew = r.crew_json || {};
      let line =
        `- [${r.method_code || '—'}] ${r.name} · код \`${r.code}\`: база=${def} ${r.unit}` +
        ` (${calcKindLabel(r.calc_kind)})` +
        (r.rate_loose != null
          ? `; лёгкие/средние/тяжёлые=${r.rate_loose}/${r.rate_medium}/${r.rate_hard}`
          : '');
      if (crew.master != null || crew.exec != null) {
        line += `; бригада ${crew.master || 0}м+${crew.exec || 0}сл`;
      }
      const params = r.params_json || {};
      if (params.by_diameter && typeof params.by_diameter === 'object') {
        const parts = Object.entries(params.by_diameter)
          .map(([d, v]) => `Ø${d}→${v}`)
          .join(', ');
        if (parts) line += `; по Ø: ${parts}`;
      }
      if (params.by_dn && typeof params.by_dn === 'object') {
        const parts = Object.entries(params.by_dn)
          .map(([d, v]) => `Ду${d}→${v}`)
          .join(', ');
        if (parts) line += `; по Ду: ${parts}`;
      }
      if (r.notes) line += ` // ${r.notes}`;
      lines.push(line);
    }
    lines.push('');
  }

  const facts = (scoped.experiences || catalog.experiences || []).filter((e) =>
    e.status === 'published' || e.status === 'confirmed'
  );
  if (facts.length) {
    lines.push('### ФАКТЫ С ОБЪЕКТОВ (подтверждены РП — калибровка)');
    for (const e of facts.slice(0, 40)) {
      const bits = [
        e.customer_name || e.object_name || 'объект',
        e.object_label,
        e.qty != null ? `${e.qty} ед.` : null,
        e.volume_value != null ? `${e.volume_value} ${e.volume_unit || ''}` : null,
        e.diameter_mm != null ? `Ø${e.diameter_mm}` : null,
        e.fouling ? `отложения ${e.fouling}${e.fouling_note ? '/' + e.fouling_note : ''}` : null,
        e.calendar_days != null ? `${e.calendar_days} сут` : null,
        (e.crew_masters != null || e.crew_exec != null)
          ? `${e.crew_masters || 0}м+${e.crew_exec || 0}сл`
          : null,
        e.equipment_text || null,
        e.derived_value != null
          ? `→ ${e.derived_value} ${e.derived_unit || ''} (${e.derived_metric || ''})`
          : null
      ].filter(Boolean);
      lines.push(`- [${e.status}] ${bits.join(' · ')}`);
    }
    lines.push('');
  }

  if (catalog.chemistry?.length) {
    lines.push('### Химия (прайс)');
    for (const c of catalog.chemistry.slice(0, 30)) {
      lines.push(`- ${c.name}: ${c.price_kg || '—'} ₽/кг; кг/м²=${c.kg_per_m2 ?? '—'}; кг/м³=${c.kg_per_m3 ?? '—'}`);
    }
  }
  lines.push('');
  lines.push('ПРАВИЛО: при конфликте MODULE §3.5 и CRM published — бери CRM.');
  lines.push('Факты с объектов — калибровка; published rates — источник истины для расчёта.');
  if (workTypeHint) lines.push(`(hint work_type=${workTypeHint})`);
  return lines.join('\n');
}

function globalsToCalcSettings(globalsMap, base = {}) {
  const g = globalsMap || {};
  return {
    ...base,
    vat_pct: g.vat_pct ?? base.vat_pct ?? 22,
    fot_tax_pct: g.fot_tax_pct ?? base.fot_tax_pct ?? 55,
    overhead_pct: g.overhead_pct ?? base.overhead_pct ?? 10,
    consumables_pct: g.consumables_pct ?? base.consumables_pct ?? 3,
    contingency_pct: g.contingency_pct ?? base.contingency_pct ?? 5,
    itr_rate_per_day: g.itr_rate ?? base.itr_rate_per_day ?? 10000,
    per_diem_per_day: g.meals_per_day ?? base.per_diem_per_day ?? 1000,
    meals_per_day: g.meals_per_day ?? base.meals_per_day ?? 1000
  };
}

async function writeChangeLog(db, { entity_type, entity_id, category_code, action, before, after, comment, user }) {
  const c = String(comment || '').trim();
  if (c.length < 5) {
    const err = new Error('Комментарий обязателен (минимум 5 символов)');
    err.statusCode = 400;
    throw err;
  }
  await db.query(
    `INSERT INTO work_norm_change_log
      (entity_type, entity_id, category_code, action, before_json, after_json, comment, user_id, user_name)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)`,
    [
      entity_type,
      entity_id != null ? String(entity_id) : null,
      category_code || null,
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      c.slice(0, 2000),
      user?.id || null,
      user?.name || user?.login || null
    ]
  );
}

/** Детерминированный вывод нормы из факта (не AI). */
function deriveFromExperience(exp, globalsMap = {}, catRow = null) {
  const shiftHours = Number(globalsMap.shift_hours) || 12;
  const kIrv = Number(globalsMap.k_irv) || 0.82;
  const shifts = Number(exp.shift_mode) || 2;
  const days = Number(exp.calendar_days);
  const exec = Number(exp.crew_exec);
  const masters = Number(exp.crew_masters);
  const qty = Number(exp.qty) || 1;
  const vol = Number(exp.volume_value);
  const unit = String(exp.volume_unit || '').toLowerCase();
  const cat = exp.category_code;
  const extras = exp.extras_json && typeof exp.extras_json === 'object' ? exp.extras_json : {};
  const questions = [];
  const clarifications = [];

  if (!cat) questions.push('Укажите направление работ (АВО, трубные пучки, …)');
  if (!(days > 0) && !(Number(exp.derived_value) > 0) && !(Number(extras.hours_fact) > 0)) {
    questions.push('Сколько календарных суток заняла работа?');
  }
  if (!(exec > 0) && !(masters > 0) && !(Number(extras.hours_fact) > 0)) {
    questions.push('Сколько мастеров и слесарей было на объекте?');
  }

  const meta = methodMeta(catRow, exp.method_code);
  let metric = (meta && meta.derived_metric) || null;
  // fallback по категории, если method не задан
  if (!metric) {
    if (cat === 'tubes') metric = 'min_per_tube';
    else if (cat === 'avo') {
      if (/м²|m2|м2/.test(unit) || Number(vol) > 0 && /м/.test(unit)) metric = 'm2_per_shift';
      else metric = 'min_per_tube';
    }
    else if (cat === 'plates') metric = /цикл/.test(unit) ? 'hours_per_cycle' : 'm2_per_shift';
    else if (cat === 'boilers') {
      if (/цикл/.test(unit) || Number(extras.cycles) > 0) metric = 'hours_per_cycle';
      else metric = 'm2_per_shift';
    }
    else if (cat === 'repair_weld') {
      if (/стык/.test(unit)) metric = 'joints_per_shift';
      else if (/пластин/.test(unit)) metric = 'plates_per_shift';
      else metric = 'm2_per_shift';
    }
    else if (cat === 'vessels') metric = 'mh_per_m3';
    else if (cat === 'insulation') metric = 'mh_per_m2';
    else if (cat === 'chem_circuits') metric = 'hours_per_cycle';
    else if (/м²|m2|м2/.test(unit)) metric = 'm2_per_shift';
    else if (/м3|м³/.test(unit)) metric = 'm3_per_shift';
    else if (/м$|м\.|meter/.test(unit)) metric = 'm_per_shift';
  }

  let derived_metric = null;
  let derived_value = null;
  let derived_unit = null;
  let derived_trace = null;

  const lengthM = Number(exp.length_m) || Number(extras.length_m) || 0;
  const cycles = Number(extras.cycles) || 0;
  const hoursFact = Number(extras.hours_fact) || 0;
  const kgReagent = Number(extras.kg_reagent) || 0;

  if (metric === 'min_per_tube' && vol > 0 && days > 0 && exec > 0) {
    const tubes = (qty > 1 && vol >= 50) ? qty * vol : vol;
    const productiveMin = days * shifts * shiftHours * 60 * kIrv * exec;
    derived_metric = 'min_per_tube';
    derived_value = Math.round((productiveMin / tubes) * 100) / 100;
    derived_unit = 'мин/труб';
    derived_trace =
      `${days} сут × ${shifts} смен × ${shiftHours} ч × КИРВ ${kIrv} × ${exec} сл × 60` +
      ` / ${tubes} труб = ${derived_value} мин/труб`;
    if (derived_value < 0.3 || derived_value > 30) {
      clarifications.push(
        `Получилось ${derived_value} мин/труб — вне обычного коридора 0.3–30. Проверьте дни/бригаду/число трубок.`
      );
    }
  } else if (metric === 'tubes_per_shift' && vol > 0 && days > 0 && exec > 0) {
    const tubes = (qty > 1 && vol >= 50) ? qty * vol : vol;
    const productiveShifts = days * shifts * exec;
    derived_metric = 'tubes_per_shift';
    derived_value = Math.round((tubes / productiveShifts) * 10) / 10;
    derived_unit = 'труб/смену';
    derived_trace = `${tubes} труб / (${days}×${shifts}×${exec}) = ${derived_value} труб/смену`;
  } else if (metric === 'mh_per_100_tubes' && vol > 0 && days > 0 && exec > 0) {
    const tubes = vol;
    const mh = days * shifts * shiftHours * exec;
    derived_metric = 'mh_per_100_tubes';
    derived_value = Math.round((mh / (tubes / 100)) * 10) / 10;
    derived_unit = 'чел·ч/100 труб';
    derived_trace = `${mh.toFixed(0)} чел·ч / (${tubes}/100) = ${derived_value} чел·ч/100 труб`;
  } else if (
    (metric === 'days_per_section' || metric === 'days_per_unit') &&
    days > 0 && qty > 0
  ) {
    derived_metric = metric;
    derived_value = Math.round((days / qty) * 100) / 100;
    derived_unit = metric === 'days_per_section' ? 'сут/секц.' : 'сут/ед.';
    derived_trace = `${days} сут / ${qty} ед. = ${derived_value} ${derived_unit}`;
    if (derived_value < 0.2 || derived_value > 30) {
      clarifications.push(`Получилось ${derived_value} ${derived_unit} — проверьте сутки и количество.`);
    }
  } else if (metric === 'hours_per_cycle') {
    const cyc = cycles > 0 ? cycles : (qty > 0 ? qty : 0);
    if (hoursFact > 0 && cyc > 0) {
      derived_metric = 'hours_per_cycle';
      derived_value = Math.round((hoursFact / cyc) * 10) / 10;
      derived_unit = 'ч/цикл';
      derived_trace = `${hoursFact} ч / ${cyc} цикл = ${derived_value} ч/цикл`;
    } else if (days > 0 && cyc > 0) {
      const totalH = days * shifts * shiftHours;
      derived_metric = 'hours_per_cycle';
      derived_value = Math.round((totalH / cyc) * 10) / 10;
      derived_unit = 'ч/цикл';
      derived_trace = `${days}×${shifts}×${shiftHours} ч / ${cyc} цикл = ${derived_value} ч/цикл`;
    } else {
      questions.push('Для CIP укажите циклы и часы факта (или сутки)');
    }
  } else if (metric === 'kg_per_m' && lengthM > 0 && kgReagent > 0) {
    derived_metric = 'kg_per_m';
    derived_value = Math.round((kgReagent / lengthM) * 1000) / 1000;
    derived_unit = 'кг/м';
    derived_trace = `${kgReagent} кг / ${lengthM} м = ${derived_value} кг/м`;
  } else if (metric === 'mh_per_m3' && vol > 0 && days > 0 && exec > 0) {
    const mh = days * shifts * shiftHours * exec;
    derived_metric = 'mh_per_m3';
    derived_value = Math.round((mh / vol) * 100) / 100;
    derived_unit = 'чел·ч/м³';
    derived_trace = `${mh.toFixed(0)} чел·ч / ${vol} м³ = ${derived_value} чел·ч/м³`;
  } else if (metric === 'mh_per_m2' && vol > 0 && days > 0 && exec > 0) {
    const mh = days * shifts * shiftHours * exec;
    derived_metric = 'mh_per_m2';
    derived_value = Math.round((mh / vol) * 100) / 100;
    derived_unit = 'чел·ч/м²';
    derived_trace = `${mh.toFixed(0)} чел·ч / ${vol} м² = ${derived_value} чел·ч/м²`;
  } else if (metric === 'm2_per_shift' && vol > 0 && days > 0 && exec > 0) {
    const productiveShifts = days * shifts * exec;
    derived_metric = 'm2_per_shift';
    derived_value = Math.round((vol / productiveShifts) * 10) / 10;
    derived_unit = 'м²/смену';
    derived_trace = `${vol} м² / (${days}×${shifts}×${exec}) = ${derived_value} м²/смену`;
  } else if (metric === 'm3_per_shift' && vol > 0 && days > 0 && exec > 0) {
    const productiveShifts = days * shifts * exec;
    derived_metric = 'm3_per_shift';
    derived_value = Math.round((vol / productiveShifts) * 10) / 10;
    derived_unit = 'м³/смену';
    derived_trace = `${vol} м³ / (${days}×${shifts}×${exec}) = ${derived_value} м³/смену`;
  } else if (metric === 'm_per_shift' || (metric === 'hours_per_cycle' && !(cycles > 0) && !(hoursFact > 0))) {
    const length = vol > 0 ? vol : lengthM;
    if (length > 0 && days > 0 && exec > 0) {
      const productiveShifts = days * shifts * exec;
      derived_metric = 'm_per_shift';
      derived_value = Math.round((length / productiveShifts) * 10) / 10;
      derived_unit = 'м/смену';
      derived_trace = `${length} м / (${days}×${shifts}×${exec}) = ${derived_value} м/смену`;
    } else if (metric === 'hours_per_cycle') {
      questions.push('Для CIP укажите циклы и часы факта (или сутки)');
    } else if (!questions.length) {
      questions.push('Укажите длину (м), сутки и бригаду');
    }
  } else if (metric === 'joints_per_shift' && vol > 0 && days > 0 && exec > 0) {
    const productiveShifts = days * shifts * exec;
    derived_metric = 'joints_per_shift';
    derived_value = Math.round((vol / productiveShifts) * 10) / 10;
    derived_unit = 'стык/смену';
    derived_trace = `${vol} стык / (${days}×${shifts}×${exec}) = ${derived_value} стык/смену`;
  } else if (metric === 'plates_per_shift' && vol > 0 && days > 0 && exec > 0) {
    const productiveShifts = days * shifts * exec;
    derived_metric = 'plates_per_shift';
    derived_value = Math.round((vol / productiveShifts) * 10) / 10;
    derived_unit = 'пластин/смену';
    derived_trace = `${vol} пластин / (${days}×${shifts}×${exec}) = ${derived_value} пластин/смену`;
  } else if (vol > 0 && days > 0 && exec > 0 && /м²|m2|м2/.test(unit)) {
    // legacy fallback
    const productiveShifts = days * shifts * exec;
    derived_metric = 'm2_per_shift';
    derived_value = Math.round((vol / productiveShifts) * 10) / 10;
    derived_unit = 'м²/смену';
    derived_trace = `${vol} м² / (${days}×${shifts}×${exec}) = ${derived_value} м²/смену`;
  } else if (!(questions.length) && !derived_value) {
    questions.push('Не хватает данных для формулы направления: заполните поля объёма, сутки и бригаду');
  }

  return {
    derived_metric,
    derived_value,
    derived_unit,
    derived_trace,
    questions,
    clarifications,
    needs_clarification: questions.length > 0 || clarifications.length > 0
  };
}

async function listExperiences(db, { category, status, limit } = {}) {
  const lim = Math.min(200, Math.max(1, limit || 80));
  const clauses = [];
  const params = [];
  if (category) {
    params.push(category);
    clauses.push(`category_code = $${params.length}`);
  }
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  params.push(lim);
  const { rows } = await db.query(
    `SELECT * FROM work_norm_experiences
     ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function getExperience(db, id) {
  const { rows } = await db.query(`SELECT * FROM work_norm_experiences WHERE id = $1`, [id]);
  const row = rows[0] || null;
  if (!row) return null;
  try {
    const delta = await computeExperienceDelta(db, row);
    if (delta != null) row.delta_pct = delta;
  } catch (_) { /* без БД/колонок — не ломаем GET */ }
  return row;
}

async function loadCategory(db, code) {
  if (!code) return null;
  const { rows } = await db.query(
    `SELECT * FROM work_norm_categories WHERE code = $1`,
    [code]
  );
  return rows[0] || null;
}

async function createExperience(db, body, user) {
  const story = String(body.story_text || '').trim();
  if (story.length < 10) {
    const err = new Error('Опишите опыт минимум в 10 символах');
    err.statusCode = 400;
    throw err;
  }
  if (!body.category_code) {
    const err = new Error('category_code обязателен');
    err.statusCode = 400;
    throw err;
  }
  const globals = (await loadGlobals(db)).map;
  const catRow = await loadCategory(db, body.category_code);
  const extras = body.extras_json && typeof body.extras_json === 'object' ? body.extras_json : {};
  const derived = deriveFromExperience(
    { ...body, story_text: story, extras_json: extras },
    globals,
    catRow
  );

  const sourceKind = body.source_kind || 'manual';
  const { rows } = await db.query(
    `INSERT INTO work_norm_experiences (
      category_code, method_code, object_label, qty, volume_value, volume_unit,
      diameter_mm, length_m, fouling, fouling_note,
      calendar_days, shift_mode, crew_masters, crew_exec, crew_other_json,
      equipment_text, source_work_id, source_tender_id, customer_name, object_name, period_text,
      story_text, derived_metric, derived_value, derived_unit, derived_trace,
      status, comment, created_by, extras_json,
      target_rate_id, source_kind, source_estimate_id, norm_snapshot_json, delta_pct
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,
      $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,
      $31,$32,$33,$34::jsonb,$35
    ) RETURNING *`,
    [
      body.category_code,
      body.method_code || null,
      body.object_label || null,
      body.qty ?? null,
      body.volume_value ?? null,
      body.volume_unit || (methodMeta(catRow, body.method_code)?.volume_unit) || null,
      body.diameter_mm ?? null,
      body.length_m ?? extras.length_m ?? null,
      body.fouling || null,
      body.fouling_note || null,
      body.calendar_days ?? null,
      body.shift_mode || 2,
      body.crew_masters ?? null,
      body.crew_exec ?? null,
      JSON.stringify(body.crew_other_json || {}),
      body.equipment_text || null,
      body.source_work_id || null,
      body.source_tender_id || null,
      body.customer_name || null,
      body.object_name || null,
      body.period_text || null,
      story,
      derived.derived_metric,
      derived.derived_value,
      derived.derived_unit,
      derived.derived_trace,
      body.status === 'confirmed' ? 'confirmed' : 'draft',
      body.comment || null,
      user?.id || null,
      JSON.stringify(extras),
      body.target_rate_id ?? null,
      sourceKind,
      body.source_estimate_id ?? null,
      body.norm_snapshot_json ? JSON.stringify(body.norm_snapshot_json) : null,
      body.delta_pct ?? null
    ]
  );
  const row = rows[0];
  if (row.status === 'confirmed') {
    await db.query(
      `UPDATE work_norm_experiences SET confirmed_by=$2, confirmed_at=NOW() WHERE id=$1`,
      [row.id, user?.id || null]
    );
    row.confirmed_by = user?.id || null;
  }
  await writeChangeLog(db, {
    entity_type: 'experience',
    entity_id: String(row.id),
    category_code: row.category_code,
    action: 'create',
    before: null,
    after: row,
    comment: body.comment || `Создан опыт #${row.id}: ${story.slice(0, 80)}`,
    user
  });
  return { row, derived };
}

async function updateExperience(db, id, body, user) {
  const before = await getExperience(db, id);
  if (!before) {
    const err = new Error('Опыт не найден');
    err.statusCode = 404;
    throw err;
  }
  if (before.status === 'published') {
    const err = new Error('Опубликованный опыт нельзя править — создайте новый');
    err.statusCode = 400;
    throw err;
  }
  const merged = { ...before, ...body };
  if (body.extras_json && typeof body.extras_json === 'object') {
    merged.extras_json = body.extras_json;
  } else if (before.extras_json) {
    merged.extras_json = before.extras_json;
  }
  const globals = (await loadGlobals(db)).map;
  const catRow = await loadCategory(db, merged.category_code);
  const derived = deriveFromExperience(merged, globals, catRow);
  const { rows } = await db.query(
    `UPDATE work_norm_experiences SET
      category_code=$2, method_code=$3, object_label=$4, qty=$5, volume_value=$6, volume_unit=$7,
      diameter_mm=$8, length_m=$9, fouling=$10, fouling_note=$11,
      calendar_days=$12, shift_mode=$13, crew_masters=$14, crew_exec=$15, crew_other_json=$16::jsonb,
      equipment_text=$17, source_work_id=$18, source_tender_id=$19,
      customer_name=$20, object_name=$21, period_text=$22, story_text=$23,
      derived_metric=$24, derived_value=$25, derived_unit=$26, derived_trace=$27,
      comment=COALESCE($28, comment), extras_json=$29::jsonb, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [
      id,
      merged.category_code, merged.method_code || null, merged.object_label || null,
      merged.qty ?? null, merged.volume_value ?? null, merged.volume_unit || null,
      merged.diameter_mm ?? null, merged.length_m ?? null, merged.fouling || null, merged.fouling_note || null,
      merged.calendar_days ?? null, merged.shift_mode || 2,
      merged.crew_masters ?? null, merged.crew_exec ?? null,
      JSON.stringify(merged.crew_other_json || {}),
      merged.equipment_text || null, merged.source_work_id || null, merged.source_tender_id || null,
      merged.customer_name || null, merged.object_name || null, merged.period_text || null,
      merged.story_text,
      derived.derived_metric, derived.derived_value, derived.derived_unit, derived.derived_trace,
      body.comment || null,
      JSON.stringify(merged.extras_json || {})
    ]
  );
  await writeChangeLog(db, {
    entity_type: 'experience', entity_id: String(id), category_code: rows[0].category_code,
    action: 'update', before, after: rows[0],
    comment: body.comment || `Правка опыта #${id}`,
    user
  });
  return { row: rows[0], derived };
}

async function confirmExperience(db, id, comment, user) {
  const before = await getExperience(db, id);
  if (!before) {
    const err = new Error('Опыт не найден');
    err.statusCode = 404;
    throw err;
  }
  if (!before.derived_value && !before.derived_metric) {
    const err = new Error('Сначала заполните данные так, чтобы вывелась норма');
    err.statusCode = 400;
    throw err;
  }
  const { rows } = await db.query(
    `UPDATE work_norm_experiences SET
       status='confirmed', confirmed_by=$2, confirmed_at=NOW(), updated_at=NOW(),
       comment=COALESCE($3, comment)
     WHERE id=$1 RETURNING *`,
    [id, user?.id || null, comment || null]
  );
  await writeChangeLog(db, {
    entity_type: 'experience', entity_id: String(id), category_code: rows[0].category_code,
    action: 'confirm', before, after: rows[0],
    comment: comment || `Подтверждён опыт #${id}`,
    user
  });
  return rows[0];
}

/**
 * Публикация confirmed → work_norm_rates (+ params_json.by_diameter).
 * mode: replace | average | note_only
 */
async function publishExperience(db, id, { comment, mode } = {}, user) {
  const c = String(comment || '').trim();
  if (c.length < 5) {
    const err = new Error('Комментарий обязателен (минимум 5 символов)');
    err.statusCode = 400;
    throw err;
  }
  const exp = await getExperience(db, id);
  if (!exp) {
    const err = new Error('Опыт не найден');
    err.statusCode = 404;
    throw err;
  }
  if (exp.status !== 'confirmed' && exp.status !== 'published') {
    const err = new Error('Сначала подтвердите опыт');
    err.statusCode = 400;
    throw err;
  }
  if (!(exp.derived_value > 0) || !exp.derived_metric) {
    const err = new Error('Нет выведенной нормы для публикации');
    err.statusCode = 400;
    throw err;
  }

  const publishMode = mode || 'replace';
  const fouling = exp.fouling || 'medium';
  const metric = exp.derived_metric;
  const calcKind = metricToCalcKind(metric) || 'min_per_unit';
  let unit = exp.derived_unit || 'мин/труб';
  if (calcKind === 'days_per_unit') unit = exp.derived_unit || 'сут/ед.';
  else if (calcKind === 'per_unit_shift') unit = exp.derived_unit || 'ед./смену';
  else if (calcKind === 'hours_per_cycle') unit = 'ч/цикл';
  else if (calcKind === 'kg_per_m') unit = 'кг/м';

  const code = `exp_${exp.category_code}_${metric}`;
  const name = exp.object_label || `Норма с объекта #${exp.id}`;
  const val = Number(exp.derived_value);

  let rateRow = await findRateForPublish(db, exp, { calcKind, code });
  const beforeRate = rateRow ? rateSnapshot(rateRow) : null;

  const noteBit =
    `опыт #${exp.id}` +
    (exp.customer_name ? ` · ${exp.customer_name}` : '') +
    (exp.diameter_mm != null ? ` · Ø${exp.diameter_mm}` : '') +
    (exp.fouling_note ? ` · ${exp.fouling_note}` : '');

  const values = {};
  if (publishMode !== 'note_only') {
    if (fouling === 'light') values.rate_loose = val;
    else if (fouling === 'heavy') values.rate_hard = val;
    else values.rate_medium = val;
    if (publishMode === 'replace') values.rate_default = val;
    else values.rate_default = val;
  }
  const paramsPatch = {};
  if (exp.diameter_mm != null && calcKind === 'min_per_unit') {
    paramsPatch.by_diameter = {
      [String(Math.round(Number(exp.diameter_mm)))]: val
    };
  }
  const crewPatch = {
    master: exp.crew_masters || 1,
    exec: exp.crew_exec || 3,
    observer_rule: 'none'
  };

  let patchResult;
  if (rateRow) {
    patchResult = await applyNormPatch(db, {
      rateId: rateRow.id,
      values,
      mode: publishMode,
      source: `publish experience #${exp.id}`,
      user,
      comment: publishMode === 'note_only' ? `${c}; ${noteBit}` : c,
      paramsPatch: publishMode === 'note_only' ? undefined : paramsPatch,
      crewPatch: publishMode === 'note_only' ? undefined : crewPatch
    });
    rateRow = patchResult.after;
    if (publishMode === 'note_only') {
      const notes = [beforeRate?.notes, `справка ${noteBit}: ${val} ${unit}`].filter(Boolean).join('; ').slice(0, 2000);
      const { rows } = await db.query(
        `UPDATE work_norm_rates SET notes=$2, updated_at=NOW(), updated_by=$3 WHERE id=$1 RETURNING *`,
        [rateRow.id, notes, user?.id || null]
      );
      rateRow = rateSnapshot(rows[0]);
    }
  } else {
    patchResult = await applyNormPatch(db, {
      categoryCode: exp.category_code,
      code,
      name,
      unit,
      calcKind,
      methodCode: exp.method_code || null,
      values: {
        rate_loose: fouling === 'light' ? val : null,
        rate_medium: fouling === 'medium' || !fouling ? val : null,
        rate_hard: fouling === 'heavy' ? val : null,
        rate_default: val
      },
      mode: 'replace',
      source: `publish experience #${exp.id}`,
      user,
      comment: c,
      paramsPatch,
      crewPatch
    });
    rateRow = patchResult.after;
  }

  const deltaPct = await computeExperienceDelta(db, { ...exp, derived_value: val });
  const { rows: expRows } = await db.query(
    `UPDATE work_norm_experiences SET
       status='published', published_rate_id=$2, published_at=NOW(), updated_at=NOW(),
       target_rate_id=$2, delta_pct=$3,
       norm_snapshot_json=$4::jsonb
     WHERE id=$1 RETURNING *`,
    [id, rateRow.id, deltaPct, JSON.stringify(rateRow)]
  );

  await writeChangeLog(db, {
    entity_type: 'experience', entity_id: String(id), category_code: exp.category_code,
    action: 'publish', before: { experience: exp, rate: beforeRate },
    after: { experience: expRows[0], rate: rateRow },
    comment: c,
    user
  });

  return { experience: expRows[0], rate: rateRow, conflict: beforeRate };
}

async function batchCreateExperiences(db, { items, default_source_kind } = {}, user) {
  const list = Array.isArray(items) ? items : [];
  const results = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i] || {};
    try {
      const body = {
        ...item,
        source_kind: item.source_kind || default_source_kind || 'manual',
        status: item.status || 'draft'
      };
      const r = await createExperience(db, body, user);
      results.push({ ok: true, index: i, id: r.row.id, row: r.row, derived: r.derived });
    } catch (e) {
      results.push({ ok: false, index: i, error: e.message });
    }
  }
  return results;
}

function parseExperiencesTsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const obj = {};
    header.forEach((h, idx) => {
      const v = cols[idx];
      if (v == null || v === '') return;
      if (['qty', 'volume_value', 'diameter_mm', 'length_m', 'calendar_days', 'crew_masters', 'crew_exec', 'shift_mode'].includes(h)) {
        obj[h] = Number(String(v).replace(',', '.'));
      } else {
        obj[h] = v;
      }
    });
    if (obj.story_text || obj.category_code) rows.push(obj);
  }
  return rows;
}

const WORK_CLOSED_FOR_NORM = new Set([
  'Закрыт', 'Работы сдали', 'Завершена', 'Завершено', 'Завершен', 'Завершён', 'Закрыта', 'Сдана', 'Сдан'
]);

function isWorkClosedStatus(status) {
  if (!status) return false;
  if (WORK_CLOSED_FOR_NORM.has(status)) return true;
  return /закрыт/i.test(String(status)) || /сдали/i.test(String(status));
}

/** Черновик опыта при закрытии работы — не блокирует closeout/PUT. */
async function tryAutoExperienceOnWorkClose(db, workId, user) {
  try {
    const wid = Number(workId);
    if (!wid) return null;
    const { rows: dup } = await db.query(
      `SELECT id FROM work_norm_experiences
       WHERE source_work_id = $1 AND source_kind = 'work_close' LIMIT 1`,
      [wid]
    );
    if (dup[0]) return null;

    const hint = await getWorkHint(db, wid);
    if (!hint) return null;

    const { rows: wRows } = await db.query(
      `SELECT work_title, description FROM works WHERE id = $1 AND deleted_at IS NULL`,
      [wid]
    );
    const w = wRows[0] || {};
    const storyParts = [
      hint.object_name,
      hint.customer_name,
      hint.period_text,
      w.work_title
    ].filter(Boolean);
    let story_text = storyParts.join(' · ');
    if (story_text.length < 10) {
      story_text = `Закрытие работы #${wid}: ${w.work_title || hint.object_name || 'объект'}`;
    }

    const heur = heuristicExtractFromStory(
      story_text + ' ' + String(w.description || '')
    );
    if (!heur.category_code) return null;

    const result = await createExperience(db, {
      category_code: heur.category_code,
      method_code: heur.method_code || null,
      qty: heur.qty,
      volume_value: heur.volume_value,
      volume_unit: heur.volume_unit,
      diameter_mm: heur.diameter_mm,
      length_m: heur.length_m,
      fouling: heur.fouling,
      fouling_note: heur.fouling_note,
      calendar_days: hint.calendar_days ?? heur.calendar_days,
      shift_mode: heur.shift_mode || 2,
      crew_masters: heur.crew_masters,
      crew_exec: hint.crew_exec ?? heur.crew_exec,
      equipment_text: hint.equipment_text ?? heur.equipment_text,
      source_work_id: wid,
      source_tender_id: hint.source_tender_id,
      customer_name: hint.customer_name,
      object_name: hint.object_name,
      object_label: w.work_title || hint.object_name,
      period_text: hint.period_text,
      story_text,
      source_kind: 'work_close',
      status: 'draft',
      comment: `Авто при закрытии работы #${wid}`
    }, user || { id: null, name: 'system' });
    return result.row;
  } catch (_) {
    return null;
  }
}

async function getWorkHint(db, workId) {
  const id = Number(workId);
  if (!id) return null;
  const { rows } = await db.query(
    `SELECT id, work_title, customer_name, object_name, city,
            start_fact, end_fact, start_plan, end_plan, start_in_work_date,
            crew_size, tender_id, work_status
     FROM works WHERE id = $1`,
    [id]
  );
  const w = rows[0];
  if (!w) return null;

  let calendar_days = null;
  const start = w.start_fact || w.start_in_work_date || w.start_plan;
  const end = w.end_fact || w.end_plan;
  if (start && end) {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    calendar_days = Math.max(1, Math.round(ms / 86400000) + 1);
  }

  let crew_exec = null;
  let crew_masters = null;
  try {
    const { rows: crew } = await db.query(
      `SELECT COUNT(DISTINCT employee_id)::int AS n
       FROM employee_assignments WHERE work_id = $1`,
      [id]
    );
    crew_exec = crew[0]?.n || null;
  } catch (_) {}

  let equipment_text = null;
  try {
    const { rows: eq } = await db.query(
      `SELECT COALESCE(e.name, e.inventory_number, 'оборудование') AS name
       FROM equipment_work_assignments ewa
       JOIN equipment e ON e.id = ewa.equipment_id
       WHERE ewa.work_id = $1
       LIMIT 20`,
      [id]
    );
    if (eq.length) equipment_text = eq.map((x) => x.name).join(', ');
  } catch (_) {
    try {
      const { rows: eq2 } = await db.query(
        `SELECT COALESCE(name, inventory_number) AS name FROM equipment WHERE work_id = $1 LIMIT 20`,
        [id]
      );
      if (eq2.length) equipment_text = eq2.map((x) => x.name).join(', ');
    } catch (__) {}
  }

  return {
    source_work_id: w.id,
    source_tender_id: w.tender_id || null,
    customer_name: w.customer_name || null,
    object_name: w.object_name || w.work_title || null,
    period_text: start && end
      ? `${String(start).slice(0, 10)} — ${String(end).slice(0, 10)}`
      : null,
    calendar_days,
    crew_exec: crew_exec || w.crew_size || null,
    crew_masters,
    equipment_text,
    work_status: w.work_status,
    note: 'Число трубок/Ø/fouling в карточке работы нет — укажите вручную или в рассказе'
  };
}

async function searchClosedWorks(db, q, limit = 20) {
  const lim = Math.min(50, Math.max(1, limit));
  const like = `%${String(q || '').trim()}%`;
  const { rows } = await db.query(
    `SELECT id, work_title, customer_name, object_name, work_status,
            start_fact, end_fact, crew_size
     FROM works
     WHERE deleted_at IS NULL
       AND (
         work_status ILIKE '%Закрыт%' OR work_status ILIKE '%сдали%'
         OR end_fact IS NOT NULL
       )
       AND (
         $1 = '%%' OR work_title ILIKE $1 OR customer_name ILIKE $1
         OR object_name ILIKE $1 OR CAST(id AS TEXT) = REPLACE($1, '%', '')
       )
     ORDER BY end_fact DESC NULLS LAST, id DESC
     LIMIT $2`,
    [like, lim]
  );
  return rows;
}

/**
 * Эвристика из русского рассказа — fallback, если LLM вернул пусто.
 * Не выдумывает: только явные числа/маркеры в тексте.
 */
function heuristicExtractFromStory(story) {
  const t = String(story || '');
  const low = t.toLowerCase();
  const out = {};
  const uncertain = [];

  if (/аво|воздушн\w*\s+охлажд/i.test(t)) out.category_code = 'avo';
  else if (/пластинчат/i.test(t)) out.category_code = 'plates';
  else if (/котл/i.test(t)) out.category_code = 'boilers';
  else if (/градир/i.test(t)) out.category_code = 'towers_hvac';
  else if (/трубопровод|аспо|протравк/i.test(t)) out.category_code = 'pipelines';
  else if (/ёмкост|резервуар|рвс/i.test(t)) out.category_code = 'vessels';
  else if (/теплообмен|трубн\w*\s+пуч|кожухотруб|\bто\b/i.test(t)) out.category_code = 'tubes';

  let m;
  if ((m = t.match(/(\d+[.,]?\d*)\s*секц/i))) {
    out.qty = Number(String(m[1]).replace(',', '.'));
    out.volume_unit = out.volume_unit || 'секции';
    out.category_code = out.category_code || 'avo';
  }
  if ((m = t.match(/(\d+[.,]?\d*)\s*(?:теплообменник|аппарат|то)\w*/i))) {
    out.qty = Number(String(m[1]).replace(',', '.'));
  }
  if ((m = t.match(/по\s+(\d+[.,]?\d*)\s*труб/i)) || (m = t.match(/(\d+[.,]?\d*)\s*труб/i))) {
    out.volume_value = Number(String(m[1]).replace(',', '.'));
    out.volume_unit = 'трубки';
    out.category_code = out.category_code || 'tubes';
  }
  if ((m = t.match(/[Øø⌀]\s*(\d+[.,]?\d*)/i)) || (m = t.match(/диаметр[а-яёa-z]*\s*(\d+[.,]?\d*)\s*мм/iu))) {
    out.diameter_mm = Number(String(m[1]).replace(',', '.'));
  }
  if ((m = t.match(/(\d+[.,]?\d*)\s*м\s*(?:длин|×|x)/i))) {
    out.length_m = Number(String(m[1]).replace(',', '.'));
  }

  if (/бетон|кокс|цемент|тяжёл/i.test(t)) {
    out.fouling = 'heavy';
    if (/бетон/i.test(t)) out.fouling_note = 'бетон';
    else if (/кокс/i.test(t)) out.fouling_note = 'кокс';
  } else if (/лёгк|легк/i.test(t)) out.fouling = 'light';
  else if (/средн/i.test(t)) out.fouling = 'medium';

  if ((m = t.match(/(\d+[.,]?\d*)\s*месяц/i))) {
    out.calendar_days = Math.round(Number(String(m[1]).replace(',', '.')) * 30);
  } else if ((m = t.match(/(\d+[.,]?\d*)\s*(?:календарн\w*\s+)?(?:сут|дн)/i))) {
    out.calendar_days = Number(String(m[1]).replace(',', '.'));
  } else if ((m = t.match(/около\s+(\d+[.,]?\d*)\s*месяц/i))) {
    out.calendar_days = Math.round(Number(String(m[1]).replace(',', '.')) * 30);
  }

  if (/одну?\s+смен|в\s+одну\s+смен/i.test(t)) out.shift_mode = 1;
  else if (/две\s+смен|2\s*смен|в\s+две\s+смен/i.test(t)) out.shift_mode = 2;

  if ((m = t.match(/(\d+)\s*мастер/i))) out.crew_masters = Number(m[1]);
  if ((m = t.match(/(\d+)\s*слесар/i))) out.crew_exec = Number(m[1]);
  else if ((m = t.match(/(\d+)\s*(?:исполнител|человек|чел\b)/i))) {
    out.crew_exec = Number(m[1]);
    uncertain.push('crew_exec');
  }

  const eq = [];
  if (/вулкан/i.test(t)) eq.push('Вулкан');
  if (/hammelmann|хаммельман/i.test(t)) eq.push('Hammelmann');
  if (/\bавд\b|высокого\s+давлен/i.test(t)) eq.push('АВД');
  if (eq.length) out.equipment_text = eq.join(', ');

  if (/апатит/i.test(t)) out.customer_name = 'Апатит';
  if (/череповец/i.test(t)) out.object_name = 'Череповец';

  if (/гдо|гидродинами/i.test(t)) out.method_code = 'gdo';
  else if (/гмо|гидромех/i.test(t)) out.method_code = 'gmo';
  else if (/хим/i.test(t) && out.category_code === 'tubes') out.method_code = 'chem';
  else if (/наружн/i.test(t) && out.category_code === 'avo') out.method_code = 'outer';

  out.uncertain_fields = uncertain;
  return out;
}

function mergeProposal(ai, heuristic, defaults) {
  const keys = [
    'category_code', 'method_code', 'object_label', 'qty', 'volume_value', 'volume_unit',
    'diameter_mm', 'length_m', 'fouling', 'fouling_note', 'calendar_days', 'shift_mode',
    'crew_masters', 'crew_exec', 'equipment_text', 'customer_name', 'object_name', 'period_text'
  ];
  const out = { ...defaults };
  for (const k of keys) {
    const aiVal = ai[k];
    const hVal = heuristic[k];
    if (aiVal != null && aiVal !== '') out[k] = aiVal;
    else if (hVal != null && hVal !== '') out[k] = hVal;
  }
  if (!out.shift_mode) out.shift_mode = 2;
  return out;
}

/**
 * AI propose: парсит рассказ в карточку; derived_* считает сервер.
 */
async function proposeFromStory(db, { story_text, category_code, source_work_id }, user) {
  const story = String(story_text || '').trim();
  if (story.length < 20) {
    const err = new Error('Расскажите подробнее (минимум ~20 символов)');
    err.statusCode = 400;
    throw err;
  }

  let workHint = null;
  if (source_work_id) {
    workHint = await getWorkHint(db, source_work_id);
  }

  const { rows: cats } = await db.query(
    `SELECT code, title, methods_json FROM work_norm_categories WHERE is_active ORDER BY sort_order`
  );
  const catList = cats.map((c) => `${c.code} — ${c.title}`).join('\n');

  const system = `Ты помощник РП компании Асгард (промочистка теплообменников, АВО, котлов).
Задача: из рассказа РП извлечь ТОЛЬКО факты в JSON. Без markdown, без пояснений до/после JSON.

Схема ответа:
{
  "category_code": "код из списка или null",
  "method_code": "код метода или null",
  "object_label": "кратко что чистили или null",
  "qty": число|null,
  "volume_value": число|null,
  "volume_unit": "трубки|секции|м2|м3|м|шт"|null,
  "diameter_mm": число|null,
  "length_m": число|null,
  "fouling": "light"|"medium"|"heavy"|null,
  "fouling_note": "строка"|null,
  "calendar_days": число|null,
  "shift_mode": 1|2,
  "crew_masters": число|null,
  "crew_exec": число|null,
  "equipment_text": "строка"|null,
  "customer_name": "строка"|null,
  "object_name": "строка"|null,
  "period_text": "строка"|null,
  "uncertain_fields": [],
  "questions": []
}

Правила:
- Цифры бери из текста. «2 месяца» → calendar_days≈60. «по 1700 трубок» → volume_value=1700, volume_unit=трубки, qty=число аппаратов.
- «бетонные/кокс» → fouling=heavy + fouling_note.
- «Ø32 / диаметром 32» → diameter_mm=32.
- теплообменники/ТО/пучки → category_code=tubes; секции АВО → avo.
- НЕ выдумывай то, чего нет. Если неясно — null и вопрос в questions.
Категории:
${catList}`;

  const userMsg = [
    workHint ? `Подсказка из CRM работы #${workHint.source_work_id}: ${JSON.stringify(workHint)}` : '',
    category_code ? `РП указал направление: ${category_code}` : '',
    'Рассказ РП:',
    story,
    'Верни только JSON-объект.'
  ].filter(Boolean).join('\n\n');

  let parsed = {};
  let aiRaw = null;
  let aiError = null;
  try {
    const aiProvider = require('./ai-provider');
    const result = await aiProvider.complete({
      system,
      messages: [{ role: 'user', content: userMsg }],
      maxTokens: 2000,
      temperature: 0
    });
    aiRaw = String(result?.text || '').trim();
    const m = aiRaw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch (pe) {
        // trailing commas / smart quotes
        const cleaned = m[0]
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/[“”]/g, '"')
          .replace(/[‘’]/g, "'");
        parsed = JSON.parse(cleaned);
      }
    }
  } catch (e) {
    aiError = e.message;
  }

  const heuristic = heuristicExtractFromStory(story);
  const aiMapped = {
    category_code: parsed.category_code || null,
    method_code: parsed.method_code || null,
    object_label: parsed.object_label || null,
    qty: parsed.qty != null ? Number(parsed.qty) : null,
    volume_value: parsed.volume_value != null ? Number(parsed.volume_value) : null,
    volume_unit: parsed.volume_unit || null,
    diameter_mm: parsed.diameter_mm != null ? Number(parsed.diameter_mm) : null,
    length_m: parsed.length_m != null ? Number(parsed.length_m) : null,
    fouling: ['light', 'medium', 'heavy'].includes(parsed.fouling) ? parsed.fouling : null,
    fouling_note: parsed.fouling_note || null,
    calendar_days: parsed.calendar_days != null ? Number(parsed.calendar_days) : null,
    shift_mode: parsed.shift_mode === 1 ? 1 : (parsed.shift_mode === 2 ? 2 : null),
    crew_masters: parsed.crew_masters != null ? Number(parsed.crew_masters) : null,
    crew_exec: parsed.crew_exec != null ? Number(parsed.crew_exec) : null,
    equipment_text: parsed.equipment_text || null,
    customer_name: parsed.customer_name || null,
    object_name: parsed.object_name || null,
    period_text: parsed.period_text || null
  };

  const proposal = mergeProposal(aiMapped, heuristic, {
    category_code: category_code || null,
    calendar_days: workHint?.calendar_days || null,
    crew_exec: workHint?.crew_exec || null,
    equipment_text: workHint?.equipment_text || null,
    customer_name: workHint?.customer_name || null,
    object_name: workHint?.object_name || null,
    period_text: workHint?.period_text || null,
    source_work_id: workHint?.source_work_id || source_work_id || null,
    source_tender_id: workHint?.source_tender_id || null,
    story_text: story,
    shift_mode: 2
  });

  // Нормализация volume_unit
  if (proposal.volume_unit) {
    const u = String(proposal.volume_unit).toLowerCase();
    if (/труб/.test(u)) proposal.volume_unit = 'трубки';
    else if (/секц/.test(u)) proposal.volume_unit = 'секции';
  }

  const globals = (await loadGlobals(db)).map;
  const catRow = await loadCategory(db, proposal.category_code);
  const derived = deriveFromExperience(proposal, globals, catRow);
  const aiQuestions = Array.isArray(parsed.questions) ? parsed.questions.filter(Boolean) : [];
  const uncertain = [
    ...(Array.isArray(parsed.uncertain_fields) ? parsed.uncertain_fields : []),
    ...(heuristic.uncertain_fields || [])
  ];

  // Если LLM совсем пустой, но эвристика вытащила факты — не пугать «не разобрано»
  const filled = ['category_code', 'qty', 'volume_value', 'calendar_days', 'crew_exec']
    .filter((k) => proposal[k] != null).length;

  if (aiError && filled < 2) {
    return {
      ok: false,
      needs_clarification: true,
      questions: ['Не удалось разобрать рассказ. Заполните форму вручную или упростите текст.', aiError],
      proposal: null,
      ai_raw: aiRaw ? aiRaw.slice(0, 500) : null
    };
  }

  return {
    ok: true,
    proposal: {
      ...proposal,
      derived_metric: derived.derived_metric,
      derived_value: derived.derived_value,
      derived_unit: derived.derived_unit,
      derived_trace: derived.derived_trace
    },
    derived,
    needs_clarification: derived.needs_clarification || aiQuestions.length > 0 || uncertain.length > 0,
    questions: [...aiQuestions, ...derived.questions],
    clarifications: derived.clarifications,
    uncertain_fields: [...new Set(uncertain)],
    work_hint: workHint,
    proposed_by: user?.id || null,
    extract_source: {
      ai_filled: Object.values(aiMapped).filter((v) => v != null && v !== '').length,
      heuristic_filled: Object.keys(heuristic).filter((k) => k !== 'uncertain_fields' && heuristic[k] != null).length
    }
  };
}

function extractNormHintsFromText(text) {
  const t = String(text || '');
  const inputs = {};
  const mTubes = t.match(/(\d{2,5})\s*(?:труб|трубок)/i);
  if (mTubes) inputs.tubes = Number(mTubes[1]);
  const mM2 = t.match(/(\d+(?:[.,]\d+)?)\s*(?:м²|м2|кв\.?\s*м)/i);
  if (mM2) inputs.surface_m2 = Number(String(mM2[1]).replace(',', '.'));
  const mLen = t.match(/(\d+(?:[.,]\d+)?)\s*(?:м\.?\s*п\.?|метр(?:ов|а)?\s*(?:труб|контура)?)/i);
  if (mLen) inputs.length_m = Number(String(mLen[1]).replace(',', '.'));
  const mDia = t.match(/(?:[øoØ]|диам(?:етр)?)\s*(\d{2,4})/i) || t.match(/\bду\s*(\d{2,4})/i);
  if (mDia) {
    inputs.diameter_mm = Number(mDia[1]);
    inputs.dn_mm = Number(mDia[1]);
  }
  const mVol = t.match(/(\d+(?:[.,]\d+)?)\s*(?:м³|m3)/i);
  if (mVol) inputs.volume_m3 = Number(String(mVol[1]).replace(',', '.'));
  const mCircuit = t.match(/контур[^\d]{0,20}(\d+(?:[.,]\d+)?)\s*(?:м³|m3)/i);
  if (mCircuit) inputs.circuit_m3 = Number(String(mCircuit[1]).replace(',', '.'));
  const mQty = t.match(/(\d+)\s*(?:апп(?:арат|\.|)|кот(?:ёл|ел|\.|)|шт\.?)/i);
  if (mQty) inputs.qty = Number(mQty[1]);
  if (/опрессов|гидроиспыт/i.test(t)) inputs._hint_hydrotest = true;
  if (/протрав/i.test(t)) inputs._hint_pickle = true;
  if (/сверл/i.test(t)) inputs._hint_drill = true;
  return inputs;
}

function resolveNormCategoryMethod(workType, text) {
  const t = String(text || '').toLowerCase();
  const wt = workType ? String(workType).toUpperCase() : null;
  if (wt === 'MOUNT' || /монтаж|демонтаж|такелаж/i.test(t)) {
    if (/демонтаж/i.test(t)) return { category_code: 'mount', method_code: 'dismount' };
    if (/такелаж|кран|стрел/i.test(t)) return { category_code: 'mount', method_code: 'rigging' };
    if (/фланец|проклад/i.test(t)) return { category_code: 'mount', method_code: 'flange' };
    return { category_code: 'mount', method_code: 'mount' };
  }
  if (wt === 'INSULATION' || /изоляц|утепл/i.test(t)) {
    return { category_code: 'insulation', method_code: 'insul' };
  }
  if (/огнев|наряд.?допуск|сварк/i.test(t) && /резк|рез\s/i.test(t)) {
    return { category_code: 'repair_weld', method_code: 'cutting' };
  }
  if (/огнев|наряд.?допуск/i.test(t)) {
    return { category_code: 'repair_weld', method_code: 'fire_works' };
  }
  if (/сварк|стык/i.test(t)) {
    return { category_code: 'repair_weld', method_code: 'weld' };
  }
  if (inputsHintPickle(t)) return { category_code: 'pipelines', method_code: 'pickle' };
  if (/опрессов|гидроиспыт/i.test(t)) return { category_code: 'pipelines', method_code: 'hydrotest' };
  if (wt === 'HYDRO_DYN' || /\bгдо\b|гидродинам/i.test(t)) {
    if (/сверл/i.test(t)) return { category_code: 'tubes', method_code: 'gdo', rate_code: 'tubes_drill_pcs_shift' };
    return { category_code: 'tubes', method_code: 'gdo' };
  }
  if (wt === 'HYDRO_MECH' || /\bгмо\b|гидромех/i.test(t)) {
    return { category_code: 'tubes', method_code: 'gmo' };
  }
  if (wt === 'CHEM' || /хим(?:ич)?|cip|промыв/i.test(t)) {
    if (/кот/i.test(t)) return { category_code: 'boilers', method_code: 'chem' };
    if (/трубоп/i.test(t)) return { category_code: 'pipelines', method_code: 'chem_ops' };
    return { category_code: 'chem_circuits', method_code: 'cip' };
  }
  if (wt === 'HVAC' || /вентил|воздуховод|градир/i.test(t)) {
    if (/градир/i.test(t)) return { category_code: 'towers_hvac', method_code: 'tower' };
    return { category_code: 'vent_sewer', method_code: 'vent' };
  }
  if (/кот(?:ёл|ел)/i.test(t)) return { category_code: 'boilers', method_code: 'mech' };
  if (/трубоп/i.test(t)) return { category_code: 'pipelines', method_code: 'hydro' };
  if (/ёмкост|резервуар|рвс/i.test(t)) return { category_code: 'vessels', method_code: 'clean' };
  if (/пластин|теплообмен/i.test(t)) return { category_code: 'plates', method_code: 'hydro_dis' };
  if (/аво|аппарат/i.test(t)) return { category_code: 'avo', method_code: 'outer' };
  return null;
}

function inputsHintPickle(t) {
  return /протрав/i.test(t);
}

/**
 * Math preview для Mimir до LLM: из work_type/TZ или явных norm_inputs.
 */
async function tryNormPreviewForEstimate(db, ctx) {
  const meta = { skipped: false, reason: null, error: null };
  const explicit = ctx?.norm_inputs && typeof ctx.norm_inputs === 'object' ? ctx.norm_inputs : null;
  let category_code = explicit?.category_code || null;
  let method_code = explicit?.method_code || null;
  let rate_code = explicit?.rate_code || null;
  let inputs = explicit?.inputs && typeof explicit.inputs === 'object' ? { ...explicit.inputs } : {};

  const textParts = [
    ctx?.work?.work_title,
    ctx?.work?.work_description,
    ctx?.tender?.tender_title,
    ctx?.tender?.tender_description,
    ...(ctx?.documents || []).map((d) => d.content || d.original_name || '')
  ].filter(Boolean);
  const blob = textParts.join('\n');

  if (!category_code) {
    const resolved = resolveNormCategoryMethod(ctx?.workType || ctx?.work_type, blob);
    if (resolved) {
      category_code = resolved.category_code;
      method_code = method_code || resolved.method_code;
      rate_code = rate_code || resolved.rate_code || null;
    }
  }

  if (!category_code) {
    meta.skipped = true;
    meta.reason = 'category/method not inferred';
    return { preview: null, inputs: null, meta };
  }

  const hinted = extractNormHintsFromText(blob);
  inputs = { ...hinted, ...inputs };
  delete inputs._hint_hydrotest;
  delete inputs._hint_pickle;
  delete inputs._hint_drill;

  if (method_code === 'fire_works' && !(Number(inputs.points) > 0) && Number(inputs.joints) > 0) {
    inputs.points = Number(inputs.joints);
  }

  try {
    const preview = await previewCalc(db, {
      category_code,
      method_code,
      rate_code,
      inputs,
      fouling: explicit?.fouling || 'medium',
      coeffs: explicit?.coeffs,
      posts: explicit?.posts
    });
    if (preview.error && !preview.ok) {
      // Две разные ситуации:
      //   1) нормы нет → фолбэк, Мимир оценивает сам и честно это говорит;
      //   2) не хватает объёма/диаметра → это вопрос к человеку (этап clarify),
      //      подменять его выдуманным сроком нельзя.
      meta.error = preview.error;
      if (!isMissingNormError(preview.error)) {
        meta.needsInput = true;
        return {
          preview: { ok: false, error: preview.error, needs_input: true, trace: preview.trace || [] },
          inputs: { category_code, method_code, rate_code, ...inputs },
          meta
        };
      }
      meta.fallback = true;
      const fb = buildFallbackPreview({
        category_code,
        method_code,
        inputs,
        workDays: inputs.work_days || inputs.workDays,
        crew: explicit?.crew,
        reason: preview.error
      });
      return {
        preview: preview.rate ? { ...fb, rate: preview.rate } : fb,
        inputs: { category_code, method_code, rate_code, ...inputs },
        meta
      };
    }
    return { preview, inputs: { category_code, method_code, rate_code, ...inputs }, meta };
  } catch (e) {
    meta.error = e.message;
    if (!isMissingNormError(e.message)) {
      meta.needsInput = true;
      return {
        preview: { ok: false, error: e.message, needs_input: true, trace: [] },
        inputs: { category_code, method_code, rate_code, ...inputs },
        meta
      };
    }
    meta.fallback = true;
    return {
      preview: buildFallbackPreview({
        category_code,
        method_code,
        inputs,
        workDays: inputs.work_days || inputs.workDays,
        crew: explicit?.crew,
        reason: e.message
      }),
      inputs: { category_code, method_code, rate_code, ...inputs },
      meta
    };
  }
}

function normPreviewToMarkdown(preview, meta) {
  if (!preview || preview.error) {
    const err = preview?.error || meta?.error || meta?.reason;
    if (!err) return '';
    if (preview && preview.needs_input) {
      // Это не «нормы нет», а «дай объём». Мимир обязан спросить, а не выдумывать.
      return [
        '',
        '═══ NORM PREVIEW (CRM math, без LLM) ═══',
        `⛔ СЧИТАТЬ НЕЛЬЗЯ: ${err}`,
        'Не выдумывай объём и не подставляй типовой. Задай вопрос в questions_for_customer',
        'или верни decision_recommend=need_info с отсутствующим параметром.'
      ].join('\n');
    }
    return `\n═══ NORM PREVIEW (CRM math) ═══\n⚠️ ${err}\n`;
  }
  const r = preview.results || {};
  const c = preview.crew || {};
  if (preview.fallback) {
    // Честно: нормы нет, это оценка модели, а не справочник.
    return [
      '',
      '═══ NORM PREVIEW (CRM math, без LLM) ═══',
      `⚠️ НОРМЫ В СПРАВОЧНИКЕ НЕТ (${preview.category_code || '—'} / ${preview.method_code || '—'})`,
      `Причина: ${meta?.error || 'нет подходящей нормы'}`,
      'Верни свою оценку сроков и бригады, но ОБЯЗАТЕЛЬНО отметь в analysis.warnings,',
      'что расчёт выполнен НЕ по справочнику, и укажи основание (аналог, практика, документ).',
      'После сохранения просчёта норма будет создана в справочнике автоматически.',
      'Trace:',
      ...(Array.isArray(preview.trace) ? preview.trace.slice(0, 8).map((x) => `- ${x}`) : [])
    ].join('\n');
  }
  const lines = [
    '',
    '═══ NORM PREVIEW (CRM math, без LLM) ═══',
    `Категория: ${preview.category_code} / ${preview.method_code || '—'}`,
    `Норма: ${preview.rate?.code || '—'} — ${preview.rate?.name || ''}`,
    `work_days: ${r.work_days ?? '—'}; person_shifts: ${r.person_shifts ?? '—'}; man_hours: ${r.man_hours ?? '—'}`,
    `Бригада: ${c.master ?? 0}м+${c.exec ?? 0}сл` +
      (c.observers ? `+${c.observers}набл` : '') +
      `; смен/сут ${c.shifts_per_day ?? '—'}`,
    'Trace:',
    ...(Array.isArray(preview.trace) ? preview.trace.slice(0, 12).map((x) => `- ${x}`) : []),
    'Используй как якорь для work_days/crew; при конфликте с MODULE — CRM preview выше.'
  ];
  return lines.join('\n');
}

function buildNormTrace(ctx, preview, ai) {
  if (!preview || preview.error) {
    // Просчёт без нормы — тоже валидный случай: фиксируем, что считали не по
    // справочнику, чтобы UI мог показать честную пометку (требование 05.11.2026).
    return {
      rate_code: null,
      rate_id: null,
      fallback: true,
      reason: preview?.error || null,
      work_days: Number((ai && ai.estimate && ai.estimate.work_days))
        || null,
      crew: null,
      category: ctx?.norm_inputs?.category_code || null,
      method: ctx?.norm_inputs?.method_code || null,
      inputs: ctx?.norm_inputs || null,
      preview: null
    };
  }
  const est = (ai && ai.estimate) || {};
  const p = (ctx && ctx.estimate && ctx.estimate.params) || {};
  const workers =
    Number(est.workers_per_shift) ||
    Number(p.workers_per_shift) ||
    Number(p.workers) ||
    null;
  const masters =
    Number(est.masters_per_shift) ||
    Number(p.masters_per_shift) ||
    Number(p.masters) ||
    null;
  return {
    rate_code: preview.rate?.code || null,
    rate_id: preview.rate?.id || null,
    work_days: Number(est.work_days) || preview.results?.work_days || null,
    crew: {
      master: preview.crew?.master,
      exec: preview.crew?.exec,
      observers: preview.crew?.observers,
      workers_per_shift: workers,
      masters_per_shift: masters
    },
    category: preview.category_code,
    method: preview.method_code,
    inputs: ctx?.norm_inputs_used || ctx?.norm_inputs || null,
    preview: {
      work_days: preview.results?.work_days,
      person_shifts: preview.results?.person_shifts,
      trace: preview.trace
    }
  };
}

function resolveVolumeFromInputs(inputs) {
  const i = inputs || {};
  return Number(
    i.tubes ?? i.joints ?? i.plates_count ?? i.surface_m2 ?? i.length_m ??
    i.circuit_m3 ?? i.volume_m3 ?? i.qty ?? i.points ?? i.lifts ?? 0
  );
}

function deriveImpliedRateValues(rateRow, inputs, workDays, crewOverride, globalsMap) {
  const shiftHours = Number(globalsMap?.shift_hours) || 12;
  const shiftsPerDay = Number(globalsMap?.shifts_per_day) || 2;
  const posts = 1;
  const crew = rateRow.crew_json || {};
  const master = Number(crewOverride?.master ?? crewOverride?.masters_per_shift ?? crew.master) || 1;
  const exec = Number(crewOverride?.exec ?? crewOverride?.workers_per_shift ?? crew.exec) || 3;
  const observers = Number(
    crewOverride?.observers != null
      ? crewOverride.observers
      : (crew.observer_rule === '1:1' ? 1 : 0)
  ) || 0;
  const peoplePerShift = master + exec + observers;
  const peoplePerDay = peoplePerShift * shiftsPerDay * posts;
  const volume = resolveVolumeFromInputs(inputs);
  const wd = Number(workDays);
  if (!(wd > 0) || !(volume > 0)) {
    const err = new Error('Нужны work_days > 0 и объём из trace/inputs');
    err.statusCode = 400;
    throw err;
  }

  const kind = rateRow.calc_kind;
  const values = {};

  if (kind === 'per_unit_shift') {
    const execPerDay = exec * shiftsPerDay * posts;
    const execShifts = wd * execPerDay;
    const implied = volume / Math.max(0.001, execShifts);
    values.rate_default = Math.round(implied * 100) / 100;
    values.rate_medium = values.rate_default;
  } else if (kind === 'mh_per_unit') {
    const baseMh = wd * peoplePerDay * shiftHours;
    const mhPer = baseMh / volume;
    values.rate_default = Math.round(mhPer * 1000) / 1000;
    values.rate_medium = values.rate_default;
  } else if (kind === 'hours_per_cycle') {
    const cycles = Number(inputs?.cycles) > 0 ? Number(inputs.cycles) : 1;
    const hours = wd * shiftHours * shiftsPerDay * posts;
    values.rate_default = Math.round((hours / cycles) * 10) / 10;
    values.rate_medium = values.rate_default;
  } else if (kind === 'days_per_unit') {
    const units = Number(inputs?.qty ?? inputs?.sections ?? inputs?.apparatus ?? 1) || 1;
    values.rate_default = Math.round((wd / units) * 100) / 100;
    values.rate_medium = values.rate_default;
  } else {
    const err = new Error(`calc_kind ${kind} не поддержан для обратного расчёта из сметы`);
    err.statusCode = 400;
    throw err;
  }

  return {
    values,
    crewPatch: { master, exec }
  };
}

/**
 * Определяет calc_kind для новой нормы, когда её ещё нет в справочнике.
 * Выбираем по единице объёма — то, что калькулятор точно посчитает.
 */
function inferCalcKindForNewRate(categoryCode, methodCode, inputs) {
  const i = inputs || {};
  if (Number(i.cycles) > 0) return { calc_kind: 'hours_per_cycle', unit: 'ч/цикл' };
  if (Number(i.tubes) > 0) return { calc_kind: 'per_unit_shift', unit: 'труб/смену' };
  if (Number(i.joints) > 0) return { calc_kind: 'per_unit_shift', unit: 'стык/смену' };
  if (Number(i.surface_m2) > 0) return { calc_kind: 'per_unit_shift', unit: 'м²/смену' };
  if (Number(i.length_m) > 0) return { calc_kind: 'per_unit_shift', unit: 'м/смену' };
  if (Number(i.volume_m3) > 0) return { calc_kind: 'per_unit_shift', unit: 'м³/смену' };
  if (Number(i.circuit_m3) > 0) return { calc_kind: 'per_unit_shift', unit: 'м³/смену' };
  if (Number(i.qty) > 0 || Number(i.apparatus) > 0) return { calc_kind: 'days_per_unit', unit: 'сут/шт' };
  if (categoryCode === 'insulation') return { calc_kind: 'per_unit_shift', unit: 'м²/смену' };
  return { calc_kind: 'fixed_days', unit: 'сут' };
}

/**
 * Создаёт/обновляет норму в справочнике из успешного просчёта Мимира.
 *
 * Требование: «после успешного просчёта в справочнике должна появиться норма».
 * Защита от мусора:
 *   • только при work_days > 0;
 *   • детерминированный code `auto_<category>_<method>` — повторный просчёт
 *     обновляет ту же норму, а не плодит копии;
 *   • basis = 'mimir_smeta', notes с источником и датой;
 *   • change_log через applyNormPatch (комментарий обязателен).
 */
async function createRateFromEstimate(db, body, user) {
  const categoryCode = String(body?.category_code || '').trim();
  const methodCode = String(body?.method_code || '').trim() || null;
  const inputs = body?.inputs && typeof body.inputs === 'object' ? body.inputs : {};
  const workDays = Number(body?.work_days);
  if (!categoryCode) {
    const err = new Error('createRateFromEstimate: нужен category_code');
    err.statusCode = 400;
    throw err;
  }
  if (!(workDays > 0)) {
    const err = new Error('createRateFromEstimate: нужен work_days > 0');
    err.statusCode = 400;
    throw err;
  }

  const cat = await loadCategory(db, categoryCode);
  if (!cat) {
    const err = new Error(`createRateFromEstimate: неизвестная категория ${categoryCode}`);
    err.statusCode = 400;
    throw err;
  }
  let primaryCode = null;
  if (methodCode) {
    const methods = Array.isArray(cat.methods_json) ? cat.methods_json : [];
    const meta = methods.find((m) => m.code === methodCode) || null;
    if (methods.length && !meta) {
      const err = new Error(`createRateFromEstimate: метода ${methodCode} нет в категории ${categoryCode}`);
      err.statusCode = 400;
      throw err;
    }
    primaryCode = meta && meta.primary_rate_code ? meta.primary_rate_code : null;
  }

  // Норму ищем по primary_rate_code метода: именно её берёт previewCalc.
  // Иначе автосоздание обновит соседний код (например weld_m_shift),
  // а расчёт продолжит смотреть на weld_joint_shift и ничего не изменится.
  let existing = null;
  if (primaryCode) {
    existing = (await db.query(
      `SELECT * FROM work_norm_rates WHERE code = $1 AND is_active LIMIT 1`,
      [primaryCode]
    )).rows[0] || null;
  }
  if (!existing) {
    existing = (await db.query(
      `SELECT * FROM work_norm_rates
        WHERE category_code = $1 AND ($2::text IS NULL OR method_code = $2) AND is_active
        ORDER BY (method_code = $2) DESC, id LIMIT 1`,
      [categoryCode, methodCode]
    )).rows[0] || null;
  }

  const kindInfo = existing
    ? { calc_kind: existing.calc_kind, unit: existing.unit }
    : inferCalcKindForNewRate(categoryCode, methodCode, inputs);

  const implied = deriveImpliedRateValues(
    { calc_kind: kindInfo.calc_kind, crew_json: body.crew || null, code: existing ? existing.code : null },
    inputs,
    workDays,
    body.crew || {},
    (await loadGlobals(db)).map
  );

  const comment = String(body.comment || '').trim().length >= 5
    ? String(body.comment).trim()
    : `Просчёт Мимира ${new Date().toISOString().slice(0, 10)}: ${workDays} сут`;

  if (existing) {
    const patch = await applyNormPatch(db, {
      rateId: existing.id,
      categoryCode,
      mode: 'average',
      source: 'mimir_smeta',
      force: isProtectedResearchBasis(existing.basis),
      comment,
      values: implied.values,
      crewPatch: implied.crewPatch,
      user
    });
    return { ok: true, created: false, updated: true, rate: patch.after, before: patch.before };
  }

  const code = `auto_${categoryCode}_${methodCode || 'default'}`;
  const patch = await applyNormPatch(db, {
    code,
    categoryCode,
    methodCode,
    name: `Авто из просчёта Мимира · ${categoryCode}/${methodCode || '—'} · ${kindInfo.unit}`,
    unit: kindInfo.unit,
    calcKind: kindInfo.calc_kind,
    values: implied.values,
    crewPatch: implied.crewPatch,
    paramsPatch: { inputs_template: inputs },
    mode: 'replace',
    source: 'mimir_smeta',
    force: true,
    comment,
    user
  });
  return { ok: true, created: true, updated: false, rate: patch.after };
}

async function applyNormPatchFromSmetaEdit(db, body, user) {
  const comment = String(body?.comment || '').trim();
  if (comment.length < 5) {
    const err = new Error('Комментарий обязателен (минимум 5 символов)');
    err.statusCode = 400;
    throw err;
  }
  const rateRow = await resolveRateForPatch(db, {
    rateId: body.rate_id,
    code: body.rate_code,
    categoryCode: body.category_code
  });
  const globals = (await loadGlobals(db)).map;
  const inputs = body.inputs || body.volumes || {};
  const implied = deriveImpliedRateValues(
    rateRow,
    inputs,
    body.work_days,
    {
      workers_per_shift: body.workers_per_shift,
      masters_per_shift: body.masters_per_shift,
      master: body.masters_per_shift,
      exec: body.workers_per_shift
    },
    globals
  );
  const force = isProtectedResearchBasis(rateRow.basis);
  const beforeDefault = rateRow.rate_default;
  const patch = await applyNormPatch(db, {
    rateId: rateRow.id,
    categoryCode: rateRow.category_code,
    mode: body.mode || 'average',
    source: 'mimir_smeta',
    force,
    comment,
    values: implied.values,
    crewPatch: implied.crewPatch,
    user
  });
  const afterDefault = patch.after?.rate_default ?? implied.values.rate_default;
  const label = rateRow.name || rateRow.code;
  return {
    ok: true,
    message: `Норма «${label}» обновлена: ${beforeDefault ?? '—'} → ${afterDefault}`,
    patch
  };
}

module.exports = {
  resolveNormBasis,
  loadGlobals,
  loadCatalog,
  previewCalc,
  toPromptMarkdown,
  expectedInputField,
  loadConversionRule,
  loadLayerDefaults,
  filterCatalogByWorkType,
  tryNormPreviewForEstimate,
  normPreviewToMarkdown,
  buildNormTrace,
  isMissingNormError,
  applyNormPatchFromSmetaEdit,
  createRateFromEstimate,
  buildFallbackPreview,
  inferCalcKindForNewRate,
  globalsToCalcSettings,
  writeChangeLog,
  pickRate,
  calcKindLabel,
  CALC_KIND_LABELS,
  metricToCalcKind,
  applyNormPatch,
  revertLastRateChange,
  fitRateFromPoints,
  findRateForPublish,
  computeExperienceDelta,
  deriveFromExperience,
  listExperiences,
  getExperience,
  createExperience,
  batchCreateExperiences,
  parseExperiencesTsv,
  tryAutoExperienceOnWorkClose,
  isWorkClosedStatus,
  updateExperience,
  confirmExperience,
  publishExperience,
  getWorkHint,
  searchClosedWorks,
  proposeFromStory,
  heuristicExtractFromStory
};
