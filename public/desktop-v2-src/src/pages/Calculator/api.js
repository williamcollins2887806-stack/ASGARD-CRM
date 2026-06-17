/**
 * API-клиент страницы /calculator (Рунический Калькулятор v2).
 *
 * Источник: vanilla `public/assets/js/calculator_v2.js` (1064 строки) — AsgardCalcV2
 *           + справочники из `calc_norms.js` / `calc_equipment.js` / `calc_cities.js`.
 *
 * Архитектура расчёта (паритет с vanilla):
 *   • Базовая конфигурация — встроена в код (`CALC_DEFAULTS_V2`, `CALC_EQUIPMENT_V2`)
 *     как зеркало `window.CALC_DEFAULTS` / `window.CALC_EQUIPMENT`. Это сохраняет
 *     поведение «работает офлайн» (vanilla тоже грузил через AsgardDB.get).
 *   • Опциональный merge из `/api/settings/calc_v2` (если админ хранит там оверрайды
 *     через PUT /api/settings/:key — см. src/routes/settings.js).
 *   • Всё считается на клиенте через `computeV2(state, settings)`.
 *
 * Что сохраняем:
 *   • POST/PUT /api/estimates с `calc_summary_json` (новый payload `asgard_calc_v2_runic`).
 *   • Совместимость на чтение: умеем читать и legacy `asgard_calc_v1`, и новый v2.
 */
import { api } from '@/api/client';

export const ROLE_LIST = ['ИТР', 'Мастер', 'Слесарь', 'Промывщик', 'ПТО', 'Химик', 'Сварщик', 'Разнорабочий'];

export function num(v, d = 0) {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : d;
}

export function clamp(n, mn, mx) {
  return Math.min(mx, Math.max(mn, n));
}

