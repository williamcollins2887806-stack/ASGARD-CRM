-- V487 down: откат расчётной модели v2.
--
-- Удаляет ключи параметров, которые добавила V487, таблицу user_ui_prefs
-- и признак norm_basis. Существующие ключи globals (созданные до V487) не
-- трогаются — удаляются только те, что перечислены здесь.

BEGIN;

-- 1. Убираем признак базиса нормы.
UPDATE work_norm_rates
   SET params_json = params_json - 'norm_basis'
 WHERE params_json ? 'norm_basis';

-- 2. Удаляем ключи, добавленные V487 (безопасно, если их уже нет).
DELETE FROM work_norm_globals
 WHERE key IN (
   'crew_span', 'master_span', 'observer_ratio', 'duplier_ratio', 'pto_threshold',
   'shift_lunch_min', 'shift_breaks_min', 'shift_pzr_min', 'shift_handover_min',
   'permit_daily_min',
   'permit_setup_h', 'move_intra_h', 'reloc_inter_zone_h', 'hookup_h',
   'scaffold_h', 'accept_h',
   'wait_default_days', 'weather_days_per_month'
 );

-- 3. Таблица пользовательских настроек.
DROP INDEX IF EXISTS idx_user_ui_prefs_user;
DROP TABLE IF EXISTS user_ui_prefs;

-- 4. Комментарий таблицы норм возвращаем к нейтральному.
COMMENT ON TABLE work_norm_rates IS NULL;

COMMIT;
