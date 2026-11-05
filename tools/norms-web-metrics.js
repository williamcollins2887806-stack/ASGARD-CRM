#!/usr/bin/env node
'use strict';
/**
 * norms-web-metrics.js — конвертация «метрик исследования» в корм для previewCalc.
 *
 * Зачем: findings/verified содержат человеческие метрики («5 ч на аппарат»,
 * «82 чел·ч на 10 стыков»), а `work_norm_rates` считает по `calc_kind`
 * и ждёт конкретные ключи во `inputs`. Без явной конверсии строка в справочник
 * не встаёт — именно на этом был провал прошлой попытки.
 *
 * Модуль даёт:
 *   specFor(metric)          → правило конверсии или null (needs_review);
 *   convert(row, opts)       → { ok, code, calc_kind, unit, value, inputs, crew, reason };
 *   productivityConstants()  → часы/смену, КИРВ, смен/сут.
 *
 * Правило честное: если метрика не ложится в схему метода без домыслов —
 * возвращаем null и причину. Такие строки идут агентам на R4, а не в импорт.
 */

const DEFAULT_SHIFT_HOURS = 12;
const DEFAULT_KIRV = 0.82;
const DEFAULT_SHIFTS_PER_DAY = 2;

function productivityConstants(overrides = {}) {
  const shiftHours = Number(overrides.shift_hours) || DEFAULT_SHIFT_HOURS;
  const kirv = Number(overrides.k_irv) || DEFAULT_KIRV;
  const shiftsPerDay = Number(overrides.shifts_per_day) || DEFAULT_SHIFTS_PER_DAY;
  return {
    shiftHours,
    kirv,
    shiftsPerDay,
    productiveHoursPerShift: shiftHours * kirv
  };
}

/**
 * Спецификация конверсии.
 *  target:   'existing' — обновляем существующий код справочника (он уже в промпте Мимира);
 *            'new'      — создаём новый код (для методов, где нормы нет).
 *  kind:     calc_kind целевой нормы.
 *  unit:     единица целевой нормы.
 *  from:     ожидаемая единица источника (для валидации).
 *  per:      сколько единиц в источнике (например 100 трубок).
 *  toRate:   (value, ctx) => значение нормы в единицах kind.
 *  inputs:   шаблон входов для previewCalc (нужны ключи из input_schema_json метода).
 */
