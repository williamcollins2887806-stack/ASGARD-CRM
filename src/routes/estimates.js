'use strict';

/**
 * Estimates Routes
 */

const estimateApprovalWorkflow = require('../services/estimateApprovalWorkflow');

const ALLOWED_COLS = new Set([
  'tender_id', 'title', 'pm_id', 'approval_status',
  'margin', 'comment', 'amount', 'cost', 'notes', 'description',
  'customer', 'object_name', 'work_type', 'priority', 'deadline',
  'items_json', 'status', 'work_id', 'approval_comment',
  'sent_for_approval_at', 'reject_reason', 'version_no',
  'created_by', 'created_at', 'updated_at'
]);

function filterData(data) {
  const filtered = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (ALLOWED_COLS.has(key) && value !== undefined) filtered[key] = value;
  }
  return filtered;
}
function isApprovalControlledPatch(body) {
  return Object.keys(body || {}).some((key) => estimateApprovalWorkflow.APPROVAL_MUTATION_FIELDS.has(key));
}
function isApprovalStatusChange(body, currentStatus) {
  const requested = estimateApprovalWorkflow.normalizeLegacyStatus(body?.approval_status);
  if (!requested) return false;
  return requested !== estimateApprovalWorkflow.normalizeLegacyStatus(currentStatus);
}
function extractRequiresPayment(body) { return estimateApprovalWorkflow.extractRequiresPayment(body || {}); }

