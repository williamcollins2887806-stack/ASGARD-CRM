'use strict';

/**
 * Worker Finances SSoT — единственный источник истины.
 * Контракт: src/lib/worker-finances.contract.md v1.2
 *
 * @param {object} db      — services/db (pool.query)
 * @param {number} empId   — employees.id
 * @param {object} [opts]
 * @param {number} [opts.year]    — фильтр по году (все года если не указан)
 * @param {number} [opts.workId]  — фильтр по работе (все работы если не указан)
 * @param {object} [opts.logger]  — fastify.log или console
 * @returns {Promise<object>}     — WorkerFinances | { error, ... }
 */
async function getWorkerFinances(db, empId, opts = {}) {
  const log = opts.logger || console;
  const year = opts.year || null;
  const workId = opts.workId || null;

  // ── Validate ──────────────────────────────────────────────────────────────
  if (year !== null && (isNaN(year) || year < 2020)) {
    return { error: 'invalid_year' };
  }

  // ── CTE 1: Earnings from field_checkins ────────────────────────────────────
  // Groups by work_id. Uses fallback for assignment_id NULL (273/273 in prod).
  // per_diem rate: COALESCE(direct assignment, fallback by employee+work)
  const earningsSQL = `
    WITH checkin_earnings AS (
      SELECT
        fc.work_id,
        w.work_title,
        w.customer_name,
        w.work_status,
        SUM(COALESCE(fc.amount_earned, 0))    AS fot,
        COUNT(DISTINCT fc.date)
          FILTER (WHERE fc.amount_earned > 0)  AS days_worked,
        -- per_diem rate: MAX across checkins handles reassignment (worker→master)
        MAX(COALESCE(ea_direct.per_diem, ea_fb.per_diem)) AS per_diem_rate,
        bool_or(COALESCE(ea_direct.is_active, ea_fb.is_active, false)) AS assignment_is_active
      FROM field_checkins fc
      JOIN works w ON w.id = fc.work_id
      -- Direct assignment (may be NULL for all 273 prod rows)
      LEFT JOIN employee_assignments ea_direct
        ON ea_direct.id = fc.assignment_id
      -- Fallback: best assignment for (employee, work)
      LEFT JOIN LATERAL (
        SELECT per_diem, is_active
        FROM employee_assignments
        WHERE employee_id = fc.employee_id
          AND work_id = fc.work_id
        ORDER BY is_active DESC, id DESC
        LIMIT 1
      ) ea_fb ON ea_direct.id IS NULL
      WHERE fc.employee_id = $1
        AND fc.status = 'completed'
        ${year ? 'AND EXTRACT(YEAR FROM fc.date) = $2' : ''}
        ${workId ? `AND fc.work_id = $${year ? 3 : 2}` : ''}
      GROUP BY fc.work_id, w.work_title, w.customer_name, w.work_status
    )
    SELECT * FROM checkin_earnings
  `;

  // ── CTE 2: Payments from worker_payments ───────────────────────────────────
  const paymentsSQL = `
    SELECT
      wp.work_id,
      SUM(wp.amount) FILTER (WHERE wp.type = 'salary')   AS salary_paid,
      SUM(wp.amount) FILTER (WHERE wp.type = 'per_diem') AS per_diem_paid,
      SUM(wp.amount) FILTER (WHERE wp.type = 'bonus')    AS bonus_paid,
      SUM(wp.amount) FILTER (WHERE wp.type = 'advance')  AS advance_paid,
      SUM(wp.amount) FILTER (WHERE wp.type = 'penalty')  AS penalty
    FROM worker_payments wp
    WHERE wp.employee_id = $1
      AND wp.status IN ('paid', 'confirmed')
      ${year ? 'AND COALESCE(wp.pay_year, EXTRACT(YEAR FROM wp.created_at)::int) = $2' : ''}
      ${workId ? `AND wp.work_id = $${year ? 3 : 2}` : ''}
    GROUP BY wp.work_id
  `;

  // ── Build params ──────────────────────────────────────────────────────────
  const params = [empId];
  if (year) params.push(year);
  if (workId) params.push(workId);

  // ── Execute both queries in parallel ──────────────────────────────────────
  let earningsRows, paymentRows;
  try {
    const [earningsRes, paymentsRes] = await Promise.all([
      db.query(earningsSQL, params),
      db.query(paymentsSQL, params),
    ]);
    earningsRows = earningsRes.rows;
    paymentRows = paymentsRes.rows;
  } catch (err) {
    log.error?.({ err, empId }, 'worker-finances query failed') ||
      log.error('worker-finances query failed', err);
    throw err;
  }

  // ── Check for NULL per_diem ───────────────────────────────────────────────
  for (const row of earningsRows) {
    if (row.per_diem_rate === null || row.per_diem_rate === undefined) {
      return {
        error: 'per_diem_not_set',
        work_id: row.work_id,
        work_title: row.work_title,
        message: `Суточные не установлены для работы «${row.work_title}». Обратитесь к руководителю проекта.`,
      };
    }
  }

  // ── Index payments by work_id ─────────────────────────────────────────────
  const payByWork = {};
  for (const p of paymentRows) {
    payByWork[p.work_id ?? '__null'] = p;
  }

  // ── Build by_work[] ───────────────────────────────────────────────────────
  const byWork = [];
  let totalFot = 0;
  let totalPerDiemAccrued = 0;

  for (const e of earningsRows) {
    const wid = e.work_id;
    const fot = parseFloat(e.fot) || 0;
    const daysWorked = parseInt(e.days_worked, 10) || 0;
    const perDiemRate = parseFloat(e.per_diem_rate) || 0;
    const perDiemAccrued = daysWorked * perDiemRate;

    const p = payByWork[wid] || {};
    const salaryPaid = parseFloat(p.salary_paid) || 0;
    const perDiemPaid = parseFloat(p.per_diem_paid) || 0;
    const bonusPaid = parseFloat(p.bonus_paid) || 0;
    const advancePaid = parseFloat(p.advance_paid) || 0;
    const penalty = parseFloat(p.penalty) || 0;

    const workEarned = fot + perDiemAccrued + bonusPaid - penalty;
    const workPaid = salaryPaid + perDiemPaid + bonusPaid + advancePaid;

    byWork.push({
      work_id: wid,
      work_title: e.work_title,
      customer_name: e.customer_name,
      fot,
      per_diem_accrued: perDiemAccrued,
      per_diem_rate: perDiemRate,
      days_worked: daysWorked,
      salary_paid: salaryPaid,
      per_diem_paid: perDiemPaid,
      bonus_paid: bonusPaid,
      advance_paid: advancePaid,
      penalty,
      total_earned: workEarned,
      total_paid: workPaid,
      total_pending: workEarned - workPaid,
      is_active: e.assignment_is_active ?? false,
      work_status: e.work_status || '',
    });

    // Mark this work_id as consumed
    delete payByWork[wid];

    totalFot += fot;
    totalPerDiemAccrued += perDiemAccrued;
  }

  // ── Root-level payments (includes unallocated work_id=NULL) ────────────────
  // Sum ALL payment rows (including those not matched to earnings works)
  let rootSalaryPaid = 0;
  let rootPerDiemPaid = 0;
  let rootBonusPaid = 0;
  let rootAdvancePaid = 0;
  let rootPenalty = 0;

  for (const p of paymentRows) {
    rootSalaryPaid += parseFloat(p.salary_paid) || 0;
    rootPerDiemPaid += parseFloat(p.per_diem_paid) || 0;
    rootBonusPaid += parseFloat(p.bonus_paid) || 0;
    rootAdvancePaid += parseFloat(p.advance_paid) || 0;
    rootPenalty += parseFloat(p.penalty) || 0;
  }

  const totalEarned = totalFot + totalPerDiemAccrued + rootBonusPaid - rootPenalty;
  const totalPaid = rootSalaryPaid + rootPerDiemPaid + rootBonusPaid + rootAdvancePaid;

  return {
    scope: {
      year: year || 'all',
      work_id: workId || null,
    },
    fot: totalFot,
    per_diem_accrued: totalPerDiemAccrued,
    bonus_accrued: rootBonusPaid,
    penalty: rootPenalty,
    total_earned: totalEarned,
    salary_paid: rootSalaryPaid,
    per_diem_paid: rootPerDiemPaid,
    bonus_paid: rootBonusPaid,
    advance_paid: rootAdvancePaid,
    total_paid: totalPaid,
    total_pending: totalEarned - totalPaid,
    by_work: byWork,
  };
}

module.exports = { getWorkerFinances };
