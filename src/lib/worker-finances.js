'use strict';

/**
 * Worker Finances SSoT — единственный источник истины.
 * Контракт: src/lib/worker-finances.contract.md v1.4
 *
 * ФОТ: field_checkins + field_trip_stages
 * Суточные: getPerDiemDays (stages всегда; checkins только если rate > 0)
 */

const { getPerDiemDays } = require('./worker-per-diem-days');

/**
 * @param {object} db
 * @param {number} empId
 * @param {object} [opts]
 * @param {number} [opts.year]
 * @param {number} [opts.workId]
 * @param {object} [opts.logger]
 */
async function getWorkerFinances(db, empId, opts = {}) {
  const log = opts.logger || console;
  const year = opts.year || null;
  const workId = opts.workId || null;

  if (year !== null && (isNaN(year) || year < 2020)) {
    return { error: 'invalid_year' };
  }

  const checkinSQL = `
    SELECT
      fc.work_id,
      w.work_title,
      w.customer_name,
      w.work_status,
      SUM(COALESCE(fc.amount_earned, 0)) AS fot_checkins,
      bool_or(ea.is_active) AS assignment_is_active
    FROM field_checkins fc
    JOIN works w ON w.id = fc.work_id
    INNER JOIN employee_assignments ea ON ea.id = fc.assignment_id
    WHERE fc.employee_id = $1
      AND fc.status = 'completed'
      ${year ? 'AND EXTRACT(YEAR FROM fc.date) = $2' : ''}
      ${workId ? `AND fc.work_id = $${year ? 3 : 2}` : ''}
    GROUP BY fc.work_id, w.work_title, w.customer_name, w.work_status
  `;

  const stageSQL = `
    SELECT
      fts.work_id,
      SUM(COALESCE(fts.amount_earned, 0)) AS fot_stages
    FROM field_trip_stages fts
    WHERE fts.employee_id = $1
      AND COALESCE(fts.status, 'active') IN ('active', 'completed', 'approved', 'adjusted')
      ${year ? 'AND EXTRACT(YEAR FROM fts.date_from) = $2' : ''}
      ${workId ? `AND (fts.work_id = $${year ? 3 : 2} OR fts.work_id IS NULL)` : ''}
    GROUP BY fts.work_id
  `;

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
      ${workId ? `AND (wp.work_id = $${year ? 3 : 2} OR wp.work_id IS NULL)` : ''}
    GROUP BY wp.work_id
  `;

  const params = [empId];
  if (year) params.push(year);
  if (workId) params.push(workId);

  let checkinRows;
  let stageRows;
  let paymentRows;
  let perDiem;
  try {
    const [checkinRes, stageRes, paymentsRes, pd] = await Promise.all([
      db.query(checkinSQL, params),
      db.query(stageSQL, params),
      db.query(paymentsSQL, params),
      getPerDiemDays(db, empId, {
        year,
        workId: workId || null,
        includeOrphans: true,
      }),
    ]);
    checkinRows = checkinRes.rows;
    stageRows = stageRes.rows;
    paymentRows = paymentsRes.rows;
    perDiem = pd;
  } catch (err) {
    log.error?.({ err, empId }, 'worker-finances query failed') ||
      log.error('worker-finances query failed', err);
    throw err;
  }

  // Merge FOT buckets in JS (NULL-safe; avoids FULL JOIN IS NOT DISTINCT FROM)
  const fotByWork = {};
  for (const c of checkinRows) {
    const key = c.work_id == null ? '__null' : String(c.work_id);
    fotByWork[key] = {
      work_id: c.work_id,
      work_title: c.work_title,
      customer_name: c.customer_name,
      work_status: c.work_status,
      fot: parseFloat(c.fot_checkins) || 0,
      assignment_is_active: c.assignment_is_active,
    };
  }
  for (const s of stageRows) {
    const key = s.work_id == null ? '__null' : String(s.work_id);
    if (!fotByWork[key]) {
      fotByWork[key] = {
        work_id: s.work_id,
        work_title: s.work_id == null ? 'Без объекта' : null,
        customer_name: null,
        work_status: '',
        fot: 0,
        assignment_is_active: false,
      };
    }
    fotByWork[key].fot += parseFloat(s.fot_stages) || 0;
  }

  // Fill missing work titles
  const missingTitles = Object.values(fotByWork)
    .filter((e) => e.work_id != null && !e.work_title)
    .map((e) => e.work_id);
  if (missingTitles.length) {
    try {
      const { rows: titles } = await db.query(
        `SELECT id, work_title, customer_name, work_status FROM works WHERE id = ANY($1::int[])`,
        [missingTitles]
      );
      for (const t of titles) {
        const e = fotByWork[String(t.id)];
        if (e) {
          e.work_title = t.work_title;
          e.customer_name = t.customer_name;
          e.work_status = t.work_status || '';
        }
      }
    } catch (_) { /* ignore */ }
  }

  const payByWork = {};
  for (const p of paymentRows) {
    payByWork[p.work_id == null ? '__null' : String(p.work_id)] = p;
  }

  const allKeys = new Set([
    ...Object.keys(fotByWork),
    ...Object.keys(perDiem.by_work),
    ...Object.keys(payByWork),
  ]);

  const byWork = [];
  let totalFot = 0;
  let totalPerDiemAccrued = 0;

  for (const key of allKeys) {
    const e = fotByWork[key] || {};
    const pd = perDiem.by_work[key] || { days: 0, rate: perDiem.default_rate, accrued: 0, work_id: key === '__null' ? null : Number(key) };
    const p = payByWork[key] || {};

    const wid = key === '__null' ? null : Number(key);
    const fot = parseFloat(e.fot) || 0;
    const daysWorked = pd.days || 0;
    // 0 — валидная ставка; не подменять на default через `||`
    const _pdRate = parseFloat(pd.rate);
    const perDiemRate = Number.isFinite(_pdRate) && _pdRate >= 0 ? _pdRate : perDiem.default_rate;
    const _pdAcc = parseFloat(pd.accrued);
    const perDiemAccrued = Number.isFinite(_pdAcc) ? _pdAcc : (daysWorked * perDiemRate);

    const salaryPaid = parseFloat(p.salary_paid) || 0;
    const perDiemPaid = parseFloat(p.per_diem_paid) || 0;
    const bonusPaid = parseFloat(p.bonus_paid) || 0;
    const advancePaid = parseFloat(p.advance_paid) || 0;
    const penalty = parseFloat(p.penalty) || 0;

    const workEarned = fot + perDiemAccrued + bonusPaid - penalty;
    const workPaid = salaryPaid + perDiemPaid + bonusPaid + advancePaid;

    byWork.push({
      work_id: wid,
      work_title: e.work_title || (wid == null ? 'Без объекта' : ''),
      customer_name: e.customer_name || null,
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

    totalFot += fot;
    totalPerDiemAccrued += perDiemAccrued;
  }

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

  if (!workId) {
    totalPerDiemAccrued = perDiem.total_accrued;
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
    per_diem_days_detail: perDiem.days,
  };
}

module.exports = { getWorkerFinances };
