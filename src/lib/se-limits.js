'use strict';

/**
 * SSoT расчёта лимитов НПД для СЗ — синхронизировано с timesheet-v2.js Phase 1A.
 *
 * monthly_used = SUM(se_transfers за месяц) + se_monthly_used_initial.amount
 *   (initial только если есть se_monthly_history за тот же year/month)
 * yearly_used  = SUM(se_monthly_history за год) + SUM(se_transfers за год) + se_yearly_used_initial
 */

function round2(x) {
  return Math.round(Number(x || 0) * 100) / 100;
}

function computeMoInitial(seMonthlyUsedInitial, year, month, hasImportForMonth) {
  let moInitial = 0;
  const mi = seMonthlyUsedInitial;
  if (mi && typeof mi === 'object' &&
      hasImportForMonth &&
      Number(mi.year) === Number(year) &&
      Number(mi.month) === Number(month)) {
    const amt = Number(mi.amount || 0);
    if (Number.isFinite(amt)) moInitial = amt;
  }
  return moInitial;
}

/**
 * @param {object} opts
 * @returns {{ moUsed, yrUsed, monthly_remaining, yearly_remaining, monthly_used, yearly_used, transfer, moRemForTransfer, yrRem }}
 */
function computeSeLimits(opts) {
  const {
    monthlyLimit,
    yearlyLimit,
    trYear = 0,
    trMonth = 0,
    yrInitial = 0,
    seMonthlyUsedInitial = null,
    yrHistory = 0,
    hasImportForMonth = false,
    year,
    month,
    canExceedLimit = false,
    earned = 0
  } = opts;

  const moInitial = computeMoInitial(seMonthlyUsedInitial, year, month, hasImportForMonth);
  const yrUsed = Number(yrHistory) + Number(trYear) + Number(yrInitial);
  const moUsed = Number(trMonth) + moInitial;
  const yrRem = Math.max(0, yearlyLimit - yrUsed);
  const moRemBase = Math.max(0, monthlyLimit - moUsed);
  let moRemForTransfer = moRemBase;
  if (canExceedLimit) {
    moRemForTransfer = Math.max(moRemBase, earned);
  }
  const transfer = Math.max(0, Math.min(earned, moRemForTransfer, yrRem));

  return {
    moInitial,
    moUsed,
    yrUsed,
    moRemBase,
    moRemForTransfer,
    yrRem,
    monthly_remaining: round2(moRemBase),
    yearly_remaining: round2(yrRem),
    monthly_used: round2(moUsed),
    yearly_used: round2(yrUsed),
    transfer: round2(transfer)
  };
}

async function loadSeLimitsAggregates(q, limitsIds, year, month) {
  const transfersYearMap = {};
  const transfersMonthMap = {};
  const yearlyHistoryByEmp = {};
  const monthlyImportMap = {};

  if (!limitsIds.length) {
    return { transfersYearMap, transfersMonthMap, yearlyHistoryByEmp, monthlyImportMap };
  }

  try {
    const { rows: yRows } = await q.query(`
      SELECT employee_id, COALESCE(SUM(transfer_amount), 0)::numeric AS total
        FROM se_transfers
       WHERE employee_id = ANY($1::int[])
         AND year = $2
         AND status != 'cancelled'
       GROUP BY employee_id
    `, [limitsIds, year]);
    for (const r of yRows) transfersYearMap[r.employee_id] = Number(r.total) || 0;
  } catch (_) {}

  try {
    const { rows: mRows } = await q.query(`
      SELECT employee_id, COALESCE(SUM(transfer_amount), 0)::numeric AS total
        FROM se_transfers
       WHERE employee_id = ANY($1::int[])
         AND year = $2
         AND month = $3
         AND status != 'cancelled'
       GROUP BY employee_id
    `, [limitsIds, year, month]);
    for (const r of mRows) transfersMonthMap[r.employee_id] = Number(r.total) || 0;
  } catch (_) {}

  try {
    const { rows: hRows } = await q.query(`
      SELECT employee_id, COALESCE(SUM(monthly_used), 0)::numeric AS year_history_used
        FROM se_monthly_history
       WHERE employee_id = ANY($1::int[])
         AND year = $2
       GROUP BY employee_id
    `, [limitsIds, year]);
    for (const r of hRows) {
      yearlyHistoryByEmp[r.employee_id] = Number(r.year_history_used) || 0;
    }
  } catch (_) {}

  try {
    const { rows: mImpRows } = await q.query(`
      SELECT employee_id
        FROM se_monthly_history
       WHERE employee_id = ANY($1::int[])
         AND year = $2
         AND month = $3
    `, [limitsIds, year, month]);
    for (const r of mImpRows) monthlyImportMap[r.employee_id] = true;
  } catch (_) {}

  return { transfersYearMap, transfersMonthMap, yearlyHistoryByEmp, monthlyImportMap };
}

async function loadLimitHolderProfiles(q, ids) {
  const map = {};
  if (!ids.length) return map;
  const { rows } = await q.query(`
    SELECT id,
           COALESCE(fio, full_name) AS fio,
           COALESCE(can_exceed_limit, false) AS can_exceed_limit,
           COALESCE(se_yearly_used_initial, 0) AS se_yearly_used_initial,
           se_monthly_used_initial
      FROM employees
     WHERE id = ANY($1::int[])
  `, [ids]);
  for (const r of rows) {
    map[r.id] = {
      id: r.id,
      fio: r.fio,
      can_exceed_limit: !!r.can_exceed_limit,
      se_yearly_used_initial: Number(r.se_yearly_used_initial || 0),
      se_monthly_used_initial: r.se_monthly_used_initial || null
    };
  }
  return map;
}

/** Годовой расход НПД для валидации перевода (se_transfers POST). */
async function computeYearlyUsedForEmployee(q, employeeId, year) {
  let trYear = 0;
  let yrHistory = 0;
  let yrInitial = 0;
  try {
    const { rows: [r] } = await q.query(`
      SELECT COALESCE(SUM(transfer_amount), 0)::numeric AS total
        FROM se_transfers
       WHERE employee_id = $1 AND year = $2 AND status != 'cancelled'
    `, [employeeId, year]);
    trYear = Number(r?.total || 0);
  } catch (_) {}
  try {
    const { rows: [r] } = await q.query(`
      SELECT COALESCE(SUM(monthly_used), 0)::numeric AS total
        FROM se_monthly_history
       WHERE employee_id = $1 AND year = $2
    `, [employeeId, year]);
    yrHistory = Number(r?.total || 0);
  } catch (_) {}
  try {
    const { rows: [r] } = await q.query(`
      SELECT COALESCE(se_yearly_used_initial, 0)::numeric AS initial
        FROM employees WHERE id = $1
    `, [employeeId]);
    yrInitial = Number(r?.initial || 0);
  } catch (_) {}
  return trYear + yrHistory + yrInitial;
}

/** id владельца лимита: payee если есть, иначе worker. */
async function resolveLimitsHolderId(q, employeeId) {
  const { rows: [emp] } = await q.query(
    'SELECT id, se_payee_id FROM employees WHERE id = $1',
    [employeeId]
  );
  if (!emp) return null;
  return emp.se_payee_id ? Number(emp.se_payee_id) : Number(emp.id);
}

module.exports = {
  computeMoInitial,
  computeSeLimits,
  loadSeLimitsAggregates,
  loadLimitHolderProfiles,
  computeYearlyUsedForEmployee,
  resolveLimitsHolderId,
  round2
};
