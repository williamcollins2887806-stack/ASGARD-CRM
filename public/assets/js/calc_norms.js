// Нормативы и справочники калькулятора
// Редактируются админом в настройках

window.CALC_DEFAULTS = {
  // === СТАВКИ ПЕРСОНАЛА ===
  base_rate: 5500,
  
  roles: [
    { id: "worker", name: "Разнорабочий", coef: 1.00, max: 8000, per_diem: 800 },
    { id: "flusher", name: "Промывщик", coef: 1.00, max: 8000, per_diem: 1000 },
    { id: "fitter", name: "Слесарь", coef: 1.05, max: 8000, per_diem: 1000 },
    { id: "welder", name: "Сварщик", coef: 1.10, max: 8000, per_diem: 1000 },
    { id: "chemist", name: "Химик", coef: 1.10, max: 8000, per_diem: 1000 },
    { id: "foreman", name: "Мастер", coef: 1.15, max: 10000, per_diem: 1200 },
    { id: "engineer", name: "ИТР", coef: 1.25, max: 10000, per_diem: 1500 }
  ],
  
  surcharges: [
    { id: "height", name: "Высотные работы (>5м)", pct: 15 },
    { id: "confined", name: "Замкнутое пространство", pct: 20 },
    { id: "hazard", name: "Взрывоопасность / газ", pct: 25 },
    { id: "winter", name: "Зимние условия (<-15°C)", pct: 15 },
    { id: "night", name: "Ночные смены", pct: 20 },
    { id: "chemical", name: "Агрессивная химия", pct: 10, roles: ["flusher", "chemist"] },
    { id: "naks", name: "Сварка НАКС", pct: 10, roles: ["welder"] }
  ],
  
  overhead_pct: 10,
  fot_tax_pct: 50,
  profit_tax_pct: 20,
  vat_pct: 22,
  profit_per_day_min: 20000,
  profit_per_day_norm: 25000,
  auto_days_multiplier: 1.2,
  auto_people_multiplier: 1.1,
  winter_complexity: 1.3,
  
  transport: [
    { id: "gazel", name: "Газель", max_kg: 1500, max_m3: 9, rate_km: 25 },
    { id: "5ton", name: "5-тонник", max_kg: 5000, max_m3: 30, rate_km: 38 },
    { id: "10ton", name: "10-тонник", max_kg: 10000, max_m3: 50, rate_km: 52 },
    { id: "20ton", name: "Фура 20т", max_kg: 20000, max_m3: 82, rate_km: 65 }
  ],
  
  chemicals: [
    { id: "acid_isk", name: "Кислотный ИСК-1", price_kg: 180, kg_per_m2: 0.5, kg_per_m3: 3, type: "scale" },
    { id: "alkali_sh", name: "Щелочной ЩС-2", price_kg: 220, kg_per_m2: 0.4, kg_per_m3: 2, type: "organic" },
    { id: "solvent", name: "Растворитель АСПО", price_kg: 350, kg_per_m2: 0.8, kg_per_m3: 5, type: "aspo" },
    { id: "passivator", name: "Пассиватор П-1", price_kg: 400, kg_per_m2: 0.1, kg_per_m3: 0.5, type: "finish" },
    { id: "ortho", name: "Ортофосфорная кислота", price_kg: 150, kg_per_m2: 0.6, kg_per_m3: 4, type: "scale" },
    { id: "hydro", name: "Соляная кислота", price_kg: 120, kg_per_m2: 0.7, kg_per_m3: 4.5, type: "scale" },
    { id: "soda", name: "Каустическая сода", price_kg: 80, kg_per_m2: 0.3, kg_per_m3: 1.5, type: "organic" }
  ],
  
  work_types: [
    {
      id: "heat_exchanger", name: "Очистка теплообменников", icon: "🔥",
      desc: "Пластинчатые, кожухотрубные, АВО",
      params: [
        { id: "apparatus_count", name: "Количество аппаратов", type: "number", unit: "шт" },
        { id: "surface_m2", name: "Площадь поверхности", type: "number", unit: "м²" },
        { id: "exchanger_type", name: "Тип теплообменника", type: "select", options: ["Пластинчатый разборный", "Пластинчатый паяный", "Кожухотрубный", "АВО"] },
        { id: "contamination", name: "Тип загрязнения", type: "select", options: ["Накипь", "Ржавчина", "Органика", "Нефтепродукты", "Смешанное"] }
      ],
      norm_per_person_day: 15,
      base_crew: { engineer: 1, foreman: 1, flusher: 4, fitter: 2 },
      recommended_chem: ["acid_isk", "passivator"],
      equipment_ids: ["pump_nvd_1", "tank_1m3", "hose_chem", "manometer"]
    },
    {
      id: "avo", name: "Очистка АВО", icon: "🌀",
      desc: "Аппараты воздушного охлаждения",
      params: [
        { id: "sections", name: "Количество секций", type: "number", unit: "шт" },
        { id: "tubes_per_section", name: "Труб в секции", type: "number", unit: "шт" },
        { id: "method", name: "Способ очистки", type: "select", options: ["Химическая", "Гидродинамическая", "Комбинированная"] }
      ],
      norm_per_person_day: 50,
      base_crew: { engineer: 1, foreman: 1, flusher: 6 },
      recommended_chem: ["acid_isk"],
      equipment_ids: ["pump_hvd_1", "tank_3m3", "hose_450bar"]
    },
    {
      id: "boiler", name: "Очистка котлов", icon: "🏭",
      desc: "Паровые и водогрейные котлы",
      params: [
        { id: "boiler_count", name: "Количество котлов", type: "number", unit: "шт" },
        { id: "surface_m2", name: "Площадь нагрева", type: "number", unit: "м²" },
        { id: "boiler_type", name: "Тип котла", type: "select", options: ["Водогрейный", "Паровой", "Утилизатор"] }
      ],
      norm_per_person_day: 20,
      base_crew: { engineer: 1, foreman: 1, flusher: 4, chemist: 1 },
      recommended_chem: ["acid_isk", "alkali_sh", "passivator"],
      equipment_ids: ["pump_chem", "tank_10m3", "heater_diesel"]
    },
    {
      id: "tank", name: "Очистка резервуаров", icon: "🛢️",
      desc: "Резервуары и ёмкости от нефтешлама",
      params: [
        { id: "volume_m3", name: "Объём резервуара", type: "number", unit: "м³" },
        { id: "product_type", name: "Тип продукта", type: "select", options: ["Нефть", "Мазут", "Бензин", "Дизтопливо", "Масло"] },
        { id: "deposit_cm", name: "Толщина отложений", type: "number", unit: "см" }
      ],
      norm_per_person_day: 5,
      base_crew: { engineer: 1, foreman: 2, flusher: 8, worker: 4 },
      recommended_chem: ["solvent"],
      equipment_ids: ["pump_slurry", "tank_10m3", "ventilator_ex", "gas_4ch"]
    },
    {
      id: "pipeline", name: "Очистка трубопроводов", icon: "🔧",
      desc: "Технологические трубопроводы",
      params: [
        { id: "diameter_mm", name: "Диаметр", type: "number", unit: "мм" },
        { id: "length_m", name: "Длина", type: "number", unit: "м" },
        { id: "deposit_type", name: "Тип отложений", type: "select", options: ["АСПО", "Накипь", "Парафин", "Ржавчина"] }
      ],
      norm_per_person_day: 100,
      base_crew: { engineer: 1, foreman: 1, flusher: 4 },
      recommended_chem: ["solvent", "acid_isk"],
      equipment_ids: ["pump_chem", "compressor_1"]
    },
    {
      id: "cooling_tower", name: "Очистка градирен", icon: "💨",
      desc: "Градирни и системы охлаждения",
      params: [
        { id: "tower_type", name: "Тип градирни", type: "select", options: ["Открытая", "Закрытая", "Вентиляторная"] },
        { id: "fill_area", name: "Площадь оросителя", type: "number", unit: "м²" }
      ],
      norm_per_person_day: 30,
      base_crew: { engineer: 1, foreman: 1, flusher: 6, worker: 2 },
      recommended_chem: ["alkali_sh"],
      equipment_ids: ["pump_hvd_1", "ladder_3x10"]
    },
    {
      id: "ventilation", name: "Очистка вентиляции", icon: "🌬️",
      desc: "Воздуховоды и вентсистемы",
      params: [
        { id: "duct_length", name: "Длина воздуховодов", type: "number", unit: "м" },
        { id: "contamination", name: "Тип загрязнения", type: "select", options: ["Пыль", "Жир", "Смешанное"] }
      ],
      norm_per_person_day: 50,
      base_crew: { engineer: 1, foreman: 1, flusher: 3 },
      recommended_chem: ["alkali_sh"],
      equipment_ids: ["brush_machine", "vacuum_industrial"]
    },
    {
      id: "heating_system", name: "Промывка отопления", icon: "🔥",
      desc: "Системы отопления зданий",
      params: [
        { id: "system_volume_m3", name: "Объём системы", type: "number", unit: "м³" },
        { id: "building_area", name: "Площадь здания", type: "number", unit: "м²" }
      ],
      norm_per_person_day: 500,
      base_crew: { engineer: 1, flusher: 2 },
      recommended_chem: ["acid_isk", "passivator"],
      equipment_ids: ["pump_chem", "tank_500l"]
    },
    {
      id: "custom", name: "Универсальный расчёт", icon: "📝",
      desc: "Ручной ввод всех параметров",
      params: [],
      norm_per_person_day: 0,
      base_crew: {},
      recommended_chem: [],
      equipment_ids: []
    }
  ],
  
  mobilization: {
    auto: { name: "Автобус", rate_per_person: 2000, max_km: 500 },
    train: { name: "Ж/Д плацкарт", rate_per_person: 3500, max_km: 3000 },
    train_coupe: { name: "Ж/Д купе", rate_per_person: 6000, max_km: 5000 },
    avia: { name: "Авиа эконом", rate_per_person: 15000, max_km: 99999 }
  },
  
  lodging: {
    hostel: { name: "Хостел/общежитие", rate_per_day: 800 },
    hotel_3: { name: "Гостиница 3*", rate_per_day: 2500 },
    hotel_4: { name: "Гостиница 4*", rate_per_day: 4000 },
    apartment: { name: "Квартира посуточно", rate_per_day: 2000 }
  },
  
  ppe_per_person: 3000,
  consumables_pct: 5
};

