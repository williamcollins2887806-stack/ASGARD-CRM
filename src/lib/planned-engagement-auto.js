'use strict';

/**
 * Автоснятие планируемого привлечения (employee_planned_engagements).
 *
 * Смысл плана: «следующий объект = P».
 *
 * При назначении в бригаду на work X:
 *  1) X == P  → снять (прибыл на план)
 *  2) X != P и человек УЖЕ на другом объекте A (A != X, без убытия)
 *     → снять план на P (ушёл на третий объект вместо плана)
 *     Пример: план на оголовок (B), сейчас на A, ставят на C → план B снимается.
 *  3) X != P и человек нигде не на объекте → план с датами ОСТАЁТЯ
 *     (сначала A, потом по плану на B). Без дат — снимет sweep D.
 *
 * Sweep (cron / startup):
 *  A) уже на объекте плана
 *  B) planned_to истекло
 *  C) без дат + на любом объекте
 *  D) без дат + не на объекте плана
 */

async function writePlanLog(db, employeeId, comment, userId) {
  try {
    const { rows: [emp] } = await db.query(
      'SELECT readiness_status FROM employees WHERE id = $1',
      [employeeId]
    );
    if (!emp) return;
    await db.query(`
      INSERT INTO worker_readiness_log
        (employee_id, old_status, new_status, comment, source, changed_by)
      VALUES ($1, $2, $2, $3, 'system', $4)
    `, [employeeId, emp.readiness_status, comment, userId || null]);
  } catch (_) { /* non-fatal */ }
}

async function cancelPlans(db, employeeId, workFilterSql, workFilterParams, userId, reason) {
  const params = [employeeId, userId, `[auto:${reason}]`, ...workFilterParams];
  // $1 emp, $2 user, $3 note tag, $4+ work filter
  const { rows } = await db.query(`
    UPDATE employee_planned_engagements SET
      status = 'cancelled',
      cancelled_at = NOW(),
      cancelled_by = $2,
      updated_at = NOW(),
      note = CASE
        WHEN note IS NULL OR note = '' THEN $3
        ELSE note || ' | ' || $3
      END
    WHERE employee_id = $1
      AND status = 'active'
      AND (${workFilterSql})
    RETURNING id, work_id
  `, params);

  for (const r of rows) {
    await writePlanLog(db, employeeId, `planned_auto_clear:${reason} work_id=${r.work_id}`, userId);
  }
  return { cleared: rows.length, ids: rows.map((r) => r.id) };
}

/**
 * Снять активный план на конкретный work_id (прибыл на объект плана).
 */
async function clearPlannedOnArrival(db, employeeId, workId, opts = {}) {
  const userId = opts.userId || null;
  const reason = opts.reason || 'arrived_same_work';
  if (!employeeId || !workId) return { cleared: 0, ids: [] };
  return cancelPlans(db, employeeId, 'work_id = $4', [workId], userId, reason);
}

/**
 * Полная логика при назначении в бригаду на newWorkId.
 * Вызывать ПОСЛЕ upsert assignment (чтобы текущий объект A был виден в БД).
 */
async function clearPlannedOnCrewAssign(db, employeeId, newWorkId, opts = {}) {
  const userId = opts.userId || null;
  if (!employeeId || !newWorkId) return { arrived: 0, redirected: 0 };

  const arrived = await clearPlannedOnArrival(db, employeeId, newWorkId, {
    userId,
    reason: 'arrived_same_work',
  });

  // Уже стоит на другом объекте A (A != newWorkId) → план на третий объект P снимаем
  const { rows: otherSite } = await db.query(`
    SELECT 1
    FROM employee_assignments ea
    WHERE ea.employee_id = $1
      AND ea.work_id IS DISTINCT FROM $2
      AND COALESCE(ea.is_active, true) = true
      AND ea.departure_date IS NULL
    LIMIT 1
  `, [employeeId, newWorkId]);

  let redirected = { cleared: 0, ids: [] };
  if (otherSite.length > 0) {
    redirected = await cancelPlans(
      db,
      employeeId,
      'work_id IS DISTINCT FROM $4',
      [newWorkId],
      userId,
      'redirected_to_other_work'
    );
  }

  return {
    arrived: arrived.cleared,
    redirected: redirected.cleared,
    ids: [...arrived.ids, ...redirected.ids],
  };
}

/**
 * Ежедневный/разовый sweep по всем активным планам.
 */
