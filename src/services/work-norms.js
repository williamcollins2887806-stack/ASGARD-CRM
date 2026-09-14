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
    rates,
    coeffs,
    chemistry,
    equipment,
    experiences
  };
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
    if (!(Number(inputs.diameter_mm) > 0)) return 'Укажите Ø, мм';
    if (!(Number(inputs.length_m) > 0)) return 'Укажите длину трубки, м';
  }
  if (category === 'tubes' && method === 'gmo') {
    if (!(resolveTubes(inputs) > 0)) return 'Укажите число трубок';
    if (!(Number(inputs.diameter_mm) > 0)) return 'Укажите Ø, мм';
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
  // ITP/heating: circuit_m3 как volume для per_unit_shift
  if ((method === 'itp' || method === 'heating') && Number(inputs.circuit_m3) > 0) {
    // ok — per_unit_shift уже берёт circuit_m3
  }

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
    const execShiftsNeeded = volume / effRate;
    const execPerDay = exec * shiftsPerDay * posts;
    workDays = ceil(execShiftsNeeded / Math.max(1, execPerDay));
    personShifts = workDays * peoplePerShift * shiftsPerDay * posts;
    manHours = personShifts * shiftHours;
    trace.push(`${volume} / ${effRate.toFixed(2)} = ${execShiftsNeeded.toFixed(2)} исполн.·смен`);
    trace.push(`бригада ${master}м+${exec}сл` +
      (observers ? `+${observers}набл` : '') +
      `, смен/сут ${shiftsPerDay}, постов ${posts} → work_days=${workDays}`);

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
    const baseMh = adj.value;
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
      reagent_kg: reagentKg != null ? Math.round(reagentKg * 10) / 10 : null
    },
    trace
  };
}

