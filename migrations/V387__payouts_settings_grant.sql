-- V387: настройки страницы выплат + грант доступа.
-- ═══════════════════════════════════════════════════════════════════════════
-- settings:
--   payout_manager_user_ids  — JSON-массив user_id, кому доступна страница выплат
--                              (по образцу V384 timesheet_global_viewer_user_ids).
--   self_employed_tax_rate   — ставка налога СЗ (6%) для перевода сверху.
--   payout_confirm_ttl_hours — TTL подтверждения (72ч).
--   payout_reminder_hours    — через сколько часов слать напоминание.
--
-- Идемпотентно: ON CONFLICT (key) DO NOTHING.

INSERT INTO settings (key, value_json, updated_at)
VALUES (
  'payout_manager_user_ids',
  COALESCE(
    (
      SELECT json_agg(u.id ORDER BY u.id)::text
      FROM users u
      WHERE u.is_active IS DISTINCT FROM false
        AND (u.login = 'd.putkov' OR u.id = 3465)
    ),
    '[3465]'
  ),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value_json, updated_at) VALUES
  ('self_employed_tax_rate',   '0.06', NOW()),
  ('payout_confirm_ttl_hours', '72',   NOW()),
  ('payout_reminder_hours',    '24',   NOW())
ON CONFLICT (key) DO NOTHING;
