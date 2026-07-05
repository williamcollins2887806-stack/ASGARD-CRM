'use strict';

/**
 * pm-balance.js — единая формула подсчёта баланса подотчётника (РП / HEAD_TO).
 *
 * Источник правды для двух endpoint'ов:
 *   - GET /api/cash/my-balance          (для самого держателя кассы)
 *   - GET /api/payroll-dashboard/pm-balance  (для BUH/директора по всем подотчётникам)
 *
 * HEAD_TO (Хосе): без handovers/se_legacy; выплаты только WHERE paid_by = holder_id.
 */

const CASH_HOLDER_PM_ROLES = new Set(['PM', 'HEAD_PM']);
const CASH_HOLDER_HEAD_TO = 'HEAD_TO';

async function resolveHolderRole(db, holderUserId, holderRole) {
  if (holderRole) return holderRole;
  const { rows } = await db.query(
    'SELECT role FROM users WHERE id = $1',
    [holderUserId]
  );
  return rows[0]?.role || null;
}

function isHeadToHolder(role) {
  return role === CASH_HOLDER_HEAD_TO;
}

async function calcPmBalance(db, holderUserId, holderRole = null) {
  if (!holderUserId) {
    return zeroBalance();
  }

  const role = await resolveHolderRole(db, holderUserId, holderRole);
  const headTo = isHeadToHolder(role);

  const payoutsFilter = headTo
    ? 'wp.paid_by = $1'
    : `(
            wp.paid_by = $1
            OR (wp.paid_by IS NULL AND w.pm_id = $1 AND wp.payment_method IN ('cash', 'card'))
          )`;

  const workExpFilter = headTo
    ? `(we.paid_by = $1 AND we.payment_method IN ('cash', 'card', 'transfer'))`
    : `(
            (we.paid_by = $1 AND we.payment_method IN ('cash', 'card', 'transfer'))
            OR (we.paid_by IS NULL AND w.pm_id = $1 AND we.payment_method IN ('cash', 'card'))
          )`;

  const handoversCte = headTo
    ? `SELECT 0::numeric AS amt`
    : `SELECT COALESCE(SUM(received_amount), 0)::numeric AS amt
        FROM worker_to_pm_handovers
        WHERE pm_user_id = $1
          AND status IN ('received', 'partial')`;

  const seLegacyCte = headTo
    ? `SELECT 0::numeric AS amt`
    : `SELECT COALESCE(SUM(st.cash_return_amount), 0)::numeric AS amt
        FROM se_transfers st
        LEFT JOIN worker_to_pm_handovers h ON h.source_se_transfer_id = st.id
        WHERE st.pm_user_id = $1
          AND st.status IN ('completed', 'returned')
          AND h.id IS NULL`;

  const { rows } = await db.query(`
    WITH
      handovers AS (
        ${handoversCte}
      ),
      se_legacy AS (
        ${seLegacyCte}
      ),
      cash_iss AS (
        SELECT COALESCE(SUM(amount), 0)::numeric AS amt
        FROM cash_requests
        WHERE user_id = $1
          AND status IN ('money_issued', 'received', 'reporting', 'closed')
      ),
      cash_exp AS (
        SELECT COALESCE(SUM(ce.amount), 0)::numeric AS amt
        FROM cash_expenses ce
        JOIN cash_requests cr ON cr.id = ce.request_id
        WHERE cr.user_id = $1
      ),
      cash_ret AS (
        SELECT COALESCE(SUM(crt.amount), 0)::numeric AS amt
        FROM cash_returns crt
        JOIN cash_requests cr ON cr.id = crt.request_id
        WHERE cr.user_id = $1
          AND crt.confirmed_at IS NOT NULL
      ),
      cash_ret_pending AS (
        SELECT COALESCE(SUM(crt.amount), 0)::numeric AS amt
        FROM cash_returns crt
        JOIN cash_requests cr ON cr.id = crt.request_id
        WHERE cr.user_id = $1
          AND crt.confirmed_at IS NULL
      ),
      payouts AS (
        SELECT COALESCE(SUM(wp.amount), 0)::numeric AS amt
        FROM worker_payments wp
        LEFT JOIN works w ON w.id = wp.work_id
        WHERE wp.status IN ('paid', 'confirmed')
          AND wp.type IN ('salary', 'bonus', 'per_diem', 'advance', 'penalty')
          AND ${payoutsFilter}
      ),
      work_exp_direct AS (
        SELECT COALESCE(SUM(we.amount), 0)::numeric AS amt
        FROM work_expenses we
        LEFT JOIN works w ON w.id = we.work_id
        WHERE COALESCE(we.source_table, '') NOT IN ('worker_payments')
          AND ${workExpFilter}
      ),
      active AS (
        SELECT COUNT(*)::int AS cnt
        FROM cash_requests
        WHERE user_id = $1
          AND status NOT IN ('closed', 'rejected')
      )
    SELECT
      (SELECT amt FROM handovers)       AS handovers_received,
      (SELECT amt FROM se_legacy)       AS se_cash_legacy,
      (SELECT amt FROM cash_iss)        AS cash_advances_issued,
      (SELECT amt FROM cash_exp)        AS cash_expenses,
      (SELECT amt FROM cash_ret)         AS cash_returns_confirmed,
      (SELECT amt FROM cash_ret_pending) AS cash_returns_pending,
      (SELECT amt FROM payouts)         AS cash_payouts_workers,
      (SELECT amt FROM work_exp_direct) AS work_expenses_direct,
      (SELECT cnt FROM active)          AS active_requests
  `, [holderUserId]);

  const r = rows[0] || {};
  const handovers       = num(r.handovers_received);
  const seLegacy        = num(r.se_cash_legacy);
  const advances        = num(r.cash_advances_issued);
  const expenses        = num(r.cash_expenses);
  const returns         = num(r.cash_returns_confirmed);
  const returnsPending  = num(r.cash_returns_pending);
  const payouts         = num(r.cash_payouts_workers);
  const workExp         = num(r.work_expenses_direct);
  const active          = parseInt(r.active_requests, 10) || 0;

  const balance = handovers + seLegacy + advances - expenses - returns - payouts - workExp;

  return {
    handovers_received:     handovers,
    se_cash_legacy:         seLegacy,
    cash_advances_issued:   advances,
    cash_expenses:          expenses,
    cash_returns_confirmed: returns,
    cash_returns_pending:   returnsPending,
    cash_payouts_workers:   payouts,
    work_expenses_direct:   workExp,
    active_requests:        active,
    balance:                balance,
    holder_role:            role
  };
}