// Функция расчёта ставки с доплатами
window.calcRateWithSurcharges = function(roleId, surchargeIds, settings) {
  const cfg = settings || CALC_DEFAULTS;
  const role = cfg.roles.find(r => r.id === roleId);
  if (!role) return 0;
  
  let rate = cfg.base_rate * role.coef;
  
  for (const sId of (surchargeIds || [])) {
    const surcharge = cfg.surcharges.find(s => s.id === sId);
    if (!surcharge) continue;
    if (surcharge.roles && !surcharge.roles.includes(roleId)) continue;
    rate += cfg.base_rate * role.coef * (surcharge.pct / 100);
  }
  
  return Math.min(rate, role.max);
};

// Функция автоподбора бригады
window.autoSelectCrew = function(workTypeId, params, settings) {
  const cfg = settings || CALC_DEFAULTS;
  const workType = cfg.work_types.find(w => w.id === workTypeId);
  if (!workType || !workType.base_crew) return [];
  
  const crew = [];
  const multiplier = cfg.auto_people_multiplier || 1.1;
  
  for (const [roleId, count] of Object.entries(workType.base_crew)) {
    const role = cfg.roles.find(r => r.id === roleId);
    if (!role) continue;
    crew.push({
      role_id: roleId,
      role_name: role.name,
      count: Math.ceil(count * multiplier),
      rate: cfg.base_rate * role.coef,
      per_diem: role.per_diem
    });
  }
  
  return crew;
};

