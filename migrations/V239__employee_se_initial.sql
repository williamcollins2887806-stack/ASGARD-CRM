-- ═══════════════════════════════════════════════════════════════════════════
-- V239: employees.se_yearly_used_initial + se_monthly_used_initial
-- Источник: TIMESHEET_V2_CONTRACT_PHASE1.md, секция «БД (V235)».
--
-- ⚠️  NUMERING NOTE: контракт декларирует V235, но к моменту реализации
-- слот V235 уже занят V235__contacts_backlinks.sql (другой спринт).
-- Поэтому фактический номер — V239 (первый свободный после V238).
-- Семантика и логика идентичны декларации в контракте.
--
-- НАЗНАЧЕНИЕ:
-- Когда сотрудника переводят в CRM из старой системы учёта (бухгалтерия 1С,
-- ручной Excel, и т.д.), он мог УЖЕ исчерпать часть НПД-лимита самозанятого —
-- но в `se_transfers` этого нет (мы туда пишем только наши собственные
-- переводы). Эти две колонки — «стартовая корректировка» (offset),
-- которая прибавляется к SUM(se_transfers) при расчёте использованного лимита.
--
-- ЛОГИКА В РАСЧЁТЕ (см. src/routes/timesheet-v2.js):
--   yearly_used  = SUM(se_transfers за год)  + se_yearly_used_initial
--   monthly_used = SUM(se_transfers за месяц) + (если initial.year==Y и
--                                                  initial.month==M)
--                                                ? initial.amount : 0
--
-- ФОРМАТ se_monthly_used_initial (JSONB):
--   {"year": 2026, "month": 6, "amount": 50000}
-- (Один месяц-«стартовый offset». Если сотрудника перевели 16.06.2026, у него
--  в июне уже могло быть 50k переводов в старой системе.)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS (no-op при повторном применении).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE employees ADD COLUMN IF NOT EXISTS se_yearly_used_initial NUMERIC(12,2) DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS se_monthly_used_initial JSONB DEFAULT NULL;

COMMENT ON COLUMN employees.se_yearly_used_initial IS 'Стартовая корректировка годового лимита НПД (offset для SUM se_transfers). При переносе из старой системы.';
COMMENT ON COLUMN employees.se_monthly_used_initial IS 'Стартовая корректировка месячного лимита НПД. JSONB {year,month,amount}. Применяется если запрошенный месяц совпадает.';
