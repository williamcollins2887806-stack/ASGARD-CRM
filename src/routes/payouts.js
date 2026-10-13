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
    if (payAmount === null || payAmount <= 0) return reply.code(400).send({ error: 'pay_amount > 0' });

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

      // Ставка налога СЗ (из настроек)
      let taxRate = 0.06;
      try {
        const { rows: st } = await client.query("SELECT value_json FROM settings WHERE key='self_employed_tax_rate' LIMIT 1");
        if (st[0]) { const v = parseFloat(String(st[0].value_json).replace(/[^\d.\-]/g, '')); if (Number.isFinite(v)) taxRate = v; }
      } catch (_) {}

      const isSe = !!emp.is_self_employed;
      // ТЗ: два поля — «сколько выплачиваем» (amount) и «сколько переводим»
      // (transfer_amount). Для не-СЗ «переводим» может быть БОЛЬШЕ «выплачиваем»
      // (пример заказчика: выплачиваем 70т, переводим 100т → 30 рабочий несёт
      // в кассу). Для СЗ налог 6% добавляется сверху к переведённой сумме.
      let taxAmount = 0;
      let transferAmount = payAmount;
      if (isSe) {
        taxAmount = Math.round(payAmount * taxRate * 100) / 100;
        transferAmount = Math.round((payAmount + taxAmount) * 100) / 100;
      } else if (b.transfer_amount != null && b.transfer_amount !== '') {
        const ta = parseMoney(b.transfer_amount);
        if (ta === null || ta <= 0) return reply.code(400).send({ error: 'transfer_amount: некорректная сумма' });
        transferAmount = ta;
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
      const deadline = new Date(Date.now() + 72 * 3600 * 1000);
      // payment_method выводим из площадки (влияет на источник денег в worker_payment_source_v):
      //   bank → company_bank, restaff → company_se, card → pm_cash/card, cash → cash, other → transfer.
      const PLATFORM_METHOD = { bank: 'bank', restaff: 'self', card: 'card', cash: 'cash', other: 'transfer' };
      const paymentMethod = PLATFORM_METHOD[b.payout_platform] || 'bank';
      // paid_by_role — из роли плательщика (для отчётности/фильтров).
      const ROLE_TO_PAID_BY = { ADMIN: 'admin', BUH: 'buh', DIRECTOR_GEN: 'director', DIRECTOR_COMM: 'director', DIRECTOR_DEV: 'director' };
      const paidByRole = ROLE_TO_PAID_BY[request.user.role] || 'buh';
      const { rows: ins } = await client.query(`
        INSERT INTO worker_payments (
          employee_id, work_id, type, amount, status, payment_method, paid_by, paid_by_role, paid_at,
          pay_year, pay_month, comment, created_by, created_at,
          payout_platform, payout_recipient_note, transfer_amount, tax_amount,
          confirmation_status, confirmation_deadline, payout_batch_id
        ) VALUES ($1, NULL, $2, $3, 'paid', $4, $5, $6, NOW(), $7, $8, $9, $5, NOW(),
                  $10, $11, $12, $13, 'awaiting', $14, $15)
        RETURNING id, amount, transfer_amount, tax_amount, confirmation_status, confirmation_deadline
      `, [
        empId, kind, payAmount, paymentMethod,
        userId, paidByRole, y, m, b.comment || null,
        b.payout_platform || null, b.payout_recipient_note || null,
        transferAmount, taxAmount, deadline, batchId,
      ]);

      await client.query(`
        INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
        VALUES ($1, 'worker_payments', $2, 'payout_paid', $3::jsonb, NOW())
      `, [userId, ins[0].id, JSON.stringify({
        kind, pay_amount: payAmount, transfer_amount: transferAmount, tax_amount: taxAmount,
        employee_id: empId, employee_fio: emp.fio, year: y, month: m,
        payout_platform: b.payout_platform || null, batch_id: batchId,
      })]);

      await client.query('COMMIT');

      // Уведомление (in-app) — SMS/MAX в Этапе 5
      try {
        if (emp.user_id) {
          const notify = require('../services/notify');
          await notify.createNotification(db, {
            user_id: emp.user_id,
            title: `💰 Выплата ${Math.round(payAmount)}₽`,
            message: 'Зайдите в приложение и подтвердите получение.',
            type: 'payment_received',
            link: '/field/earnings',
          });
        }
      } catch (_) {}

      return reply.send({
        ok: true,
        payment: ins[0],
        preview: {
          employee_id: empId, fio: emp.fio, kind,
          pay_amount: payAmount, transfer_amount: transferAmount, tax_amount: taxAmount,
          is_self_employed: isSe, year: y, month: m,
        },
      });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      logError(fastify, '[payouts] POST /pay error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
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
        `SELECT id, COALESCE(NULLIF(TRIM(fio),''), NULLIF(TRIM(full_name),''), 'ID '||id) AS fio,
                is_self_employed, is_officially_employed FROM employees WHERE id=$1`, [empId]);
      let taxRate = 0.06;
      try {
        const { rows: st } = await db.query("SELECT value_json FROM settings WHERE key='self_employed_tax_rate' LIMIT 1");
        if (st[0]) { const v = parseFloat(String(st[0].value_json).replace(/[^\d.\-]/g, '')); if (Number.isFinite(v)) taxRate = v; }
      } catch (_) {}
      return reply.send({
        employee: empRows[0] || { id: empId },
        row, tax_rate: taxRate,
        is_self_employed: !!(empRows[0] && empRows[0].is_self_employed),
      });
    } catch (err) {
      logError(fastify, '[payouts] GET /preview error', err, request);
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