async function routes(fastify) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  async function withWorkflowAction(reply, handler) {
    try { return await handler(); }
    catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Ошибка согласования' });
    }
  }
  function canReadApprovalWorkflow(user, estimate) {
    if (!user) return false;
    if (user.role === 'ADMIN' || user.role === 'HEAD_PM' || user.role === 'BUH') return true;
    if (String(user.role || '').startsWith('DIRECTOR')) return true;
    return Number(user.id) === Number(estimateApprovalWorkflow.getRequesterId(estimate));
  }
  async function ensureEstimateCanBeEditedDirectly(request, reply, estimate) {
    const approval = await estimateApprovalWorkflow.getApprovalRequest(db, Number(estimate.id));
    if (!approval) return true;
    const ownerId = estimateApprovalWorkflow.getRequesterId(estimate);
    const canEditInRework = approval.current_stage === estimateApprovalWorkflow.STAGES.PM_REWORK && (request.user.role === 'ADMIN' || Number(request.user.id) === Number(ownerId));
    if (canEditInRework) return true;
    return reply.code(409).send({ error: 'Документ уже участвует в согласовании. Используйте действия согласования для смены статуса.' });
  }
  function buildWorkflowActionHandler(actionName) {
    return async function workflowActionHandler(request, reply) {
      const params = {
        estimateId: Number(request.params.id),
        actor: request.user,
        comment: request.body?.comment || request.body?.approval_comment || request.body?.reject_reason || '',
        reworkKind: request.body?.rework_kind || request.body?.kind || 'rework',
        requiresPayment: extractRequiresPayment(request.body),
        sourceType: request.body?.source_type,
        sourceId: request.body?.source_id,
        source: `estimates_route:${actionName}`
      };
      return withWorkflowAction(reply, async () => {
        let result;
        if (actionName === 'submit') result = await estimateApprovalWorkflow.submit(db, params);
        else if (actionName === 'resubmit') result = await estimateApprovalWorkflow.resubmit(db, params);
        else if (actionName === 'approve_to_accounting') result = await estimateApprovalWorkflow.approveToAccounting(db, params);
        else if (actionName === 'request_rework') result = await estimateApprovalWorkflow.requestRework(db, params);
        else if (actionName === 'reject') result = await estimateApprovalWorkflow.reject(db, params);
        else if (actionName === 'accept_accounting' || actionName === 'approve_final') result = await estimateApprovalWorkflow.acceptAccounting(db, params);
        else if (actionName === 'cancel_by_pm') result = await estimateApprovalWorkflow.cancelByPm(db, params);
        else throw new Error(`Unsupported workflow action: ${actionName}`);
        return { estimate: result.estimate, approval: result.request, event: result.event, payment_slip: result.paymentSlip || null };
      });
    };
  }

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tender_id, pm_id, status, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT e.*, t.customer_name as customer, u.name as pm_name FROM estimates e LEFT JOIN tenders t ON e.tender_id = t.id LEFT JOIN users u ON e.pm_id = u.id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (tender_id) { sql += ` AND e.tender_id = $${idx}`; params.push(tender_id); idx++; }
    if (pm_id) { sql += ` AND e.pm_id = $${idx}`; params.push(pm_id); idx++; }
    if (status) { sql += ` AND e.approval_status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY e.id DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { estimates: result.rows };
  });

  fastify.get('/:id/approval', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const estimateResult = await db.query('SELECT * FROM estimates WHERE id = $1', [request.params.id]);
    const estimate = estimateResult.rows[0];
    if (!estimate) return reply.code(404).send({ error: 'Документ не найден' });
    if (!canReadApprovalWorkflow(request.user, estimate)) return reply.code(403).send({ error: 'Недостаточно прав для просмотра согласования' });
    const details = await estimateApprovalWorkflow.getApprovalDetails(db, Number(request.params.id));
    return { estimate, approval: details.request, events: details.events, payment_slips: details.paymentSlips };
  });

  fastify.post('/:id/approval/submit', { preHandler: [fastify.authenticate] }, buildWorkflowActionHandler('submit'));
  fastify.post('/:id/approval/resubmit', { preHandler: [fastify.authenticate] }, buildWorkflowActionHandler('resubmit'));
  fastify.post('/:id/approval/approve-to-accounting', { preHandler: [fastify.authenticate] }, buildWorkflowActionHandler('approve_to_accounting'));
  fastify.post('/:id/approval/request-rework', { preHandler: [fastify.authenticate] }, buildWorkflowActionHandler('request_rework'));
  fastify.post('/:id/approval/reject', { preHandler: [fastify.authenticate] }, buildWorkflowActionHandler('reject'));
  fastify.post('/:id/approval/accept', { preHandler: [fastify.authenticate] }, buildWorkflowActionHandler('accept_accounting'));
  fastify.post('/:id/approval/approve-final', { preHandler: [fastify.authenticate] }, buildWorkflowActionHandler('approve_final'));
  fastify.post('/:id/approval/cancel', { preHandler: [fastify.authenticate] }, buildWorkflowActionHandler('cancel_by_pm'));
  fastify.post('/:id/approval/mark-paid', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    return withWorkflowAction(reply, async () => {
      const parts = request.parts();
      let paymentFile = null;
      const fields = {};
      for await (const part of parts) {
        if (part.file) {
          paymentFile = { filename: part.filename, mimetype: part.mimetype, buffer: await part.toBuffer() };
        } else {
          fields[part.fieldname] = part.value;
        }
      }
      const result = await estimateApprovalWorkflow.markPaid(db, {
        estimateId: Number(request.params.id), actor: request.user, comment: fields.comment || '', paymentFile, source: 'estimates_route:mark_paid'
      });
      return { estimate: result.estimate, approval: result.request, event: result.event, payment_slip: result.paymentSlip || null };
    });
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('SELECT * FROM estimates WHERE id = $1', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Документ не найден' });
    const approval = await estimateApprovalWorkflow.getApprovalRequest(db, Number(request.params.id));
    return { estimate: result.rows[0], approval };
  });

  fastify.post('/', { preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'])] }, async (request, reply) => {
    try {
      const body = request.body || {};
      if (body.name && !body.title) { body.title = body.name; delete body.name; }
      if (!body.title && !body.tender_id) return reply.code(400).send({ error: 'Укажите название или идентификатор тендера' });
      const requestedStatus = estimateApprovalWorkflow.normalizeLegacyStatus(body.approval_status);
      if (requestedStatus && !['draft', 'sent', 'pending'].includes(requestedStatus)) return reply.code(409).send({ error: 'Создание записи возможно только в черновике или через маршрут согласования' });
      const data = filterData({ ...body, approval_status: ['sent', 'pending'].includes(requestedStatus) ? 'draft' : (requestedStatus || body.approval_status), created_by: request.user.id, created_at: new Date().toISOString() });
      const keys = Object.keys(data);
      if (!keys.length) return reply.code(400).send({ error: 'Нет данных для сохранения' });
      const values = Object.values(data);
      const sql = `INSERT INTO estimates (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await db.query(sql, values);
      let estimate = result.rows[0];
      if (['sent', 'pending'].includes(requestedStatus)) {
        try {
          const workflowResult = await estimateApprovalWorkflow.submit(db, { estimateId: estimate.id, actor: request.user, comment: body.approval_comment || body.comment || '', requiresPayment: extractRequiresPayment(body), sourceType: body.source_type, sourceId: body.source_id, source: 'estimates_route_create' });
          estimate = workflowResult.estimate;
          return { estimate, approval: workflowResult.request, event: workflowResult.event };
        } catch (workflowErr) {
          await db.query('DELETE FROM estimates WHERE id = $1', [estimate.id]);
          throw workflowErr;
        }
      }
      if (estimate.pm_id && estimate.pm_id !== request.user.id) {
        createNotification(db, { user_id: estimate.pm_id, title: 'Новый документ', message: `${request.user.name || 'Пользователь'} создал документ: ${estimate.title || ''}`, type: 'estimate', link: `#/estimates?id=${estimate.id}` });
      }
      return { estimate };
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      if (err.code === '22003') return reply.code(400).send({ error: 'Числовое значение выходит за допустимый диапазон' });
      if (err.code === '23503') return reply.code(400).send({ error: 'Связанная запись не найдена' });
      if (err.code === '23505') return reply.code(409).send({ error: 'Запись уже существует' });
      return reply.code(500).send({ error: 'Ошибка создания документа' });
    }
  });

  fastify.put('/:id', { preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'BUH'])] }, async (request, reply) => {
    const { id } = request.params;
    const currentResult = await db.query('SELECT * FROM estimates WHERE id = $1', [id]);
    const current = currentResult.rows[0];
    if (!current) return reply.code(404).send({ error: 'Документ не найден' });
    if (isApprovalStatusChange(request.body, current.approval_status)) {
      return withWorkflowAction(reply, async () => {
        const result = await estimateApprovalWorkflow.applyLegacyMutation(db, { estimateId: Number(id), actor: request.user, patch: request.body || {}, source: 'estimates_route_put' });
        return { estimate: result.estimate, approval: result.request, event: result.event };
      });
    }
    const approval = await estimateApprovalWorkflow.getApprovalRequest(db, Number(id));
    if (approval) {
      const directEditReply = await ensureEstimateCanBeEditedDirectly(request, reply, current);
      if (directEditReply !== true) return directEditReply;
    }
    const data = filterData(request.body || {});
    for (const field of estimateApprovalWorkflow.APPROVAL_MUTATION_FIELDS) delete data[field];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) { updates.push(`${key} = $${idx}`); values.push(value); idx++; }
    if (!updates.length) {
      if (isApprovalControlledPatch(request.body)) return reply.code(409).send({ error: 'Поля согласования меняются только через действия согласования.' });
      return reply.code(400).send({ error: 'Нет данных для сохранения' });
    }
    updates.push('updated_at = NOW()');
    values.push(id);
    const sql = `UPDATE estimates SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    return { estimate: result.rows[0], approval };
  });

  fastify.delete('/:id', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (request, reply) => {
    const result = await db.query('DELETE FROM estimates WHERE id = $1 RETURNING id', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Документ не найден' });
    return { message: 'Удалено' };
  });
}

module.exports = routes;
