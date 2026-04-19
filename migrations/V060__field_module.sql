-- ═══════════════════════════════════════════════════════════
-- V060: ASGARD Field Module
-- ═══════════════════════════════════════════════════════════

-- 1. SMS auth codes
CREATE TABLE IF NOT EXISTS field_auth_codes (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    employee_id INTEGER REFERENCES employees(id),
    attempts INTEGER DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_auth_phone ON field_auth_codes(phone, used, expires_at);

-- 2. Field sessions (JWT)
CREATE TABLE IF NOT EXISTS field_sessions (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    device_info TEXT,
    push_subscription JSONB,
    last_active_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_sessions_employee ON field_sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_field_sessions_token ON field_sessions(token_hash);

-- 3. Checkins
CREATE TABLE IF NOT EXISTS field_checkins (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    work_id INTEGER NOT NULL REFERENCES works(id),
    assignment_id INTEGER REFERENCES employee_assignments(id),
    checkin_at TIMESTAMP NOT NULL,
    checkin_lat DECIMAL(10,7),
    checkin_lng DECIMAL(10,7),
    checkin_accuracy DECIMAL(8,2),
    checkin_source VARCHAR(20) DEFAULT 'self',
    checkin_by INTEGER,
    checkout_at TIMESTAMP,
    checkout_lat DECIMAL(10,7),
    checkout_lng DECIMAL(10,7),
    checkout_accuracy DECIMAL(8,2),
    checkout_source VARCHAR(20),
    checkout_by INTEGER,
    hours_worked DECIMAL(5,2),
    hours_paid DECIMAL(5,2),
    day_rate DECIMAL(12,2),
    amount_earned DECIMAL(12,2),
    date DATE NOT NULL,
    shift VARCHAR(20) DEFAULT 'day',
    status VARCHAR(20) DEFAULT 'active',
    edit_reason TEXT,
    note TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_checkins_emp_date ON field_checkins(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_field_checkins_work ON field_checkins(work_id, date);

-- 4. Report templates (must be before daily_reports due to FK)
CREATE TABLE IF NOT EXISTS field_report_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    fields JSONB NOT NULL DEFAULT '[]',
    progress_unit VARCHAR(50),
    progress_field VARCHAR(50),
    progress_total INTEGER,
    work_type VARCHAR(100),
    is_default BOOLEAN DEFAULT FALSE,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Daily reports
CREATE TABLE IF NOT EXISTS field_daily_reports (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    date DATE NOT NULL,
    shift VARCHAR(20) DEFAULT 'day',
    author_id INTEGER NOT NULL REFERENCES employees(id),
    author_role VARCHAR(50),
    template_id INTEGER REFERENCES field_report_templates(id),
    report_data JSONB NOT NULL DEFAULT '{}',
    crew_snapshot JSONB,
    downtime_minutes INTEGER DEFAULT 0,
    downtime_reason TEXT,
    status VARCHAR(20) DEFAULT 'draft',
    accepted_by INTEGER,
    accepted_at TIMESTAMP,
    comment TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_reports_work ON field_daily_reports(work_id, date);

-- 6. Photos
CREATE TABLE IF NOT EXISTS field_photos (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    work_id INTEGER NOT NULL REFERENCES works(id),
    report_id INTEGER REFERENCES field_daily_reports(id),
    checkin_id INTEGER REFERENCES field_checkins(id),
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255),
    mime_type VARCHAR(50),
    size INTEGER,
    photo_type VARCHAR(30) DEFAULT 'work',
    caption TEXT,
    lat DECIMAL(10,7),
    lng DECIMAL(10,7),
    taken_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_photos_work ON field_photos(work_id, created_at);

-- 7. Incidents
CREATE TABLE IF NOT EXISTS field_incidents (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    reported_by INTEGER NOT NULL REFERENCES employees(id),
    incident_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP,
    duration_minutes INTEGER,
    severity VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'open',
    resolution TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 8. SMS log
CREATE TABLE IF NOT EXISTS field_sms_log (
    id SERIAL PRIMARY KEY,
    work_id INTEGER REFERENCES works(id),
    employee_id INTEGER REFERENCES employees(id),
    phone VARCHAR(20) NOT NULL,
    message_type VARCHAR(50) NOT NULL,
    message_text TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'sent',
    mango_response JSONB,
    sent_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 9. Logistics
CREATE TABLE IF NOT EXISTS field_logistics (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    trip_id INTEGER REFERENCES business_trips(id),
    item_type VARCHAR(30) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    date_from DATE,
    date_to DATE,
    details JSONB DEFAULT '{}',
    document_id INTEGER REFERENCES documents(id),
    status VARCHAR(30) DEFAULT 'pending',
    sent_to_employee BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_logistics_work ON field_logistics(work_id);
CREATE INDEX IF NOT EXISTS idx_field_logistics_emp ON field_logistics(employee_id);

-- 10. Project settings
CREATE TABLE IF NOT EXISTS field_project_settings (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL UNIQUE REFERENCES works(id),
    is_active BOOLEAN DEFAULT TRUE,
    activated_at TIMESTAMP,
    activated_by INTEGER,
    report_template_id INTEGER REFERENCES field_report_templates(id),
    site_category VARCHAR(50) DEFAULT 'ground',
    schedule_type VARCHAR(20) DEFAULT 'shift',
    shift_hours DECIMAL(4,1) DEFAULT 11.0,
    rounding_rule VARCHAR(20) DEFAULT 'half_up',
    rounding_step DECIMAL(3,1) DEFAULT 0.5,
    per_diem DECIMAL(10,2) DEFAULT 0,
    object_lat DECIMAL(10,7),
    object_lng DECIMAL(10,7),
    geo_radius_meters INTEGER DEFAULT 500,
    geo_required BOOLEAN DEFAULT FALSE,
    shift_start_reminder VARCHAR(5),
    daily_report_reminder VARCHAR(5),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 11. Tariff grid (approved by Kudryashov O.S. 01.10.2025)
CREATE TABLE IF NOT EXISTS field_tariff_grid (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    position_name VARCHAR(255) NOT NULL,
    points INTEGER NOT NULL,
    rate_per_shift DECIMAL(10,2) NOT NULL,
    point_value DECIMAL(10,2) DEFAULT 500.00,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    is_combinable BOOLEAN DEFAULT FALSE,
    requires_approval BOOLEAN DEFAULT FALSE,
    notes TEXT,
    approved_by VARCHAR(255) DEFAULT 'Кудряшов О.С.',
    approved_at DATE DEFAULT '2025-10-01',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed: MLSP (marine platforms)
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order, notes) VALUES
('mlsp', 'Новичок на испытательном сроке', 14, 7000, 1, NULL),
('mlsp', 'Новичок по окончанию испытательного срока', 15, 7500, 2, NULL),
('mlsp', 'Слесарь-монтажник (первый заезд)', 16, 8000, 3, NULL),
('mlsp', 'Слесарь (полный функционал, от второго заезда)', 17, 8500, 4, NULL),
('mlsp', 'Слесарь/чистельщик (высокая нагрузка, персональная)', 18, 9000, 5, 'Ставка персональная'),
('mlsp', 'Мастер сменный (второй)', 19, 9500, 6, NULL),
('mlsp', 'Мастер ПТО', 19, 9500, 7, NULL),
('mlsp', 'Мастер ответственный (основной, первый)', 21, 10500, 8, NULL),
('mlsp', 'Трансфер на корабле', 12, 6000, 9, 'За трансфер'),
('mlsp', 'Трансфер на вертолёте', 6, 3000, 10, 'За трансфер');

-- Seed: Ground (regular sites)
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order) VALUES
('ground', 'Слесарь (полный функционал)', 11, 5500, 1),
('ground', 'Мастер сменный (второй)', 12, 6000, 2),
('ground', 'Мастер ответственный (основной, первый)', 14, 7000, 3);

-- Seed: Ground hard conditions (temporary camps)
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order) VALUES
('ground_hard', 'Слесарь (полный функционал)', 13, 6500, 1),
('ground_hard', 'Мастер сменный (второй)', 14, 7000, 2),
('ground_hard', 'Мастер ответственный (основной, первый)', 16, 8000, 3);

-- Seed: Warehouse
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order) VALUES
('warehouse', 'Слесарь (полный функционал)', 10, 5000, 1),
('warehouse', 'Мастер ответственный (основной, первый)', 12, 6000, 2);

-- Seed: Combinations (+1 point, requires approval)
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order, is_combinable, requires_approval, notes) VALUES
('ground', 'Совмещение: сварщик/водитель/электрик', 1, 500, 10, TRUE, TRUE, '+1 балл к основному тарифу'),
('ground_hard', 'Совмещение: сварщик/водитель/электрик', 1, 500, 10, TRUE, TRUE, '+1 балл к основному тарифу'),
('warehouse', 'Совмещение: мастер/сварщик/водитель/электрик', 1, 500, 10, TRUE, TRUE, '+1 балл к основному тарифу');

-- Seed: Special rates (common for all categories)
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order, notes) VALUES
('special', 'Выходной в командировке (карантин, дорога, нерабочий день)', 6, 3000, 1, 'Применяется ко всем категориям'),
('special', 'Обучение / прохождение мед. осмотра', 7, 3500, 2, NULL),
('special', 'Дорога и ожидание', 6, 3000, 3, NULL),
('special', 'Пайковые (суточные)', 0, 1000, 4, '1000 руб/сут, не в баллах'),
('special', 'Переработка (сверх нормы)', 0, 0, 5, 'По согласованию с директором');

-- Seed: Default report templates
INSERT INTO field_report_templates (name, work_type, fields, progress_unit, progress_field, is_default) VALUES
('Гидромеханическая чистка', 'hydromechanical',
 '[{"key":"apparatus","label":"Аппарат","type":"select","options":["1","2"],"required":true},{"key":"tubes_done","label":"Трубок пробурено","type":"number","required":true},{"key":"diameter","label":"Диаметр, мм","type":"select","options":["20","25","30","33"]},{"key":"notes","label":"Примечания","type":"text"}]',
 'трубок', 'tubes_done', TRUE),
('Химическая чистка', 'chemical',
 '[{"key":"stage","label":"Этап","type":"select","options":["Щелочная промывка","Кислотный цикл 1","Кислотный цикл 2","Пассивация","Промывка"],"required":true},{"key":"temperature","label":"Температура, °C","type":"number"},{"key":"ph","label":"pH","type":"number"},{"key":"concentration","label":"Концентрация, %","type":"number"},{"key":"notes","label":"Примечания","type":"text"}]',
 NULL, NULL, TRUE),
('Монтаж ОВиК', 'hvac',
 '[{"key":"section","label":"Участок","type":"text","required":true},{"key":"work_type","label":"Тип работ","type":"select","options":["Монтаж воздуховодов","Монтаж оборудования","Обвязка","Пусконаладка"]},{"key":"progress_pct","label":"Выполнение, %","type":"number"},{"key":"notes","label":"Примечания","type":"text"}]',
 '%', 'progress_pct', TRUE),
('АВД / Гидродинамическая чистка', 'avd',
 '[{"key":"object_part","label":"Объект/участок","type":"text","required":true},{"key":"area_done","label":"Площадь, м²","type":"number","required":true},{"key":"pressure","label":"Давление, бар","type":"number"},{"key":"notes","label":"Примечания","type":"text"}]',
 'м²', 'area_done', TRUE);

-- ALTER existing tables: employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS field_pin VARCHAR(4);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS field_last_login TIMESTAMP;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS clothing_size VARCHAR(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shoe_size VARCHAR(10);

-- ALTER existing tables: employee_assignments
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS field_role VARCHAR(30) DEFAULT 'worker';
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS tariff_id INTEGER REFERENCES field_tariff_grid(id);
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS tariff_points INTEGER;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS combination_tariff_id INTEGER REFERENCES field_tariff_grid(id);
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS per_diem DECIMAL(10,2);
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS shift_type VARCHAR(20) DEFAULT 'day';
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS sms_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS sms_sent_at TIMESTAMP;