async function sweepStalePlannedEngagements(db, opts = {}) {
  const userId = opts.userId || null;
  const stats = { arrived: 0, expired: 0, stale: 0, orphan_undated: 0 };

  // A) уже на объекте плана
  const arrived = await db.query(`
    UPDATE employee_planned_engagements pe SET
      status = 'cancelled',
      cancelled_at = NOW(),
      cancelled_by = $1,
      updated_at = NOW(),
      note = CASE
        WHEN pe.note IS NULL OR pe.note = '' THEN '[auto:arrived_same_work]'
        ELSE pe.note || ' | [auto:arrived_same_work]'
      END
    WHERE pe.status = 'active'
      AND EXISTS (
        SELECT 1 FROM employee_assignments ea
        WHERE ea.employee_id = pe.employee_id
          AND ea.work_id = pe.work_id
          AND COALESCE(ea.is_active, true) = true
          AND ea.departure_date IS NULL
      )
    RETURNING pe.id, pe.employee_id, pe.work_id
  `, [userId]);
  stats.arrived = arrived.rows.length;
  for (const r of arrived.rows) {
    await writePlanLog(db, r.employee_id, `planned_auto_clear:arrived_same_work work_id=${r.work_id}`, userId);
  }

  // B) окно плана истекло
  const expired = await db.query(`
    UPDATE employee_planned_engagements pe SET
      status = 'cancelled',
      cancelled_at = NOW(),
      cancelled_by = $1,
      updated_at = NOW(),
      note = CASE
        WHEN pe.note IS NULL OR pe.note = '' THEN '[auto:expired]'
        ELSE pe.note || ' | [auto:expired]'
      END
    WHERE pe.status = 'active'
      AND pe.planned_to IS NOT NULL
      AND pe.planned_to < CURRENT_DATE
    RETURNING pe.id, pe.employee_id, pe.work_id
  `, [userId]);
  stats.expired = expired.rows.length;
  for (const r of expired.rows) {
    await writePlanLog(db, r.employee_id, `planned_auto_clear:expired work_id=${r.work_id}`, userId);
  }

  // C) без дат + уже на любом объекте
  const stale = await db.query(`
    UPDATE employee_planned_engagements pe SET
      status = 'cancelled',
      cancelled_at = NOW(),
      cancelled_by = $1,
      updated_at = NOW(),
      note = CASE
        WHEN pe.note IS NULL OR pe.note = '' THEN '[auto:stale_undated_on_site]'
        ELSE pe.note || ' | [auto:stale_undated_on_site]'
      END
    WHERE pe.status = 'active'
      AND pe.planned_from IS NULL
      AND pe.planned_to IS NULL
      AND EXISTS (
        SELECT 1 FROM employee_assignments ea
        WHERE ea.employee_id = pe.employee_id
          AND COALESCE(ea.is_active, true) = true
          AND ea.departure_date IS NULL
      )
    RETURNING pe.id, pe.employee_id, pe.work_id
  `, [userId]);
  stats.stale = stale.rows.length;
  for (const r of stale.rows) {
    await writePlanLog(db, r.employee_id, `planned_auto_clear:stale_undated_on_site work_id=${r.work_id}`, userId);
  }

  // D) без дат + НЕ на объекте плана
  const orphan = await db.query(`
    UPDATE employee_planned_engagements pe SET
      status = 'cancelled',
      cancelled_at = NOW(),
      cancelled_by = $1,
      updated_at = NOW(),
      note = CASE
        WHEN pe.note IS NULL OR pe.note = '' THEN '[auto:stale_undated_not_on_plan_work]'
        ELSE pe.note || ' | [auto:stale_undated_not_on_plan_work]'
      END
    WHERE pe.status = 'active'
      AND pe.planned_from IS NULL
      AND pe.planned_to IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM employee_assignments ea
        WHERE ea.employee_id = pe.employee_id
          AND ea.work_id = pe.work_id
          AND COALESCE(ea.is_active, true) = true
          AND ea.departure_date IS NULL
      )
    RETURNING pe.id, pe.employee_id, pe.work_id
  `, [userId]);
  stats.orphan_undated = orphan.rows.length;
  for (const r of orphan.rows) {
    await writePlanLog(db, r.employee_id, `planned_auto_clear:stale_undated_not_on_plan_work work_id=${r.work_id}`, userId);
  }

  return stats;
}

module.exports = {
  clearPlannedOnArrival,
  clearPlannedOnCrewAssign,
  sweepStalePlannedEngagements,
};