const SPECS = {
  // ── Пластинчатые ТО ────────────────────────────────────────────────────────
  cip_duration_per_apparatus: {
    target: 'existing', code: 'plates_cip_hours', kind: 'hours_per_cycle',
    unit: 'ч/цикл', from: 'hour', category: 'plates', method: 'chem_cip',
    toRate: (v) => v,
    inputs: { circuit_m3: 2.3, cycles: 3 },
    note: 'часы CIP на аппарат = часы на цикл (CIP идёт циклами)'
  },
  disassembly_clean_duration: {
    target: 'existing', code: 'plates_days_per_app', kind: 'days_per_unit',
    unit: 'сут/апп.', from: 'day', category: 'plates', method: 'hydro_dis',
    toRate: (v) => v,
    inputs: { apparatus: 1, surface_m2: 120 },
    note: 'разборная очистка: сутки на аппарат'
  },
  plates_disassembly_days_funke: {
    target: 'existing', code: 'plates_days_per_app', kind: 'days_per_unit',
    unit: 'сут/апп.', from: 'day', category: 'plates', method: 'hydro_dis',
    toRate: (v) => v,
    inputs: { apparatus: 1, surface_m2: 120 },
    note: 'разборка/сборка Funke — сутки на аппарат'
  },

  // ── Котлы ──────────────────────────────────────────────────────────────────
  chem_boiler_flush: {
    target: 'existing', code: 'boiler_chem_days', kind: 'days_per_unit',
    unit: 'сут/котёл', from: 'day', category: 'boilers', method: 'chem',
    toRate: (v) => v,
    inputs: { boilers: 1, circuit_m3: 2, cycles: 2 },
    note: 'химчистка котла: сутки на котёл'
  },
  complex_boiler_flush: {
    target: 'existing', code: 'boiler_complex_days', kind: 'days_per_unit',
    unit: 'сут/котёл', from: 'day', category: 'boilers', method: 'complex',
    toRate: (v) => v,
    inputs: { boilers: 1, surface_m2: 40, circuit_m3: 2 },
    note: 'комплекс котла: сутки на котёл'
  },
  mech_vs_chem_downtime: {
    target: 'existing', code: 'boiler_mech_days', kind: 'days_per_unit',
    unit: 'сут/котёл', from: 'day', category: 'boilers', method: 'mech',
    toRate: (v) => v,
    inputs: { boilers: 1, surface_m2: 40 },
    note: 'механика котла: простой в сутках'
  },
  // чел·ч на 10 м² → м²/исполнитель-смену через продуктивные часы
  boiler_pit_clean_le2m_10m2: {
    target: 'existing', code: 'boiler_complex_m2_shift', kind: 'per_unit_shift',
    unit: 'м²/смену', from: 'person_hour', per: 10, category: 'boilers', method: 'complex',
    toRate: (v, c) => c.productiveHoursPerShift / (v / 10),
    inputs: { boilers: 1, surface_m2: 10, circuit_m3: 2 },
    note: 'чел·ч на 10 м² → м² за продуктивную смену',
    distinct: true
  },
  boiler_pit_clean_gt2m_10m2: {
    target: 'existing', code: 'boiler_complex_m2_shift', kind: 'per_unit_shift',
    unit: 'м²/смену', from: 'person_hour', per: 10, category: 'boilers', method: 'complex',
    toRate: (v, c) => c.productiveHoursPerShift / (v / 10),
    inputs: { boilers: 1, surface_m2: 10, circuit_m3: 2 },
    note: 'то же для приямков глубже 2 м',
    distinct: true
  },
  boiler_gas_duct_10m2: {
    target: 'existing', code: 'boiler_complex_m2_shift', kind: 'per_unit_shift',
    unit: 'м²/смену', from: 'person_hour', per: 10, category: 'boilers', method: 'complex',
    toRate: (v, c) => c.productiveHoursPerShift / (v / 10),
    inputs: { boilers: 1, surface_m2: 10, circuit_m3: 2 },
    note: 'газоходы: чел·ч на 10 м²',
    distinct: true
  },
  boiler_screen_wash_10m2: {
    target: 'existing', code: 'boiler_hydro_m2_shift', kind: 'per_unit_shift',
    unit: 'м²/смену', from: 'person_hour', per: 10, category: 'boilers', method: 'hydro',
    toRate: (v, c) => c.productiveHoursPerShift / (v / 10),
    inputs: { boilers: 1, surface_m2: 10 },
    note: 'обмыв экранов: чел·ч на 10 м²',
    distinct: true
  },

  // ── Трубные пучки ─────────────────────────────────────────────────────────
  // чел·ч на 100 трубок → мин/трубку (калькулятор ждёт min_per_unit)
  gdo_bundle_preheater_100: {
    target: 'existing', code: 'tubes_min_per_tube', kind: 'min_per_unit',
    unit: 'мин/труб', from: 'person_hour', per: 100, category: 'tubes', method: 'gdo',
    toRate: (v) => (v * 60) / 100,
    inputs: { tubes: 100, diameter_mm: 16, length_m: 6 },
    note: 'чел·ч на 100 трубок → мин на трубку',
    distinct: true
  },
  gdo_per_100_tubes_6_8m: {
    target: 'existing', code: 'tubes_min_per_tube', kind: 'min_per_unit',
    unit: 'мин/труб', from: 'person_hour', per: 100, category: 'tubes', method: 'gdo',
    toRate: (v) => (v * 60) / 100,
    inputs: { tubes: 100, diameter_mm: 25, length_m: 7 },
    note: 'трубки 6–8 м',
    distinct: true
  },
  gdo_per_100_tubes_over8m: {
    target: 'existing', code: 'tubes_min_per_tube', kind: 'min_per_unit',
    unit: 'мин/труб', from: 'person_hour', per: 100, category: 'tubes', method: 'gdo',
    toRate: (v) => (v * 60) / 100,
    inputs: { tubes: 100, diameter_mm: 25, length_m: 9 },
    note: 'трубки длиннее 8 м',
    distinct: true
  },
  gdo_outer_preheater_100: {
    target: 'existing', code: 'tubes_min_per_tube', kind: 'min_per_unit',
    unit: 'мин/труб', from: 'person_hour', per: 100, category: 'tubes', method: 'gdo',
    toRate: (v) => (v * 60) / 100,
    inputs: { tubes: 100, diameter_mm: 16, length_m: 4 },
    note: 'наружная очистка подогревателя',
    distinct: true
  },
  gdo_subheater_100_le4m: {
    target: 'existing', code: 'tubes_min_per_tube', kind: 'min_per_unit',
    unit: 'мин/труб', from: 'person_hour', per: 100, category: 'tubes', method: 'gdo',
    toRate: (v) => (v * 60) / 100,
    inputs: { tubes: 100, diameter_mm: 20, length_m: 4 },
    note: 'подогреватель, трубка ≤4 м',
    distinct: true
  },
  gdo_bore_100_le4m: {
    target: 'existing', code: 'tubes_min_per_tube', kind: 'min_per_unit',
    unit: 'мин/труб', from: 'person_hour', per: 100, category: 'tubes', method: 'gdo',
    toRate: (v) => (v * 60) / 100,
    inputs: { tubes: 100, diameter_mm: 20, length_m: 4 },
    note: 'развальцовка/рассверловка',
    distinct: true
  },

  // ── Трубопроводы ──────────────────────────────────────────────────────────
  // чел·ч на 100 м → чел·ч на метр (mh_per_unit)
  pickle_100m_dn15_38: {
    target: 'existing', code: 'pipe_pickle_mh_dn', kind: 'mh_per_unit',
    unit: 'чел·ч/м', from: 'person_hour', per: 100, category: 'pipelines', method: 'pickle',
    toRate: (v) => v / 100, keyBy: { kind: 'dn', fromMetric: 'last' },
    inputs: { length_m: 100, dn_mm: 32 },
    note: 'протравка, Ду15–38'
  },
  pickle_100m_dn48: {
    target: 'existing', code: 'pipe_pickle_mh_dn', kind: 'mh_per_unit',
    unit: 'чел·ч/м', from: 'person_hour', per: 100, category: 'pipelines', method: 'pickle',
    toRate: (v) => v / 100, keyBy: { kind: 'dn', fromMetric: 'last' },
    inputs: { length_m: 100, dn_mm: 48 }, note: 'Ду48'
  },
  pickle_100m_dn57: {
    target: 'existing', code: 'pipe_pickle_mh_dn', kind: 'mh_per_unit',
    unit: 'чел·ч/м', from: 'person_hour', per: 100, category: 'pipelines', method: 'pickle',
    toRate: (v) => v / 100, keyBy: { kind: 'dn', fromMetric: 'last' },
    inputs: { length_m: 100, dn_mm: 57 }, note: 'Ду57'
  },
  pickle_100m_dn76: {
    target: 'existing', code: 'pipe_pickle_mh_dn', kind: 'mh_per_unit',
    unit: 'чел·ч/м', from: 'person_hour', per: 100, category: 'pipelines', method: 'pickle',
    toRate: (v) => v / 100, keyBy: { kind: 'dn', fromMetric: 'last' },
    inputs: { length_m: 100, dn_mm: 76 }, note: 'Ду76'
  },
  pickle_100m_dn89: {
    target: 'existing', code: 'pipe_pickle_mh_dn', kind: 'mh_per_unit',
    unit: 'чел·ч/м', from: 'person_hour', per: 100, category: 'pipelines', method: 'pickle',
    toRate: (v) => v / 100, keyBy: { kind: 'dn', fromMetric: 'last' },
    inputs: { length_m: 100, dn_mm: 89 }, note: 'Ду89'
  },
  pickle_100m_dn108: {
    target: 'existing', code: 'pipe_pickle_mh_dn', kind: 'mh_per_unit',
    unit: 'чел·ч/м', from: 'person_hour', per: 100, category: 'pipelines', method: 'pickle',
    toRate: (v) => v / 100, keyBy: { kind: 'dn', fromMetric: 'last' },
    inputs: { length_m: 100, dn_mm: 108 }, note: 'Ду108'
  },
  pickle_100m_dn133_159: {
    target: 'existing', code: 'pipe_pickle_mh_dn', kind: 'mh_per_unit',
    unit: 'чел·ч/м', from: 'person_hour', per: 100, category: 'pipelines', method: 'pickle',
    toRate: (v) => v / 100, keyBy: { kind: 'dn', fromMetric: 'last' },
    inputs: { length_m: 100, dn_mm: 159 }, note: 'Ду133–159'
  },
  pickle_100m_dn219_426: {
    target: 'existing', code: 'pipe_pickle_mh_dn', kind: 'mh_per_unit',
    unit: 'чел·ч/м', from: 'person_hour', per: 100, category: 'pipelines', method: 'pickle',
    toRate: (v) => v / 100, keyBy: { kind: 'dn', fromMetric: 'last' },
    inputs: { length_m: 100, dn_mm: 325 }, note: 'Ду219–426'
  },
  hydrotest_strength_hold_hours: {
    target: 'existing', code: 'pipe_hydrotest_hours', kind: 'hours_per_cycle',
    unit: 'ч/контур', from: 'hour', category: 'pipelines', method: 'hydrotest',
    toRate: (v) => v, inputs: { length_m: 100, dn_mm: 159 }, note: 'выдержка на прочность'
  },
  hydrotest_leak_hold_hours: {
    target: 'existing', code: 'pipe_hydrotest_hours', kind: 'hours_per_cycle',
    unit: 'ч/контур', from: 'hour', category: 'pipelines', method: 'hydrotest',
    toRate: (v) => v, inputs: { length_m: 100, dn_mm: 159 }, note: 'выдержка на герметичность'
  },

  // ── Ёмкости ───────────────────────────────────────────────────────────────
  vessel_sludge_wash_m3: {
    target: 'existing', code: 'vessel_mh_per_m3', kind: 'mh_per_unit',
    unit: 'чел·ч/м³', from: 'person_hour', category: 'vessels', method: 'clean',
    toRate: (v) => v, inputs: { volume_m3: 100, deposit_cm: 5 }, note: 'зачистка от шлама',
    distinct: true
  },
  vessel_sludge_oil_m3: {
    target: 'existing', code: 'vessel_mh_per_m3', kind: 'mh_per_unit',
    unit: 'чел·ч/м³', from: 'person_hour', category: 'vessels', method: 'clean',
    toRate: (v) => v, inputs: { volume_m3: 100, deposit_cm: 5 }, note: 'зачистка от нефтешлама',
    distinct: true
  },

  // ── Градирни и инженерные системы ─────────────────────────────────────────
  per_10m2_lotok: {
    target: 'existing', code: 'tower_m2_shift', kind: 'per_unit_shift',
    unit: 'м²/смену', from: 'person_hour', per: 10, category: 'towers_hvac', method: 'tower',
    toRate: (v, c) => c.productiveHoursPerShift / (v / 10),
    inputs: { surface_m2: 10 }, note: 'чел·ч на 10 м² лотка → м²/смену'
  },
  cooling_tower_tray_10m2: {
    target: 'existing', code: 'tower_m2_shift', kind: 'per_unit_shift',
    unit: 'м²/смену', from: 'person_hour', per: 10, category: 'towers_hvac', method: 'tower',
    toRate: (v, c) => c.productiveHoursPerShift / (v / 10),
    inputs: { surface_m2: 10 }, note: 'лотки градирни'
  },

  // ── Химконтуры ────────────────────────────────────────────────────────────
  cip_circulation_max: {
    target: 'existing', code: 'cip_hours_circuit', kind: 'hours_per_cycle',
    unit: 'ч/цикл', from: 'hour', category: 'chem_circuits', method: 'cip',
    fixedFouling: 'heavy',
    toRate: (v) => v, inputs: { circuit_m3: 5, cycles: 2 },
    note: 'максимальная циркуляция — верхняя граница (тяжёлое загрязнение), не типичный цикл'
  },
  plates_cip_max_hours: {
    target: 'existing', code: 'plates_cip_hours', kind: 'hours_per_cycle',
    unit: 'ч/цикл', from: 'hour', category: 'plates', method: 'chem_cip',
    fixedFouling: 'heavy',
    toRate: (v) => v, inputs: { circuit_m3: 2.3, cycles: 3 },
    note: 'верхняя граница CIP — тяжёлое загрязнение'
  },
  cooling_circuit_cip_min_hours: {
    target: 'existing', code: 'cip_hours_circuit', kind: 'hours_per_cycle',
    unit: 'ч/цикл', from: 'hour', category: 'chem_circuits', method: 'cip',
    toRate: (v) => v, inputs: { circuit_m3: 1, cycles: 2 }, note: 'минимальная CIP контура охлаждения'
  },

  // ── Монтаж / такелаж ──────────────────────────────────────────────────────
  // «смен на оборудование» → days_per_unit (прямая)
  equipment_dismount: {
    target: 'new', code: 'web_mount_dismount_days', kind: 'days_per_unit',
    unit: 'сут/шт', from: 'shift', category: 'mount', method: 'dismount',
    toRate: (v, c) => v / c.shiftsPerDay,
    inputs: { qty: 1 }, note: 'смены на демонтаж → сутки на единицу'
  },
  rigging_simple_case: {
    target: 'existing', code: 'rigging_lift_shift', kind: 'per_unit_shift',
    unit: 'опер/смену', from: 'day', category: 'mount', method: 'rigging',
    toRate: (v, c) => 1 / (v * c.shiftsPerDay),
    inputs: { qty: 1 }, note: 'сутки на подъём → операций за смену'
  },

  // ── Изоляция ──────────────────────────────────────────────────────────────
  insul_wire_frame_100m2: {
    target: 'existing', code: 'insul_mh_m2', kind: 'mh_per_unit',
    unit: 'чел·ч/м²', from: 'person_hour', per: 100, category: 'insulation', method: 'insul',
    toRate: (v) => v / 100, inputs: { surface_m2: 100 }, note: 'каркас из проволоки',
    distinct: true
  },
  insul_mesh_frame_100m2: {
    target: 'existing', code: 'insul_mh_m2', kind: 'mh_per_unit',
    unit: 'чел·ч/м²', from: 'person_hour', per: 100, category: 'insulation', method: 'insul',
    toRate: (v) => v / 100, inputs: { surface_m2: 100 }, note: 'каркас из сетки',
    distinct: true
  },
  insul_glass_plastic_cover_100m2: {
    target: 'existing', code: 'insul_mh_m2', kind: 'mh_per_unit',
    unit: 'чел·ч/м²', from: 'person_hour', per: 100, category: 'insulation', method: 'insul',
    toRate: (v) => v / 100, inputs: { surface_m2: 100, cover: 2 }, note: 'покрытие стеклопластиком',
    distinct: true
  },
  insul_pvc_cover_100m2: {
    target: 'existing', code: 'insul_mh_m2', kind: 'mh_per_unit',
    unit: 'чел·ч/м²', from: 'person_hour', per: 100, category: 'insulation', method: 'insul',
    toRate: (v) => v / 100, inputs: { surface_m2: 100, cover: 1 }, note: 'покрытие ПВХ',
    distinct: true
  },

  // ── Сварка ────────────────────────────────────────────────────────────────
  // Базовое правило обновляет primary (`weld_joint_shift`), остальные Ду
  // складываются в by_diameter — иначе четыре разных диаметра дали бы
  // четыре «нормы-сироты», не влияющие на расчёт.
  weld_joint_10pcs_dn102: {
    target: 'existing', code: 'weld_joint_shift', kind: 'per_unit_shift',
    unit: 'стык/смену', from: 'person_hour', per: 10, category: 'repair_weld', method: 'weld',
    toRate: (v, c) => (10 * c.productiveHoursPerShift) / v, keyBy: { kind: 'dn' },
    inputs: { joints: 10, dn_mm: 102 }, note: 'стыки Ду102 — базовая норма'
  },
  weld_joint_10pcs_dn57: {
    target: 'existing', code: 'weld_joint_shift', kind: 'per_unit_shift',
    unit: 'стык/смену', from: 'person_hour', per: 10, category: 'repair_weld', method: 'weld',
    toRate: (v, c) => (10 * c.productiveHoursPerShift) / v, keyBy: { kind: 'dn' },
    inputs: { joints: 10, dn_mm: 57 }, note: 'стыки Ду57'
  },
  weld_joint_10pcs_dn68: {
    target: 'existing', code: 'weld_joint_shift', kind: 'per_unit_shift',
    unit: 'стык/смену', from: 'person_hour', per: 10, category: 'repair_weld', method: 'weld',
    toRate: (v, c) => (10 * c.productiveHoursPerShift) / v, keyBy: { kind: 'dn' },
    inputs: { joints: 10, dn_mm: 68 }, note: 'стыки Ду68'
  },
  weld_joint_10pcs_dn15: {
    target: 'existing', code: 'weld_joint_shift', kind: 'per_unit_shift',
    unit: 'стык/смену', from: 'person_hour', per: 10, category: 'repair_weld', method: 'weld',
    toRate: (v, c) => (10 * c.productiveHoursPerShift) / v, keyBy: { kind: 'dn' },
    inputs: { joints: 10, dn_mm: 15 }, note: 'стыки Ду15'
  },

  // ── АВО ───────────────────────────────────────────────────────────────────
  avo_air_box_clean_10m2: {
    target: 'existing', code: 'avo_m2_shift', kind: 'per_unit_shift',
    unit: 'м²/смену', from: 'person_hour', per: 10, category: 'avo', method: 'outer',
    toRate: (v, c) => c.productiveHoursPerShift / (v / 10),
    inputs: { sections: 1, surface_m2: 10 }, note: 'воздушный бокс АВО'
  },

  // ── Уточнения категории (R4-находка: агент положил в чужой метод) ─────────
  // ГЭСНр 65-02-026 — физико-химическая очистка СИСТЕМЫ ОТОПЛЕНИЯ, не трубок ГТО.
  // 10,1 чел·ч на 1 м³ системы → м³ за продуктивную смену исполнителя.
  per_m3_circuit: {
    target: 'existing', code: 'heating_m3_shift', kind: 'per_unit_shift',
    unit: 'м³/смену', from: 'person_hour', category: 'towers_hvac', method: 'heating',
    categoryOverride: 'towers_hvac', methodOverride: 'heating',
    toRate: (v, c) => c.productiveHoursPerShift / v,
    inputs: { circuit_m3: 10 },
    note: '10,1 чел·ч на 1 м³ системы отопления → м³/смену (категория исправлена: ГЭСНр 65-02-026)'
  },
  single_cycle_circulation: {
    target: 'existing', code: 'cip_hours_circuit', kind: 'hours_per_cycle',
    unit: 'ч/цикл', from: 'hour', category: 'chem_circuits', method: 'cip',
    toRate: (v) => v,
    inputs: { circuit_m3: 5, cycles: 2 },
    note: '6–12 ч на промывку контура = часы цикла'
  },
  aspo_solvent_static_plus_circ: {
    target: 'existing', code: 'pipe_chem_circuit_hours', kind: 'hours_per_cycle',
    unit: 'ч/цикл', from: 'hour', category: 'pipelines', method: 'chem_ops',
    toRate: (v) => v,
    inputs: { length_m: 100, dn_mm: 159 },
    note: 'циркуляция растворителя АСПО по 24 ч → часы цикла'
  },
  itp_annual_cip: {
    target: 'existing', code: 'itp_days', kind: 'fixed_days',
    unit: 'сут', from: 'shift', category: 'towers_hvac', method: 'itp',
    toRate: (v, c) => v / c.shiftsPerDay,
    inputs: { circuit_m3: 10 },
    note: '1 смена на ИТП в год → сутки (смен/сут из globals)'
  },
  heating_radiator_flush_100pcs: {
    target: 'new', code: 'web_towers_hvac_heating_rad_shift', kind: 'per_unit_shift',
    unit: 'радиатор/смену', from: 'person_hour', per: 100, category: 'towers_hvac', method: 'heating',
    toRate: (v, c) => (100 * c.productiveHoursPerShift) / v,
    // physicalInputError для towers_hvac.heating требует circuit_m3, поэтому
    // вход шаблона обязан его содержать, а число радиаторов идёт отдельным ключом.
    inputs: { circuit_m3: 10, qty: 100 },
    note: 'промывка 100 радиаторов: чел·ч → радиаторов за смену'
  },

  insulation_per_shift_enir: {
    target: 'existing', code: 'insul_m2_shift', kind: 'per_unit_shift',
    unit: 'м²/смену', from: 'm2', category: 'insulation', method: 'insul',
    toRate: (v) => v, inputs: { surface_m2: 100, diameter_mm: 159 },
    note: 'выработка изоляции по ЕНиР, м²/смену'
  },

  // ── Дополнительные правила R4 (второй проход по findings) ─────────────────
  // Система отопления: 10,1 чел·ч на 1 м³ → м³/смену.
  per_m3_heating_circuit: {
    target: 'existing', code: 'heating_m3_shift', kind: 'per_unit_shift',
    unit: 'м³/смену', from: 'person_hour', category: 'towers_hvac', method: 'heating',
    toRate: (v, c) => c.productiveHoursPerShift / v,
    inputs: { circuit_m3: 10 }, note: '10,1 чел·ч на 1 м³ системы отопления'
  },
  // Промывка ИТП: «9–10 часов» — это смена; берём как фикс. сутки.
  itp_heating_flush: {
    target: 'existing', code: 'itp_days', kind: 'fixed_days',
    unit: 'сут', from: 'shift', category: 'towers_hvac', method: 'itp',
    toRate: (v, c) => v / c.shiftsPerDay,
    inputs: { circuit_m3: 10 }, note: 'промывка ИТП ~9–10 ч = одна смена'
  },
  // Замена теплоносителя в доме: 1 день на объект.
  coolant_replace_house: {
    target: 'existing', code: 'itp_days', kind: 'fixed_days',
    unit: 'сут', from: 'day', category: 'towers_hvac', method: 'itp',
    toRate: (v) => v, inputs: { circuit_m3: 10 },
    note: 'замена теплоносителя: сутки на объект'
  },
  // Очистка воздуховодов: 150–300 п.м/смену — берём консервативно 150.
  duct_clean_linear_per_shift: {
    target: 'existing', code: 'vent_lm_shift', kind: 'per_unit_shift',
    unit: 'м.п./смену', from: 'm', category: 'vent_sewer', method: 'vent',
    toRate: (v) => v, inputs: { length_m: 100 },
    note: 'темп очистки воздуховодов, п.м./смену (источник даёт 150–300)'
  },
  // Травление: 2–5 ч на цикл → доля суток.
  pickle_cycle_duration: {
    target: 'existing', code: 'pipe_pickle_days', kind: 'fixed_days',
    unit: 'сут', from: 'hour', category: 'pipelines', method: 'pickle',
    toRate: (v, c) => v / (c.shiftHours * c.shiftsPerDay),
    inputs: { length_m: 100, dn_mm: 159 },
    note: 'травление 2–5 ч на цикл → доля суток'
  },
  // Пневмоимпульс: 2–3 ч на объект → сутки.
  pneumo_impulse_local: {
    target: 'existing', code: 'pneumo_m_day', kind: 'per_unit_shift',
    unit: 'м/смену', from: 'hour', category: 'towers_hvac', method: 'pneumo',
    toRate: (v, c) => 50 * (c.shiftHours / v),
    inputs: { length_m: 50 }, note: 'пневмоимпульс 2–3 ч на объект (пересчёт по длине 50 м)'
  },
  // Продолжительность цикла: часы на контур — это часы одного цикла,
  // не верхняя граница. Тяжёлым считаем только «максимум/24 ч подряд».
  heating_chem_cycle: {
    target: 'existing', code: 'heating_m3_shift', kind: 'per_unit_shift',
    unit: 'м³/смену', from: 'hour', category: 'towers_hvac', method: 'heating',
    toRate: (v, c) => (10 * c.productiveHoursPerShift) / v,
    inputs: { circuit_m3: 10 },
    note: 'цикл 8–24 ч на систему 10 м³ → м³/смену (пересчёт от объёма)'
  },
  stop_clean_test_start: {
    target: 'existing', code: 'boiler_chem_days', kind: 'days_per_unit',
    unit: 'сут/котёл', from: 'day', category: 'boilers', method: 'chem',
    toRate: (v) => v, inputs: { boilers: 1, circuit_m3: 2, cycles: 2 },
    note: 'остановка-очистка-пуск: сутки (1–5 по объёму, берём верхнюю границу источника)'
  },
  passivation_circulation: {
    target: 'existing', code: 'pipe_chem_circuit_hours', kind: 'hours_per_cycle',
    unit: 'ч/цикл', from: 'hour', category: 'pipelines', method: 'chem_ops',
    toRate: (v) => v, inputs: { length_m: 100, dn_mm: 159 },
    note: 'пассивация 1 ч — длительность цикла'
  },
  season_prep_boiler: {
    target: 'existing', code: 'boiler_chem_days', kind: 'days_per_unit',
    unit: 'сут/котёл', from: 'day', category: 'boilers', method: 'chem',
    toRate: (v) => v, inputs: { boilers: 1, circuit_m3: 2, cycles: 2 },
    note: 'подготовка к сезону одного котла: сутки (1–5 по источнику)'
  },
  field_campaign_calendar: {
    target: 'new', code: 'web_pipelines_pickle_campaign_days', kind: 'fixed_days',
    unit: 'сут', from: 'day', category: 'pipelines', method: 'pickle',
    toRate: (v) => v, inputs: { length_m: 100, dn_mm: 159 },
    note: 'календарь кампании травления (45 сут на объект) — фикс. срок, не удельная норма'
  },
  gdo_tubes_per_repair_campaign: {
    target: 'new', code: 'web_tubes_gdo_campaign_tubes', kind: 'fixed_days',
    unit: 'сут', from: 'tube', category: 'tubes', method: 'gdo',
    toRate: (v, c) => Math.max(1, Math.round((v / 1000) / c.shiftsPerDay)),
    inputs: { tubes: 1000, diameter_mm: 25, length_m: 6 },
    note: '19 146 трубок за кампанию → ориентир суток на 1000 трубок'
  },
  mma_weld_hours_per_joint_dn219: {
    target: 'existing', code: 'weld_joint_shift', kind: 'per_unit_shift',
    unit: 'стык/смену', from: 'hour', category: 'repair_weld', method: 'weld',
    toRate: (v, c) => c.productiveHoursPerShift / v, keyBy: { kind: 'dn' },
    inputs: { joints: 1, dn_mm: 219 },
    note: '5,95 ч на стык Ду219 (MMA) → стыков за продуктивную смену'
  },
  weld_hours_per_joint_dn200_table: {
    target: 'existing', code: 'weld_joint_shift', kind: 'per_unit_shift',
    unit: 'стык/смену', from: 'hour', category: 'repair_weld', method: 'weld',
    toRate: (v, c) => c.productiveHoursPerShift / v, keyBy: { kind: 'dn' },
    inputs: { joints: 1, dn_mm: 200 },
    note: '0,8 ч на стык Ду200 → стыков за смену'
  },
  cooling_circuit_cip: {
    target: 'existing', code: 'cip_hours_circuit', kind: 'hours_per_cycle',
    unit: 'ч/цикл', from: 'shift', category: 'chem_circuits', method: 'cip',
    toRate: (v, c) => v * c.shiftHours,
    inputs: { circuit_m3: 5, cycles: 2 },
    note: 'циркуляция 4–24 ч: 1 смена ≈ 12 ч цикла'
  }
};

