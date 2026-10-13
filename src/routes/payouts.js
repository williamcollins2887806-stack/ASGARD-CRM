'use strict';

/**
 * Payouts API — страница выплат (#/payouts)
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/payouts
 *
 * Доступ: роль (ADMIN, DIRECTOR_*, BUH) ИЛИ персональный грант
 *         settings.payout_manager_user_ids (Дима Путков).
 *
 * Этап 2 (текущий):
 *   GET /warnings/:year/:month  — мягкие предупреждения готовности периода
 *                                 (НЕ блокируют выплату, см. src/lib/payout-period.js)
 *   GET /me                     — кто я и есть ли доступ (для UI)
 *
 * Дальше (Этап 3+): /list, /employee/:id/summary, /pay, /archive, /history.
 */

const { requirePayoutAccess, hasPayoutAccess, getPayoutManagerIds } = require('../lib/payouts-access');
const { getPeriodWarnings } = require('../lib/payout-period');
const { buildPayoutRows } = require('../lib/payout-row');
const { logError } = require('../lib/log-error');

function isValidPeriod(year, month) {
  const yStr = String(year).trim();
  const mStr = String(month).trim();
  // Строгая проверка: только целые числа без «хвостов» (9abc → невалидно).
  if (!/^\d+$/.test(yStr) || !/^\d+$/.test(mStr)) return false;
  const y = Number(yStr);
  const m = Number(mStr);
  return Number.isInteger(y) && y >= 2020 && y <= 2099 && Number.isInteger(m) && m >= 1 && m <= 12;
}

