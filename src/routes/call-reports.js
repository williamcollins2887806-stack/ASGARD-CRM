'use strict';

/**
 * ASGARD CRM — API маршруты аналитики звонков
 *
 * GET  /              — список отчётов (пагинация, фильтр)
 * GET  /:id           — детали отчёта
 * POST /generate      — ручная генерация
 * GET  /schedule      — расписание (ADMIN)
 * PUT  /schedule/:id  — обновить расписание (ADMIN)
 */

const CallReportGenerator = require('../services/call-report-generator');

const REPORT_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

async function routes(fastify, options) {
  const db = fastify.db;

  // GET / — Список отчётов
  fastify.get('/', {
    preHandler: [fastify.requireRoles(REPORT_ROLES)]
  }, async (request) => {
    const { type, limit = 20, offset = 0 } = request.query;
    let sql = 'SELECT id, report_type, period_from, period_to, title, generated_by, created_at FROM call_reports WHERE 1=1';
    const params = [];
    let idx = 1;

    if (type) {
      sql += ` AND report_type = $${idx++}`;
      params.push(type);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Math.min(parseInt(limit), 100), parseInt(offset));

    const { rows } = await db.query(sql, params);

    const countRes = await db.query('SELECT COUNT(*) as total FROM call_reports' + (type ? ' WHERE report_type = $1' : ''), type ? [type] : []);

    return { items: rows, total: parseInt(countRes.rows[0]?.total || 0) };
  });

  // GET /:id — Детали отчёта
  fastify.get('/:id', {
    preHandler: [fastify.requireRoles(REPORT_ROLES)]
  }, async (request, reply) => {
    const { rows } = await db.query('SELECT * FROM call_reports WHERE id = $1', [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Отчёт не найден' });
    return { item: rows[0] };
  });

  // POST /generate — Ручная генерация
  fastify.post('/generate', {
    preHandler: [fastify.requireRoles(REPORT_ROLES)]
  }, async (request, reply) => {
    const { report_type = 'daily', date_from, date_to } = request.body;

    if (!['daily', 'weekly', 'monthly'].includes(report_type)) {
      return reply.code(400).send({ error: 'Тип отчёта: daily, weekly, monthly' });
    }

    // Даты по умолчанию
    const now = new Date();
    let dateFrom = date_from;
    let dateTo = date_to;

    if (!dateFrom || !dateTo) {
      switch (report_type) {
        case 'daily': {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          dateFrom = dateFrom || yesterday.toISOString().slice(0, 10);
          dateTo = dateTo || dateFrom;
          break;
        }
        case 'weekly': {
          const weekAgo = new Date(now);
          weekAgo.setDate(weekAgo.getDate() - 7);
          dateFrom = dateFrom || weekAgo.toISOString().slice(0, 10);
          dateTo = dateTo || new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
          break;
        }
        case 'monthly': {
          const monthAgo = new Date(now);
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          dateFrom = dateFrom || monthAgo.toISOString().slice(0, 10);
          dateTo = dateTo || new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
          break;
        }
      }
    }

    let aiProvider = null;
    try { aiProvider = require('../services/ai-provider'); } catch (_) {}

    const generator = new CallReportGenerator(db, aiProvider);
    const report = await generator.generate(report_type, dateFrom, dateTo, request.user.id);

    return { success: true, item: report };
  });

  // GET /schedule — Расписание
  fastify.get('/schedule', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async () => {
    const { rows } = await db.query('SELECT * FROM call_report_schedule ORDER BY id');
    return { items: rows };
  });

  // PUT /schedule/:id — Обновить расписание
  fastify.put('/schedule/:id', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { cron_expression, is_active, notify_roles } = request.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (cron_expression !== undefined) {
      updates.push(`cron_expression = $${idx++}`);
      values.push(cron_expression);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(is_active);
    }
    if (notify_roles !== undefined) {
      updates.push(`notify_roles = $${idx++}`);
      values.push(notify_roles);
    }

    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });

    values.push(id);
    const { rows } = await db.query(
      `UPDATE call_report_schedule SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (!rows[0]) return reply.code(404).send({ error: 'Расписание не найдено' });
    return { success: true, item: rows[0] };
  });
}

module.exports = routes;
