-- ═══════════════════════════════════════════════════════════════════════════
-- V232: payroll_period_locks — локи периода (год+месяц) по скоупам
-- Источник: TIMESHEET_V2_CONTRACT.md, секция «БД (новые таблицы)».
-- Используется новым роутом /api/timesheet/v2 — закрытие периода для
-- PM/WAREHOUSE/TO/OFFICE_MANAGER и глобальный лок DIRECTOR/ADMIN/BUH/HR.
--
-- scope:
--   'pm'        — лок РП на свой набор работ (scope_user_id = users.id РП)
--   'warehouse' — лок кладовщика на склад-отметки (scope_user_id = NULL)
--   'medical'   — лок ТО (scope_user_id = NULL)
--   'travel'    — лок офис-менеджера (scope_user_id = NULL)
--   'global'    — лок директора/админа/бухгалтера/HR (scope_user_id = NULL)
--
-- Жизненный цикл: INSERT при «закрыть период», UPDATE unlocked_at при разлоке.
-- Для уникальности «один активный лок на (год,месяц,scope[,user])»
-- используется UNIQUE с COALESCE на scope_user_id и WHERE unlocked_at IS NULL
-- через частичный индекс (UNIQUE constraint с COALESCE-выражением Postgres
-- напрямую не поддерживает в DDL — поэтому делаем UNIQUE INDEX отдельно).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payroll_period_locks (
    id              SERIAL      PRIMARY KEY,
    year            INTEGER     NOT NULL,
    month           INTEGER     NOT NULL CHECK (month BETWEEN 1 AND 12),
    scope           VARCHAR(20) NOT NULL CHECK (scope IN ('pm','warehouse','medical','travel','global')),
    scope_user_id   INTEGER     REFERENCES users(id),
    locked_at       TIMESTAMPTZ DEFAULT NOW(),
    locked_by       INTEGER     REFERENCES users(id),
    unlocked_at     TIMESTAMPTZ,
    unlocked_by     INTEGER     REFERENCES users(id),
    note            TEXT
);

-- Активный лок: уникален в разрезе (год, месяц, scope, scope_user_id).
-- Частичный — позволяет иметь историю старых разлокированных записей
-- без конфликта при повторном закрытии того же периода.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payroll_period_active_lock
    ON payroll_period_locks (year, month, scope, (COALESCE(scope_user_id, 0)))
    WHERE unlocked_at IS NULL;

-- Быстрая проверка наличия активного лока на (год, месяц, scope).
CREATE INDEX IF NOT EXISTS idx_period_locks_lookup
    ON payroll_period_locks (year, month, scope)
    WHERE unlocked_at IS NULL;