/**
 * Балансы всех подотчётников (PM, HEAD_PM, HEAD_TO).
 */
async function calcAllPmBalances(db) {
  const { rows: holders } = await db.query(`
    SELECT id, name, role
    FROM users
    WHERE role IN ('PM', 'HEAD_PM', 'HEAD_TO')
      AND COALESCE(is_active, true) = true
    ORDER BY name
  `);

  const results = [];
  for (const h of holders) {
    const b = await calcPmBalance(db, h.id, h.role);
    results.push({
      pm_id:                  h.id,
      pm_name:                h.name,
      holder_role:            h.role,
      handovers_received:     b.handovers_received,
      se_cash_legacy:         b.se_cash_legacy,
      cash_advances_issued:   b.cash_advances_issued,
      cash_expenses:          b.cash_expenses,
      cash_returns_confirmed: b.cash_returns_confirmed,
      cash_payouts_workers:   b.cash_payouts_workers,
      work_expenses_direct:   b.work_expenses_direct,
      handovers_pending_count: isHeadToHolder(h.role) ? 0 : await countPendingHandovers(db, h.id),
      handovers_pending_sum:  isHeadToHolder(h.role) ? 0 : await sumPendingHandovers(db, h.id),
      balance:                b.balance
    });
  }
  return results;
}

async function countPendingHandovers(db, pmUserId) {
  const { rows } = await db.query(`
    SELECT COUNT(*)::int AS cnt
    FROM worker_to_pm_handovers
    WHERE pm_user_id = $1 AND status = 'pending'
  `, [pmUserId]);
  return parseInt(rows[0]?.cnt, 10) || 0;
}

async function sumPendingHandovers(db, pmUserId) {
  const { rows } = await db.query(`
    SELECT COALESCE(SUM(expected_amount), 0)::numeric AS amt
    FROM worker_to_pm_handovers
    WHERE pm_user_id = $1 AND status = 'pending'
  `, [pmUserId]);
  return num(rows[0]?.amt);
}

function num(v) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function zeroBalance() {
  return {
    handovers_received: 0, se_cash_legacy: 0, cash_advances_issued: 0,
    cash_expenses: 0, cash_returns_confirmed: 0, cash_payouts_workers: 0,
    work_expenses_direct: 0, active_requests: 0, balance: 0
  };
}

module.exports = {
  calcPmBalance,
  calcAllPmBalances,
  CASH_HOLDER_PM_ROLES,
  CASH_HOLDER_HEAD_TO,
  isHeadToHolder
};
