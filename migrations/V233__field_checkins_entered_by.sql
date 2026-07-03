-- ═══════════════════════════════════════════════════════════════════════════
-- V233: entered_by_user_id для field_checkins и field_trip_stages
-- Источник: TIMESHEET_V2_CONTRACT.md, секция «БД (новые таблицы)».
-- Новый табель (/api/timesheet/v2) хранит ИМЕННО users.id того, кто ВВЁЛ
-- запись (а не сотрудника, на которого она). Это нужно для:
--   1) проекции «entered_by_fio / entered_by_role» в каждой клетке;
--   2) PM-RBAC «PM может править ТОЛЬКО свои чекины (entered_by_user_id=viewer.id)»;
--   3) разрешения конфликтов когда РП ставит «склад/мед/дорога» сам себе
--      вместо кладовщика — мы знаем кто фактически внёс.
--
-- ВНИМАНИЕ к семантике существующих полей (НЕ overwrite!):
--   • field_checkins.checkin_by — СМЕШАННОЕ поле:
--       - при checkin_source ∈ ('manual','pm_manual','admin') → это users.id
--         того, кто вручную создал чекин (мастер/РП/админ);
--       - при checkin_source ∈ ('self','master') → это employees.id того,
--         кто фактически тапнул кнопку в полевой мобилке.
--     Backfill копируем ТОЛЬКО для CRM-инсёртов (manual/pm_manual/admin).
--     Полевые self/master НЕ трогаем — там checkin_by это employee.id,
--     не users.id, маппинг неоднозначен.
--   • field_trip_stages.created_by — INTEGER без FK (исторически был задуман
--     как users.id, но в коде кое-где пишут employee.id). На моменте
--     написания миграции реальная статистика недоступна (SSH к проду упал),
--     поэтому backfill делаем «как контракт сказал» — копируем как есть,
--     но ТОЛЬКО когда соответствующий users.id существует. Записи без
--     валидного users.id оставляем NULL — лучше «не знаем», чем «врём».
--
-- Indempotent: ADD COLUMN IF NOT EXISTS + UPDATE с WHERE NULL-гардом.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── field_checkins ──────────────────────────────────────────────────────────
ALTER TABLE field_checkins
    ADD COLUMN IF NOT EXISTS entered_by_user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_field_checkins_entered_by
    ON field_checkins (entered_by_user_id)
    WHERE entered_by_user_id IS NOT NULL;

-- Backfill: ТОЛЬКО для CRM-источников. Существование users.id обязательно,
-- иначе ловим FK-нарушение (если checkin_by = employee.id попал в manual).
UPDATE field_checkins fc
SET entered_by_user_id = fc.checkin_by
WHERE fc.entered_by_user_id IS NULL
  AND fc.checkin_source IN ('manual', 'pm_manual', 'admin')
  AND fc.checkin_by IS NOT NULL
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = fc.checkin_by);

-- ── field_trip_stages ───────────────────────────────────────────────────────
ALTER TABLE field_trip_stages
    ADD COLUMN IF NOT EXISTS entered_by_user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_field_trip_stages_entered_by
    ON field_trip_stages (entered_by_user_id)
    WHERE entered_by_user_id IS NOT NULL;

-- Backfill: created_by в field_trip_stages исторически без FK.
-- Копируем только если users.id реально существует (иначе оставляем NULL).
UPDATE field_trip_stages fts
SET entered_by_user_id = fts.created_by
WHERE fts.entered_by_user_id IS NULL
  AND fts.created_by IS NOT NULL
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = fts.created_by);
