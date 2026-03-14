-- ═══════════════════════════════════════════════════════════════════════════
-- V032: Site Inspections & Business Trips Module
-- Модуль "Осмотр объекта" + Командировки
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Заявки на осмотр объекта
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_inspections (
    id SERIAL PRIMARY KEY,

    -- Связи
    work_id       INTEGER REFERENCES works(id) ON DELETE SET NULL,
    estimate_id   INTEGER REFERENCES estimates(id) ON DELETE SET NULL,
    tender_id     INTEGER REFERENCES tenders(id) ON DELETE SET NULL,

    -- Статус workflow:
    -- draft → sent → approved / rejected → trip_planned → trip_sent → completed
    status VARCHAR(50) NOT NULL DEFAULT 'draft',

    -- Данные объекта
    object_name              VARCHAR(500),
    object_address           TEXT,
    customer_name            VARCHAR(500),
    customer_contact_person  VARCHAR(255),
    customer_contact_email   VARCHAR(255),
    customer_contact_phone   VARCHAR(100),

    -- Возможные даты осмотра (JSON массив)
    -- [{date: "2026-03-01", time_from: "10:00", time_to: "17:00"}, ...]
    inspection_dates JSONB DEFAULT '[]',

    -- Сотрудники (JSON массив)
    -- [{employee_id, fio, position, passport_series, passport_number, phone}, ...]
    employees_json JSONB DEFAULT '[]',

    -- Транспорт (JSON массив)
    -- [{brand, model, plate_number, driver_fio}, ...]
    vehicles_json JSONB DEFAULT '[]',

    -- Примечания
    notes TEXT,

    -- Служебные
    author_id     INTEGER REFERENCES users(id),
    approved_by   INTEGER,
    approved_at   TIMESTAMP,
    rejected_at   TIMESTAMP,
    rejected_reason TEXT,
    sent_at       TIMESTAMP,
    email_sent_to VARCHAR(255),

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Командировки на осмотр
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_trips (
    id SERIAL PRIMARY KEY,

    -- Связи
    inspection_id INTEGER REFERENCES site_inspections(id) ON DELETE SET NULL,
    work_id       INTEGER REFERENCES works(id) ON DELETE SET NULL,

    -- Статус: draft → sent → approved → completed
    status VARCHAR(50) NOT NULL DEFAULT 'draft',

    -- Даты
    date_from DATE,
    date_to   DATE,

    -- Сотрудники (JSON)
    -- [{employee_id, fio, position}, ...]
    employees_json JSONB DEFAULT '[]',

    -- Способ передвижения: auto, rail, air, mixed
    transport_type VARCHAR(50),

    -- Потребности
    need_fuel_card  BOOLEAN DEFAULT false,
    need_air_ticket BOOLEAN DEFAULT false,
    need_advance    BOOLEAN DEFAULT false,
    advance_amount  NUMERIC(15,2),

    -- Детали билетов
    ticket_details TEXT,

    -- Связи с другими модулями
    cash_request_id INTEGER,          -- связь с заявкой на аванс
    expense_ids     JSONB DEFAULT '[]', -- связь с расходами

    -- Служебные
    author_id                 INTEGER REFERENCES users(id),
    sent_to_office_manager    BOOLEAN DEFAULT false,
    office_manager_notified_at TIMESTAMP,
    approved_by               INTEGER,
    approved_at               TIMESTAMP,

    notes      TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Индексы
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_site_inspections_work   ON site_inspections(work_id);
CREATE INDEX IF NOT EXISTS idx_site_inspections_tender ON site_inspections(tender_id);
CREATE INDEX IF NOT EXISTS idx_site_inspections_status ON site_inspections(status);
CREATE INDEX IF NOT EXISTS idx_site_inspections_author ON site_inspections(author_id);

CREATE INDEX IF NOT EXISTS idx_business_trips_inspection ON business_trips(inspection_id);
CREATE INDEX IF NOT EXISTS idx_business_trips_work       ON business_trips(work_id);
CREATE INDEX IF NOT EXISTS idx_business_trips_status     ON business_trips(status);

COMMIT;
