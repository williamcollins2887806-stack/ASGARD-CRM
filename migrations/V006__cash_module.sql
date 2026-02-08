-- ═══════════════════════════════════════════════════════════════
-- V006: КАССА — Авансовые отчёты и расчёты с РП
-- ═══════════════════════════════════════════════════════════════

-- 1. Заявки на выдачу наличных
CREATE TABLE IF NOT EXISTS cash_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),          -- кто запрашивает (РП)
  work_id INTEGER REFERENCES works(id),                   -- привязка к проекту (NULL = личный долг)
  type VARCHAR(20) NOT NULL DEFAULT 'advance',             -- 'advance' = аванс на проект, 'loan' = долг до ЗП
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),        -- запрашиваемая сумма
  purpose TEXT NOT NULL,                                    -- цель / обоснование
  cover_letter TEXT,                                        -- сопроводительное письмо
  status VARCHAR(20) NOT NULL DEFAULT 'requested',         -- workflow statuses (see below)
  director_id INTEGER REFERENCES users(id),                -- кто согласовал/отклонил
  director_comment TEXT,                                    -- комментарий директора
  received_at TIMESTAMP,                                   -- когда РП подтвердил получение
  closed_at TIMESTAMP,                                     -- когда директор закрыл
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Статусы: requested → approved → received → reporting → closed
--                    → rejected (от approved)
--                    → question (директор задаёт вопрос, РП отвечает, возвращается в requested)

-- 2. Расходы по заявке (чеки)
CREATE TABLE IF NOT EXISTS cash_expenses (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES cash_requests(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,                                -- за что потрачено
  receipt_file VARCHAR(255),                                -- имя файла чека (UUID в uploads/)
  receipt_original_name VARCHAR(255),                       -- оригинальное имя файла
  expense_date DATE DEFAULT CURRENT_DATE,                   -- дата расхода
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Возвраты остатков
CREATE TABLE IF NOT EXISTS cash_returns (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES cash_requests(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note TEXT,                                                -- комментарий к возврату
  confirmed_by INTEGER REFERENCES users(id),               -- кто подтвердил приём возврата (директор)
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Диалог по заявке (вопросы/ответы между директором и РП)
CREATE TABLE IF NOT EXISTS cash_messages (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES cash_requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_cash_requests_user ON cash_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_requests_status ON cash_requests(status);
CREATE INDEX IF NOT EXISTS idx_cash_requests_work ON cash_requests(work_id);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_request ON cash_expenses(request_id);
CREATE INDEX IF NOT EXISTS idx_cash_returns_request ON cash_returns(request_id);
CREATE INDEX IF NOT EXISTS idx_cash_messages_request ON cash_messages(request_id);

-- 5. Регистрация модуля в справочнике M1
INSERT INTO modules (key, label, description, category, icon, sort_order)
VALUES
  ('cash',       'Касса',        'Авансовые отчёты и расчёты',  'finance', 'finances', 35),
  ('cash_admin', 'Касса (управление)', 'Согласование и контроль', 'finance', 'finances', 36)
ON CONFLICT (key) DO NOTHING;

-- 6. Пресеты: PM получает cash (read+write), Directors получают cash_admin (read+write+delete)
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('PM', 'cash', true, true, false),
  ('DIRECTOR_GEN', 'cash', true, true, true),
  ('DIRECTOR_GEN', 'cash_admin', true, true, true),
  ('DIRECTOR_COMM', 'cash', true, true, true),
  ('DIRECTOR_COMM', 'cash_admin', true, true, true),
  ('DIRECTOR_DEV', 'cash', true, true, true),
  ('DIRECTOR_DEV', 'cash_admin', true, true, true),
  ('BUH', 'cash', true, false, false),
  ('BUH', 'cash_admin', true, false, false)
ON CONFLICT (role, module_key) DO NOTHING;

-- 7. Проставить пермишены существующим пользователям
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, rp.module_key, rp.can_read, rp.can_write, rp.can_delete, u.id
FROM users u
JOIN role_presets rp ON rp.role = u.role
WHERE u.is_active = true
  AND rp.module_key IN ('cash', 'cash_admin')
ON CONFLICT (user_id, module_key) DO NOTHING;