// Функция автоподбора дней
window.autoSelectDays = function(workTypeId, params, crewSize, settings) {
  const cfg = settings || CALC_DEFAULTS;
  const workType = cfg.work_types.find(w => w.id === workTypeId);
  if (!workType || !workType.norm_per_person_day) return 10;
  
  let volume = 0;
  switch (workTypeId) {
    case 'heat_exchanger':
    case 'boiler':
      volume = params.surface_m2 || 100;
      break;
    case 'avo':
      volume = (params.sections || 1) * (params.tubes_per_section || 100);
      break;
    case 'tank':
      volume = params.volume_m3 || 100;
      break;
    case 'pipeline':
      volume = params.length_m || 100;
      break;
    case 'cooling_tower':
      volume = params.fill_area || 100;
      break;
    case 'ventilation':
      volume = params.duct_length || 100;
      break;
    case 'heating_system':
      volume = params.building_area || 1000;
      break;
    default:
      return 10;
  }
  
  const workersCount = crewSize || 6;
  const norm = workType.norm_per_person_day;
  const multiplier = cfg.auto_days_multiplier || 1.2;
  
  let days = Math.ceil((volume / (norm * workersCount)) * multiplier);
  days = Math.max(days, 3);
  days = Math.min(days, 90);
  
  return days;
};

// Функция автоподбора транспорта
window.autoSelectTransport = function(totalKg, totalM3, settings) {
  const cfg = settings || CALC_DEFAULTS;
  const sorted = [...cfg.transport].sort((a, b) => a.max_kg - b.max_kg);
  
  for (const t of sorted) {
    if (totalKg <= t.max_kg && totalM3 <= t.max_m3) {
      return t;
    }
  }
  
  return sorted[sorted.length - 1];
};

// Функция автоподбора химии
window.autoSelectChemicals = function(workTypeId, contaminationType, volumeOrArea, settings) {
  const cfg = settings || CALC_DEFAULTS;
  const workType = cfg.work_types.find(w => w.id === workTypeId);
  
  const result = [];
  const chemIds = workType?.recommended_chem || [];
  
  for (const chemId of chemIds) {
    const chem = cfg.chemicals.find(c => c.id === chemId);
    if (!chem) continue;
    
    let kg = 0;
    if (volumeOrArea.m2) {
      kg = volumeOrArea.m2 * chem.kg_per_m2;
    } else if (volumeOrArea.m3) {
      kg = volumeOrArea.m3 * chem.kg_per_m3;
    }
    
    if (kg > 0) {
      result.push({
        id: chem.id,
        name: chem.name,
        kg: Math.ceil(kg),
        price_kg: chem.price_kg,
        total: Math.ceil(kg) * chem.price_kg
      });
    }
  }
  
  return result;
};

// Функция автоподбора мобилизации
window.autoSelectMobilization = function(distanceKm, settings) {
  const cfg = settings || CALC_DEFAULTS;
  const mob = cfg.mobilization;
  
  if (distanceKm <= mob.auto.max_km) return { ...mob.auto, id: 'auto' };
  if (distanceKm <= mob.train.max_km) return { ...mob.train, id: 'train' };
  if (distanceKm <= mob.train_coupe.max_km) return { ...mob.train_coupe, id: 'train_coupe' };
  return { ...mob.avia, id: 'avia' };
};

console.log('[CALC] Norms loaded:', CALC_DEFAULTS.work_types.length, 'work types');
