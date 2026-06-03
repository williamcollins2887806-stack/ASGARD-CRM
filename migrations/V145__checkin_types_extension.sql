-- ═══════════════════════════════════════════════════════════════════════════
-- HR Module v2 — Сессия 1, Шаг 1, Волна 5
-- V145: Типы отметок в табеле + начальные настройки лимитов СЗ
--
-- field_checkins.shift уже VARCHAR(20) — без CHECK-constraint, поэтому
-- расширение до 'day','night','road','warehouse','medical','waiting'
-- не требует ALTER. Документируем для будущих сессий.
--
-- field_trip_stages.stage_type уже поддерживает: 'medical','travel','waiting',
-- 'warehouse','day_off','object'.
--
-- Начальные настройки лимитов самозанятых (используются payroll-dashboard
-- и se_transfers валидацией).
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO settings (key, value_json, updated_at) VALUES
  ('self_employed_monthly_limit', '350000', NOW()),
  ('self_employed_yearly_limit',  '2400000', NOW())
ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW();
