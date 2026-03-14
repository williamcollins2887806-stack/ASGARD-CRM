// Справочник оборудования для калькулятора
// Основано на реальном оборудовании АСГАРД-Сервис

window.CALC_EQUIPMENT = [
  // === НАСОСЫ И АВД ===
  { id: "pump_nvd_1", name: "Насос НВД малый", category: "Насосы", weight_kg: 80, volume_m3: 0.3, amort_day: 500, work_types: ["heat_exchanger", "boiler", "heating_system"] },
  { id: "pump_nvd_2", name: "Насос НВД средний", category: "Насосы", weight_kg: 120, volume_m3: 0.5, amort_day: 700, work_types: ["heat_exchanger", "boiler", "avo"] },
  { id: "pump_nvd_3", name: "Насос НВД большой", category: "Насосы", weight_kg: 200, volume_m3: 0.8, amort_day: 1000, work_types: ["tank", "pipeline"] },
  { id: "pump_hvd_1", name: "АВД ПРЕУС E5022A (500 бар)", category: "АВД", weight_kg: 350, volume_m3: 1.2, amort_day: 2000, work_types: ["heat_exchanger", "avo", "cooling_tower"] },
  { id: "pump_hvd_2", name: "АВД ПРЕУС T3517EX (350 бар)", category: "АВД", weight_kg: 280, volume_m3: 1.0, amort_day: 1800, work_types: ["heat_exchanger", "avo"] },
  { id: "pump_chem", name: "Насос химический мембранный Gematech", category: "Насосы", weight_kg: 45, volume_m3: 0.15, amort_day: 600, work_types: ["heat_exchanger", "boiler", "pipeline", "heating_system", "commissioning"] },
  { id: "pump_membrane", name: "Насос мембранный Yamada NDP-40", category: "Насосы", weight_kg: 35, volume_m3: 0.1, amort_day: 500, work_types: ["heat_exchanger", "boiler"] },
  { id: "pump_slurry", name: "Насос шламовый", category: "Насосы", weight_kg: 150, volume_m3: 0.6, amort_day: 800, work_types: ["tank"] },
  { id: "pump_submersible", name: "Насос погружной Termica AGP100", category: "Насосы", weight_kg: 25, volume_m3: 0.08, amort_day: 300, work_types: ["tank", "cooling_tower"] },
  { id: "compressor_1", name: "Компрессор АЭРУС 210/24", category: "Компрессоры", weight_kg: 45, volume_m3: 0.2, amort_day: 400, work_types: ["pipeline", "ventilation"] },
  { id: "compressor_2", name: "Компрессор передвижной 5м³/мин", category: "Компрессоры", weight_kg: 800, volume_m3: 3.0, amort_day: 1500, rent_day: 5000, work_types: ["pipeline", "tank"] },
  
  // === ЁМКОСТИ ===
  { id: "tank_500l", name: "Ёмкость 500 л пластик", category: "Ёмкости", weight_kg: 25, volume_m3: 0.6, amort_day: 100, work_types: ["heat_exchanger", "heating_system"] },
  { id: "tank_1m3", name: "Ёмкость 1 м³ пластик", category: "Ёмкости", weight_kg: 50, volume_m3: 1.1, amort_day: 150, work_types: ["heat_exchanger", "boiler", "heating_system", "commissioning"] },
  { id: "tank_3m3", name: "Ёмкость 3 м³ металл", category: "Ёмкости", weight_kg: 300, volume_m3: 3.2, amort_day: 300, work_types: ["avo", "boiler", "pipeline"] },
  { id: "tank_10m3", name: "Ёмкость 10 м³ в кассете", category: "Ёмкости", weight_kg: 800, volume_m3: 10.5, amort_day: 500, work_types: ["tank", "boiler", "pipeline"] },
  { id: "barrel_48l", name: "Бочка евро 48 л", category: "Ёмкости", weight_kg: 5, volume_m3: 0.05, amort_day: 20, work_types: ["heat_exchanger", "boiler"] },
  
  // === ШЛАНГИ РВД ===
  { id: "hose_180bar", name: "РВД 180 бар 20м", category: "Шланги", weight_kg: 15, volume_m3: 0.03, amort_day: 100, work_types: ["heat_exchanger", "heating_system"] },
  { id: "hose_250bar", name: "РВД 250 бар 20м", category: "Шланги", weight_kg: 18, volume_m3: 0.04, amort_day: 120, work_types: ["heat_exchanger", "avo"] },
  { id: "hose_450bar", name: "РВД 450 бар 15м", category: "Шланги", weight_kg: 20, volume_m3: 0.04, amort_day: 150, work_types: ["avo", "cooling_tower"] },
  { id: "hose_1100bar", name: "РВД 1100 бар 20м", category: "Шланги", weight_kg: 35, volume_m3: 0.06, amort_day: 300, work_types: ["avo", "pipeline"] },
  { id: "hose_chem", name: "Шланг химстойкий 25м", category: "Шланги", weight_kg: 12, volume_m3: 0.03, amort_day: 80, work_types: ["heat_exchanger", "boiler", "commissioning"] },
  
  // === ПРИБОРЫ ===
  { id: "ph_meter", name: "pH-метр HMDigital PH-200", category: "Приборы", weight_kg: 0.5, volume_m3: 0.001, amort_day: 50, work_types: ["heat_exchanger", "boiler", "commissioning"] },
  { id: "gas_4ch", name: "Газоанализатор GasAlert 4-канальный", category: "Приборы", weight_kg: 0.8, volume_m3: 0.002, amort_day: 150, work_types: ["tank", "pipeline"] },
  { id: "gas_h2s", name: "Газоанализатор SENKO H2S", category: "Приборы", weight_kg: 0.3, volume_m3: 0.001, amort_day: 80, work_types: ["tank", "pipeline"] },
  { id: "gas_o2", name: "Газоанализатор SENKO O2", category: "Приборы", weight_kg: 0.3, volume_m3: 0.001, amort_day: 80, work_types: ["tank", "pipeline"] },
  { id: "gas_kolion", name: "Газоанализатор КОЛИОН-1В Ex", category: "Приборы", weight_kg: 1.2, volume_m3: 0.003, amort_day: 200, work_types: ["tank", "pipeline"] },
  { id: "manometer", name: "Манометр поверенный", category: "Приборы", weight_kg: 0.5, volume_m3: 0.001, amort_day: 30, work_types: ["heat_exchanger", "boiler", "pipeline"] },
  { id: "thermometer", name: "Термометр инфракрасный", category: "Приборы", weight_kg: 0.3, volume_m3: 0.001, amort_day: 30, work_types: ["heat_exchanger", "boiler"] },
  { id: "testo_330", name: "Анализатор дымовых газов TESTO 330", category: "Приборы", weight_kg: 2, volume_m3: 0.01, amort_day: 300, work_types: ["boiler"] },
  { id: "endoscope", name: "Видеоэндоскоп Yartek", category: "Приборы", weight_kg: 1, volume_m3: 0.005, amort_day: 200, work_types: ["heat_exchanger", "pipeline"] },
  { id: "laser_range", name: "Лазерный дальномер BOSCH 80м", category: "Приборы", weight_kg: 0.2, volume_m3: 0.001, amort_day: 50, work_types: ["tank", "cooling_tower", "ventilation"] },
  
  // === ВЕНТИЛЯЦИЯ И ОБОГРЕВ ===
  { id: "ventilator_ex", name: "Вентилятор взрывозащищённый SHT-30-EX", category: "Вентиляция", weight_kg: 35, volume_m3: 0.15, amort_day: 300, work_types: ["tank", "pipeline"] },
  { id: "ventilator_radial", name: "Вентилятор радиальный ВР 280-46", category: "Вентиляция", weight_kg: 80, volume_m3: 0.4, amort_day: 400, work_types: ["tank"] },
  { id: "duct_flex", name: "Воздуховод гибкий антистат. d300 10м", category: "Вентиляция", weight_kg: 8, volume_m3: 0.1, amort_day: 50, work_types: ["tank", "pipeline"] },
  { id: "heater_diesel", name: "Пушка тепловая дизельная 20кВт", category: "Обогрев", weight_kg: 25, volume_m3: 0.15, amort_day: 400, work_types: ["heat_exchanger", "boiler", "tank"] },
  { id: "heater_electric", name: "Нагреватель греющий кабель ЭНГЛУ", category: "Обогрев", weight_kg: 10, volume_m3: 0.05, amort_day: 150, work_types: ["pipeline"] },
  { id: "water_heater", name: "Водонагреватель ARISTON 15л", category: "Обогрев", weight_kg: 8, volume_m3: 0.02, amort_day: 100, work_types: ["heating_system"] },
  
  // === ТАКЕЛАЖ ===
  { id: "winch_500", name: "Лебёдка электрическая 0.5/1.0 т", category: "Такелаж", weight_kg: 40, volume_m3: 0.1, amort_day: 200, work_types: ["tank", "cooling_tower"] },
  { id: "winch_manual", name: "Лебёдка ручная рычажная 2.5 т", category: "Такелаж", weight_kg: 15, volume_m3: 0.03, amort_day: 50, work_types: ["heat_exchanger", "avo"] },
  { id: "winch_tripod", name: "Лебёдка для трипода 25м", category: "Такелаж", weight_kg: 12, volume_m3: 0.02, amort_day: 100, work_types: ["tank"] },
  { id: "sling_chain", name: "Строп цепной 4-ветвевой 2.4т", category: "Такелаж", weight_kg: 25, volume_m3: 0.03, amort_day: 30, work_types: ["heat_exchanger", "tank"] },
  { id: "sling_textile", name: "Строп текстильный петлевой 5т", category: "Такелаж", weight_kg: 3, volume_m3: 0.01, amort_day: 20, work_types: ["heat_exchanger", "avo"] },
  { id: "jack_hydraulic", name: "Домкрат гидравлический 10т", category: "Такелаж", weight_kg: 15, volume_m3: 0.02, amort_day: 50, work_types: ["heat_exchanger"] },
  { id: "roller_block", name: "Блок-ролик одинарный 46кН", category: "Такелаж", weight_kg: 5, volume_m3: 0.01, amort_day: 30, work_types: ["tank", "cooling_tower"] },
  
  // === ЭЛЕКТРОИНСТРУМЕНТ ===
  { id: "welder_tig", name: "Сварочный TIG 315 AC/DC", category: "Сварка", weight_kg: 35, volume_m3: 0.15, amort_day: 500, work_types: ["heat_exchanger", "pipeline"] },
  { id: "drill", name: "Дрель STURM 1300Вт", category: "Электроинструмент", weight_kg: 4, volume_m3: 0.02, amort_day: 80, work_types: ["heat_exchanger", "ventilation"] },
  { id: "impact_wrench", name: "Гайковёрт пневм. ударный 1\" 2440 Нм", category: "Электроинструмент", weight_kg: 8, volume_m3: 0.02, amort_day: 150, work_types: ["heat_exchanger", "pipeline"] },
  { id: "angle_grinder", name: "Болгарка 230мм", category: "Электроинструмент", weight_kg: 6, volume_m3: 0.02, amort_day: 100, work_types: ["pipeline", "tank"] },
  { id: "pipe_cutter", name: "Труборез роликовый", category: "Электроинструмент", weight_kg: 3, volume_m3: 0.01, amort_day: 50, work_types: ["pipeline", "heating_system"] },
  { id: "torque_wrench", name: "Динамометрический ключ 42-210 Нм", category: "Электроинструмент", weight_kg: 2, volume_m3: 0.01, amort_day: 50, work_types: ["heat_exchanger"] },
  
  // === СИЗ И БЕЗОПАСНОСТЬ ===
  { id: "scba_drager", name: "ДАСВ Drager PSS 5000", category: "СИЗОД", weight_kg: 15, volume_m3: 0.05, amort_day: 300, work_types: ["tank", "pipeline"] },
  { id: "scba_psh", name: "Шланговый аппарат ПШ-20 20м", category: "СИЗОД", weight_kg: 8, volume_m3: 0.03, amort_day: 150, work_types: ["tank"] },
  { id: "respirator", name: "Полумаска UNIX изолирующая", category: "СИЗОД", weight_kg: 0.5, volume_m3: 0.002, amort_day: 30, work_types: ["heat_exchanger", "boiler"] },
  { id: "gas_mask", name: "Противогаз ПШ-2Бп", category: "СИЗОД", weight_kg: 1.5, volume_m3: 0.005, amort_day: 50, work_types: ["tank", "pipeline"] },
  { id: "rescue_device", name: "Спасательное устройство Питон", category: "Безопасность", weight_kg: 8, volume_m3: 0.02, amort_day: 100, work_types: ["tank", "cooling_tower"] },
  { id: "tripod", name: "Тренога спасательная", category: "Безопасность", weight_kg: 25, volume_m3: 0.15, amort_day: 150, work_types: ["tank"] },
  { id: "anchor_loop", name: "Анкерная петля", category: "Безопасность", weight_kg: 0.5, volume_m3: 0.001, amort_day: 20, work_types: ["tank", "cooling_tower"] },
  { id: "emergency_shower", name: "Аварийный душ", category: "Безопасность", weight_kg: 20, volume_m3: 0.1, amort_day: 50, work_types: ["heat_exchanger", "boiler"] },
  { id: "fire_extinguisher", name: "Огнетушитель ОУ-3", category: "Безопасность", weight_kg: 8, volume_m3: 0.02, amort_day: 30, work_types: ["tank", "pipeline"] },
  
  // === ОСВЕЩЕНИЕ ===
  { id: "headlamp", name: "Налобный фонарь Petzl PIXA", category: "Освещение", weight_kg: 0.2, volume_m3: 0.001, amort_day: 30, work_types: ["tank", "pipeline", "ventilation"] },
  { id: "flashlight_ex", name: "Фонарь взрывозащищённый ФРВС", category: "Освещение", weight_kg: 0.8, volume_m3: 0.002, amort_day: 50, work_types: ["tank", "pipeline"] },
  { id: "floodlight", name: "Прожектор светодиодный 100Вт", category: "Освещение", weight_kg: 5, volume_m3: 0.02, amort_day: 50, work_types: ["tank", "cooling_tower"] },
  
  // === ЛЕСТНИЦЫ И ПОДМОСТИ ===
  { id: "ladder_3x10", name: "Лестница 3-секц. алюм. 3х10", category: "Подмости", weight_kg: 25, volume_m3: 0.3, amort_day: 80, work_types: ["avo", "cooling_tower", "ventilation"] },
  { id: "scaffold", name: "Подмости передвижные h=4м", category: "Подмости", weight_kg: 120, volume_m3: 1.5, amort_day: 200, rent_day: 800, work_types: ["avo", "cooling_tower"] },
  { id: "platform", name: "Тележка-платформа 680х1250", category: "Подмости", weight_kg: 40, volume_m3: 0.5, amort_day: 50, work_types: ["heat_exchanger", "tank"] },
  
  // === СПЕЦИНСТРУМЕНТ ===
  { id: "nitrogen_gun", name: "Азотная пневмопушка ИСТА 3л", category: "Спецоборудование", weight_kg: 5, volume_m3: 0.02, amort_day: 100, work_types: ["pipeline"] },
  { id: "pig_launcher", name: "Камера пуска/приёма поршней", category: "Спецоборудование", weight_kg: 200, volume_m3: 0.8, amort_day: 500, work_types: ["pipeline"] },
  { id: "brush_machine", name: "Щёточная машина для воздуховодов", category: "Спецоборудование", weight_kg: 30, volume_m3: 0.2, amort_day: 400, work_types: ["ventilation"] },
  { id: "vacuum_industrial", name: "Промышленный пылесос", category: "Спецоборудование", weight_kg: 50, volume_m3: 0.3, amort_day: 200, work_types: ["ventilation", "tank"] },
  { id: "pipe_roller", name: "Вальцеватель труб Neptun", category: "Спецоборудование", weight_kg: 15, volume_m3: 0.05, amort_day: 150, work_types: ["heat_exchanger"] },
  
  // === ГЕНЕРАТОРЫ ===
  { id: "generator_20kw", name: "Генератор дизельный 20кВт", category: "Электроснабжение", weight_kg: 500, volume_m3: 1.5, amort_day: 1500, rent_day: 5000, work_types: ["tank", "pipeline", "cooling_tower"] },
  { id: "extension_50m", name: "Удлинитель силовой 50м 16А", category: "Электроснабжение", weight_kg: 15, volume_m3: 0.05, amort_day: 50, work_types: ["heat_exchanger", "boiler", "tank"] }
];

// Функция получения оборудования по типу работы
window.getEquipmentForWorkType = function(workTypeId) {
  return CALC_EQUIPMENT.filter(e => 
    !e.work_types || e.work_types.length === 0 || e.work_types.includes(workTypeId)
  );
};

// Функция расчёта стоимости оборудования
window.calcEquipmentCost = function(equipmentList, workDays) {
  let total = 0;
  let totalWeight = 0;
  let totalVolume = 0;
  
  for (const item of equipmentList) {
    const eq = CALC_EQUIPMENT.find(e => e.id === item.id);
    if (!eq) continue;
    
    const qty = item.qty || 1;
    const days = workDays || 10;
    
    // Если есть аренда — используем её, иначе амортизацию
    const dayRate = item.rent ? (eq.rent_day || 0) : (eq.amort_day || 0);
    total += dayRate * days * qty;
    totalWeight += eq.weight_kg * qty;
    totalVolume += eq.volume_m3 * qty;
  }
  
  return { total, totalWeight, totalVolume };
};

console.log('[CALC] Equipment loaded:', CALC_EQUIPMENT.length, 'items');