/**
 * Метрики, которые НЕ конвертируются автоматически, с честной причиной.
 * Эти строки идут агентам (R4) с конкретной задачей, а не в импорт.
 */
const NEEDS_REVIEW = {
  per_m3_circuit: 'метрика на м³ системы отопления, а категория — трубки ГТО: нужна норма на трубку',
  avo_typical_tube_rows_per_section: 'ряды секции — геометрия, не норма времени',
  manual_rvs_crew_size: 'численность бригады, не выработка — идёт в crew_json, нужен отдельный вопрос по времени',
  itp_annual_cip: 'в источнике «1 смена в год на ИТП» — нет объёма контура, без него не считается',
  'котёл-утилизатор химия': 'метрика без единицы измерения — нужен перевод в сутки/котёл',
  'сектор оросителя': '«1 смена на сектор» без площади сектора — не считается',
  'чел·ч на 1 аппарат': 'единица не нормирована (чел·ч без базы), нужен объём',
  'демонтаж ~10 т': 'вес без такелажной схемы — нужен способ и кран',
  'сравнение CIP vs разбор': 'сравнительная оценка, не норма',
  'разборная vs CIP': 'сравнительная оценка, не норма',
  'разборная гидро/хим-мех': 'сравнение методов, не норма времени',
  'жаротрубный котёл комплекс': 'нет единицы (сутки/котёл?) — уточнить у источника',
  'химпромывка одного котла': 'нет объёма контура и циклов',
  'безразборная химия ПТО': 'нет объёма контура и циклов',
  'длительность CIP': 'нет базы (аппарат? контур?)',
  'выдержка под давлением': 'единица «чел·ч/участок» без размера участка',
  '6000 м² оросителя химия': 'общий срок на всю градирню, не удельная норма',
  пневмоимпульс: 'мин/радиатор без числа радиаторов',
  heating_chem_cycle: 'часы цикла на систему без объёма контура',
  season_prep_boiler: 'подготовка к сезону — комплекс, не удельная выработка',
  insul_flange_removable_10pc: 'изоляция фланцев считается по штукам, а норма insul — на м²: нужен пересчёт площади',
  insul_minwool_m3: 'изоляция матами в м³, норма на м² — нужна толщина слоя',
  insul_glass_wool_m3: 'то же: нужна толщина для перевода м³ → м²',
  flange_prep_degrease_1m_dn100: 'обезжиривание метров трубы ≠ стык/смену',
  mount_flange_pipe_100m_dn400: 'монтаж 100 м трубы Ду400 — не «шт/смену», нужна отдельная норма на м',
  flange_pipe_100m_dn300: 'то же для Ду300',
  heating_radiator_flush_100pcs: 'промывка радиаторов — нет нормы на радиатор в справочнике',
  heating_pneumo_radiator_1pc: 'пневмоимпульс на радиатор — нет базы',
  hydrotest_hold_chh_dn100_200: 'чел·ч на участок без длины участка',
  hydrotest_hold_chh_dn500_1400: 'то же для Ду500–1400',
  hydrotest_extra_watch_post_chh: 'наблюдающий пост — идёт в бригаду, не в норму времени',
  hydrotest_emergency_crew_per_hour: 'аварийная бригада — не норма выработки',
  gmo_condenser_water_box_10m2: 'м² водяной камеры, а норма ГМО — на трубку',
  gmo_tube_sheet_10m2: 'м² трубной доски, норма — на трубку',
  gmo_condenser_retube_unit: 'перетрубка на аппарат — нет числа трубок',
  condenser_chem_clean_25mw: 'часы на турбину 25 МВт — не норма на трубку',
  condenser_chem_clean_50_100mw: 'то же 50–100 МВт',
  gdo_per_100_tubes_6_8m_dup: 'дубль',
  aspo_sandblast_m2_river: 'пескоструй по м² без длины трубопровода',
  aspo_sandblast_m2_mountain: 'то же',
  cooling_fill_sector_contact_hours: '«контактные часы» на сектор без площади',
  cooling_tower_water_blow_system: 'общее время на систему, не удельная норма',
  vessel_touchup_100m2: 'подкраска м², а норма ёмкости — чел·ч/м³: нужен пересчёт',
  vessel_abrasive_blast_100m2: 'то же для пескоструя',
  avo_inner_clean_hyd_resist_trigger: 'порог гидросопротивления, не норма времени',
  avo_fin_blow_pressure_bar: 'давление обдува, не норма времени',
  avo_outer_clean_max_per_year: 'периодичность, не норма времени',
  weld_maint_large_pipe_10m: '10 м шва — норма на метр возможна, но 241,5 чел·ч/10 м неправдоподобно: перепроверить',
  weld_maint_xl_pipe_10m: 'то же, 375,3 чел·ч/10 м — перепроверить',
  gmo_gas_impulse_install: 'монтаж газоимпульса — без числа точек',
  pickle_100m_dn133_159_dup: 'дубль',
  passivation_circulation: 'пассивация в часах на контур без объёма'
};

