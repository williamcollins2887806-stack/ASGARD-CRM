/**
 * Payroll Dashboard API
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/payroll-dashboard
 *
 * GET  /summary/:year/:month                  — сводка (заработано/перевод/возврат/касса)
 * GET  /self-employed-limits                  — годовой остаток лимита по СЗ
 * GET  /official-employees                    — таблица официальных
 * PUT  /official-employees/:id                — обновить оклад/статус
 *
 * Операции с самозанятыми:
 *   GET    /se-transfers/:year/:month                — список операций
 *   POST   /se-transfers                             — создать операцию
 *   PUT    /se-transfers/:id/confirm-transfer        — деньги переведены
 *   PUT    /se-transfers/:id/confirm-return          — наличные получены
 *   PUT    /se-transfers/:id/cancel                  — отменить
 *   GET    /se-transfers/employee/:id/year/:year     — операции рабочего за год
 *
 * GET /cash-flow/:year/:month                 — детально по каждому рабочему
 * GET /pm-balance                             — баланс всех РП
 * GET /pm-balance/:pm_id                      — детально по РП
 *
 * Доступ: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH
 */

const ACCESS_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH'];

async function getSettingNumber(db, key, fallback) {
  const { rows: [r] } = await db.query('SELECT value_json FROM settings WHERE key = $1', [key]);
  if (!r) return fallback;
  const v = parseFloat(String(r.value_json).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(v) ? v : fallback;
}

async function routes(fastify, options) {
  const db = fastify.db;

  // ─── GET /summary/:year/:month ────────────────────────────────────────────
  fastify.get('/summary/:year/:month', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const year  = parseInt(request.params.year, 10);
    const month = parseInt(request.params.month, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return reply.code(400).send({ error: 'Bad year/month' });

    const monthlyLimit = await getSettingNumber(db, 'self_employed_monthly_limit', 350000);
    const yearlyLimit  = await getSettingNumber(db, 'self_employed_yearly_limit', 2400000);

    // Заработано всеми за месяц (checkins + stages)
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const periodEnd   = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

    const { rows: ciSum } = await db.query(`
      SELECT
        fc.employee_id,
        COALESCE(SUM(fc.amount_earned), 0) AS earned
      FROM field_checkins fc
      WHERE fc.date BETWEEN $1 AND $2
        AND COALESCE(fc.status, 'active') != 'cancelled'
      GROUP BY fc.employee_id
    `, [periodStart, periodEnd]);

    const { rows: stSum } = await db.query(`
      SELECT
        fts.employee_id,
        COALESCE(SUM(fts.amount_earned), 0) AS earned
      FROM field_trip_stages fts
      WHERE fts.date_from <= $2 AND COALESCE(fts.date_to, fts.date_from) >= $1
        AND COALESCE(fts.status, 'active') != 'rejected'
      GROUP BY fts.employee_id
    `, [periodStart, periodEnd]);

    const earnedByEmp = {};
    for (const r of ciSum) earnedByEmp[r.employee_id] = Number(r.earned || 0);
    for (const r of stSum) earnedByEmp[r.employee_id] = (earnedByEmp[r.employee_id] || 0) + Number(r.earned || 0);

    const empIds = Object.keys(earnedByEmp).map(x => parseInt(x, 10));
    if (!empIds.length) {
      return {
        year, month,
        total_earned: 0, total_transfer: 0, total_cash_return: 0, total_cash_needed: 0,
        net_cash: 0, agreement_transfers_count: 0, agreement_transfers_sum: 0,
        by_mode: { self_employed: 0, official: 0, cash: 0 },
      };
    }

    const { rows: emps } = await db.query(`
      SELECT id, fio, is_self_employed, is_officially_employed, can_exceed_limit,
             official_salary, official_status, official_non_burnable
      FROM employees WHERE id = ANY($1::int[])
    `, [empIds]);

    const { rows: yearlySum } = await db.query(`
      SELECT employee_id, COALESCE(SUM(transfer_amount), 0) AS yr_sum
      FROM se_transfers
      WHERE employee_id = ANY($1::int[]) AND year = $2 AND status != 'cancelled'
      GROUP BY employee_id
    `, [empIds, year]);
    const yearlyByEmp = {};
    for (const r of yearlySum) yearlyByEmp[r.employee_id] = Number(r.yr_sum || 0);

    const { rows: agreementSum } = await db.query(`
      SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(transfer_amount), 0) AS sum
      FROM se_transfers
      WHERE year = $1 AND month = $2 AND operation_type = 'agreement_transfer' AND status != 'cancelled'
    `, [year, month]);

    let total_earned = 0, total_transfer = 0, total_cash_return = 0, total_cash_needed = 0;
    let mode_self = 0, mode_off = 0, mode_cash = 0;

    for (const emp of emps) {
      const earned = earnedByEmp[emp.id] || 0;
      total_earned += earned;

      if (emp.is_self_employed) {
        mode_self += 1;
        const yrSum = yearlyByEmp[emp.id] || 0;
        const yrRemain = Math.max(0, yearlyLimit - yrSum);
        let transfer = monthlyLimit;
        if (emp.can_exceed_limit && earned > monthlyLimit) {
          transfer = earned;
        }
        transfer = Math.min(transfer, yrRemain);
        const cashReturn = Math.max(0, transfer - earned);
        const cashPayout = Math.max(0, earned - transfer);
        total_transfer    += transfer;
        total_cash_return += cashReturn;
        total_cash_needed += cashPayout;
      } else if (emp.is_officially_employed) {
        mode_off += 1;
        const salary = Number(emp.official_salary || 0);
        const transfer = emp.official_status === 'unpaid_leave' ? 0 : salary;
        const cashNeeded = Math.max(0, earned - salary);
        total_transfer    += transfer;
        total_cash_needed += cashNeeded;
      } else {
        mode_cash += 1;
        total_cash_needed += earned;
      }
    }

    const net_cash = total_cash_return - total_cash_needed;

    return {
      year, month,
      monthly_limit: monthlyLimit,
      yearly_limit:  yearlyLimit,
      total_earned, total_transfer, total_cash_return, total_cash_needed,
      net_cash,
      agreement_transfers_count: Number(agreementSum[0]?.cnt || 0),
      agreement_transfers_sum:   Number(agreementSum[0]?.sum || 0),
      by_mode: { self_employed: mode_self, official: mode_off, cash: mode_cash },
    };
  });

  // ─── GET /self-employed-limits ────────────────────────────────────────────
  fastify.get('/self-employed-limits', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async () => {
    const yearlyLimit = await getSettingNumber(db, 'self_employed_yearly_limit', 2400000);
    const year = new Date().getFullYear();
    const { rows } = await db.query(`
      SELECT
        e.id, e.fio,
        COALESCE(SUM(t.transfer_amount) FILTER (WHERE t.status != 'cancelled'), 0) AS transferred_year
      FROM employees e
      LEFT JOIN se_transfers t ON t.employee_id = e.id AND t.year = $1
      WHERE e.is_self_employed = true AND e.is_active = true
      GROUP BY e.id, e.fio
      ORDER BY transferred_year DESC, e.fio
    `, [year]);
    return {
      year,
      yearly_limit: yearlyLimit,
      employees: rows.map(r => ({
        ...r,
        transferred_year: Number(r.transferred_year || 0),
        remaining: yearlyLimit - Number(r.transferred_year || 0),
      })),
    };
  });

  // ─── GET /official-employees ──────────────────────────────────────────────
  fastify.get('/official-employees', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async () => {
    const { rows } = await db.query(`
      SELECT
        e.id, e.fio, e.phone, e.role_tag,
        e.official_salary, e.official_non_burnable, e.official_hire_date,
        e.official_status, e.official_leave_from, e.official_leave_to
      FROM employees e
      WHERE e.is_officially_employed = true AND e.is_active = true
      ORDER BY e.fio
    `);
    return { employees: rows };
  });

  // ─── PUT /official-employees/:id ──────────────────────────────────────────
  fastify.put('/official-employees/:id', { preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'BUH'])] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const allowed = ['official_salary', 'official_non_burnable', 'official_hire_date',
                     'official_status', 'official_leave_from', 'official_leave_to',
                     'is_officially_employed', 'is_self_employed'];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [k, v] of Object.entries(request.body || {})) {
      if (!allowed.includes(k)) continue;
      updates.push(`${k} = $${idx}`); values.push(v); idx++;
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });

    // Взаимоисключение
    const body = request.body || {};
    if (body.is_officially_employed === true && body.is_self_employed !== false) {
      updates.push(`is_self_employed = false`);
    }
    if (body.is_self_employed === true && body.is_officially_employed !== false) {
      updates.push(`is_officially_employed = false`);
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    try {
      const { rows } = await db.query(
        `UPDATE employees SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Не найден' });
      return { employee: rows[0] };
    } catch (e) {
      if (e.code === '23514') {
        return reply.code(400).send({ error: 'Рабочий не может быть одновременно самозанятым и официально устроенным' });
      }
      throw e;
    }
  });

  // ─── GET /se-transfers/:year/:month ───────────────────────────────────────
  fastify.get('/se-transfers/:year/:month', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request) => {
    const year  = parseInt(request.params.year, 10);
    const month = parseInt(request.params.month, 10);
    const { rows } = await db.query(`
      SELECT
        t.*,
        e.fio,
        w.work_title,
        cb.name AS created_by_name,
        cf.name AS confirmed_by_name
      FROM se_transfers t
      LEFT JOIN employees e ON e.id = t.employee_id
      LEFT JOIN works w     ON w.id = t.work_id
      LEFT JOIN users cb    ON cb.id = t.created_by
      LEFT JOIN users cf    ON cf.id = t.confirmed_by
      WHERE t.year = $1 AND t.month = $2
      ORDER BY t.created_at DESC
    `, [year, month]);
    return { transfers: rows };
  });

  // ─── POST /se-transfers ───────────────────────────────────────────────────
  fastify.post('/se-transfers', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const { employee_id, year, month, operation_type, transfer_amount, earned_amount, work_id, comment } = request.body || {};
    if (!employee_id || !year || !month || !operation_type) {
      return reply.code(400).send({ error: 'employee_id, year, month, operation_type обязательны' });
    }
    if (!['work_transfer', 'agreement_transfer'].includes(operation_type)) {
      return reply.code(400).send({ error: 'Недопустимый operation_type' });
    }

    const { rows: [emp] } = await db.query(
      'SELECT is_self_employed, is_officially_employed FROM employees WHERE id = $1',
      [employee_id]
    );
    if (!emp) return reply.code(404).send({ error: 'Сотрудник не найден' });
    if (!emp.is_self_employed) {
      return reply.code(400).send({ error: 'Рабочий не самозанятый' });
    }
    if (emp.is_officially_employed) {
      return reply.code(400).send({ error: 'Рабочий официально устроен — переводы СЗ невозможны' });
    }

    // ИНН
    const { rows: [se] } = await db.query('SELECT inn FROM self_employed WHERE employee_id = $1', [employee_id]);
    if (!se || !se.inn) {
      return reply.code(400).send({ error: 'У рабочего не заполнен ИНН самозанятого' });
    }

    // Годовой лимит
    const yearlyLimit = await getSettingNumber(db, 'self_employed_yearly_limit', 2400000);
    const { rows: [sum] } = await db.query(`
      SELECT COALESCE(SUM(transfer_amount), 0) AS yr_sum
      FROM se_transfers WHERE employee_id = $1 AND year = $2 AND status != 'cancelled'
    `, [employee_id, year]);
    const yrSum = Number(sum.yr_sum || 0);
    const remaining = Math.max(0, yearlyLimit - yrSum);
    const transferNum = Number(transfer_amount);
    if (transferNum + yrSum > yearlyLimit) {
      return reply.code(400).send({ error: 'Превышен годовой лимит НПД', remaining });
    }

    // Сценарий — поля
    const earnedNum = Number(earned_amount || 0);
    if (operation_type === 'agreement_transfer' && earnedNum !== 0) {
      return reply.code(400).send({ error: 'Для agreement_transfer earned_amount должен быть 0' });
    }
    if (operation_type === 'work_transfer' && earnedNum <= 0) {
      return reply.code(400).send({ error: 'Для work_transfer earned_amount должен быть > 0' });
    }
    const cashReturn = operation_type === 'agreement_transfer'
      ? transferNum
      : Math.max(0, transferNum - earnedNum);
    const cashPayout = operation_type === 'work_transfer'
      ? Math.max(0, earnedNum - transferNum)
      : 0;

    // pm_user_id из works
    let pmUserId = null;
    if (work_id) {
      const { rows: [w] } = await db.query('SELECT pm_id FROM works WHERE id = $1', [work_id]);
      pmUserId = w?.pm_id || null;
    }

    const { rows: [created] } = await db.query(`
      INSERT INTO se_transfers
        (employee_id, year, month, operation_type, earned_amount, transfer_amount,
         cash_return_amount, cash_payout_amount, work_id, pm_user_id, inn,
         status, comment, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'planned', $12, $13)
      RETURNING *
    `, [employee_id, year, month, operation_type, earnedNum, transferNum,
        cashReturn, cashPayout, work_id || null, pmUserId, se.inn,
        comment || null, request.user.id]);

    return { transfer: created };
  });

  // ─── PUT /se-transfers/:id/confirm-transfer ───────────────────────────────
  fastify.put('/se-transfers/:id/confirm-transfer', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [t] } = await db.query('SELECT status FROM se_transfers WHERE id = $1', [id]);
    if (!t) return reply.code(404).send({ error: 'Операция не найдена' });
    if (t.status !== 'planned') return reply.code(409).send({ error: 'Можно только из planned' });

    await db.query(`
      UPDATE se_transfers SET status = 'transferred', transferred_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [id]);
    return { ok: true };
  });

  // ─── PUT /se-transfers/:id/confirm-return ─────────────────────────────────
  fastify.put('/se-transfers/:id/confirm-return', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: [t] } = await db.query('SELECT status FROM se_transfers WHERE id = $1', [id]);
    if (!t) return reply.code(404).send({ error: 'Операция не найдена' });
    if (t.status !== 'transferred') return reply.code(409).send({ error: 'Можно только из transferred' });

    await db.query(`
      UPDATE se_transfers SET
        status = 'completed', returned_at = NOW(), confirmed_by = $1, updated_at = NOW()
      WHERE id = $2
    `, [request.user.id, id]);
    return { ok: true };
  });

  // ─── PUT /se-transfers/:id/cancel ─────────────────────────────────────────
  fastify.put('/se-transfers/:id/cancel', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    await db.query(`
      UPDATE se_transfers SET status = 'cancelled', updated_at = NOW() WHERE id = $1
    `, [id]);
    return { ok: true };
  });

  // ─── GET /se-transfers/employee/:id/year/:year ────────────────────────────
  fastify.get('/se-transfers/employee/:id/year/:year', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request) => {
    const empId = parseInt(request.params.id, 10);
    const year  = parseInt(request.params.year, 10);
    const { rows } = await db.query(`
      SELECT t.*, w.work_title
      FROM se_transfers t
      LEFT JOIN works w ON w.id = t.work_id
      WHERE t.employee_id = $1 AND t.year = $2
      ORDER BY t.month DESC, t.created_at DESC
    `, [empId, year]);
    return { transfers: rows };
  });

  // ─── GET /cash-flow/:year/:month ──────────────────────────────────────────
  fastify.get('/cash-flow/:year/:month', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request) => {
    const year  = parseInt(request.params.year, 10);
    const month = parseInt(request.params.month, 10);
    const { rows } = await db.query(`
      SELECT
        t.employee_id, e.fio,
        SUM(t.transfer_amount)     AS transfer_total,
        SUM(t.cash_return_amount)  AS cash_return_total,
        SUM(t.cash_payout_amount)  AS cash_payout_total
      FROM se_transfers t
      JOIN employees e ON e.id = t.employee_id
      WHERE t.year = $1 AND t.month = $2 AND t.status != 'cancelled'
      GROUP BY t.employee_id, e.fio
      ORDER BY e.fio
    `, [year, month]);
    return { year, month, items: rows };
  });

  // ─── GET /pm-balance — баланс всех РП ────────────────────────────────────
  fastify.get('/pm-balance', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request, reply) => {
    try {
      const { rows } = await db.query(`
        WITH pms AS (
          SELECT id, name FROM users WHERE role IN ('PM','HEAD_PM') AND COALESCE(is_active, true) = true
        ),
        cash_in AS (
          SELECT user_id, COALESCE(SUM(amount), 0) AS amt
          FROM cash_requests
          WHERE status IN ('received','reporting')
          GROUP BY user_id
        ),
        se_cash AS (
          SELECT pm_user_id AS user_id, COALESCE(SUM(cash_return_amount), 0) AS amt
          FROM se_transfers
          WHERE status IN ('completed','returned')
          GROUP BY pm_user_id
        ),
        cash_exp AS (
          SELECT cr.user_id, COALESCE(SUM(ce.amount), 0) AS amt
          FROM cash_expenses ce
          JOIN cash_requests cr ON cr.id = ce.request_id
          GROUP BY cr.user_id
        ),
        cash_ret AS (
          SELECT cr.user_id, COALESCE(SUM(crt.amount), 0) AS amt
          FROM cash_returns crt
          JOIN cash_requests cr ON cr.id = crt.request_id
          GROUP BY cr.user_id
        ),
        sal_cash AS (
          SELECT w.pm_id AS user_id, COALESCE(SUM(wp.amount), 0) AS amt
          FROM worker_payments wp
          JOIN works w ON w.id = wp.work_id
          WHERE wp.payment_method = 'cash' AND wp.status = 'paid'
          GROUP BY w.pm_id
        )
        SELECT
          p.id AS pm_id, p.name AS pm_name,
          COALESCE(ci.amt, 0)  AS cash_in,
          COALESCE(sc.amt, 0)  AS se_cash_in,
          COALESCE(ce.amt, 0)  AS cash_out_expenses,
          COALESCE(cr.amt, 0)  AS cash_out_returns,
          COALESCE(sl.amt, 0)  AS cash_out_salaries,
          (COALESCE(ci.amt,0) + COALESCE(sc.amt,0)
           - COALESCE(ce.amt,0) - COALESCE(cr.amt,0) - COALESCE(sl.amt,0)) AS balance
        FROM pms p
        LEFT JOIN cash_in   ci ON ci.user_id = p.id
        LEFT JOIN se_cash   sc ON sc.user_id = p.id
        LEFT JOIN cash_exp  ce ON ce.user_id = p.id
        LEFT JOIN cash_ret  cr ON cr.user_id = p.id
        LEFT JOIN sal_cash  sl ON sl.user_id = p.id
        ORDER BY p.name
      `);
      return { pms: rows };
    } catch (e) {
      fastify.log.warn('[pm-balance] fallback: ' + e.message);
      // Простой фолбэк: только PM-список без cash-таблиц
      const { rows: pms } = await db.query(`
        SELECT id AS pm_id, name AS pm_name, 0 AS cash_in, 0 AS se_cash_in,
               0 AS cash_out_expenses, 0 AS cash_out_returns, 0 AS cash_out_salaries,
               0 AS balance
        FROM users WHERE role IN ('PM','HEAD_PM') AND COALESCE(is_active, true) = true
        ORDER BY name
      `);
      return { pms, note: 'cash_* / worker_payments не доступны: ' + e.message };
    }
  });

  // ─── GET /pm-balance/:pm_id — детализация ─────────────────────────────────
  fastify.get('/pm-balance/:pm_id', { preHandler: [fastify.requireRoles(ACCESS_ROLES)] }, async (request) => {
    const pmId = parseInt(request.params.pm_id, 10);
    const out = { pm_id: pmId, items: { cash_requests: [], se_transfers: [], cash_expenses: [], cash_returns: [], worker_payments: [] } };

    try {
      const { rows: cr } = await db.query(`SELECT id, amount, status, created_at FROM cash_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [pmId]);
      out.items.cash_requests = cr;
    } catch (_) {}

    try {
      const { rows: sr } = await db.query(`SELECT id, employee_id, transfer_amount, cash_return_amount, status, created_at FROM se_transfers WHERE pm_user_id = $1 ORDER BY created_at DESC LIMIT 100`, [pmId]);
      out.items.se_transfers = sr;
    } catch (_) {}

    return out;
  });
}

module.exports = routes;
