'use strict';

/**
 * Director Payments — Stage W (выплаты от директора)
 * Prefix: /api/director-payments
 *
 * Логика:
 *   Директор лично выплачивает рабочему (нал/перевод/карта) — отдельный экран
 *   в CRM. Внутри это та же worker_payments запись (status='paid'), но с
 *   paid_by_role='director' — чтобы было видно «директор выдал», а не РП/бух.
 *
 * Endpoints:
 *   POST /        — выплатить рабочему (прокси на pay-worker логику)
 *   GET  /history — история выплат с paid_by_role='director'
 *
 * RBAC: только DIRECTOR_*, ADMIN.
 */

const ALLOWED_ROLES = [
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'ADMIN'
];

const VALID_TYPES = ['per_diem', 'salary', 'advance', 'bonus', 'penalty'];
const VALID_METHODS = ['cash', 'card', 'transfer'];

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.requireRoles(ALLOWED_ROLES)] };

  // ────────────────────────────────────────────────────────────────
  // POST /api/director-payments
  // body: { employee_id, work_id, type, amount, payment_method,
  //         comment?, pay_year?, pay_month?, confirm_duplicate? }
  //   Прокси на pay-worker, но с paid_by_role='director'.
  //   Защита от дубля (та же что в worker-payments.js).
  // ────────────────────────────────────────────────────────────────
  fastify.post('/', auth, async (request, reply) => {
    try {
      const {
        employee_id, work_id, type, amount, payment_method,
        comment, pay_year, pay_month, confirm_duplicate
      } = request.body || {};

      if (!VALID_TYPES.includes(type)) {
        return reply.code(400).send({ error: `type ∈ ${VALID_TYPES.join('|')}` });
      }
      if (!VALID_METHODS.includes(payment_method)) {
        return reply.code(400).send({ error: `payment_method ∈ ${VALID_METHODS.join('|')}` });
      }
      const amt = parseFloat(amount);
      if (!Number.isFinite(amt) || (type !== 'penalty' && amt <= 0)) {
        return reply.code(400).send({ error: 'amount > 0' });
      }
      if (!employee_id || !work_id) {
        return reply.code(400).send({ error: 'employee_id, work_id обязательны' });
      }
      const eId = parseInt(employee_id, 10);
      const wId = parseInt(work_id, 10);
      if (!Number.isFinite(eId) || !Number.isFinite(wId)) {
        return reply.code(400).send({ error: 'Bad employee_id/work_id' });
      }

      // Контекст: проверка существования work + employee
      const { rows: ctx } = await db.query(`
        SELECT w.id AS work_id, w.work_title,
               e.id AS employee_id, e.fio, e.user_id AS employee_user_id
        FROM works w, employees e
        WHERE w.id = $1 AND e.id = $2
      `, [wId, eId]);
      if (!ctx.length) {
        return reply.code(404).send({ error: 'Работа или сотрудник не найдены' });
      }
      const c = ctx[0];

      // Защита от двойной выплаты — та же логика, что в worker-payments.js.
      if (!confirm_duplicate) {
        const now = new Date();
        const py = pay_year  ? parseInt(pay_year, 10)  : now.getFullYear();
        const pm = pay_month ? parseInt(pay_month, 10) : (now.getMonth() + 1);
        const { rows: existing } = await db.query(`
          SELECT id, amount, paid_at, payment_method
          FROM worker_payments
          WHERE employee_id = $1
            AND type = $2
            AND status IN ('paid','confirmed')
            AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $3
            AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $4
        `, [eId, type, py, pm]);

        if (existing.length > 0) {
          const totalAlreadyPaid = existing.reduce((s, r) => s + Number(r.amount || 0), 0);
          const typeRu = {
            per_diem: 'Суточные', salary: 'Зарплата', advance: 'Аванс',
            bonus: 'Премия', penalty: 'Штраф'
          }[type] || type;
          return reply.code(409).send({
            error: 'duplicate_payment',
            message: `${typeRu} уже выплачены этому рабочему: ${existing.length} операция(й), всего ${Math.round(totalAlreadyPaid)} ₽.`,
            already_paid: existing.map(r => ({
              id: r.id, amount: Number(r.amount),
              paid_at: r.paid_at, payment_method: r.payment_method
            })),
            total_already_paid: Math.round(totalAlreadyPaid),
            requires_confirmation: true
          });
        }
      }

      const userId = request.user.id;
      const py = pay_year  ? parseInt(pay_year, 10)  : null;
      const pm = pay_month ? parseInt(pay_month, 10) : null;

      const { rows: inserted } = await db.query(`
        INSERT INTO worker_payments (
          employee_id, work_id, type, amount, status,
          payment_method, paid_by, paid_by_role, paid_at,
          comment, pay_year, pay_month,
          created_at, created_by
        ) VALUES (
          $1, $2, $3, $4, 'paid',
          $5, $6, 'director', NOW(),
          $7, $8, $9,
          NOW(), $6
        )
        RETURNING *
      `, [eId, wId, type, amt, payment_method, userId, comment || null, py, pm]);

      // Audit
      try {
        await db.query(`
          INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
          VALUES ($1, 'worker_payments', $2, 'director_payment_paid', $3::jsonb, NOW())
        `, [userId, inserted[0].id, JSON.stringify({
          amount: amt, type, employee_id: eId, employee_fio: c.fio,
          work_id: wId, work_title: c.work_title, payment_method,
          comment: comment || null, paid_by_role: 'director'
        })]);
      } catch (_) { /* audit_log опциональна */ }

      // Уведомление рабочему
      if (c.employee_user_id) {
        try {
          const notify = require('../services/notify');
          const typeLabels = {
            salary: 'Зарплата', per_diem: 'Суточные', advance: 'Аванс',
            bonus: 'Премия', penalty: 'Удержание'
          };
          const methodLabels = { cash: 'наличные', card: 'на карту', transfer: 'переводом' };
          await notify.createNotification(db, {
            user_id: c.employee_user_id,
            title: `💰 Выплачено ${Math.round(amt)}₽`,
            message: `${typeLabels[type] || type}: ${amt}₽ ${methodLabels[payment_method]} (от директора)`,
            type: 'payment_received',
            link: '/field/earnings'
          });
        } catch (e) {
          fastify.log.warn(`[director-payments] notification failed: ${e.message}`);
        }
      }

      return { ok: true, payment: inserted[0] };
    } catch (err) {
      fastify.log.error({ err }, '[director-payments] POST / error');
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // GET /api/director-payments/history
  //   ?year= &month= &employee_id= &work_id=
  //   Список worker_payments где paid_by_role='director'.
  // ────────────────────────────────────────────────────────────────
  fastify.get('/history', auth, async (request, reply) => {
    try {
      const { year, month, employee_id, work_id, limit, offset } = request.query || {};
      const conds = [`wp.paid_by_role = 'director'`];
      const params = [];
      let idx = 1;

      if (year) {
        conds.push(`COALESCE(wp.pay_year, EXTRACT(YEAR FROM wp.created_at)::int) = $${idx++}`);
        params.push(parseInt(year, 10));
      }
      if (month) {
        conds.push(`COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int) = $${idx++}`);
        params.push(parseInt(month, 10));
      }
      if (employee_id) {
        conds.push(`wp.employee_id = $${idx++}`);
        params.push(parseInt(employee_id, 10));
      }
      if (work_id) {
        conds.push(`wp.work_id = $${idx++}`);
        params.push(parseInt(work_id, 10));
      }

      const where = 'WHERE ' + conds.join(' AND ');
      const lim = Math.min(parseInt(limit, 10) || 200, 1000);
      const off = parseInt(offset, 10) || 0;

      const { rows } = await db.query(`
        SELECT wp.*, e.fio AS employee_fio,
               w.work_title,
               u.name AS paid_by_name
        FROM worker_payments wp
        LEFT JOIN employees e ON e.id = wp.employee_id
        LEFT JOIN works w ON w.id = wp.work_id
        LEFT JOIN users u ON u.id = wp.paid_by
        ${where}
        ORDER BY COALESCE(wp.paid_at, wp.created_at) DESC, wp.id DESC
        LIMIT ${lim} OFFSET ${off}
      `, params);

      const { rows: [tot] } = await db.query(`
        SELECT COUNT(*)::int AS cnt, COALESCE(SUM(amount), 0)::numeric AS sum
        FROM worker_payments wp
        ${where}
      `, params);

      return {
        payments: rows,
        total_count: tot.cnt,
        total_amount: Number(tot.sum) || 0
      };
    } catch (err) {
      fastify.log.error({ err }, '[director-payments] GET /history error');
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