function specFor(metric) {
  const key = String(metric || '').trim();
  return SPECS[key] || null;
}

/**
 * Отдельный код для каждого исходного объекта, если правило это требует.
 * Пример: `tubes_min_per_tube` собирает подогреватель, наружную очистку,
 * трубки 6–8 м и >8 м — это РАЗНЫЕ работы, усреднять их в одну норму нельзя.
 * Такой код получает суффикс из метрики: `web_tubes_gdo_gdo_per_100_tubes_6_8m`.
 */
function distinctCode(baseCode, metric) {
  const slug = String(metric || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 44);
  return slug ? `${baseCode}__${slug}` : baseCode;
}

/**
 * Достаёт Ду из имени метрики: `pickle_100m_dn219_426` → 325 (середина),
 * `weld_joint_10pcs_dn102` → 102, `hydrotest_hold_chh_dn100_200` → 150.
 * Используется, чтобы нормы по разным диаметрам не усреднялись в одно число.
 */
function parseDnFromMetric(metric) {
  const s = String(metric || '');
  const m = s.match(/dn(\d+)(?:_(\d+))?/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] != null ? Number(m[2]) : null;
  if (!(a > 0)) return null;
  if (b != null && b > a) return Math.round((a + b) / 2);
  return a;
}

function reviewReason(metric) {
  const key = String(metric || '').trim();
  return NEEDS_REVIEW[key] || 'нет правила конверсии в calc_kind — нужна ручная норма';
}

