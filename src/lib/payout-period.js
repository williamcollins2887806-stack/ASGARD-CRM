'use strict';

/**
 * Предупреждения готовности периода к выплате (мягкие, НЕ блокируют).
 * ═══════════════════════════════════════════════════════════════════════════
 * Решение заказчика: серверно выплаты не блокируем, показываем предупреждения,
 * чтобы Дима видел, что табель за месяц ещё не полностью закрыт.
 *
 * Критерии (по данным, пер-сотрудник где возможно):
 *   1. Есть смены field_checkins со status='active' за период.
 *   2. Есть этапы field_trip_stages со status IN ('planned','active'), пересекающие период.
 *   3. Есть открытые разногласия timesheet_disputes (status open/in_review) за период.
 *   4. Справочно: РП не закрыл табель (payroll_period_locks) — без привязки к сотруднику.
 */

const MONTH_BOUNDS = (year, month) => {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0)); // последний день месяца
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
};

/**
 * Предупреждения общего периода (не пер-сотрудник).
 * @returns {Promise<{from,to,warnings:Array<{code,level,message,count,employee_ids?}>}>}
 */
async function getPeriodWarnings(db, year, month) {
  const { from, to } = MONTH_BOUNDS(year, month);
  const warnings = [];

  // 1) Незакрытые смены
  try {
    const { rows } = await db.query(
      `SELECT employee_id, COUNT(*)::int AS cnt
         FROM field_checkins
        WHERE date BETWEEN $1::date AND $2::date
          AND status = 'active'
        GROUP BY employee_id`,
      [from, to]
    );
    if (rows.length) {
      warnings.push({
        code: 'active_shifts',
        level: 'warn',
        message: `Незакрытых смен: ${rows.reduce((s, r) => s + r.cnt, 0)} у ${rows.length} сотр.`,
        count: rows.reduce((s, r) => s + r.cnt, 0),
        employee_ids: rows.map((r) => r.employee_id),
      });
    }
  } catch (_) { /* таблицы может не быть на старом клоне */ }

  // 2) Незафинализированные этапы, пересекающие месяц
  try {
    const { rows } = await db.query(
      `SELECT employee_id, COUNT(*)::int AS cnt
         FROM field_trip_stages
        WHERE date_from <= $2::date
          AND COALESCE(date_to, date_from) >= $1::date
          AND COALESCE(status, 'active') IN ('active', 'planned')
        GROUP BY employee_id`,
      [from, to]
    );
    if (rows.length) {
      warnings.push({
        code: 'pending_stages',
        level: 'warn',
        message: `Этапов в статусе planned/active: ${rows.reduce((s, r) => s + r.cnt, 0)} у ${rows.length} сотр.`,
        count: rows.reduce((s, r) => s + r.cnt, 0),
        employee_ids: rows.map((r) => r.employee_id),
      });
    }
  } catch (_) { /* ignore */ }

  // 3) Открытые разногласия по табелю
  try {
    const { rows } = await db.query(
      `SELECT employee_id, COUNT(*)::int AS cnt
         FROM timesheet_disputes
        WHERE dispute_year = $1 AND dispute_month = $2
          AND status IN ('open', 'in_review')
        GROUP BY employee_id`,
      [parseInt(year, 10), parseInt(month, 10)]
    );
    if (rows.length) {
      warnings.push({
        code: 'open_disputes',
        level: 'warn',
        message: `Открытых споров по табелю: ${rows.reduce((s, r) => s + r.cnt, 0)} у ${rows.length} сотр.`,
        count: rows.reduce((s, r) => s + r.cnt, 0),
        employee_ids: rows.map((r) => r.employee_id),
      });
    }
  } catch (_) { /* ignore */ }

  // 4) Справочно: закрытие месяца по локам (не пер-сотрудник)
  try {
    const { rows } = await db.query(
      `SELECT scope, scope_user_id, locked_at
         FROM payroll_period_locks
        WHERE year = $1 AND month = $2 AND unlocked_at IS NULL`,
      [parseInt(year, 10), parseInt(month, 10)]
    );
    const globalLocked = rows.some((r) => r.scope === 'global');
    const scopeLocked = new Set(rows.filter((r) => !r.scope_user_id).map((r) => r.scope));
    const pmLockedCount = rows.filter((r) => r.scope === 'pm').length;
    if (!globalLocked) {
      warnings.push({
        code: 'no_global_lock',
        level: 'info',
        message: `Общий лок месяца не выставлен. Скоупы закрыты: ${[...scopeLocked].join(', ') || '—'}; РП закрыли: ${pmLockedCount}`,
        count: 0,
        scope_locks: Array.from(scopeLocked),
        pm_locked_count: pmLockedCount,
      });
    }
  } catch (_) { /* ignore */ }

  return { from, to, warnings };
}

module.exports = { getPeriodWarnings, MONTH_BOUNDS };