export function fmtMoney(v) {
  const n = Number(v) || 0;
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

export function safeParse(s, fallback) {
  if (!s) return fallback;
  try {
    const v = typeof s === 'string' ? JSON.parse(s) : s;
    return v && typeof v === 'object' ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

/* ════════════════════════════════════════════════════════════════════════
   BACKEND
   ════════════════════════════════════════════════════════════════════════ */

export function loadAppSettings() {
  return api('/api/settings/app').then((d) => d?.value || d || {}).catch(() => ({}));
}

/** Опциональные оверрайды калькулятора v2 (админ хранит в settings.calc_v2). */
export function loadCalcV2Overrides() {
  return api('/api/settings/calc_v2')
    .then((d) => (d && (d.value || d)) || null)
    .catch(() => null);
}

export function loadTenders(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit || 200));
  if (params.archived) q.set('archived', 'true');
  return api('/api/tenders?' + q.toString())
    .then((d) => d.items || d.tenders || [])
    .catch(() => []);
}

export function loadEstimate(id) {
  return api('/api/estimates/' + id).then((d) => d?.estimate || d?.item || d);
}

export function loadEstimatesByTender(tenderId) {
  return api('/api/estimates?tender_id=' + tenderId)
    .then((d) => d.items || d.estimates || [])
    .catch(() => []);
}

export function createEstimate(body) {
  return api('/api/estimates', { method: 'POST', body });
}

export function updateEstimate(id, body) {
  return api('/api/estimates/' + id, { method: 'PUT', body });
}

/* ════════════════════════════════════════════════════════════════════════
   ВСТРОЕННЫЕ СПРАВОЧНИКИ v2 (зеркало vanilla calc_norms.js / calc_equipment.js)
   ════════════════════════════════════════════════════════════════════════ */

export const CALC_DEFAULTS_V2 = {
  base_rate: 5500,
  roles: [
    { id: 'worker',   name: 'Разнорабочий', coef: 1.00, max: 8000,  per_diem: 800 },
    { id: 'flusher',  name: 'Промывщик',    coef: 1.00, max: 8000,  per_diem: 1000 },
    { id: 'fitter',   name: 'Слесарь',      coef: 1.05, max: 8000,  per_diem: 1000 },
    { id: 'welder',   name: 'Сварщик',      coef: 1.10, max: 8000,  per_diem: 1000 },
    { id: 'chemist',  name: 'Химик',        coef: 1.10, max: 8000,  per_diem: 1000 },
    { id: 'foreman',  name: 'Мастер',       coef: 1.15, max: 10000, per_diem: 1200 },
    { id: 'engineer', name: 'ИТР',          coef: 1.25, max: 10000, per_diem: 1500 }
  ],
  surcharges: [
    { id: 'height',   name: 'Высотные работы (>5м)',     pct: 15 },
    { id: 'confined', name: 'Замкнутое пространство',     pct: 20 },
    { id: 'hazard',   name: 'Взрывоопасность / газ',      pct: 25 },
    { id: 'winter',   name: 'Зимние условия (<-15°C)',    pct: 15 },
    { id: 'night',    name: 'Ночные смены',               pct: 20 },
    { id: 'chemical', name: 'Агрессивная химия',          pct: 10, roles: ['flusher', 'chemist'] },
    { id: 'naks',     name: 'Сварка НАКС',                pct: 10, roles: ['welder'] }
  ],
  overhead_pct: 10,
  fot_tax_pct: 50,
  profit_tax_pct: 20,
  vat_pct: 22,
  profit_per_day_min: 20000,
  profit_per_day_norm: 25000,
  auto_days_multiplier: 1.2,
  auto_people_multiplier: 1.1,
  transport: [
    { id: 'gazel', name: 'Газель',    max_kg: 1500,  max_m3: 9,  rate_km: 25 },
    { id: '5ton',  name: '5-тонник',  max_kg: 5000,  max_m3: 30, rate_km: 38 },
    { id: '10ton', name: '10-тонник', max_kg: 10000, max_m3: 50, rate_km: 52 },
    { id: '20ton', name: 'Фура 20т',  max_kg: 20000, max_m3: 82, rate_km: 65 }
  ],
  chemicals: [
    { id: 'acid_isk',   name: 'Кислотный ИСК-1',       price_kg: 180, kg_per_m2: 0.5, kg_per_m3: 3,   type: 'scale' },
    { id: 'alkali_sh',  name: 'Щелочной ЩС-2',         price_kg: 220, kg_per_m2: 0.4, kg_per_m3: 2,   type: 'organic' },
    { id: 'solvent',    name: 'Растворитель АСПО',     price_kg: 350, kg_per_m2: 0.8, kg_per_m3: 5,   type: 'aspo' },
    { id: 'passivator', name: 'Пассиватор П-1',         price_kg: 400, kg_per_m2: 0.1, kg_per_m3: 0.5, type: 'finish' },
    { id: 'ortho',      name: 'Ортофосфорная кислота', price_kg: 150, kg_per_m2: 0.6, kg_per_m3: 4,   type: 'scale' },
    { id: 'hydro',      name: 'Соляная кислота',        price_kg: 120, kg_per_m2: 0.7, kg_per_m3: 4.5, type: 'scale' },
    { id: 'soda',       name: 'Каустическая сода',      price_kg: 80,  kg_per_m2: 0.3, kg_per_m3: 1.5, type: 'organic' }
  ],
  work_types: [
    { id: 'heat_exchanger', name: 'Очистка теплообменников', icon: '🔥', desc: 'Пластинчатые, кожухотрубные, АВО',
      params: [
        { id: 'apparatus_count', name: 'Количество аппаратов',  type: 'number', unit: 'шт' },
        { id: 'surface_m2',      name: 'Площадь поверхности',    type: 'number', unit: 'м²' },
        { id: 'exchanger_type',  name: 'Тип теплообменника',     type: 'select', options: ['Пластинчатый разборный', 'Пластинчатый паяный', 'Кожухотрубный', 'АВО'] },
        { id: 'contamination',   name: 'Тип загрязнения',         type: 'select', options: ['Накипь', 'Ржавчина', 'Органика', 'Нефтепродукты', 'Смешанное'] }
      ],
      norm_per_person_day: 15, base_crew: { engineer: 1, foreman: 1, flusher: 4, fitter: 2 },
      recommended_chem: ['acid_isk', 'passivator'], equipment_ids: ['pump_nvd_1', 'tank_1m3', 'hose_chem', 'manometer'] },
    { id: 'avo', name: 'Очистка АВО', icon: '🌀', desc: 'Аппараты воздушного охлаждения',
      params: [
        { id: 'sections',          name: 'Количество секций',  type: 'number', unit: 'шт' },
        { id: 'tubes_per_section', name: 'Труб в секции',      type: 'number', unit: 'шт' },
        { id: 'method',            name: 'Способ очистки',     type: 'select', options: ['Химическая', 'Гидродинамическая', 'Комбинированная'] }
      ],
      norm_per_person_day: 50, base_crew: { engineer: 1, foreman: 1, flusher: 6 },
      recommended_chem: ['acid_isk'], equipment_ids: ['pump_hvd_1', 'tank_3m3', 'hose_450bar'] },
    { id: 'boiler', name: 'Очистка котлов', icon: '🏭', desc: 'Паровые и водогрейные котлы',
      params: [
        { id: 'boiler_count', name: 'Количество котлов', type: 'number', unit: 'шт' },
        { id: 'surface_m2',   name: 'Площадь нагрева',    type: 'number', unit: 'м²' },
        { id: 'boiler_type',  name: 'Тип котла',          type: 'select', options: ['Водогрейный', 'Паровой', 'Утилизатор'] }
      ],
      norm_per_person_day: 20, base_crew: { engineer: 1, foreman: 1, flusher: 4, chemist: 1 },
      recommended_chem: ['acid_isk', 'alkali_sh', 'passivator'], equipment_ids: ['pump_chem', 'tank_10m3', 'heater_diesel'] },
    { id: 'tank', name: 'Очистка резервуаров', icon: '🛢️', desc: 'Резервуары и ёмкости от нефтешлама',
      params: [
        { id: 'volume_m3',    name: 'Объём резервуара',     type: 'number', unit: 'м³' },
        { id: 'product_type', name: 'Тип продукта',         type: 'select', options: ['Нефть', 'Мазут', 'Бензин', 'Дизтопливо', 'Масло'] },
        { id: 'deposit_cm',   name: 'Толщина отложений',    type: 'number', unit: 'см' }
      ],
      norm_per_person_day: 5, base_crew: { engineer: 1, foreman: 2, flusher: 8, worker: 4 },
      recommended_chem: ['solvent'], equipment_ids: ['pump_slurry', 'tank_10m3', 'ventilator_ex', 'gas_4ch'] },
    { id: 'pipeline', name: 'Очистка трубопроводов', icon: '🔧', desc: 'Технологические трубопроводы',
      params: [
        { id: 'diameter_mm',  name: 'Диаметр',           type: 'number', unit: 'мм' },
        { id: 'length_m',     name: 'Длина',             type: 'number', unit: 'м' },
        { id: 'deposit_type', name: 'Тип отложений',     type: 'select', options: ['АСПО', 'Накипь', 'Парафин', 'Ржавчина'] }
      ],
      norm_per_person_day: 100, base_crew: { engineer: 1, foreman: 1, flusher: 4 },
      recommended_chem: ['solvent', 'acid_isk'], equipment_ids: ['pump_chem', 'compressor_1'] },
    { id: 'cooling_tower', name: 'Очистка градирен', icon: '💨', desc: 'Градирни и системы охлаждения',
      params: [
        { id: 'tower_type', name: 'Тип градирни',        type: 'select', options: ['Открытая', 'Закрытая', 'Вентиляторная'] },
        { id: 'fill_area',  name: 'Площадь оросителя',   type: 'number', unit: 'м²' }
      ],
      norm_per_person_day: 30, base_crew: { engineer: 1, foreman: 1, flusher: 6, worker: 2 },
      recommended_chem: ['alkali_sh'], equipment_ids: ['pump_hvd_1', 'ladder_3x10'] },
    { id: 'ventilation', name: 'Очистка вентиляции', icon: '🌬️', desc: 'Воздуховоды и вентсистемы',
      params: [
        { id: 'duct_length',   name: 'Длина воздуховодов', type: 'number', unit: 'м' },
        { id: 'contamination', name: 'Тип загрязнения',     type: 'select', options: ['Пыль', 'Жир', 'Смешанное'] }
      ],
      norm_per_person_day: 50, base_crew: { engineer: 1, foreman: 1, flusher: 3 },
      recommended_chem: ['alkali_sh'], equipment_ids: ['brush_machine', 'vacuum_industrial'] },
    { id: 'heating_system', name: 'Промывка отопления', icon: '🔥', desc: 'Системы отопления зданий',
      params: [
        { id: 'system_volume_m3', name: 'Объём системы',  type: 'number', unit: 'м³' },
        { id: 'building_area',    name: 'Площадь здания', type: 'number', unit: 'м²' }
      ],
      norm_per_person_day: 500, base_crew: { engineer: 1, flusher: 2 },
      recommended_chem: ['acid_isk', 'passivator'], equipment_ids: ['pump_chem', 'tank_500l'] },
    { id: 'custom', name: 'Универсальный расчёт', icon: '📝', desc: 'Ручной ввод всех параметров',
      params: [], norm_per_person_day: 0, base_crew: {}, recommended_chem: [], equipment_ids: [] }
  ],
  mobilization: {
    auto:        { name: 'Автобус',      rate_per_person: 2000,  max_km: 500 },
    train:       { name: 'Ж/Д плацкарт', rate_per_person: 3500,  max_km: 3000 },
    train_coupe: { name: 'Ж/Д купе',     rate_per_person: 6000,  max_km: 5000 },
    avia:        { name: 'Авиа эконом',  rate_per_person: 15000, max_km: 99999 }
  },
  lodging: {
    hostel:    { name: 'Хостел/общежитие',     rate_per_day: 800 },
    hotel_3:   { name: 'Гостиница 3*',          rate_per_day: 2500 },
    hotel_4:   { name: 'Гостиница 4*',          rate_per_day: 4000 },
    apartment: { name: 'Квартира посуточно',    rate_per_day: 2000 }
  },
  ppe_per_person: 3000,
  consumables_pct: 5
};

/** Каталог оборудования (минимальный набор из vanilla, расширяется через settings.calc_v2.equipment_catalog). */
export const CALC_EQUIPMENT_V2 = [
  { id: 'pump_nvd_1',        name: 'Насос НВД малый',                       category: 'Насосы',       weight_kg: 80,  volume_m3: 0.3,  amort_day: 500 },
  { id: 'pump_nvd_2',        name: 'Насос НВД средний',                     category: 'Насосы',       weight_kg: 120, volume_m3: 0.5,  amort_day: 700 },
  { id: 'pump_nvd_3',        name: 'Насос НВД большой',                     category: 'Насосы',       weight_kg: 200, volume_m3: 0.8,  amort_day: 1000 },
  { id: 'pump_hvd_1',        name: 'АВД ПРЕУС E5022A (500 бар)',             category: 'АВД',           weight_kg: 350, volume_m3: 1.2,  amort_day: 2000 },
  { id: 'pump_hvd_2',        name: 'АВД ПРЕУС T3517EX (350 бар)',            category: 'АВД',           weight_kg: 280, volume_m3: 1.0,  amort_day: 1800 },
  { id: 'pump_chem',         name: 'Насос химический мембранный Gematech', category: 'Насосы',       weight_kg: 45,  volume_m3: 0.15, amort_day: 600 },
  { id: 'pump_membrane',     name: 'Насос мембранный Yamada NDP-40',         category: 'Насосы',       weight_kg: 35,  volume_m3: 0.1,  amort_day: 500 },
  { id: 'pump_slurry',       name: 'Насос шламовый',                         category: 'Насосы',       weight_kg: 150, volume_m3: 0.6,  amort_day: 800 },
  { id: 'compressor_1',      name: 'Компрессор АЭРУС 210/24',                category: 'Компрессоры', weight_kg: 45,  volume_m3: 0.2,  amort_day: 400 },
  { id: 'compressor_2',      name: 'Компрессор передвижной 5м³/мин',         category: 'Компрессоры', weight_kg: 800, volume_m3: 3.0,  amort_day: 1500, rent_day: 5000 },
  { id: 'tank_500l',         name: 'Ёмкость 500 л пластик',                  category: 'Ёмкости',     weight_kg: 25,  volume_m3: 0.6,  amort_day: 100 },
  { id: 'tank_1m3',          name: 'Ёмкость 1 м³ пластик',                    category: 'Ёмкости',     weight_kg: 50,  volume_m3: 1.1,  amort_day: 150 },
  { id: 'tank_3m3',          name: 'Ёмкость 3 м³ металл',                     category: 'Ёмкости',     weight_kg: 300, volume_m3: 3.2,  amort_day: 300 },
  { id: 'tank_10m3',         name: 'Ёмкость 10 м³ в кассете',                 category: 'Ёмкости',     weight_kg: 800, volume_m3: 10.5, amort_day: 500 },
  { id: 'hose_180bar',       name: 'РВД 180 бар 20м',                         category: 'Шланги',      weight_kg: 15,  volume_m3: 0.03, amort_day: 100 },
  { id: 'hose_250bar',       name: 'РВД 250 бар 20м',                         category: 'Шланги',      weight_kg: 18,  volume_m3: 0.04, amort_day: 120 },
  { id: 'hose_450bar',       name: 'РВД 450 бар 15м',                         category: 'Шланги',      weight_kg: 20,  volume_m3: 0.04, amort_day: 150 },
  { id: 'hose_chem',         name: 'Шланг химстойкий 25м',                   category: 'Шланги',      weight_kg: 12,  volume_m3: 0.03, amort_day: 80 },
  { id: 'manometer',         name: 'Манометр поверенный',                    category: 'Приборы',    weight_kg: 0.5, volume_m3: 0.001, amort_day: 30 },
  { id: 'ph_meter',          name: 'pH-метр HMDigital PH-200',               category: 'Приборы',    weight_kg: 0.5, volume_m3: 0.001, amort_day: 50 },
  { id: 'gas_4ch',           name: 'Газоанализатор GasAlert 4-канальный',    category: 'Приборы',    weight_kg: 0.8, volume_m3: 0.002, amort_day: 150 },
  { id: 'ventilator_ex',     name: 'Вентилятор взрывозащищённый SHT-30-EX', category: 'Вентиляция', weight_kg: 35,  volume_m3: 0.15, amort_day: 300 },
  { id: 'heater_diesel',     name: 'Пушка тепловая дизельная 20кВт',         category: 'Обогрев',    weight_kg: 25,  volume_m3: 0.15, amort_day: 400 },
  { id: 'brush_machine',     name: 'Щёточная машина для воздуховодов',       category: 'Спецоборудование', weight_kg: 30, volume_m3: 0.2, amort_day: 400 },
  { id: 'vacuum_industrial', name: 'Промышленный пылесос',                   category: 'Спецоборудование', weight_kg: 50, volume_m3: 0.3, amort_day: 200 },
  { id: 'ladder_3x10',       name: 'Лестница 3-секц. алюм. 3х10',             category: 'Подмости',   weight_kg: 25,  volume_m3: 0.3,  amort_day: 80 },
  { id: 'scaffold',          name: 'Подмости передвижные h=4м',              category: 'Подмости',   weight_kg: 120, volume_m3: 1.5,  amort_day: 200, rent_day: 800 }
];

/** Слить дефолты v2 с оверрайдами из настроек (формат как в vanilla). */
export function mergeCalcSettings(overrides) {
  if (!overrides || typeof overrides !== 'object') return { ...CALC_DEFAULTS_V2 };
  // Простой override верхнего уровня (как vanilla `{ ...defaults, ...app.calc_v2 }`).
  return { ...CALC_DEFAULTS_V2, ...overrides };
}

/** Слить базовый каталог оборудования с пользовательским из настроек. */
export function mergeEquipmentCatalog(overrides) {
  if (!Array.isArray(overrides) || !overrides.length) return CALC_EQUIPMENT_V2.slice();
  const byId = new Map(CALC_EQUIPMENT_V2.map((e) => [e.id, e]));
  for (const e of overrides) {
    if (e && e.id) byId.set(e.id, { ...byId.get(e.id), ...e });
  }
  return Array.from(byId.values());
}

/* ════════════════════════════════════════════════════════════════════════
   STATE (порт createState из vanilla calculator_v2.js)
   ════════════════════════════════════════════════════════════════════════ */

const isoNow = () => new Date().toISOString();

export function createState(tender) {
  return {
    tender_id: tender?.id || null,
    customer_name: tender?.customer_name || '',
    tender_title: tender?.tender_title || tender?.title || '',
    work_type_id: 'heat_exchanger',
    city: '',
    distance_km: 0,
    conditions: [],   // id из surcharges (общие, не привязанные к ролям)
    surcharges: [],   // итоговый набор доплат (conditions + ролевые)
    params: {},
    crew: [],         // [{ role_id, role_name, count, per_diem }]
    crew_manual: false,
    prep_days: 2,
    work_days: 10,
    demob_days: 1,
    days_manual: false,
    chemicals: [],    // [{ id, kg }]
    chem_manual: false,
    equipment: [],    // [{ id, qty, rent }]
    equip_manual: false,
    transport_id: 'auto',
    mobilization_type: 'auto',
    lodging_type: 'hotel_3',
    margin_pct: 20,
    assumptions: '',
    version: 1,
    created_at: isoNow()
  };
}

/** Сохранить значения из старого state поверх свежего default (для смены тендера). */
export function inheritFromTender(state, tender) {
  if (!tender) return state;
  return {
    ...state,
    tender_id: tender.id,
    customer_name: tender.customer_name || '',
    tender_title: tender.tender_title || tender.title || ''
  };
}

/* ════════════════════════════════════════════════════════════════════════
   HELPERS (порт window.calc* из vanilla calc_norms.js)
   ════════════════════════════════════════════════════════════════════════ */

export function calcRateWithSurcharges(roleId, surchargeIds, s) {
  const role = (s.roles || []).find((r) => r.id === roleId);
  if (!role) return 0;
  let rate = num(s.base_rate, 5500) * num(role.coef, 1);
  for (const sid of (surchargeIds || [])) {
    const sur = (s.surcharges || []).find((x) => x.id === sid);
    if (!sur) continue;
    if (sur.roles && !sur.roles.includes(roleId)) continue;
    rate += num(s.base_rate, 5500) * num(role.coef, 1) * (num(sur.pct, 0) / 100);
  }
  return Math.min(rate, num(role.max, 99999));
}

export function autoSelectTransport(totalKg, totalM3, s) {
  const sorted = (s.transport || []).slice().sort((a, b) => num(a.max_kg, 0) - num(b.max_kg, 0));
  for (const t of sorted) {
    if (totalKg <= num(t.max_kg, 0) && totalM3 <= num(t.max_m3, 0)) return t;
  }
  return sorted[sorted.length - 1] || { id: 'gazel', name: 'Газель', rate_km: 25, max_kg: 1500, max_m3: 9 };
}

export function autoSelectMobilization(distanceKm, s) {
  const mob = s.mobilization || {};
  if (distanceKm <= num(mob.auto?.max_km, 500)) return { ...(mob.auto || {}), id: 'auto' };
  if (distanceKm <= num(mob.train?.max_km, 3000)) return { ...(mob.train || {}), id: 'train' };
  if (distanceKm <= num(mob.train_coupe?.max_km, 5000)) return { ...(mob.train_coupe || {}), id: 'train_coupe' };
  return { ...(mob.avia || {}), id: 'avia' };
}

export function calcEquipmentCost(equipmentList, workDays, catalog) {
  let total = 0, totalWeight = 0, totalVolume = 0;
  for (const item of (equipmentList || [])) {
    const eq = (catalog || CALC_EQUIPMENT_V2).find((e) => e.id === item.id);
    if (!eq) continue;
    const qty = num(item.qty, 1);
    const days = num(workDays, 10);
    const dayRate = item.rent ? num(eq.rent_day, 0) : num(eq.amort_day, 0);
    total += dayRate * days * qty;
    totalWeight += num(eq.weight_kg, 0) * qty;
    totalVolume += num(eq.volume_m3, 0) * qty;
  }
  return { total, totalWeight, totalVolume };
}

/* ════════════════════════════════════════════════════════════════════════
   COMPUTE V2 (порт vanilla calculator_v2.js compute)
   ════════════════════════════════════════════════════════════════════════ */

export function computeV2(state, s, catalog) {
  const dist = clamp(num(state.distance_km, 0), 0, 15000);
  const prepDays = clamp(num(state.prep_days, 0), 0, 30);
  const workDays = clamp(num(state.work_days, 1), 1, 365);
  const demobDays = clamp(num(state.demob_days, 0), 0, 14);
  const totalDays = prepDays + workDays + demobDays;

  let peopleCount = 0, payrollWork = 0, perDiemTotal = 0;
  for (const c of (state.crew || [])) {
    const role = (s.roles || []).find((r) => r.id === c.role_id);
    if (!role) continue;
    const count = clamp(num(c.count, 0), 0, 50);
    peopleCount += count;
    const rate = calcRateWithSurcharges(c.role_id, state.surcharges, s);
    payrollWork += rate * count * workDays;
    perDiemTotal += num(role.per_diem, 1000) * count * totalDays;
  }

  const prepPeople = Math.min(2, peopleCount);
  const prepRate = num(s.base_rate, 5500) * 1.15;
  const payrollPrep = prepRate * prepPeople * prepDays;
  const payrollDemob = prepRate * prepPeople * demobDays;
  const payrollTotal = payrollWork + payrollPrep + payrollDemob;
  const fotTax = payrollTotal * num(s.fot_tax_pct, 50) / 100;

  const lodging = (s.lodging || {})[state.lodging_type] || { rate_per_day: 2500 };
  const lodgingTotal = num(lodging.rate_per_day, 2500) * peopleCount * totalDays;

  const mobAuto = autoSelectMobilization(dist, s);
  const mobSelected = state.mobilization_type === 'auto'
    ? mobAuto
    : { ...((s.mobilization || {})[state.mobilization_type] || mobAuto), id: state.mobilization_type };
  const mobilizationTotal = num(mobSelected.rate_per_person, 3500) * peopleCount * 2;

  let chemTotal = 0, chemWeight = 0;
  for (const ch of (state.chemicals || [])) {
    const chem = (s.chemicals || []).find((c) => c.id === ch.id);
    if (!chem) continue;
    const kg = num(ch.kg, 0);
    chemTotal += kg * num(chem.price_kg, 0);
    chemWeight += kg;
  }
  const consumables = chemTotal * (num(s.consumables_pct, 5) / 100);

  const eqResult = calcEquipmentCost(state.equipment || [], workDays, catalog);
  const totalWeightKg = chemWeight + eqResult.totalWeight;
  const totalVolM3 = (chemWeight / 1000) + eqResult.totalVolume;

  const transport = state.transport_id === 'auto'
    ? autoSelectTransport(totalWeightKg, totalVolM3, s)
    : ((s.transport || []).find((t) => t.id === state.transport_id) || (s.transport || [])[0] || { rate_km: 25, name: 'Газель' });
  const logisticsTotal = num(transport.rate_km, 40) * dist * 2;

  const ppeTotal = num(s.ppe_per_person, 3000) * peopleCount;
  const baseCost = payrollTotal + perDiemTotal + lodgingTotal + mobilizationTotal + chemTotal + consumables + eqResult.total + logisticsTotal + ppeTotal;
  const overheadPct = num(s.overhead_pct, 10);
  const overhead = baseCost * overheadPct / 100;
  const costTotal = baseCost + overhead + fotTax;

  const marginPct = clamp(num(state.margin_pct, 20), 5, 100);
  const priceNoVat = costTotal / (1 - marginPct / 100);
  const profitBeforeTax = priceNoVat - costTotal;
  const profitTax = profitBeforeTax * (num(s.profit_tax_pct, 20) / 100);
  const netProfit = profitBeforeTax - profitTax;
  const vatPct = num(s.vat_pct, 22);
  const priceWithVat = priceNoVat * (1 + vatPct / 100);
  const profitPerDay = (peopleCount > 0 && workDays > 0) ? netProfit / (peopleCount * workDays) : 0;

  const minProfit = num(s.profit_per_day_min, 20000);
  const normProfit = num(s.profit_per_day_norm, 25000);
  let status = 'red';
  if (profitPerDay >= normProfit) status = 'green';
  else if (profitPerDay >= minProfit) status = 'yellow';

  return {
    distance_km: dist, prep_days: prepDays, work_days: workDays, demob_days: demobDays, total_days: totalDays,
    people_count: peopleCount,
    payroll_work: payrollWork, payroll_prep: payrollPrep, payroll_demob: payrollDemob, payroll_total: payrollTotal,
    fot_tax: fotTax, fot_tax_pct: num(s.fot_tax_pct, 50),
    per_diem_total: perDiemTotal,
    lodging_total: lodgingTotal,
    mobilization_total: mobilizationTotal, mobilization_type: mobSelected.id, mobilization_obj: mobSelected,
    chem_total: chemTotal, consumables,
    equip_total: eqResult.total, equip_weight: eqResult.totalWeight, equip_volume: eqResult.totalVolume,
    total_weight_kg: totalWeightKg, total_volume_m3: totalVolM3,
    transport, logistics_total: logisticsTotal,
    ppe_total: ppeTotal,
    base_cost: baseCost, overhead, overhead_pct: overheadPct,
    cost_total: costTotal,
    margin_pct: marginPct, price_no_vat: priceNoVat,
    profit_before_tax: profitBeforeTax, profit_tax: profitTax, net_profit: netProfit,
    profit_tax_pct: num(s.profit_tax_pct, 20),
    vat_pct: vatPct, price_with_vat: priceWithVat,
    profit_per_day: profitPerDay,
    min_profit: minProfit, norm_profit: normProfit, status
  };
}

/* ════════════════════════════════════════════════════════════════════════
   AUTO-FILL (порт vanilla autoFill)
   ════════════════════════════════════════════════════════════════════════ */

export function autoFillV2(state, s) {
  const wt = (s.work_types || []).find((w) => w.id === state.work_type_id);
  if (!wt) return state;
  const next = { ...state };

  if (!state.crew_manual && wt.base_crew && Object.keys(wt.base_crew).length) {
    const peopleMult = num(s.auto_people_multiplier, 1.1);
    next.crew = [];
    for (const [roleId, count] of Object.entries(wt.base_crew)) {
      const role = (s.roles || []).find((r) => r.id === roleId);
      if (!role) continue;
      next.crew.push({
        role_id: roleId,
        role_name: role.name,
        count: Math.ceil(num(count, 0) * peopleMult),
        per_diem: num(role.per_diem, 1000)
      });
    }
  }

  if (!state.days_manual && wt.norm_per_person_day) {
    const p = state.params || {};
    const vol = p.surface_m2 || p.volume_m3 || p.length_m || p.fill_area || p.building_area || 100;
    const crewSize = (next.crew || []).reduce((a, c) => a + num(c.count, 0), 0) || 6;
    const daysMult = num(s.auto_days_multiplier, 1.2);
    next.work_days = Math.max(3, Math.min(90, Math.ceil((vol / (num(wt.norm_per_person_day, 1) * crewSize)) * daysMult)));
  }

  if (!state.chem_manual && Array.isArray(wt.recommended_chem) && wt.recommended_chem.length) {
    next.chemicals = [];
    const p = state.params || {};
    const vol = p.system_volume_m3 || p.volume_m3 || 0;
    const area = p.surface_m2 || p.fill_area || 0;
    for (const chemId of wt.recommended_chem) {
      const chem = (s.chemicals || []).find((c) => c.id === chemId);
      if (!chem) continue;
      const kg = Math.ceil(vol ? vol * num(chem.kg_per_m3, 0) : area * num(chem.kg_per_m2, 0)) || 50;
      next.chemicals.push({ id: chemId, kg });
    }
  }

  if (!state.equip_manual && Array.isArray(wt.equipment_ids) && wt.equipment_ids.length) {
    next.equipment = wt.equipment_ids.slice(0, 8).map((id) => ({ id, qty: 1, rent: false }));
  }

  return next;
}

/* ════════════════════════════════════════════════════════════════════════
   LEGACY v1 COMPAT (для чтения старых estimate'ов с asgard_calc_v1)
   ════════════════════════════════════════════════════════════════════════ */

export function defaultsFromSettings(app) {
  const c = app.calc || {};
  const roleRates = c.role_rates || {};
  const roles = ROLE_LIST.map((r) => ({ role: r, count: 0, rate: num(roleRates[r], 5000) }));
  return {
    work_days: 10, prep_days: 0, prep_people: 0, prep_rate: num(c.prep_rate_per_day, 3500),
    city: '', distance_km: 0,
    per_diem: 0, lodging_per_person_day: 0, lodging_total: 0, ppe_per_person: 0,
    mobilizations: [{ label: 'Мобилизация 1', people: 0, cost_per_person: 0 }],
    roles, system_volume_m3: 0, chemical_id: (c.chemicals?.[0]?.id) || '',
    equipment: [], transport_id: 'AUTO', margin_pct: 20, vat_pct: num(app.vat_pct, 22)
  };
}

export function mergeState(base, saved) {
  if (!saved || typeof saved !== 'object') return base;
  const next = JSON.parse(JSON.stringify(base));
  for (const k of Object.keys(base)) if (saved[k] !== undefined) next[k] = saved[k];
  if (Array.isArray(saved.roles)) {
    const map = new Map(saved.roles.map((r) => [r.role, r]));
    next.roles = base.roles.map((r) => {
      const sv = map.get(r.role);
      return sv ? { role: r.role, count: num(sv.count, 0), rate: num(sv.rate, r.rate) } : r;
    });
  }
  if (Array.isArray(saved.mobilizations)) {
    next.mobilizations = saved.mobilizations.map((m) => ({
      label: String(m.label || ''), people: num(m.people, 0), cost_per_person: num(m.cost_per_person, 0)
    }));
  }
  if (Array.isArray(saved.equipment)) {
    next.equipment = saved.equipment.map((e) => ({
      name: String(e.name || ''), kind: String(e.kind || 'own'),
      cost: num(e.cost, 0), rate_per_day: num(e.rate_per_day, 0), amort: num(e.amort, 0),
      weight_kg: num(e.weight_kg, 0), volume_m3: num(e.volume_m3, 0)
    }));
  }
  return next;
}

export function compute(state, app) {
  const c = app.calc || {};
  const overhead_pct = num(c.overhead_pct, 10);
  const fot_tax_pct = num(c.fot_tax_pct, 50);
  const profit_tax_pct = num(c.profit_tax_pct, 20);
  const min_ppd = num(c.min_profit_per_person_day, 25000);

  const workDays = clamp(num(state.work_days, 0), 0, 365);
  const prepDays = clamp(num(state.prep_days, 0), 0, 365);
  const totalDays = workDays + prepDays;

  const roleRows = (state.roles || []).map((r) => ({
    role: r.role, count: clamp(num(r.count, 0), 0, 999), rate: num(r.rate, 0)
  }));
  const peopleWork = roleRows.reduce((sum, r) => sum + r.count, 0);
  const payrollWork = roleRows.reduce((sum, r) => sum + r.count * r.rate * workDays, 0);

  const prepPeople = clamp(num(state.prep_people, 0), 0, 999);
  const prepRate = num(state.prep_rate, num(c.prep_rate_per_day, 3500));
  const payrollPrep = prepPeople * prepRate * prepDays;
  const payrollTotal = payrollWork + payrollPrep;

  const perDiem = num(state.per_diem, 0) * totalDays * peopleWork;
  const lodgingPPD = num(state.lodging_per_person_day, 0);
  let lodging = lodgingPPD * totalDays * peopleWork;
  if (!lodging) lodging = num(state.lodging_total, 0);
  const ppe = num(state.ppe_per_person, 0) * peopleWork;
  const mobilization = (state.mobilizations || []).reduce(
    (sum, m) => sum + num(m.people, 0) * num(m.cost_per_person, 0), 0
  );

  const chemList = c.chemicals || [];
  const chem = chemList.find((x) => String(x.id) === String(state.chemical_id)) || chemList[0] || null;
  const vol = num(state.system_volume_m3, 0);
  const chemKg = chem ? vol * num(chem.kg_per_m3, 0) : 0;
  const chemCost = chem ? chemKg * num(chem.price_per_kg, 0) : 0;
  const chemVolM3 = chemKg / 1000;

  const eq = (state.equipment || []).map((e) => ({
    name: String(e.name || ''), kind: String(e.kind || 'own'),
    cost: num(e.cost, 0), rate_per_day: num(e.rate_per_day, 0), amort: num(e.amort, 0),
    weight_kg: num(e.weight_kg, 0), volume_m3: num(e.volume_m3, 0)
  })).filter((e) => e.name.trim());

  const equipCost = eq.reduce((sum, e) => {
    if (e.kind === 'buy') return sum + e.cost;
    if (e.kind === 'rent') return sum + e.rate_per_day * workDays;
    return sum + e.amort;
  }, 0);
  const equipWeight = eq.reduce((sum, e) => sum + e.weight_kg, 0);
  const equipVol = eq.reduce((sum, e) => sum + e.volume_m3, 0);
  const totalWeightKg = equipWeight + chemKg;
  const totalVolM3 = equipVol + chemVolM3;

  const dist = clamp(num(state.distance_km, 0), 0, 200000);
  const trans = c.transport_options || c.transport || [];
  let selected = null;
  if (String(state.transport_id) !== 'AUTO') {
    selected = trans.find((t) => String(t.id) === String(state.transport_id)) || null;
  }
  if (!selected) {
    selected = trans.slice()
      .sort((a, b) => (num(a.max_weight_t, 0) - num(b.max_weight_t, 0)) || (num(a.max_volume_m3, 0) - num(b.max_volume_m3, 0)))
      .find((t) => (totalWeightKg / 1000) <= num(t.max_weight_t, 0) && totalVolM3 <= num(t.max_volume_m3, 0)) ||
      trans[trans.length - 1] || null;
  }
  const transRate = selected ? num(selected.rate_per_km, 0) : 0;
  const logistics = transRate * dist * 2;

  const base = payrollTotal + perDiem + lodging + ppe + mobilization + chemCost + equipCost + logistics;
  const overhead = base * overhead_pct / 100;
  const fotTax = payrollTotal * fot_tax_pct / 100;
  const costTotal = base + overhead + fotTax;

  const m = clamp(num(state.margin_pct, 0), 0, 95) / 100;
  const pt = clamp(profit_tax_pct, 0, 99) / 100;
  const denom = (1 - pt) - m;
  const priceNoVat = denom > 0 ? (costTotal * (1 - pt)) / denom : (costTotal * 1.5);
  const profitBeforeTax = priceNoVat - costTotal;
  const netProfit = profitBeforeTax * (1 - pt);
  const vatPct = clamp(num(state.vat_pct, num(app.vat_pct, 22)), 0, 30);
  const priceWithVat = priceNoVat * (1 + vatPct / 100);
  const ppd = (peopleWork > 0 && workDays > 0) ? (netProfit / (peopleWork * workDays)) : 0;

  return {
    ok: ppd >= min_ppd, min_ppd,
    workDays, prepDays, totalDays, peopleWork, payrollWork, payrollPrep, payrollTotal,
    perDiem, lodging, ppe, mobilization,
    chem: chem ? { id: chem.id, name: chem.name, kg_per_m3: num(chem.kg_per_m3, 0),
      price_per_kg: num(chem.price_per_kg, 0), volume_m3: vol, kg: chemKg, cost: chemCost } : null,
    equipment: eq, equipCost, equipment_total: equipCost,
    totalWeightKg, totalVolM3,
    transport: selected ? { id: selected.id, name: selected.name, max_weight_t: num(selected.max_weight_t, 0),
      max_volume_m3: num(selected.max_volume_m3, 0), rate_per_km: transRate } : null,
    dist, logistics,
    overhead_pct, overhead, fot_tax_pct, fotTax, profit_tax_pct,
    costTotal, margin_pct: num(state.margin_pct, 0),
    priceNoVat, vatPct, priceWithVat, profitBeforeTax, netProfit,
    profit_per_person_day: ppd
  };
}
