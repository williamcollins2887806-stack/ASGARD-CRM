'use strict';

/**
 * Payout Row — строка списка выплат по сотруднику за месяц.
 * ═══════════════════════════════════════════════════════════════════════════
 * Формула (решение заказчика):
 *   к_выплате = остаток + начислено + премия − удержание/штраф − аванс − оклад
 *
 * Где:
 *   начислено   = чистый заработок за месяц (дни × ставка): field_checkins
 *                 (status='completed') + field_trip_stages, БЕЗ премий/штрафов/
 *                 авансов/суточных.
 *   остаток     = перенос с прошлых периодов:
 *                 (начислено_до + премии_до − штрафы_до) − (авансы_до + зарплаты_до)
 *                 Строго ДО начала месяца — чтобы не задвоить текущий период.
 *   премия      = worker_payments type='bonus' (paid/confirmed) за месяц.
 *   штраф       = worker_payments type='penalty' (status != 'cancelled') за месяц.
 *   аванс       = worker_payments type='advance' (paid/confirmed) за месяц — уже выплачен.
 *   оклад       = worker_payments type='salary' (paid/confirmed) за месяц для
 *                 официально устроенных (оклад платится отдельно и раньше).
 *
 * ВАЖНО (урок аудита): база — начисление, НЕ `total_pending`. `total_pending`
 * уже включает текущий месяц и все вычеты, повторное прибавление/вычитание
 * даёт двойной счёт.
 */

const MONTH_START = (year, month) => `${year}-${String(month).padStart(2, '0')}-01`;
const MONTH_END = (year, month) => {
  const last = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10), 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
};

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
function money(v) {
  return Math.round(num(v) * 100) / 100;
}

/**
 * Строит строки списка выплат за (year, month).
 * @returns {Promise<{year,month,rows:Array,totals:object}>}
 */
