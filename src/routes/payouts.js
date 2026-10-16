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
const { loadPayoutCalcSettings, calcPayout } = require('../lib/payout-calc');
const { logError } = require('../lib/log-error');
const { sendHuman } = require('../lib/human-error');
const crypto = require('crypto');

function isValidPeriod(year, month) {
  const yStr = String(year).trim();
  const mStr = String(month).trim();
  // Строгая проверка: только целые числа без «хвостов» (9abc → невалидно).
  if (!/^\d+$/.test(yStr) || !/^\d+$/.test(mStr)) return false;
  const y = Number(yStr);
  const m = Number(mStr);
  return Number.isInteger(y) && y >= 2020 && y <= 2099 && Number.isInteger(m) && m >= 1 && m <= 12;
}

/** ЕДИНЫЙ маппинг «роль → paid_by_role» (V391: раньше дублировался в 3 местах).
 *  CHECK chk_wp_paid_by_role_v243 допускает только нижний регистр. */
const ROLE_TO_PAID_BY = {
  ADMIN: 'admin', BUH: 'buh',
  DIRECTOR_GEN: 'director', DIRECTOR_COMM: 'director', DIRECTOR_DEV: 'director',
  PM: 'pm', HEAD_PM: 'pm',
  TO: 'buh', HEAD_TO: 'buh', PROC: 'buh',
};
function paidByRoleFor(role) { return ROLE_TO_PAID_BY[role] || 'buh'; }

/** Число из numeric-строки Postgres. */
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Срок жизни кода подтверждения (часы). Настройка payout_confirm_ttl_hours,
 *  дефолт 72 ч — как было в коде до V391. */
const DEFAULT_CONFIRM_TTL_HOURS = 72;
async function getConfirmTtlHours(db) {
  try {
    const { rows } = await db.query(`SELECT value_json FROM settings WHERE key='payout_confirm_ttl_hours' LIMIT 1`);
    if (rows[0]) {
      const v = parseFloat(String(rows[0].value_json).replace(/[^\d.\-]/g, ''));
      if (Number.isFinite(v) && v > 0) return v;
    }
  } catch (_) {}
  return DEFAULT_CONFIRM_TTL_HOURS;
}

/** Дефолтная ставка НПД. Переопределяется settings.self_employed_tax_rate. */
const DEFAULT_SE_TAX_RATE = 0.06;

/** Строгий разбор денежной суммы: '10abc', '10,5', '1,000', '1e5' → null.
 *  Допускается только точка как десятичный разделитель и максимум 2 знака
 *  (деньги в рублях/копейках). Запятая НЕ принимается: '1,000' в русской
 *  локали читается как 1000, а не 1 — неоднозначность опасна для выплат. */
function parseMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  }
  const s = String(v).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
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
      return sendHuman(reply, err);
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
      return sendHuman(reply, err);
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
      return sendHuman(reply, err);
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
      return sendHuman(reply, err);
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
               MAX(wp.paid_at) AS last_paid_at,
               wp.payee_employee_id,
               COALESCE(NULLIF(TRIM(pe.fio),''), NULLIF(TRIM(pe.full_name),'')) AS payee_fio
          FROM worker_payments wp
          JOIN employees e ON e.id = wp.employee_id
          LEFT JOIN employees pe ON pe.id = wp.payee_employee_id
         WHERE COALESCE(wp.pay_year, EXTRACT(YEAR FROM wp.created_at)::int) = $1
           AND COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int) = $2
           AND wp.status IN ('paid','confirmed')
         GROUP BY wp.employee_id, e.fio, e.full_name, e.id, wp.type, wp.payee_employee_id, pe.fio, pe.full_name
         ORDER BY fio
      `, [parseInt(year, 10), parseInt(month, 10)]);

      // свернуть по сотруднику
      const byEmp = new Map();
      for (const r of rows) {
        if (!byEmp.has(r.employee_id)) {
          byEmp.set(r.employee_id, { employee_id: r.employee_id, fio: r.fio, total: 0, by_type: {}, last_paid_at: null, payees: [] });
        }
        const e = byEmp.get(r.employee_id);
        e.total = Math.round((e.total + parseFloat(r.amount)) * 100) / 100;
        e.by_type[r.type] = Math.round(((e.by_type[r.type] || 0) + parseFloat(r.amount)) * 100) / 100;
        if (r.last_paid_at && (!e.last_paid_at || r.last_paid_at > e.last_paid_at)) e.last_paid_at = r.last_paid_at;
        // V391: через кого переводили — в архив (для истории и ведомости).
        if (r.payee_employee_id && r.payee_fio && !e.payees.some((p) => p.id === r.payee_employee_id)) {
          e.payees.push({ id: r.payee_employee_id, fio: r.payee_fio });
        }
      }
      const list = Array.from(byEmp.values()).sort((a, b) => a.fio.localeCompare(b.fio, 'ru'));
      return reply.send({ year: parseInt(year, 10), month: parseInt(month, 10), rows: list, count: list.length });
    } catch (err) {
      logError(fastify, '[payouts] GET /archive error', err, request);
      return sendHuman(reply, err);
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
        `SELECT e.id, COALESCE(NULLIF(TRIM(e.fio),''), NULLIF(TRIM(e.full_name),''), 'ID '||e.id) AS fio,
                e.is_self_employed, e.is_officially_employed,
                e.se_payee_id, e.se_payee_id_2, e.is_se_payee,
                p1.fio AS se_payee_fio, p1.phone AS se_payee_phone,
                p2.fio AS se_payee2_fio, p2.phone AS se_payee2_phone
           FROM employees e
           LEFT JOIN employees p1 ON p1.id = e.se_payee_id
           LEFT JOIN employees p2 ON p2.id = e.se_payee_id_2
          WHERE e.id = $1`, [empId]);

      return reply.send({
        employee: empRows[0] || { id: empId },
        total_paid_all_time: Math.round(totalPaid * 100) / 100,
        avg_per_year: avgByYear,
        by_year: byYear,
        current_year_months: monthRow,
      });
    } catch (err) {
      logError(fastify, '[payouts] GET /employee/summary error', err, request);
      return sendHuman(reply, err);
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
               wp.confirmation_status, wp.comment, w.work_title,
               wp.payee_employee_id,
               COALESCE(pe.fio, pe.full_name) AS payee_fio
          FROM worker_payments wp
          LEFT JOIN works w ON w.id = wp.work_id
          LEFT JOIN employees pe ON pe.id = wp.payee_employee_id
         WHERE wp.employee_id = $1
         ORDER BY pay_year DESC, pay_month DESC, wp.id DESC
         LIMIT 500
      `, [empId]);
      return reply.send({ employee_id: empId, operations: rows });
    } catch (err) {
      logError(fastify, '[payouts] GET /history error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /adjustment — начисление премии / удержание (штраф) ─────────────
  // Тело: { employee_id, year, month, type: 'bonus'|'penalty', amount, comment }
  //   comment обязателен по ТЗ: «кто согласовал и за что» (премия) /
  //   «за что удержание» (штраф). Пишется в worker_payments (status='paid',
  //      корректировка «к выплате», физическую выплату проводит /pay.
  //      status='pending' — деньги ещё не двигались, поэтому факт перевода
  //      (paid_this_month, «выплачено в поле») этими записями НЕ раздувается.
  //      Динамика учитывается в payout-row (bonus/penalty при status != cancelled),
  //      табеле (timesheet-v2) и расчётном листе — там фильтр тот же.
  fastify.post('/adjustment', payoutAuth, async (request, reply) => {
    const b = request.body || {};
    const empId = parseInt(b.employee_id, 10);
    const y = parseInt(b.year, 10);
    const m = parseInt(b.month, 10);
    const type = b.type;
    if (!Number.isInteger(empId) || empId <= 0) return reply.code(400).send({ error: 'employee_id обязателен' });
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    if (!['bonus', 'penalty'].includes(type)) return reply.code(400).send({ error: 'type: bonus|penalty' });
    const amount = parseMoney(b.amount);
    if (amount === null || amount <= 0) return reply.code(400).send({ error: 'invalid_amount', message: 'Сумма должна быть больше нуля.', hint: 'Введите сумму в рублях и повторите.' });
    const comment = (b.comment || '').toString().trim();
    if (!comment) {
      return reply.code(400).send({
        error: 'comment_required',
        message: type === 'bonus'
          ? 'Укажите комментарий: кто согласовал премию и за что'
          : 'Укажите комментарий: за что удержание/штраф',
      });
    }

    const userId = request.user.id;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // Анти-гонка по (сотрудник, тип, период) — чтобы двойной клик не создал
      // две премии/удержания.
      const lockKey2 = (type === 'penalty' ? 5 : 6) * 1000000 + (y % 100) * 100 + m;
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [empId, lockKey2]);

      const { rows: empRows } = await client.query(
        `SELECT id, COALESCE(NULLIF(TRIM(fio),''), NULLIF(TRIM(full_name),''), 'ID '||id) AS fio
           FROM employees WHERE id = $1`, [empId]);
      if (!empRows.length) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Сотрудник не найден' }); }
      const emp = empRows[0];

      // paid_by_role — из роли (CHECK chk_wp_paid_by_role_v243 ждёт нижний регистр:
      // admin|buh|director|pm). Раньше передавали request.user.role ('ADMIN') → 500.
      const paidByRole = paidByRoleFor(request.user.role);

      const { rows: ins } = await client.query(`
        INSERT INTO worker_payments (
          employee_id, work_id, type, amount, status, payment_method, paid_by, paid_by_role, paid_at,
          pay_year, pay_month, comment, created_by, created_at, confirmation_status
        ) VALUES ($1, NULL, $2, $3, 'pending', 'adjustment', $4, $5, NOW(), $6, $7, $8, $4, NOW(), NULL)
        RETURNING id, type, amount, comment, pay_year, pay_month
      `, [empId, type, amount, userId, paidByRole, y, m, comment]);

      await client.query(`
        INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
        VALUES ($1, 'worker_payments', $2, $3, $4::jsonb, NOW())
      `, [userId, ins[0].id, type === 'bonus' ? 'payout_bonus_added' : 'payout_penalty_added',
        JSON.stringify({ employee_id: empId, employee_fio: emp.fio, type, amount, comment, year: y, month: m })]);

      await client.query('COMMIT');
      return reply.send({ ok: true, adjustment: ins[0] });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      logError(fastify, '[payouts] POST /adjustment error', err, request);
      return sendHuman(reply, err);
    } finally {
      client.release();
    }
  });

  // ─── POST /carry-adjustment — корректировка остатка (V391) ────────────────
  // Тело: { employee_id, year, month, new_amount, reason }
  //   Дима видит текущий остаток (carry) и ставит нужный: «было +5000 → стало
  //   −10000». Пишем РАЗНИЦУ (delta) отдельной записью типа 'carry_adjustment':
  //     delta > 0 → было меньше нужного (увеличиваем долг компании) → +amount
  //     delta < 0 → уменьшаем долг / появляется переплата → amount со знаком −
  //   Причина ОБЯЗАТЕЛЬНА: она видна рабочему в приложении/табеле и попадает
  //   в историю, архив и расчётный лист.
  fastify.post('/carry-adjustment', payoutAuth, async (request, reply) => {
    const b = request.body || {};
    const empId = parseInt(b.employee_id, 10);
    const y = parseInt(b.year, 10);
    const m = parseInt(b.month, 10);
    if (!Number.isInteger(empId) || empId <= 0) return reply.code(400).send({ error: 'employee_id обязателен' });
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    const newAmount = parseMoney(b.new_amount);
    if (newAmount === null) return reply.code(400).send({ error: 'new_amount: некорректная сумма' });
    const reason = (b.reason || '').toString().trim();
    if (!reason) {
      return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину корректировки — её увидит рабочий' });
    }

    const userId = request.user.id;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // сериализуем корректировки по сотруднику-периоду
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [empId, 7 * 1000000 + (y % 100) * 100 + m]);

      const { rows: empRows } = await client.query(
        `SELECT id, COALESCE(NULLIF(TRIM(fio),''), NULLIF(TRIM(full_name),''), 'ID '||id) AS fio
           FROM employees WHERE id = $1`, [empId]);
      if (!empRows.length) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Сотрудник не найден' }); }
      const emp = empRows[0];

      // Текущий остаток на начало периода = сумма pending прошлых периодов
      // (та же логика, что в payout-row.js: строго до целевого месяца).
      const periodId = y * 100 + m;
      const { rows: debtRows } = await client.query(`
        SELECT COALESCE(SUM(CASE WHEN type IN ('salary','bonus','per_diem','carry_adjustment') THEN amount
                                 WHEN type = 'penalty' THEN -amount ELSE 0 END), 0)::numeric AS carry
          FROM worker_payments
         WHERE employee_id = $1 AND status = 'pending'
           AND type IN ('salary','bonus','per_diem','penalty','carry_adjustment')
           AND (COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) * 100
                + COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int)) < $2
      `, [empId, periodId]);
      // также учитываем корректировки, уже сделанные В ЭТОМ периоде
      const { rows: inMonth } = await client.query(`
        SELECT COALESCE(SUM(amount), 0)::numeric AS s
          FROM worker_payments
         WHERE employee_id = $1 AND status = 'pending' AND type = 'carry_adjustment'
           AND COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) = $2
           AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $3
      `, [empId, y, m]);

      const currentCarry = Math.round((num(debtRows[0].carry) + num(inMonth[0].s)) * 100) / 100;
      const delta = Math.round((newAmount - currentCarry) * 100) / 100;
      if (Math.abs(delta) < 0.01) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'no_change', message: `Остаток уже равен ${newAmount}` });
      }

      const { rows: ins } = await client.query(`
        INSERT INTO worker_payments (
          employee_id, work_id, type, amount, status, payment_method, paid_by, paid_by_role,
          pay_year, pay_month, comment, created_by, created_at, confirmation_status
        ) VALUES ($1, NULL, 'carry_adjustment', $2, 'pending', 'adjustment', $3, $4, $5, $6, $7, $3, NOW(), NULL)
        RETURNING id, amount, comment
      `, [empId, delta, userId, paidByRoleFor(request.user.role), y, m, 'Корректировка остатка: ' + reason]);

      await client.query(`
        INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
        VALUES ($1, 'worker_payments', $2, 'payout_carry_adjusted', $3::jsonb, NOW())
      `, [userId, ins[0].id, JSON.stringify({
        employee_id: empId, employee_fio: emp.fio, year: y, month: m,
        carry_before: currentCarry, carry_after: newAmount, delta, reason,
      })]);

      await client.query('COMMIT');
      return reply.send({ ok: true, carry_before: currentCarry, carry_after: newAmount, delta, adjustment: ins[0] });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      logError(fastify, '[payouts] POST /carry-adjustment error', err, request);
      return sendHuman(reply, err);
    } finally {
      client.release();
    }
  });

  // ─── POST /pay — совершить выплату ────────────────────────────────────────
  // Тело: { employee_id, year, month, kind: 'advance'|'salary', pay_amount,
  //         transfer_amount?, payout_platform?, payout_recipient_note?,
  //         confirm_over? }
  // СЗ: переводим = выплачиваем × (1 + tax_rate), tax_amount = разница.
  // Записывает worker_payments(status='paid'), audit_log. Баланс РП/касса
  // выводятся ИЗ worker_payments (pm-balance.js) — вручную cash_balance_log
  // не пишем, иначе двойной счёт.
  fastify.post('/pay', payoutAuth, async (request, reply) => {
    const b = request.body || {};
    const empId = parseInt(b.employee_id, 10);
    const y = parseInt(b.year, 10);
    const m = parseInt(b.month, 10);
    const kind = b.kind;
    if (!Number.isInteger(empId) || empId <= 0) return reply.code(400).send({ error: 'employee_id обязателен' });
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    if (!['advance', 'salary'].includes(kind)) return reply.code(400).send({ error: 'kind: advance|salary' });

    const payAmount = parseMoney(b.pay_amount);
    if (payAmount === null || payAmount <= 0) return reply.code(400).send({ error: 'invalid_amount', message: 'Сумма выплаты должна быть больше нуля.', hint: 'Введите сумму в рублях (например 15000) и повторите.' });

    // Площадка выплаты — строгий allowlist (иначе 400, а не 500 от CHECK)
    const PLATFORMS = ['restaff', 'card', 'bank', 'cash', 'other'];
    if (b.payout_platform != null && b.payout_platform !== '' && !PLATFORMS.includes(b.payout_platform)) {
      return reply.code(400).send({ error: `payout_platform: ${PLATFORMS.join(', ')}` });
    }

    const userId = request.user.id;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // Анти-гонка: сериализуем выплаты по (сотрудник, тип, период).
      // Иначе два одновременных запроса (двойной клик) создадут две выплаты.
      const lockKey2 = (kind === 'advance' ? 1 : 2) * 1000000 + (y % 100) * 100 + m;
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [empId, lockKey2]);

      // Профиль сотрудника + СЗ
      const { rows: empRows } = await client.query(
        `SELECT id, COALESCE(NULLIF(TRIM(fio),''), NULLIF(TRIM(full_name),''), 'ID '||id) AS fio,
                is_self_employed, is_officially_employed, user_id
           FROM employees WHERE id = $1`, [empId]);
      if (!empRows.length) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Сотрудник не найден' }); }
      const emp = empRows[0];

      // Ставка налога СЗ (оставлено для справки/логов; расчёт идёт через payout-calc)
      let taxRate = DEFAULT_SE_TAX_RATE;
      try {
        const { rows: st } = await client.query("SELECT value_json FROM settings WHERE key='self_employed_tax_rate' LIMIT 1");
        if (st[0]) { const v = parseFloat(String(st[0].value_json).replace(/[^\d.\-]/g, '')); if (Number.isFinite(v)) taxRate = v; }
      } catch (_) {}

      const isSe = !!emp.is_self_employed;
      // V391: «через кого» переводим. Если задан — он должен быть одним из
      // получателей ЭТОГО рабочего (se_payee_id или se_payee_id_2), иначе
      // выплата уйдёт не тому. Для не-СЗ поле игнорируется.
      let payeeEmployeeId = null;
      if (b.payee_employee_id != null && b.payee_employee_id !== '') {
        const pid = parseInt(b.payee_employee_id, 10);
        if (!Number.isFinite(pid) || pid <= 0) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: 'payee_employee_id: некорректный id' });
        }
        // Получатель обязан быть привязан ИМЕННО к этому рабочему.
        const { rows: own } = await client.query(
          `SELECT id FROM employees
            WHERE id = $1
              AND (id = (SELECT se_payee_id   FROM employees WHERE id = $2)
                OR id = (SELECT se_payee_id_2 FROM employees WHERE id = $2))`,
          [pid, empId]
        );
        if (!own.length) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: 'payee_employee_id: получатель не привязан к этому рабочему' });
        }
        payeeEmployeeId = pid;
      }
      // Формула пересчёта «выплата → перевод» — единый источник (payout-calc.js):
      //   СЗ:  переводим = выплата × 1.064/0.96 × 1.22 (Рестаф 3.5% + НДС 22%)
      //   нал: галка «официально» → +15%; иначе либо ручная сумма, либо 1:1.
      const calcSettings = await loadPayoutCalcSettings(client);
      const calc = calcPayout({
        payAmount,
        isSelfEmployed: isSe,
        officialTransfer: b.official_transfer === true,
        transferAmountManual: b.transfer_amount != null && b.transfer_amount !== ''
          ? parseMoney(b.transfer_amount) : null,
        settings: calcSettings,
      });
      const transferAmount = calc.transferAmount;
      const taxAmount = calc.taxAmount;
      const officialTransfer = calc.officialTransfer;
      const payoutPlatform = isSe ? 'restaff' : (officialTransfer ? 'bank' : (b.payout_platform || 'cash'));

      // ─── ГЕЙТ СОГЛАСОВАНИЯ (единый модуль, ТЗ №7) ────────────────────────
      // Статус + СВЕРКА СУММЫ живут в src/lib/payout-approval-gate.js —
      // одна точка правды для всех 7 путей выплаты. Дублирование логики
      // руками (было в 2 ручках из 6) давало обходы: одобрение 1 ₽ открывало
      // выплату любой суммы (найдено верификатором 16.10.2026).
      {
        const MOD = require('../lib/payout-approval-gate');
        const bad = await MOD.checkPayoutApproved(client, { employeeId: empId, year: y, month: m, amount: payAmount, type: b.kind === 'advance' ? 'advance' : 'salary' });
        if (bad) {
          await client.query('ROLLBACK');
          const { code, ...body } = bad;
          return reply.code(code).send(body);
        }
      }

      // Проверка «сотрудник столько не заработал»
      let earnings = null;
      if (!b.confirm_over) {
        const list = await buildPayoutRows(client, y, m);
        const row = list.rows.find((r) => r.employee_id === empId);
        earnings = row ? row.to_pay : 0;
        if (payAmount > (earnings || 0)) {
          await client.query('ROLLBACK');
          return reply.code(409).send({
            error: 'over_earnings',
            message: `Сотрудник заработал ${earnings} ₽, а выплата ${payAmount} ₽. Подтвердите, если это осознанно.`,
            available: earnings,
            requires_confirmation: true,
          });
        }
      }

      // Защита от дубля (по сотруднику+типу+периоду), если не подтверждено явно
      if (!b.confirm_duplicate) {
        const { rows: dup } = await client.query(`
          SELECT id, amount FROM worker_payments
           WHERE employee_id=$1 AND type=$2 AND status IN ('paid','confirmed')
             AND COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int)=$3
             AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int)=$4
        `, [empId, kind, y, m]);
        if (dup.length) {
          await client.query('ROLLBACK');
          return reply.code(409).send({
            error: 'duplicate_payment',
            message: `За ${m}.${y} уже есть ${kind === 'advance' ? 'аванс' : 'зарплата'} (${dup.length}). Подтвердите повтор.`,
            already: dup, requires_confirmation: true,
          });
        }
      }

      const batchId = crypto.randomUUID();
      const deadline = new Date(Date.now() + (await getConfirmTtlHours(db)) * 3600 * 1000);
      // payment_method выводим из площадки (влияет на источник денег в worker_payment_source_v):
      //   bank → company_bank, restaff → company_se, card → pm_cash/card, cash → cash, other → transfer.
      const PLATFORM_METHOD = { bank: 'bank', restaff: 'self', card: 'card', cash: 'cash', other: 'transfer' };
      const paymentMethod = PLATFORM_METHOD[payoutPlatform] || 'bank';
      // paid_by_role — из роли плательщика (для отчётности/фильтров).
      const paidByRole = paidByRoleFor(request.user.role);
      const { rows: ins } = await client.query(`
        INSERT INTO worker_payments (
          employee_id, work_id, type, amount, status, payment_method, paid_by, paid_by_role, paid_at,
          pay_year, pay_month, comment, created_by, created_at,
          payout_platform, payout_recipient_note, transfer_amount, tax_amount,
          confirmation_status, confirmation_deadline, payout_batch_id, official_transfer, info_amount,
          payee_employee_id
        ) VALUES ($1, NULL, $2, $3, 'paid', $4, $5, $6, NOW(), $7, $8, $9, $5, NOW(),
                  $10, $11, $12, $13, 'awaiting', $14, $15, $16, $17, $18)
        RETURNING id, amount, transfer_amount, tax_amount, info_amount, confirmation_status, confirmation_deadline
      `, [
        empId, kind, payAmount, paymentMethod,
        userId, paidByRole, y, m, b.comment || null,
        payoutPlatform, b.payout_recipient_note || null,
        transferAmount, taxAmount, deadline, batchId, officialTransfer, calc.infoAmount,
        payeeEmployeeId,
      ]);

      // Привязываем факт выплаты к позиции списка (для статуса «выплачено»).
      try {
        await client.query(`
          UPDATE payout_batch_items i
             SET worker_payment_id = $1
            FROM payout_batches b
           WHERE i.batch_id = b.id AND i.employee_id = $2
             AND b.period_year = $3 AND b.period_month = $4
             AND i.approval_status = 'approved'`, [ins[0].id, empId, y, m]);
      } catch (e) { /* таблиц может не быть на старом клоне */ }

      await client.query(`
        INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
        VALUES ($1, 'worker_payments', $2, 'payout_paid', $3::jsonb, NOW())
      `, [userId, ins[0].id, JSON.stringify({
        kind, pay_amount: payAmount, transfer_amount: transferAmount, tax_amount: taxAmount,
        employee_id: empId, employee_fio: emp.fio, year: y, month: m,        payout_platform: payoutPlatform, official_transfer: officialTransfer, batch_id: batchId,
      })]);

      await client.query('COMMIT');

      // Уведомление + код подтверждения (MAX → SMS, in-app баннер). Этап 5.
      try {
        const { sendPayoutCode } = require('../lib/payout-notify');
        await sendPayoutCode(fastify, db, { paymentId: ins[0].id, employeeId: empId, amount: calc.infoAmount, period: { year: y, month: m } });
      } catch (e) {
        fastify.log.warn(`[payouts] notify fail: ${e.message}`);
      }

      return reply.send({
        ok: true,
        payment: ins[0],
        preview: {
          employee_id: empId, fio: emp.fio, kind,
          pay_amount: payAmount, transfer_amount: transferAmount, tax_amount: taxAmount,
          is_self_employed: isSe, official_transfer: officialTransfer,
          payout_platform: payoutPlatform, year: y, month: m,
        },
      });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      logError(fastify, '[payouts] POST /pay error', err, request);
      return sendHuman(reply, err);
    } finally {
      client.release();
    }
  });

  // ─── GET /preview/:employeeId — предпросмотр расчётной ведомости ──────────
  fastify.get('/preview/:employeeId', payoutAuth, async (request, reply) => {
    const empId = parseInt(request.params.employeeId, 10);
    const y = parseInt(request.query.year, 10);
    const m = parseInt(request.query.month, 10);
    if (!Number.isInteger(empId) || empId <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    if (!isValidPeriod(y, m)) return reply.code(400).send({ error: 'Некорректный период' });
    try {
      const list = await buildPayoutRows(db, y, m);
      const row = list.rows.find((r) => r.employee_id === empId) || null;
      const { rows: empRows } = await db.query(
        `SELECT e.id, COALESCE(NULLIF(TRIM(e.fio),''), NULLIF(TRIM(e.full_name),''), 'ID '||e.id) AS fio,
                e.is_self_employed, e.is_officially_employed,
                e.se_payee_id, e.se_payee_id_2, e.is_se_payee,
                p1.fio AS se_payee_fio, p1.phone AS se_payee_phone,
                p2.fio AS se_payee2_fio, p2.phone AS se_payee2_phone
           FROM employees e
           LEFT JOIN employees p1 ON p1.id = e.se_payee_id
           LEFT JOIN employees p2 ON p2.id = e.se_payee_id_2
          WHERE e.id = $1`, [empId]);

      let taxRate = DEFAULT_SE_TAX_RATE;
      try {
        const { rows: st } = await db.query("SELECT value_json FROM settings WHERE key='self_employed_tax_rate' LIMIT 1");
        if (st[0]) { const v = parseFloat(String(st[0].value_json).replace(/[^\d.\-]/g, '')); if (Number.isFinite(v)) taxRate = v; }
      } catch (_) {}
      // Коэффициенты пересчёта для фронта (единый источник — payout-calc.js).
      const calcSettings = await loadPayoutCalcSettings(db);
      return reply.send({
        employee: empRows[0] || { id: empId },
        row, tax_rate: taxRate,
        is_self_employed: !!(empRows[0] && empRows[0].is_self_employed),
        calc: {
          se_info_coef: calcSettings.seInfoCoef,
          se_transfer_coef: calcSettings.seTransferCoef,
          official_markup_rate: calcSettings.officialMarkupRate,
          se_commission_rate: calcSettings.seCommissionRate,
          se_vat_rate: calcSettings.seVatRate,
        },
      });
    } catch (err) {
      logError(fastify, '[payouts] GET /preview error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /:id/confirm-by-manager — подтвердить за рабочего ────────────────
  // Для тех, кто не может зайти в приложение. Причина НЕ обязательна (ТЗ),
  // но фиксируем кто/когда/что — для аудита.
  fastify.post('/:id/confirm-by-manager', payoutAuth, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    try {
      const { rows } = await db.query(
        `UPDATE worker_payments
            SET confirmation_status = 'confirmed',
                confirmed_by_worker = true,
                confirmed_at = NOW(),
                updated_at = NOW()
          WHERE id = $1 AND status IN ('paid','confirmed')
            AND confirmation_status = 'awaiting'
          RETURNING id, employee_id, amount`,
        [id]);
      if (!rows.length) return reply.code(404).send({ error: 'Выплата не найдена или не в статусе paid' });
      await db.query(`
        INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
        VALUES ($1, 'worker_payments', $2, 'payout_confirmed_by_manager', $3::jsonb, NOW())
      `, [request.user.id, id, JSON.stringify({ by_role: request.user.role, reason: request.body?.reason || null })]);
      return reply.send({ ok: true, payment: rows[0] });
    } catch (err) {
      logError(fastify, '[payouts] POST /confirm-by-manager error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── GET /my/pending — неподтверждённые выплаты ТЕКУЩЕГО рабочего ──────────
  // Для несжимаемого баннера в мобильном PWA.
  fastify.get('/my/pending', { preHandler: [fastify.fieldAuthenticate] }, async (request, reply) => {
    try {
      const empId = request.fieldEmployee ? request.fieldEmployee.id : null;
      if (!empId) return reply.code(401).send({ error: 'Не авторизован' });
      const { rows } = await db.query(`
        SELECT id, amount, transfer_amount, tax_amount, info_amount, type, paid_at,
               payout_platform, payout_recipient_note, confirmation_status, confirmation_deadline,
               COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) AS pay_year,
               COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) AS pay_month
          FROM worker_payments
         WHERE employee_id = $1
           AND status IN ('paid','confirmed')
           AND confirmation_status = 'awaiting'
         ORDER BY paid_at DESC
      `, [empId]);
      return reply.send({ payments: rows });
    } catch (err) {
      logError(fastify, '[payouts] GET /my/pending error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /my/:id/confirm — рабочий подтверждает получение ─────────────────
  fastify.post('/my/:id/confirm', { preHandler: [fastify.fieldAuthenticate] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    try {
      const empId = request.fieldEmployee ? request.fieldEmployee.id : null;
      if (!empId) return reply.code(401).send({ error: 'Не авторизован' });
      const code = request.body && request.body.code;
      if (!code) return reply.code(400).send({ error: 'Код обязателен' });

      const { rows: payRows } = await db.query(
        `SELECT id FROM worker_payments
          WHERE id = $1 AND employee_id = $2 AND status IN ('paid','confirmed')`, [id, empId]);
      if (!payRows.length) return reply.code(404).send({ error: 'Выплата не найдена' });

      const { verifyPayoutCode } = require('../lib/payout-notify');
      const v = await verifyPayoutCode(db, { paymentId: id, employeeId: empId, code });
      if (!v.ok) return reply.code(400).send({ error: v.error, attempts_left: v.attempts_left });

      // Читаем результат UPDATE: если строка не awaiting (уже подтверждена/оспорена),
      // возвращаем 404, а не лживый 200.
      const { rows: upd } = await db.query(`
        UPDATE worker_payments
           SET confirmation_status = 'confirmed', confirmed_by_worker = true,
               confirmed_at = NOW(), status = 'confirmed', updated_at = NOW()
         WHERE id = $1 AND employee_id = $2 AND confirmation_status = 'awaiting'
         RETURNING id`, [id, empId]);
      if (!upd.length) return reply.code(404).send({ error: 'Выплата не найдена или уже не ждёт подтверждения' });
      return reply.send({ ok: true });
    } catch (err) {
      logError(fastify, '[payouts] POST /my/confirm error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /my/:id/dispute — «не согласен / не получил» (маркер) ────────────
  fastify.post('/my/:id/dispute', { preHandler: [fastify.fieldAuthenticate] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    try {
      const empId = request.fieldEmployee ? request.fieldEmployee.id : null;
      if (!empId) return reply.code(401).send({ error: 'Не авторизован' });

      // Проверяем, что выплата принадлежит этому сотруднику и ещё ждёт подтверждения
      const { rows: own } = await db.query(
        `SELECT id FROM worker_payments
          WHERE id = $1 AND employee_id = $2 AND status IN ('paid','confirmed')
            AND confirmation_status = 'awaiting'`, [id, empId]);
      if (!own.length) return reply.code(404).send({ error: 'Выплата не найдена' });

      // РП: по работе выплаты (works.pm_id) или по последней работе сотрудника
      const { rows: pmRows } = await db.query(`
        SELECT COALESCE(
                 w.pm_id,
                 (SELECT w2.pm_id FROM field_checkins fc
                    JOIN works w2 ON w2.id = fc.work_id
                   WHERE fc.employee_id = $2 AND w2.pm_id IS NOT NULL
                   ORDER BY fc.date DESC LIMIT 1)
               ) AS pm_id
          FROM worker_payments wp
          LEFT JOIN works w ON w.id = wp.work_id
         WHERE wp.id = $1`, [id, empId]);

      let pmPhone = null, managerPhone = null;
      try {
        const { rows: mgr } = await db.query(
          `SELECT value_json FROM settings WHERE key='payout_manager_user_ids' LIMIT 1`);
        if (mgr[0]) {
          const ids = JSON.parse(mgr[0].value_json);
          if (Array.isArray(ids) && ids.length) {
            const { rows: u } = await db.query(`SELECT phone FROM users WHERE id = $1`, [ids[0]]);
            managerPhone = u[0] ? u[0].phone : null;
          }
        }
      } catch (_) {}
      if (pmRows[0] && pmRows[0].pm_id) {
        const { rows: p } = await db.query(`SELECT phone FROM users WHERE id = $1`, [pmRows[0].pm_id]);
        pmPhone = p[0] ? p[0].phone : null;
      }

      await db.query(`
        UPDATE worker_payments
           SET confirmation_status = 'disputed', dispute_at = NOW(),
               dispute_reason = $2, updated_at = NOW()
         WHERE id = $1 AND employee_id = $3 AND confirmation_status = 'awaiting'
         RETURNING id`, [id, (request.body && request.body.reason) || null, empId]);

      return reply.send({ ok: true, contacts: { manager_phone: managerPhone, pm_phone: pmPhone } });
    } catch (err) {
      logError(fastify, '[payouts] POST /my/dispute error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /:id/resend — повторно отправить код (Дима/админ) ────────────────
  fastify.post('/:id/resend', payoutAuth, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    try {
      const { rows } = await db.query(
        `SELECT id, employee_id, amount FROM worker_payments WHERE id = $1 AND status IN ('paid','confirmed')`, [id]);
      if (!rows.length) return reply.code(404).send({ error: 'Выплата не найдена' });
      const { sendPayoutCode } = require('../lib/payout-notify');
      const r = await sendPayoutCode(fastify, db, { paymentId: id, employeeId: rows[0].employee_id, amount: rows[0].amount });
      return reply.send(r);
    } catch (err) {
      logError(fastify, '[payouts] POST /resend error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── GET /monthly-series/:year — выплачено по месяцам (для графика) ───────
  fastify.get('/monthly-series/:year', payoutAuth, async (request, reply) => {
    const y = parseInt(request.params.year, 10);
    if (!Number.isInteger(y) || y < 2020 || y > 2099) return reply.code(400).send({ error: 'Некорректный год' });
    try {
      const { rows } = await db.query(`
        SELECT COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) AS month,
               SUM(CASE WHEN type IN ('salary','advance','bonus') THEN amount ELSE 0 END)
             - SUM(CASE WHEN type='penalty' THEN amount ELSE 0 END) AS paid
          FROM worker_payments
         WHERE COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) = $1
           AND status IN ('paid','confirmed')
         GROUP BY 1`, [y]);
      const { rows: accRows } = await db.query(`
        SELECT EXTRACT(MONTH FROM date)::int AS month,
               SUM(COALESCE(amount_earned,0))::numeric AS accrued
          FROM field_checkins
         WHERE status = 'completed' AND EXTRACT(YEAR FROM date)::int = $1
         GROUP BY 1`, [y]);
      const series = Array.from({ length: 12 }, (_, i) => {
        const mm = i + 1;
        const f = rows.find((r) => r.month === mm);
        const a = accRows.find((r) => r.month === mm);
        return {
          month: mm,
          paid: f ? Math.round(parseFloat(f.paid) * 100) / 100 : 0,
          accrued: a ? Math.round(parseFloat(a.accrued) * 100) / 100 : 0,
        };
      });
      return reply.send({ year: y, series });
    } catch (err) {
      logError(fastify, '[payouts] GET /monthly-series error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── GET /employee/:id/monthly — начислено/выплачено по месяцам (модалка) ─
  fastify.get('/employee/:id/monthly', payoutAuth, async (request, reply) => {
    const empId = parseInt(request.params.id, 10);
    const y = parseInt(request.query.year, 10) || new Date().getFullYear();
    if (!Number.isInteger(empId) || empId <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    try {
      const { rows: paidRows } = await db.query(`
        SELECT COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) AS month,
               SUM(CASE WHEN type IN ('salary','advance','bonus') THEN amount ELSE 0 END)
             - SUM(CASE WHEN type='penalty' THEN amount ELSE 0 END) AS paid
          FROM worker_payments
         WHERE employee_id = $1 AND status IN ('paid','confirmed')
           AND COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) = $2
         GROUP BY 1`, [empId, y]);
      const { rows: accRows } = await db.query(`
        SELECT EXTRACT(MONTH FROM date)::int AS month,
               SUM(COALESCE(amount_earned,0))::numeric AS accrued
          FROM field_checkins
         WHERE employee_id = $1 AND status = 'completed' AND EXTRACT(YEAR FROM date)::int = $2
         GROUP BY 1`, [empId, y]);
      const series = Array.from({ length: 12 }, (_, i) => {
        const mm = i + 1;
        const pr = paidRows.find((r) => r.month === mm);
        const ar = accRows.find((r) => r.month === mm);
        return {
          month: mm,
          paid: pr ? Math.round(parseFloat(pr.paid) * 100) / 100 : 0,
          accrued: ar ? Math.round(parseFloat(ar.accrued) * 100) / 100 : 0,
        };
      });
      return reply.send({ employee_id: empId, year: y, series });
    } catch (err) {
      logError(fastify, '[payouts] GET /employee/:id/monthly error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── GET /export/:year/:month — Excel: список выплат за месяц ──────────────
  fastify.get('/export/:year/:month', payoutAuth, async (request, reply) => {
    const { year, month } = request.params;
    if (!isValidPeriod(year, month)) return reply.code(400).send({ error: 'Некорректный период' });
    try {
      const y = parseInt(year, 10), m = parseInt(month, 10);
      const [list, warns] = await Promise.all([
        buildPayoutRows(db, y, m), getPeriodWarnings(db, y, m),
      ]);
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(`Выплаты ${m}.${y}`);

      ws.columns = [
        { header: 'ФИО', key: 'fio', width: 34 },
        { header: 'Способ', key: 'method', width: 16 },
        { header: 'Через кого', key: 'payee', width: 26 },
        { header: 'Остаток', key: 'carry', width: 14 },
        { header: 'Начислено', key: 'accrued', width: 14 },
        { header: 'Аванс', key: 'advance', width: 12 },
        { header: 'Премия', key: 'bonus', width: 12 },
        { header: 'Удержание', key: 'penalty', width: 12 },
        { header: 'К выплате', key: 'to_pay', width: 14 },
        { header: 'Статус', key: 'status', width: 20 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const r of list.rows) {
        var methodLabel = r.is_self_employed ? 'Самозанятый' : (r.is_officially_employed ? 'Официально' : 'Наличные');
        // «Через кого»: получатели рабочего (может быть двое — перечисляем).
        var payees = [r.se_payee_fio, r.se_payee2_fio].filter(Boolean).join(', ');
        ws.addRow({
          fio: r.fio, method: methodLabel, payee: payees || '',
          carry: r.carry, accrued: r.accrued, advance: r.advance, bonus: r.bonus,
          penalty: r.penalty, to_pay: r.to_pay,
          status: r.paid_this_period
            ? (r.confirm === 'confirmed' ? 'выплачено/подтв.' : (r.overdue ? 'не подтвердил' : 'ждёт подтв.'))
            : (r.overpaid ? 'переплата' : ''),
        });
      }
      ws.addRow({});
      ws.addRow({ fio: 'ИТОГО', carry: list.totals.carry, accrued: list.totals.accrued, advance: list.totals.advance, bonus: list.totals.bonus, penalty: list.totals.penalty, to_pay: list.totals.to_pay }).font = { bold: true };
      // Мягкие предупреждения периода — отдельным листом, не мешая данным
      const wsW = wb.addWorksheet('Предупреждения');
      wsW.columns = [{ header: 'Уровень', width: 10 }, { header: 'Сообщение', width: 70 }];
      (warns.warnings || []).forEach((w) => wsW.addRow({ Уровень: w.level, Сообщение: w.message }));

      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename="payouts-${y}-${m}.xlsx"`);
      await wb.xlsx.write(reply.raw);
      return reply;
    } catch (err) {
      logError(fastify, '[payouts] GET /export error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── GET /statement/:employeeId/:year/:month — расчётный лист (Excel) ──────
  fastify.get('/statement/:employeeId/:year/:month', payoutAuth, async (request, reply) => {
    const empId = parseInt(request.params.employeeId, 10);
    const { year, month } = request.params;
    if (!Number.isInteger(empId) || empId <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    if (!isValidPeriod(year, month)) return reply.code(400).send({ error: 'Некорректный период' });
    try {
      const y = parseInt(year, 10), m = parseInt(month, 10);
      const list = await buildPayoutRows(db, y, m);
      const row = list.rows.find((r) => r.employee_id === empId) || null;
      const { rows: empRows } = await db.query(
        `SELECT id, COALESCE(NULLIF(TRIM(fio),''), NULLIF(TRIM(full_name),''), 'ID '||id) AS fio, is_self_employed
           FROM employees WHERE id=$1`, [empId]);
      const { rows: ops } = await db.query(`
        SELECT wp.type, wp.amount, wp.transfer_amount, wp.tax_amount, wp.status, wp.payment_method, wp.payout_platform,
               COALESCE(wp.pay_year, EXTRACT(YEAR FROM wp.created_at)::int) AS pay_year,
               COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int) AS pay_month,
               wp.confirmation_status, wp.comment,
               COALESCE(NULLIF(TRIM(pe.fio),''), NULLIF(TRIM(pe.full_name),'')) AS payee_fio
          FROM worker_payments wp
          LEFT JOIN employees pe ON pe.id = wp.payee_employee_id
         WHERE wp.employee_id = $1 AND wp.status IN ('paid','confirmed')
           AND COALESCE(wp.pay_year, EXTRACT(YEAR FROM wp.created_at)::int) = $2
           AND COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int) = $3
         ORDER BY wp.id DESC`, [empId, y, m]);

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Расчётный лист');
      ws.getCell('A1').value = 'Расчётный лист';
      ws.getCell('A1').font = { bold: true, size: 14 };
      ws.getCell('A2').value = (empRows[0] ? empRows[0].fio : 'Сотрудник');
      ws.getCell('A3').value = `Период: ${String(m).padStart(2, '0')}.${y}`;
      ws.addRow([]);
      const head = ws.addRow(['Показатель', 'Сумма']);
      head.font = { bold: true };
      if (row) {
        ws.addRow(['Остаток с прошлых', row.carry]);
        ws.addRow(['Начислено', row.accrued]);
        ws.addRow(['Премия', row.bonus]);
        ws.addRow(['Удержание/штраф', -row.penalty]);
        ws.addRow(['Аванс', -row.advance]);
        ws.addRow(['Оклад', -row.official]);
        const payeesRow = [row.se_payee_fio, row.se_payee2_fio].filter(Boolean).join(', ');
        if (payeesRow) ws.addRow(['Через кого (получатели)', payeesRow]);
        const tot = ws.addRow(['К выплате', row.to_pay]);
        tot.font = { bold: true };
      }
      ws.addRow([]);
      const oh = ws.addRow(['Тип', 'Сумма', 'Переведено', 'Налог', 'Способ', 'Через кого', 'Комментарий', 'Статус']);
      oh.font = { bold: true };
      ops.forEach((o) => ws.addRow([o.type, o.amount, o.transfer_amount, o.tax_amount, o.payout_platform || o.payment_method, o.payee_fio || '', o.comment || '', o.confirmation_status || o.status]));

      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename="statement-${empId}-${y}-${m}.xlsx"`);
      await wb.xlsx.write(reply.raw);
      return reply;
    } catch (err) {
      logError(fastify, '[payouts] GET /statement error', err, request);
      return sendHuman(reply, err);
    }
  });

  // ─── POST /:id/revert — отменить выплату (вернуть рабочего в реестр) ──────
  // Удаляет запись о выплате и код подтверждения; рабочего возвращает в список
  // «к выплате». Только для выплат нового флоу (с payout_batch_id), не для
  // исторических. Пишет audit_log.
  fastify.post('/:id/revert', payoutAuth, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: pay } = await client.query(
        `SELECT id, employee_id, amount, type, payout_batch_id, confirmation_status
           FROM worker_payments WHERE id = $1 FOR UPDATE`, [id]);
      if (!pay.length) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Выплата не найдена' }); }
      const p = pay[0];
      if (!p.payout_batch_id) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'not_revertible', message: 'Эту выплату нельзя отменить (историческая запись)' });
      }
      await client.query('DELETE FROM payout_confirmation_codes WHERE payment_id = $1', [id]);
      await client.query('DELETE FROM notifications WHERE type = $1 AND link LIKE $2', ['payment_received', '%field/earnings%']);
      // ⚠️ V392: НЕ удаляем строку — только помечаем cancelled. Иначе отмена
      // обнуляла накопительный счётчик согласования, и ту же сумму можно было
      // выплатить повторно в пределах одобренного (F2, верификатор 16.10.2026).
      // Отменённые записи продолжают занимать «квоту» согласования.
      await client.query(
        `UPDATE worker_payments SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
      await client.query(`
        INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
        VALUES ($1, 'worker_payments', $2, 'payout_reverted', $3::jsonb, NOW())
      `, [request.user.id, id, JSON.stringify({ employee_id: p.employee_id, amount: p.amount, type: p.type, confirmation_status: p.confirmation_status })]);
      await client.query('COMMIT');
      return reply.send({ ok: true, reverted: id, employee_id: p.employee_id });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      logError(fastify, '[payouts] POST /revert error', err, request);
      return sendHuman(reply, err);
    } finally { client.release(); }
  });

  // ─── GET /access — список грантов (для админ-UI, только базовая роль) ─────
  fastify.get('/access', payoutAuth, async (request, reply) => {
    try {
      const ids = await getPayoutManagerIds(db);
      return reply.send({ user_ids: ids });
    } catch (err) {
      logError(fastify, '[payouts] GET /access error', err, request);
      return sendHuman(reply, err);
    }
  });
}

module.exports = routes;