function toPromptMarkdown(catalog, workTypeHint) {
  if (!catalog) return '(справочник норм CRM пуст)';
  const lines = [];
  lines.push('═══ СПРАВОЧНИК НОРМ CRM (приоритет над MODULE §3.5 при конфликте) ═══');
  lines.push('Globals: ' + Object.entries(catalog.globals || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(', '));
  lines.push('');
  const cats = catalog.categories || [];
  for (const cat of cats) {
    lines.push(`### ${cat.title} (${cat.code})`);
    const rates = (catalog.rates || []).filter((r) => r.category_code === cat.code);
    for (const r of rates) {
      const def = r.rate_default != null ? r.rate_default : '—';
      const crew = r.crew_json || {};
      let line =
        `- [${r.method_code || '—'}] ${r.name}: база=${def} ${r.unit}` +
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

  const facts = (catalog.experiences || []).filter((e) =>
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
  return rows[0] || null;
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

  const { rows } = await db.query(
    `INSERT INTO work_norm_experiences (
      category_code, method_code, object_label, qty, volume_value, volume_unit,
      diameter_mm, length_m, fouling, fouling_note,
      calendar_days, shift_mode, crew_masters, crew_exec, crew_other_json,
      equipment_text, source_work_id, source_tender_id, customer_name, object_name, period_text,
      story_text, derived_metric, derived_value, derived_unit, derived_trace,
      status, comment, created_by, extras_json
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,
      $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb
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
      JSON.stringify(extras)
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
  let calcKind = 'min_per_unit';
  let unit = exp.derived_unit || 'мин/труб';
  let code = `exp_${exp.category_code}_${exp.derived_metric}`;
  let name = exp.object_label || `Норма с объекта #${exp.id}`;

  const metric = exp.derived_metric;
  if (metric === 'days_per_section' || metric === 'days_per_unit') {
    calcKind = 'days_per_unit';
    unit = exp.derived_unit || 'сут/ед.';
  } else if (metric === 'm2_per_shift' || metric === 'm3_per_shift' || metric === 'm_per_shift' ||
             metric === 'tubes_per_shift' || metric === 'joints_per_shift') {
    calcKind = 'per_unit_shift';
    unit = exp.derived_unit || 'ед./смену';
  } else if (metric === 'hours_per_cycle') {
    calcKind = 'hours_per_cycle';
    unit = 'ч/цикл';
  } else if (metric === 'kg_per_m') {
    calcKind = 'kg_per_m';
    unit = 'кг/м';
  } else if (metric === 'mh_per_m3' || metric === 'mh_per_m2' || metric === 'mh_per_100_tubes') {
    calcKind = 'mh_per_unit';
    unit = exp.derived_unit || 'чел·ч';
  } else if (metric === 'min_per_tube') {
    calcKind = 'min_per_unit';
    unit = 'мин/труб';
  }

  const { rows: existing } = await db.query(
    `SELECT * FROM work_norm_rates
     WHERE category_code=$1 AND is_active
       AND (
         (method_code IS NOT DISTINCT FROM $2 AND calc_kind=$3)
         OR code=$4
       )
     ORDER BY id LIMIT 1`,
    [exp.category_code, exp.method_code || null, calcKind, code]
  );

  let rateRow = existing[0] || null;
  const val = Number(exp.derived_value);
  const beforeRate = rateRow ? { ...rateRow } : null;

  const setFoulingRates = (row) => {
    let loose = row.rate_loose != null ? Number(row.rate_loose) : null;
    let medium = row.rate_medium != null ? Number(row.rate_medium) : null;
    let hard = row.rate_hard != null ? Number(row.rate_hard) : null;
    let def = row.rate_default != null ? Number(row.rate_default) : null;
    const apply = (prev) => {
      if (publishMode === 'average' && prev != null) return Math.round(((prev + val) / 2) * 100) / 100;
      if (publishMode === 'note_only') return prev;
      return val;
    };
    if (fouling === 'light') loose = apply(loose);
    else if (fouling === 'heavy') hard = apply(hard);
    else medium = apply(medium);
    if (def == null || publishMode === 'replace') def = val;
    else if (publishMode === 'average') def = Math.round(((def + val) / 2) * 100) / 100;
    return { loose, medium, hard, def };
  };

  const noteBit =
    `опыт #${exp.id}` +
    (exp.customer_name ? ` · ${exp.customer_name}` : '') +
    (exp.diameter_mm != null ? ` · Ø${exp.diameter_mm}` : '') +
    (exp.fouling_note ? ` · ${exp.fouling_note}` : '');

  if (!rateRow) {
    const rates = setFoulingRates({
      rate_loose: null, rate_medium: null, rate_hard: null, rate_default: null
    });
    const params = {};
    if (exp.diameter_mm != null && calcKind === 'min_per_unit') {
      params.by_diameter = { [String(Math.round(Number(exp.diameter_mm)))]: val };
    }
    const crew = {
      master: exp.crew_masters || 1,
      exec: exp.crew_exec || 3,
      observer_rule: 'none'
    };
    const { rows } = await db.query(
      `INSERT INTO work_norm_rates (
        category_code, method_code, code, name, unit, calc_kind,
        rate_loose, rate_medium, rate_hard, rate_default,
        crew_json, params_json, basis, notes, sort_order, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,'field',$13,50,$14)
      RETURNING *`,
      [
        exp.category_code, exp.method_code || null, code, name, unit, calcKind,
        rates.loose, rates.medium, rates.hard, rates.def,
        JSON.stringify(crew), JSON.stringify(params),
        noteBit, user?.id || null
      ]
    );
    rateRow = rows[0];
  } else if (publishMode !== 'note_only') {
    const rates = setFoulingRates(rateRow);
    const params = { ...(rateRow.params_json || {}) };
    if (exp.diameter_mm != null && calcKind === 'min_per_unit') {
      const by = { ...(params.by_diameter || {}) };
      const key = String(Math.round(Number(exp.diameter_mm)));
      if (publishMode === 'average' && by[key] != null) {
        by[key] = Math.round(((Number(by[key]) + val) / 2) * 100) / 100;
      } else {
        by[key] = val;
      }
      params.by_diameter = by;
    }
    const notes = [rateRow.notes, noteBit].filter(Boolean).join('; ').slice(0, 2000);
    const { rows } = await db.query(
      `UPDATE work_norm_rates SET
         rate_loose=$2, rate_medium=$3, rate_hard=$4, rate_default=$5,
         params_json=$6::jsonb, notes=$7, basis='field',
         updated_at=NOW(), updated_by=$8
       WHERE id=$1 RETURNING *`,
      [rateRow.id, rates.loose, rates.medium, rates.hard, rates.def,
        JSON.stringify(params), notes, user?.id || null]
    );
    rateRow = rows[0];
  } else {
    const notes = [rateRow.notes, `справка ${noteBit}: ${val} ${unit}`].filter(Boolean).join('; ').slice(0, 2000);
    const { rows } = await db.query(
      `UPDATE work_norm_rates SET notes=$2, updated_at=NOW(), updated_by=$3 WHERE id=$1 RETURNING *`,
      [rateRow.id, notes, user?.id || null]
    );
    rateRow = rows[0];
  }

  const { rows: expRows } = await db.query(
    `UPDATE work_norm_experiences SET
       status='published', published_rate_id=$2, published_at=NOW(), updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [id, rateRow.id]
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

module.exports = {
  loadGlobals,
  loadCatalog,
  previewCalc,
  toPromptMarkdown,
  globalsToCalcSettings,
  writeChangeLog,
  pickRate,
  calcKindLabel,
  CALC_KIND_LABELS,
  deriveFromExperience,
  listExperiences,
  getExperience,
  createExperience,
  updateExperience,
  confirmExperience,
  publishExperience,
  getWorkHint,
  searchClosedWorks,
  proposeFromStory,
  heuristicExtractFromStory
};