async function routes(fastify, options) {
  const db = fastify.db;
  const payoutAuth = { preHandler: [requirePayoutAccess(fastify)] };

  // ─── GET /me — доступ и роль (для UI: показать/скрыть страницу) ───────────
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const allowed = await hasPayoutAccess(db, request.user);
      return reply.send({
        allowed,
        role: request.user ? request.user.role : null,
        user_id: request.user ? request.user.id : null,
      });
    } catch (err) {
      logError(fastify, '[payouts] GET /me error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /warnings/:year/:month — предупреждения периода (мягкие) ─────────
  fastify.get('/warnings/:year/:month', payoutAuth, async (request, reply) => {
    const { year, month } = request.params;
    if (!isValidPeriod(year, month)) {
      return reply.code(400).send({ error: 'Некорректный период (год/месяц)' });
    }
    try {
      const result = await getPeriodWarnings(db, year, month);
      // ready_to_pay: мягкий флаг для UI (true, если нет warn-предупреждений).
      const ready_to_pay = !result.warnings.some((w) => w.level === 'warn');
      return reply.send({ year: parseInt(year, 10), month: parseInt(month, 10), ready_to_pay, ...result });
    } catch (err) {
      logError(fastify, '[payouts] GET /warnings error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /list/:year/:month — строки списка выплат ────────────────────────
  fastify.get('/list/:year/:month', payoutAuth, async (request, reply) => {
    const { year, month } = request.params;
    if (!isValidPeriod(year, month)) {
      return reply.code(400).send({ error: 'Некорректный период (год/месяц)' });
    }
    try {
      const [list, warn] = await Promise.all([
        buildPayoutRows(db, year, month),
        getPeriodWarnings(db, year, month),
      ]);
      const ready_to_pay = !warn.warnings.some((w) => w.level === 'warn');
      // Строки с предупреждениями периода помечаем (мягко, не блокируем)
      const warnEmpIds = new Set();
      for (const w of warn.warnings) {
        if (w.level === 'warn' && Array.isArray(w.employee_ids)) {
          for (const id of w.employee_ids) warnEmpIds.add(id);
        }
      }
      for (const r of list.rows) {
        if (warnEmpIds.has(r.employee_id)) r.warning = true;
      }
      return reply.send({ ...list, ready_to_pay, warnings: warn.warnings });
    } catch (err) {
      logError(fastify, '[payouts] GET /list error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /archive/years — годы, за которые есть выплаты ────────────────────
  fastify.get('/archive/years', payoutAuth, async (request, reply) => {
    try {
      const { rows } = await db.query(`
        SELECT DISTINCT COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) AS year
          FROM worker_payments
         WHERE COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) IS NOT NULL
         ORDER BY year DESC
      `);
      return reply.send({ years: rows.map((r) => r.year).filter(Boolean) });
    } catch (err) {
      logError(fastify, '[payouts] GET /archive/years error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /archive/:year/:month — кто получил выплаты в месяце ─────────────
  fastify.get('/archive/:year/:month', payoutAuth, async (request, reply) => {
    const { year, month } = request.params;
    if (!isValidPeriod(year, month)) {
      return reply.code(400).send({ error: 'Некорректный период (год/месяц)' });
    }
    try {
      const { rows } = await db.query(`
        SELECT wp.employee_id,
               COALESCE(NULLIF(TRIM(e.fio),''), NULLIF(TRIM(e.full_name),''), 'ID ' || e.id) AS fio,
               wp.type,
               SUM(wp.amount)::numeric AS amount,
               MAX(wp.paid_at) AS last_paid_at
          FROM worker_payments wp
          JOIN employees e ON e.id = wp.employee_id
         WHERE COALESCE(wp.pay_year, EXTRACT(YEAR FROM wp.created_at)::int) = $1
           AND COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int) = $2
           AND wp.status IN ('paid','confirmed')
         GROUP BY wp.employee_id, e.fio, e.full_name, e.id, wp.type
         ORDER BY fio
      `, [parseInt(year, 10), parseInt(month, 10)]);

      // свернуть по сотруднику
      const byEmp = new Map();
      for (const r of rows) {
        if (!byEmp.has(r.employee_id)) {
          byEmp.set(r.employee_id, { employee_id: r.employee_id, fio: r.fio, total: 0, by_type: {}, last_paid_at: null });
        }
        const e = byEmp.get(r.employee_id);
        e.total = Math.round((e.total + parseFloat(r.amount)) * 100) / 100;
        e.by_type[r.type] = Math.round(((e.by_type[r.type] || 0) + parseFloat(r.amount)) * 100) / 100;
        if (r.last_paid_at && (!e.last_paid_at || r.last_paid_at > e.last_paid_at)) e.last_paid_at = r.last_paid_at;
      }
      const list = Array.from(byEmp.values()).sort((a, b) => a.fio.localeCompare(b.fio, 'ru'));
      return reply.send({ year: parseInt(year, 10), month: parseInt(month, 10), rows: list, count: list.length });
    } catch (err) {
      logError(fastify, '[payouts] GET /archive error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /employee/:id/summary — дашборд сотрудника ───────────────────────
  // Выплачено за всё время (ФОТ без суточных = salary+advance+bonus−penalty по paid/confirmed),
  // среднее по годам, помесячный ряд текущего года.
  fastify.get('/employee/:id/summary', payoutAuth, async (request, reply) => {
    const empId = parseInt(request.params.id, 10);
    if (!Number.isInteger(empId) || empId <= 0) {
      return reply.code(400).send({ error: 'Некорректный id сотрудника' });
    }
    try {
      const { rows: yrs } = await db.query(`
        SELECT COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) AS year,
               SUM(CASE WHEN type IN ('salary','advance','bonus') THEN amount ELSE 0 END)
             - SUM(CASE WHEN type='penalty' THEN amount ELSE 0 END) AS paid
          FROM worker_payments
         WHERE employee_id = $1 AND status IN ('paid','confirmed')
         GROUP BY 1 ORDER BY 1
      `, [empId]);

      const totalPaid = yrs.reduce((s, r) => s + parseFloat(r.paid || 0), 0);
      const byYear = yrs.map((r) => ({ year: r.year, paid: Math.round(parseFloat(r.paid || 0) * 100) / 100 }));
      const avgByYear = byYear.length ? Math.round((totalPaid / byYear.length) * 100) / 100 : 0;

      const { rows: months } = await db.query(`
        SELECT COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) AS month,
               SUM(CASE WHEN type IN ('salary','advance','bonus') THEN amount ELSE 0 END)
             - SUM(CASE WHEN type='penalty' THEN amount ELSE 0 END) AS paid
          FROM worker_payments
         WHERE employee_id = $1 AND status IN ('paid','confirmed')
           AND COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) = EXTRACT(YEAR FROM NOW())::int
         GROUP BY 1 ORDER BY 1
      `, [empId]);
      const monthRow = Array.from({ length: 12 }, (_, i) => {
        const found = months.find((m) => m.month === i + 1);
        return { month: i + 1, paid: found ? Math.round(parseFloat(found.paid) * 100) / 100 : 0 };
      });

      const { rows: empRows } = await db.query(
        `SELECT id, COALESCE(NULLIF(TRIM(fio),''), NULLIF(TRIM(full_name),''), 'ID '||id) AS fio,
                is_self_employed, is_officially_employed
           FROM employees WHERE id = $1`, [empId]);

      return reply.send({
        employee: empRows[0] || { id: empId },
        total_paid_all_time: Math.round(totalPaid * 100) / 100,
        avg_per_year: avgByYear,
        by_year: byYear,
        current_year_months: monthRow,
      });
    } catch (err) {
      logError(fastify, '[payouts] GET /employee/summary error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /history/:employeeId — расчётные ведомости сотрудника ────────────
  fastify.get('/history/:employeeId', payoutAuth, async (request, reply) => {
    const empId = parseInt(request.params.employeeId, 10);
    if (!Number.isInteger(empId) || empId <= 0) {
      return reply.code(400).send({ error: 'Некорректный id сотрудника' });
    }
    try {
      const { rows } = await db.query(`
        SELECT wp.id, wp.type, wp.amount, wp.status, wp.payment_method, wp.paid_at,
               COALESCE(wp.pay_year, EXTRACT(YEAR FROM wp.created_at)::int) AS pay_year,
               COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int) AS pay_month,
               wp.payout_platform, wp.tax_amount, wp.transfer_amount,
               wp.confirmation_status, wp.comment, w.work_title
          FROM worker_payments wp
          LEFT JOIN works w ON w.id = wp.work_id
         WHERE wp.employee_id = $1
         ORDER BY pay_year DESC, pay_month DESC, wp.id DESC
         LIMIT 500
      `, [empId]);
      return reply.send({ employee_id: empId, operations: rows });
    } catch (err) {
      logError(fastify, '[payouts] GET /history error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /access — список грантов (для админ-UI, только базовая роль) ─────
  fastify.get('/access', payoutAuth, async (request, reply) => {
    try {
      const ids = await getPayoutManagerIds(db);
      return reply.send({ user_ids: ids });
    } catch (err) {
      logError(fastify, '[payouts] GET /access error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
