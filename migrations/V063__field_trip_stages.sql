-- ═══════════════════════════════════════════════════════════════
-- V063: Field Trip Stages — этапы командировки (медосмотр, дорога, ожидание, склад, выходной)
-- Session 12
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS field_trip_stages (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    work_id INTEGER NOT NULL REFERENCES works(id),
    assignment_id INTEGER REFERENCES employee_assignments(id),

    -- Тип этапа
    stage_type VARCHAR(30) NOT NULL,
    -- 'medical'       — медосмотр
    -- 'travel'        — дорога (любой транспорт)
    -- 'waiting'       — ожидание (ТОЛЬКО вне дома)
    -- 'warehouse'     — работа на складе
    -- 'day_off'       — выходной в командировке
    -- 'object'        — объект (связь с field_checkins)

    -- Дата (один этап = один день ИЛИ диапазон дней)
    date_from DATE NOT NULL,
    date_to DATE,                      -- NULL = один день
    days_count INTEGER DEFAULT 1,      -- кол-во дней (рассчитывается)

    -- Тариф
    tariff_id INTEGER REFERENCES field_tariff_grid(id),
    tariff_points INTEGER NOT NULL,
    rate_per_day DECIMAL(10,2) NOT NULL,
    amount_earned DECIMAL(12,2),       -- = days_count × rate_per_day

    -- Детали (JSONB)
    details JSONB DEFAULT '{}',

    -- Привязка к логистике (билет → дорога)
    logistics_id INTEGER REFERENCES field_logistics(id),

    -- Источник отметки
    source VARCHAR(20) DEFAULT 'self',
    source_employee_id INTEGER,

    -- Статус и подтверждение
    status VARCHAR(20) DEFAULT 'active',
    days_approved INTEGER,
    approved_by INTEGER,
    approved_at TIMESTAMP,
    adjustment_note TEXT,

    -- Фото-подтверждение
    photo_filename VARCHAR(255),
    photo_original VARCHAR(255),

    -- Мета
    note TEXT,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_stages_emp_work ON field_trip_stages(employee_id, work_id);
CREATE INDEX IF NOT EXISTS idx_trip_stages_work_date ON field_trip_stages(work_id, date_from);
CREATE INDEX IF NOT EXISTS idx_trip_stages_status ON field_trip_stages(work_id, status);

-- Уникальность: один сотрудник не может иметь два активных этапа одного типа на один день
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_stages_unique_day
    ON field_trip_stages(employee_id, work_id, stage_type, date_from)
    WHERE status NOT IN ('rejected');
