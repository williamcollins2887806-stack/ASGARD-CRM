-- ============================================
-- V040: Equipment Premium (FaceKit)
-- Комплекты, привязка к работам, фото-верификация
-- ============================================

-- 1. Комплекты оборудования (наборы для работ)
CREATE TABLE IF NOT EXISTS equipment_kits (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  code VARCHAR(50),
  description TEXT,
  work_type VARCHAR(100),           -- тип работы (heat_exchanger, boiler, etc.)
  icon VARCHAR(10) DEFAULT '🧰',
  photo_url TEXT,
  is_template BOOLEAN DEFAULT false, -- шаблон-комплект (не привязан к конкретному оборудованию)
  is_active BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Элементы комплекта
CREATE TABLE IF NOT EXISTS equipment_kit_items (
  id SERIAL PRIMARY KEY,
  kit_id INTEGER NOT NULL REFERENCES equipment_kits(id) ON DELETE CASCADE,
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL,  -- конкретная единица (для реальных комплектов)
  category_id INTEGER REFERENCES equipment_categories(id),           -- категория (для шаблонов)
  item_name VARCHAR(200),            -- название позиции (для шаблонов)
  quantity INTEGER DEFAULT 1,
  is_required BOOLEAN DEFAULT true,  -- обязательная позиция
  sort_order INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kit_items_kit ON equipment_kit_items(kit_id);
CREATE INDEX IF NOT EXISTS idx_kit_items_equipment ON equipment_kit_items(equipment_id);

-- 3. Привязка оборудования к работам
CREATE TABLE IF NOT EXISTS equipment_work_assignments (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TIMESTAMP DEFAULT NOW(),
  returned_at TIMESTAMP,
  condition_on_assign VARCHAR(50),
  condition_on_return VARCHAR(50),
  photo_assign TEXT[],               -- фото при выдаче
  photo_return TEXT[],               -- фото при возврате
  notes TEXT,
  status VARCHAR(30) DEFAULT 'active', -- active, returned, lost
  UNIQUE(equipment_id, work_id, assigned_at)
);

CREATE INDEX IF NOT EXISTS idx_ewa_work ON equipment_work_assignments(work_id);
CREATE INDEX IF NOT EXISTS idx_ewa_equipment ON equipment_work_assignments(equipment_id);
CREATE INDEX IF NOT EXISTS idx_ewa_status ON equipment_work_assignments(status);

-- 4. Фото-верификация при перемещениях
ALTER TABLE equipment_movements ADD COLUMN IF NOT EXISTS verification_photos TEXT[];
ALTER TABLE equipment_movements ADD COLUMN IF NOT EXISTS checklist JSONB;

-- 5. Добавляем поле photo_url в equipment если нет
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- 6. Добавляем recommended_kit_id для быстрого подбора
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS kit_id INTEGER REFERENCES equipment_kits(id);

-- 7. Категория для расходников (consumables tracking)
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS min_stock_level INTEGER DEFAULT 0;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS reorder_point INTEGER DEFAULT 0;

-- 8. Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status) WHERE status != 'written_off';
CREATE INDEX IF NOT EXISTS idx_equipment_category ON equipment(category_id);
CREATE INDEX IF NOT EXISTS idx_equipment_holder ON equipment(current_holder_id) WHERE current_holder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_warehouse ON equipment(warehouse_id) WHERE warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_work ON equipment(work_id) WHERE work_id IS NOT NULL;

-- 9. Вставляем шаблоны комплектов по типам работ
INSERT INTO equipment_kits (name, code, work_type, icon, is_template, description) VALUES
  ('Комплект ХИМ-промывка теплообменника', 'KIT-HE-CHEM', 'heat_exchanger', '🧪', true, 'Стандартный набор для химической промывки теплообменного оборудования'),
  ('Комплект ГДП теплообменника', 'KIT-HE-HDP', 'heat_exchanger', '💧', true, 'Набор для гидродинамической промывки теплообменников'),
  ('Комплект АВО', 'KIT-AVO', 'avo', '🌬️', true, 'Набор для промывки аппаратов воздушного охлаждения'),
  ('Комплект Котельная', 'KIT-BOILER', 'boiler', '🔥', true, 'Набор для промывки и обслуживания котельного оборудования'),
  ('Комплект Резервуар (ЗВС)', 'KIT-TANK', 'tank', '🛢️', true, 'Набор для зачистки вертикальных стальных резервуаров'),
  ('Комплект Трубопровод', 'KIT-PIPE', 'pipeline', '🔩', true, 'Набор для промывки и диагностики трубопроводов'),
  ('Комплект Вентиляция', 'KIT-VENT', 'ventilation', '💨', true, 'Набор для чистки систем вентиляции и воздуховодов'),
  ('Комплект Градирня', 'KIT-COOL', 'cooling_tower', '❄️', true, 'Набор для обслуживания градирен'),
  ('Комплект Отопление', 'KIT-HEAT', 'heating_system', '🏠', true, 'Набор для промывки систем отопления'),
  ('Комплект ПНР', 'KIT-COMM', 'commissioning', '⚡', true, 'Набор для пуско-наладочных работ'),
  ('Комплект СИЗ базовый', 'KIT-PPE-BASE', NULL, '🦺', true, 'Базовый комплект средств индивидуальной защиты'),
  ('Комплект СИЗ ЗВС', 'KIT-PPE-TANK', 'tank', '⛑️', true, 'Расширенный комплект СИЗ для работ в замкнутых пространствах')
ON CONFLICT DO NOTHING;

-- 10. Шаблонные позиции для комплекта "ХИМ-промывка теплообменника"
INSERT INTO equipment_kit_items (kit_id, category_id, item_name, quantity, is_required, sort_order)
SELECT k.id, NULL, item.name, item.qty, item.req, item.ord
FROM equipment_kits k
CROSS JOIN (VALUES
  ('Насос химический мембранный', 1, true, 1),
  ('Ёмкость 1-3 м³', 1, true, 2),
  ('Шланг химстойкий 25м', 2, true, 3),
  ('pH-метр', 1, true, 4),
  ('Манометр поверенный', 2, true, 5),
  ('Термометр инфракрасный', 1, false, 6),
  ('Бочка евро 48л', 4, false, 7),
  ('Удлинитель силовой 50м', 1, false, 8),
  ('Огнетушитель ОУ-3', 1, true, 9),
  ('Аварийный душ', 1, true, 10)
) AS item(name, qty, req, ord)
WHERE k.code = 'KIT-HE-CHEM'
ON CONFLICT DO NOTHING;

-- 11. Шаблонные позиции для комплекта "Резервуар (ЗВС)"
INSERT INTO equipment_kit_items (kit_id, category_id, item_name, quantity, is_required, sort_order)
SELECT k.id, NULL, item.name, item.qty, item.req, item.ord
FROM equipment_kits k
CROSS JOIN (VALUES
  ('Насос шламовый', 1, true, 1),
  ('Насос погружной', 1, true, 2),
  ('Вентилятор взрывозащищённый', 1, true, 3),
  ('Воздуховод гибкий d300 10м', 2, true, 4),
  ('Газоанализатор 4-канальный', 1, true, 5),
  ('Газоанализатор H2S', 1, true, 6),
  ('Газоанализатор O2', 1, true, 7),
  ('ДАСВ Drager PSS 5000', 2, true, 8),
  ('Тренога спасательная', 1, true, 9),
  ('Спасательное устройство Питон', 1, true, 10),
  ('Лебёдка для трипода 25м', 1, true, 11),
  ('Фонарь взрывозащищённый', 4, true, 12),
  ('Налобный фонарь Petzl', 4, true, 13),
  ('Прожектор 100Вт', 2, false, 14),
  ('Генератор дизельный 20кВт', 1, false, 15),
  ('Огнетушитель ОУ-3', 2, true, 16)
) AS item(name, qty, req, ord)
WHERE k.code = 'KIT-TANK'
ON CONFLICT DO NOTHING;

-- V040: Equipment Premium (FaceKit) — OK
