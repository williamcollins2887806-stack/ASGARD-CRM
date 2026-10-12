-- V384: персональный доступ к «Общему табелю» (read-only).
-- ═══════════════════════════════════════════════════════════════════════════
-- Механизм: settings.timesheet_global_viewer_user_ids — JSON-массив user_id.
-- Пользователь из списка видит #/timesheet (Timesheet v2, mode=global) в полном
-- директорском профиле, но БЕЗ права записи/закрытия месяца (granted_readonly).
--
-- Читает: src/lib/timesheet-access.js (isGlobalViewerGranted).
-- Потребители: src/routes/timesheet-v2.js (mode/профиль/export),
--              src/routes/auth.js (синтетический пермишен timesheet_global),
--              src/routes/payroll-dashboard.js (карточка кассы, read-only).
--
-- Путков Д.В. (login=d.putkov) — id берём из users, без хардкода числа,
-- с фолбэком на известный id 3465, если строка ещё не создана.
-- Идемпотентно: ON CONFLICT (key) DO NOTHING — повторный прогон не перезапишет.

INSERT INTO settings (key, value_json, updated_at)
VALUES (
  'timesheet_global_viewer_user_ids',
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