async function buildPayoutRows(db, year, month) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const from = MONTH_START(y, m);
  const to = MONTH_END(y, m);
  const periodId = y * 100 + m; // сравнение периодов (год*100+месяц)

  // ── 1. Начислено за месяц: ФОТ из смен (completed) + этапов ──────────────
  // Смены: одна дата → всегда в одном месяце. Этапы: могут пересекать границу
  // месяца → считаем ПРОПОРЦИОНАЛЬНО дням, попавшим в период (иначе двойной счёт).
  const { rows: fotMonth } = await db.query(
    `
    SELECT employee_id, SUM(s)::numeric AS fot FROM (
      SELECT employee_id, SUM(COALESCE(amount_earned,0)) AS s
        FROM field_checkins
       WHERE date BETWEEN $1::date AND $2::date
         AND status = 'completed'
       GROUP BY employee_id
      UNION ALL
      SELECT employee_id,
             SUM(
               COALESCE(amount_earned,0)
               * ( LEAST(COALESCE(date_to, date_from), $2::date)
                   - GREATEST(date_from, $1::date) + 1 )
               / NULLIF( (COALESCE(date_to, date_from) - date_from + 1), 0 )
             ) AS s
        FROM field_trip_stages
       WHERE date_from <= $2::date
         AND COALESCE(date_to, date_from) >= $1::date
         AND COALESCE(status,'active') IN ('active','completed','approved','adjusted')
       GROUP BY employee_id
    ) t
    GROUP BY employee_id
    `,
    [from, to]
  );

  // ── 2. Начислено до месяца (для остатка) ─────────────────────────────────
  const { rows: fotBefore } = await db.query(
    `
    SELECT employee_id, SUM(s)::numeric AS fot FROM (
      SELECT employee_id, SUM(COALESCE(amount_earned,0)) AS s
        FROM field_checkins
       WHERE date < $1::date AND status = 'completed'
       GROUP BY employee_id
      UNION ALL
      SELECT employee_id,
             SUM(
               COALESCE(amount_earned,0)
               * ( LEAST(COALESCE(date_to, date_from), $1::date - 1)
                   - date_from + 1 )
               / NULLIF( (COALESCE(date_to, date_from) - date_from + 1), 0 )
             ) AS s
        FROM field_trip_stages
       WHERE date_from < $1::date
         AND COALESCE(status,'active') IN ('active','completed','approved','adjusted')
       GROUP BY employee_id
    ) t
    GROUP BY employee_id
    `,
    [from]
  );

  // ── 3. Выплаты за месяц по типам ─────────────────────────────────────────
  const { rows: payMonth } = await db.query(
    `
    SELECT employee_id, type, status,
           SUM(amount)::numeric AS amount
      FROM worker_payments
     WHERE COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) = $1
       AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $2
     GROUP BY employee_id, type, status
    `,
    [y, m]
  );

  // ── 4. Выплаты до месяца (для остатка) ───────────────────────────────────
  const { rows: payBefore } = await db.query(
    `
    SELECT employee_id, type, status,
           SUM(amount)::numeric AS amount
      FROM worker_payments
     WHERE (COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) * 100
            + COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int)) < $1
     GROUP BY employee_id, type, status
    `,
    [periodId]
  );

  // ── 5b. Детали выплат за период (статус подтверждения для списка) ────────
  let detailMap = new Map();
  try {
    const { rows: payDetail } = await db.query(
      `SELECT DISTINCT ON (employee_id)
              employee_id, id AS payment_id, type, status,
              confirmation_status, confirmation_deadline
         FROM worker_payments
        WHERE COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) = $1
          AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $2
          AND status IN ('paid','confirmed')
        ORDER BY employee_id, id DESC`, [y, m]);
    detailMap = new Map(payDetail.map((r) => [r.employee_id, r]));
  } catch (_) { /* колонок может не быть на старом клоне */ }

  // ── 5. Профили сотрудников (только те, у кого есть активность) ───────────
  const empIds = new Set();
  for (const r of fotMonth) empIds.add(r.employee_id);
  for (const r of fotBefore) empIds.add(r.employee_id);
  for (const r of payMonth) empIds.add(r.employee_id);
  for (const r of payBefore) empIds.add(r.employee_id);

  let empMap = new Map();
  if (empIds.size) {
    const { rows: emps } = await db.query(
      `
      SELECT e.id,
             ${empName(empIds)},
             e.is_self_employed, e.is_officially_employed,
             e.official_salary, e.official_non_burnable, e.official_status,
             e.se_payee_id, e.is_se_payee, e.is_active
        FROM employees e
       WHERE e.id = ANY($1::int[])
      `,
      [Array.from(empIds)]
    );
    empMap = new Map(emps.map((e) => [e.id, e]));
  }

  // helpers агрегации выплат
  const mkPay = () => ({ advance: 0, penalty: 0, salary: 0, bonus: 0, per_diem: 0 });
  const aggMonth = new Map();
  for (const r of payMonth) {
    if (!aggMonth.has(r.employee_id)) aggMonth.set(r.employee_id, mkPay());
    const a = aggMonth.get(r.employee_id);
    const amt = num(r.amount);
    if (r.type === 'advance' && ['paid', 'confirmed'].includes(r.status)) a.advance += amt;
    if (r.type === 'penalty' && r.status !== 'cancelled') a.penalty += amt;
    if (r.type === 'salary' && ['paid', 'confirmed'].includes(r.status)) a.salary += amt;
    if (r.type === 'bonus' && ['paid', 'confirmed'].includes(r.status)) a.bonus += amt;
    if (r.type === 'per_diem' && ['paid', 'confirmed'].includes(r.status)) a.per_diem += amt;
  }
  const aggBefore = new Map();
  for (const r of payBefore) {
    if (!aggBefore.has(r.employee_id)) aggBefore.set(r.employee_id, mkPay());
    const a = aggBefore.get(r.employee_id);
    const amt = num(r.amount);
    if (r.type === 'advance' && ['paid', 'confirmed'].includes(r.status)) a.advance += amt;
    if (r.type === 'penalty' && r.status !== 'cancelled') a.penalty += amt;
    if (r.type === 'salary' && ['paid', 'confirmed'].includes(r.status)) a.salary += amt;
    if (r.type === 'bonus' && ['paid', 'confirmed'].includes(r.status)) a.bonus += amt;
  }

  const fotMonthMap = new Map(fotMonth.map((r) => [r.employee_id, num(r.fot)]));
  const fotBeforeMap = new Map(fotBefore.map((r) => [r.employee_id, num(r.fot)]));

  const rows = [];
  const totals = {
    accrued: 0, carry: 0, advance: 0, penalty: 0, official: 0, bonus: 0, to_pay: 0,
    employees: 0, overpaid_count: 0, paid_this_month: 0,
  };

  // Выплачено за месяц (paid/confirmed всех типов со знаком) — для KPI/графика
  try {
    const { rows: paidAgg } = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN type IN ('salary','advance','bonus') THEN amount ELSE 0 END)
                     - SUM(CASE WHEN type='penalty' THEN amount ELSE 0 END), 0)::numeric AS paid
         FROM worker_payments
        WHERE COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) = $1
          AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $2
          AND status IN ('paid','confirmed')`, [y, m]);
    totals.paid_this_month = money(paidAgg[0] ? paidAgg[0].paid : 0);
  } catch (_) {}

  for (const [empId, emp] of empMap) {
    const accrued = money(fotMonthMap.get(empId) || 0);
    const month = aggMonth.get(empId) || mkPay();
    const before = aggBefore.get(empId) || mkPay();

    // Перенос с прошлых периодов
    const earnedBefore = num(fotBeforeMap.get(empId)) + before.bonus - before.penalty;
    const paidBefore = before.advance + before.salary;
    const carry = money(earnedBefore - paidBefore);

    const advance = money(month.advance);
    const penalty = money(month.penalty);
    const official = money(month.salary);
    const bonus = money(month.bonus);

    const toPay = money(carry + accrued + bonus - penalty - advance - official);

    // Показываем, если есть хоть что-то (иначе «пустой» не нужен)
    const hasAny = accrued !== 0 || carry !== 0 || advance !== 0 || penalty !== 0 ||
                   official !== 0 || bonus !== 0;
    if (!hasAny) continue;

    const fio = (emp.fio || emp.full_name || '').trim() || ('ID ' + empId);
    const det = detailMap.get(empId);
    const rec = {
      employee_id: empId,
      fio,
      is_self_employed: !!emp.is_self_employed,
      is_officially_employed: !!emp.is_officially_employed,
      official_salary: num(emp.official_salary),
      se_payee_id: emp.se_payee_id || null,
      accrued,
      carry,
      advance,
      penalty,
      official,
      bonus,
      to_pay: toPay,
      overpaid: toPay < 0,
      ready: true,
      // Детали выплаты за период (для статусов строки)
      payment_id: det ? det.payment_id : null,
      paid_this_period: !!det,
      confirm: det ? det.confirmation_status : null,
      overdue: det && det.confirmation_status === 'awaiting' && det.confirmation_deadline
        ? new Date(det.confirmation_deadline) < new Date() : false,
    };
    rows.push(rec);

    totals.accrued += accrued;
    totals.carry += carry;
    totals.advance += advance;
    totals.penalty += penalty;
    totals.official += official;
    totals.bonus += bonus;
    totals.to_pay += toPay;
    totals.employees += 1;
    if (toPay < 0) totals.overpaid_count += 1;
  }

  // Сортировка по алфавиту (русская локаль через toLowerCase + localeCompare)
  rows.sort((a, b) => a.fio.localeCompare(b.fio, 'ru'));

  for (const k of Object.keys(totals)) {
    if (typeof totals[k] === 'number' && k !== 'employees' && k !== 'overpaid_count') {
      totals[k] = money(totals[k]);
    }
  }

  return { year: y, month: m, from, to, rows, totals };
}

/** ФИО: COALESCE(fio, full_name, 'ID N') */
function empName() {
  return `COALESCE(NULLIF(TRIM(e.fio),''), NULLIF(TRIM(e.full_name),''), 'ID ' || e.id) AS fio,
          NULLIF(TRIM(e.full_name),'') AS full_name`;
}

module.exports = { buildPayoutRows, MONTH_START, MONTH_END };