/**
 * Конвертация одной строки findings/verified в корм импорта.
 * @returns {{ok:boolean, reason?:string, code?:string, category?:string, method?:string,
 *            calc_kind?:string, unit?:string, value?:number, inputs?:object,
 *            target?:string, note?:string}}
 */
function convert(row, consts = {}) {
  const c = productivityConstants(consts);
  // findings.jsonl хранит метрику внутри extracted, verified.jsonl — на верхнем уровне.
  const src = row && row.extracted && typeof row.extracted === 'object'
    ? Object.assign({}, row.extracted, { url: row.url, quote_ru: row.quote_ru, source_type: row.source_type, confidence: row.confidence, category: row.category || row.extracted.category })
    : row;
  const metric = src && (src.metric || src.derived_metric);
  const spec = specFor(metric);
  // Если правила нет — причина должна быть содержательной: сначала ищем в
  // NEEDS_REVIEW по метрике, затем по «пустой» метрике, затем общий текст.
  if (!spec) {
    const reason = reviewReason(metric);
    return {
      ok: false,
      reason,
      metric: metric || '(пусто)',
      category: (src && (src.category_code || src.category)) || null,
      method: (src && (src.method_code || src.method)) || null
    };
  }
  // findings.jsonl: значение в extracted.productivity / .value / .days / .shifts;
  // verified.jsonl: value / derived_value на верхнем уровне.
  const value = Number(
    src.value != null ? src.value
      : src.derived_value != null ? src.derived_value
        : src.productivity != null ? src.productivity
          : src.days != null ? src.days
            : src.shifts
  );
  if (!(value > 0)) {
    return { ok: false, reason: 'значение не положительное', metric };
  }
  const srcUnit = String(src.unit || '').trim();
  if (spec.from && srcUnit && srcUnit !== spec.from) {
    return {
      ok: false,
      reason: `единица «${srcUnit}» не совпадает с ожидаемой «${spec.from}»`,
      metric
    };
  }
  const rate = spec.toRate(value, c);
  if (!(rate > 0) || !Number.isFinite(rate)) {
    return { ok: false, reason: 'конверсия дала неположительное значение', metric };
  }
  // Ключ для разведения по диаметру: берём число из имени метрики
  // (`pickle_100m_dn219_426` → 325 — середина диапазона), иначе из row.diameter_mm.
  let byKey = null;
  if (spec.keyBy && spec.keyBy.kind === 'dn') {
    const dn = parseDnFromMetric(metric) || Number(src.diameter_mm) || null;
    if (dn) byKey = String(dn);
  }
    return {
      ok: true,
      metric,
      code: spec.distinct ? distinctCode(spec.code, metric) : spec.code,
      target: spec.distinct ? 'new' : spec.target,
      category: spec.categoryOverride || spec.category,
    method: spec.methodOverride || spec.method,
    calc_kind: spec.kind,
    unit: spec.unit,
    value: Math.round(rate * 1000) / 1000,
    source_value: value,
    source_unit: srcUnit,
    // Слот по отложениям: если правило задаёт fouling жёстко (например
    // «максимальная циркуляция» — это верхняя граница), берём его.
    fouling: spec.fixedFouling || src.fouling || 'medium',
    by_key: byKey,
    inputs: { ...spec.inputs },
    note: spec.note || ''
  };
}

module.exports = {
  SPECS,
  NEEDS_REVIEW,
  specFor,
  reviewReason,
  convert,
  parseDnFromMetric,
  productivityConstants,
  DEFAULT_SHIFT_HOURS,
  DEFAULT_KIRV,
  DEFAULT_SHIFTS_PER_DAY
};
