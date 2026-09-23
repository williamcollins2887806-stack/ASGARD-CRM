/**
 * Резолв `entered_by_user_id` для FK-колонок на `users(id)`.
 * ═══════════════════════════════════════════════════════════════════════════
 * D-246. `field_checkins.entered_by_user_id` и `field_trip_stages.entered_by_user_id`
 * ссылаются на `users(id)`, а `request.user.id` — не всегда user.id:
 * при QA-прогоне сессия подписана `employee.id` (namespace `employees`).
 * Тогда INSERT падал 500-й:
 *   `insert or update on table "field_trip_stages" violates foreign key constraint
 *    "field_trip_stages_entered_by_user_id_fkey"` (прод, 15.09.2026 01:52:59).
 *
 * Порядок резолва:
 *   1. прямое совпадение `users.id` — штатный путь (CRM-JWT);
 *   2. `employees.user_id` — для employee-id сессий (field/QА);
 *   3. `NULL` — колонка nullable, «кто внёс» в UI берётся из `created_by` / `checkin_by`.
 */
'use strict';

async function resolveEnteredByUserId(db, viewer) {
  const id = parseInt(viewer && viewer.id, 10);
  if (!Number.isFinite(id)) return null;
  const { rows } = await db.query(
    `SELECT COALESCE(
              (SELECT u.id FROM users u WHERE u.id = $1),
              (SELECT e.user_id FROM employees e WHERE e.id = $1 AND e.user_id IS NOT NULL),
              NULL
            ) AS uid`,
    [id]
  );
  return rows[0] && rows[0].uid != null ? rows[0].uid : null;
}

module.exports = { resolveEnteredByUserId };
