-- V067: Worker Payments — единая таблица выплат рабочим
-- Типы: per_diem (суточные), salary (ЗП), advance (аванс на ЗП), bonus (премия), penalty (удержание)

CREATE TABLE IF NOT EXISTS worker_payments (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    work_id INTEGER REFERENCES works(id),

    -- Тип выплаты
    type VARCHAR(30) NOT NULL CHECK (type IN ('per_diem', 'salary', 'advance', 'bonus', 'penalty')),

    -- Период (для суточных и ЗП)
    period_from DATE,
    period_to DATE,
    pay_month INTEGER CHECK (pay_month BETWEEN 1 AND 12),
    pay_year INTEGER CHECK (pay_year BETWEEN 2020 AND 2099),

    -- Суммы
    amount NUMERIC(12,2) NOT NULL,

    -- Суточные: дни × ставка
    days INTEGER,
    rate_per_day NUMERIC(10,2),

    -- ЗП: баллы × стоимость балла
    total_points NUMERIC(10,2),
    point_value NUMERIC(10,2),
    works_detail JSONB,  -- [{work_id, work_title, days, points, amount}]

    -- Оплата
    payment_method VARCHAR(30),  -- cash, card, transfer
    paid_at TIMESTAMP,
    paid_by INTEGER REFERENCES users(id),

    -- Подтверждение рабочим
    confirmed_by_worker BOOLEAN DEFAULT false,
    confirmed_at TIMESTAMP,

    -- Статус
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'confirmed', 'cancelled')),
    comment TEXT,

    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_wp_employee ON worker_payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_wp_work ON worker_payments(work_id);
CREATE INDEX IF NOT EXISTS idx_wp_type ON worker_payments(type);
CREATE INDEX IF NOT EXISTS idx_wp_status ON worker_payments(status);
CREATE INDEX IF NOT EXISTS idx_wp_pay_period ON worker_payments(pay_year, pay_month);
CREATE INDEX IF NOT EXISTS idx_wp_created ON worker_payments(created_at DESC);
