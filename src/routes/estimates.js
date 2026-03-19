'use strict';

/**
 * Estimates Routes — Просчёты (CRUD)
 * ═══════════════════════════════════════════════════════════════
 *
 * CRUD: создание, чтение, обновление обычных полей, удаление.
 * Согласование (смена approval_status) — ТОЛЬКО через /api/approval/estimates/:id/*
 * PUT с approval_status → 400.
 * version_no генерируется сервером автоматически.
 */

const approvalService = require('../services/approvalService');

const ALLOWED_COLS = new Set([
  'tender_id', 'title', 'pm_id', 'approval_status',
  'margin', 'comment', 'amount', 'cost', 'notes', 'description',
  'customer', 'object_name', 'work_type', 'priority', 'deadline',
  'items_json', 'work_id', 'approval_comment',
  'sent_for_approval_at', 'reject_reason', 'version_no',
  'cover_letter', 'assumptions', 'price_tkp', 'cost_plan',
  'calc_v2_json', 'calc_summary_json', 'quick_calc_json',
  'probability_pct', 'payment_terms',
  'created_by', 'created_at', 'updated_at'
]);

const APPROVAL_FIELDS = new Set([
  'is_approved', 'approved_by', 'approved_at', 'decided_at', 'decided_by_user_id'
]);

function filterData(data) {
  const filtered = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (ALLOWED_COLS.has(key) && value !== undefined) filtered[key] = value;
  }
  return filtered;
}

async function routes(fastify) {
  const db = fastify.db;

  // ─── LIST ───
  // RBAC: фильтрация по ролям (Сессия 4)
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tender_id, pm_id, status, limit = 100, offset = 0 } = request.query;
    const role = request.user.role;
    const userId = request.user.id;

    // Роли без доступа к финансам просчётов
    const NO_ACCESS = ['HR', 'HR_MANAGER', 'WAREHOUSE', 'PROC', 'OFFICE_MANAGER', 'CHIEF_ENGINEER'];
    if (NO_ACCESS.includes(role)) return { estimates: [] };

    let sql = `SELECT e.*, t.customer_name as customer, u.name as pm_name
               FROM estimates e
               LEFT JOIN tenders t ON e.tender_id = t.id
               LEFT JOIN users u ON e.pm_id = u.id WHERE 1=1`;
    const params = [];
    let idx = 1;

    // PM → только свои просчёты
    if (role === 'PM') {
      sql += ` AND e.pm_id = $${idx}`;
      params.push(userId);
      idx++;
    }

    // BUH → только approved + requires_payment
    if (role === 'BUH') {
      sql += ` AND e.approval_status = 'approved' AND e.requires_payment = true`;
    }

    // ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, HEAD_PM → все
    // TO, HEAD_TO → все (TO работает со всеми тендерами)

    if (tender_id) { sql += ` AND e.tender_id = $${idx}`; params.push(tender_id); idx++; }
    if (pm_id) { sql += ` AND e.pm_id = $${idx}`; params.push(pm_id); idx++; }
    if (status) { sql += ` AND e.approval_status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY e.id DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { estimates: result.rows };
  });

  // ─── GET ───
  // RBAC: проверка доступа по роли (Сессия 4)
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const role = request.user.role;
    const userId = request.user.id;

    // Роли без доступа к финансам просчётов
    const NO_ACCESS = ['HR', 'HR_MANAGER', 'WAREHOUSE', 'PROC', 'OFFICE_MANAGER', 'CHIEF_ENGINEER'];
    if (NO_ACCESS.includes(role)) {
      return reply.code(403).send({ error: 'Нет доступа к просчётам' });
    }

    const result = await db.query('SELECT * FROM estimates WHERE id = $1', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Просчёт не найден' });

    const estimate = result.rows[0];

    // PM → только свои
    if (role === 'PM' && Number(estimate.pm_id) !== Number(userId)) {
      return reply.code(403).send({ error: 'Нет доступа к этому просчёту' });
    }

    // BUH → только approved + requires_payment
    if (role === 'BUH' && !(estimate.approval_status === 'approved' && estimate.requires_payment)) {
      return reply.code(403).send({ error: 'Нет доступа к этому просчёту' });
    }

    return { estimate };
  });

  // ─── CREATE ───
  fastify.post('/', {
    preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'])]
  }, async (request, reply) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const body = request.body || {};
      if (body.name && !body.title) { body.title = body.name; delete body.name; }
      if (!body.pm_id) body.pm_id = request.user.id;
      if (!body.title && !body.tender_id) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Укажите название или тендер' });
      }

      const data = filterData({ ...body, created_by: request.user.id, created_at: new Date().toISOString() });
      const sendForApproval = ['sent', 'pending'].includes(String(data.approval_status || '').toLowerCase());
      if (sendForApproval) {
        data.approval_status = 'sent';
        data.sent_for_approval_at = new Date().toISOString();
      } else {
        data.approval_status = data.approval_status || 'draft';
      }

      // version_no — генерируется сервером, клиентское значение игнорируется
      delete data.version_no;
      if (data.tender_id && data.pm_id) {
        const vResult = await client.query(
          'SELECT COALESCE(MAX(version_no), 0) + 1 AS next_ver FROM estimates WHERE tender_id = $1 AND pm_id = $2',
          [data.tender_id, data.pm_id]
        );
        data.version_no = vResult.rows[0].next_ver;
      } else {
        data.version_no = 1;
      }

      const keys = Object.keys(data);
      if (!keys.length) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Нет данных' }); }
      const values = Object.values(data);
      const sql = `INSERT INTO estimates (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await client.query(sql, values);
      const estimate = result.rows[0];

      if (sendForApproval) {
        await approvalService.notifyDirectorsForApproval(client, {
          entityType: 'estimates', entityId: estimate.id,
          actorName: request.user.name,
          title: '📋 Просчёт на согласование',
          message: `${request.user.name || 'РП'} отправил просчёт #${estimate.id}`,
          requiresPayment: false
        });
      }

      await client.query('COMMIT');
      return { estimate };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '22003') return reply.code(400).send({ error: 'Число вне диапазона' });
      if (err.code === '23503') return reply.code(400).send({ error: 'Связанная запись не найдена' });
      return reply.code(500).send({ error: 'Ошибка создания просчёта' });
    } finally {
      client.release();
    }
  });

  // ─── UPDATE ───
  // Только обычные поля (comment, cost_plan, price_tkp и т.д.)
  // Смена статуса согласования — ТОЛЬКО через /api/approval/estimates/:id/*
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body || {};

    // Блокируем попытку сменить статус через PUT
    if (body.approval_status) {
      return reply.code(400).send({
        error: 'Используйте /api/approval/estimates/:id/* для смены статуса'
      });
    }

    const currentResult = await db.query('SELECT * FROM estimates WHERE id = $1', [id]);
    const current = currentResult.rows[0];
    if (!current) return reply.code(404).send({ error: 'Просчёт не найден' });

    const data = filterData(body);

    // Удаляем approval-поля — они управляются только через /api/approval
    for (const field of APPROVAL_FIELDS) delete data[field];
    delete data.reject_reason;
    delete data.approval_comment;
    delete data.sent_for_approval_at;

    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      updates.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    updates.push('updated_at = NOW()');
    values.push(id);
    const sql = `UPDATE estimates SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    return { estimate: result.rows[0] };
  });

  // ─── DELETE ───
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const result = await db.query('DELETE FROM estimates WHERE id = $1 RETURNING id', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { message: 'Удалено' };
  });
}

module.exports = routes;
