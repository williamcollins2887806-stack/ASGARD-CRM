'use strict';

/**
 * ASGARD CRM — Универсальные маршруты согласований
 * ═══════════════════════════════════════════════════════════════
 * 
 * POST /api/approval/:entityType/:id/approve     — директор согласовывает
 * POST /api/approval/:entityType/:id/rework       — доработка (директор/бух)
 * POST /api/approval/:entityType/:id/question      — вопрос (директор/бух)
 * POST /api/approval/:entityType/:id/reject        — директор отклоняет
 * POST /api/approval/:entityType/:id/resubmit     — PM переотправляет после доработки
 * POST /api/approval/:entityType/:id/pay-bank      — бух оплачивает через ПП
 * POST /api/approval/:entityType/:id/issue-cash    — бух выдаёт наличные
 * POST /api/approval/:entityType/:id/confirm-cash  — инициатор подтверждает получение
 * POST /api/approval/:entityType/:id/expense-report — инициатор прикладывает отчёт
 * GET  /api/approval/pending-buh                    — очередь бухгалтерии
 * GET  /api/approval/cash-balance                   — баланс кассы (для модалки)
 */

const approvalService = require('../services/approvalService');

// Разрешённые сущности (защита от SQL injection)
const ALLOWED_ENTITIES = new Set([
  'cash_requests', 'pre_tender_requests', 'bonus_requests',
  'work_expenses', 'office_expenses', 'expenses',
  'one_time_payments', 'tmc_requests', 'payroll_sheets',
  'business_trips', 'travel_expenses', 'training_applications',
  'estimates', 'tkp', 'staff_requests', 'pass_requests',
  'permit_applications', 'site_inspections', 'seal_transfers'
]);

function validateEntity(entityType) {
  if (!ALLOWED_ENTITIES.has(entityType)) {
    throw Object.assign(new Error(`Неизвестная сущность: ${entityType}`), { statusCode: 400 });
  }
}

async function routes(fastify) {
  const db = fastify.db;

  // Обёртка для обработки ошибок
  async function handleAction(reply, fn) {
    try {
      return await fn();
    } catch (err) {
      const code = err.statusCode || 500;
      return reply.code(code).send({
        error: err.message,
        balance: err.balance // для модалки «недостаточно средств»
      });
    }
  }

  // ─── Директор согласовывает ───
  fastify.post('/:entityType/:id/approve', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return handleAction(reply, async () => {
      validateEntity(request.params.entityType);
      return approvalService.directorApprove(db, {
        entityType: request.params.entityType,
        entityId: parseInt(request.params.id),
        actor: request.user,
        comment: request.body?.comment || ''
      });
    });
  });

  // ─── На доработку ───
  fastify.post('/:entityType/:id/rework', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return handleAction(reply, async () => {
      validateEntity(request.params.entityType);
      return approvalService.requestRework(db, {
        entityType: request.params.entityType,
        entityId: parseInt(request.params.id),
        actor: request.user,
        comment: request.body?.comment || ''
      });
    });
  });

  // ─── Вопрос ───
  fastify.post('/:entityType/:id/question', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return handleAction(reply, async () => {
      validateEntity(request.params.entityType);
      return approvalService.askQuestion(db, {
        entityType: request.params.entityType,
        entityId: parseInt(request.params.id),
        actor: request.user,
        comment: request.body?.comment || ''
      });
    });
  });

  // ─── Отклонить ───
  fastify.post('/:entityType/:id/reject', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return handleAction(reply, async () => {
      validateEntity(request.params.entityType);
      return approvalService.directorReject(db, {
        entityType: request.params.entityType,
        entityId: parseInt(request.params.id),
        actor: request.user,
        comment: request.body?.comment || ''
      });
    });
  });

  // ─── PM: отправить черновик на согласование ───
  fastify.post('/:entityType/:id/send', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return handleAction(reply, async () => {
      validateEntity(request.params.entityType);
      const entityType = request.params.entityType;
      const entityId = parseInt(request.params.id);
      const actor = request.user;

      // Verify entity exists and is draft
      const result = await db.query(`SELECT * FROM ${entityType} WHERE id = $1`, [entityId]);
      const entity = result.rows[0];
      if (!entity) throw Object.assign(new Error('Запись не найдена'), { statusCode: 404 });
      if (entity.approval_status !== 'draft') {
        throw Object.assign(new Error('Отправить можно только черновик'), { statusCode: 400 });
      }

      // Update status to sent
      await db.query(
        `UPDATE ${entityType} SET approval_status = 'sent', sent_for_approval_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [entityId]
      );

      // Log
      await db.query(
        `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
         VALUES ($1, $2, $3, 'send', $4, NOW())`,
        [actor.id, entityType, entityId, JSON.stringify({ actor_name: actor.name })]
      );

      // Record in approval_comments
      await db.query(
        `INSERT INTO approval_comments (entity_type, entity_id, user_id, action, comment)
         VALUES ($1, $2, $3, 'resubmit', $4)`,
        [entityType, entityId, actor.id, 'Отправлено на согласование']
      );

      // Notify directors
      await approvalService.notifyDirectorsForApproval(db, {
        entityType, entityId,
        actorName: actor.name,
        title: 'На согласование',
        message: `${actor.name || 'РП'} отправил на согласование #${entityId}`,
        requiresPayment: false
      });

      return { success: true, status: 'sent' };
    });
  });

  // ─── PM: переотправить после доработки/вопроса ───
  fastify.post('/:entityType/:id/resubmit', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return handleAction(reply, async () => {
      validateEntity(request.params.entityType);
      return approvalService.resubmit(db, {
        entityType: request.params.entityType,
        entityId: parseInt(request.params.id),
        actor: request.user
      });
    });
  });

  // ─── Бухгалтерия: оплатить через ПП ───
  fastify.post('/:entityType/:id/pay-bank', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return handleAction(reply, async () => {
      validateEntity(request.params.entityType);
      return approvalService.payByBankTransfer(db, {
        entityType: request.params.entityType,
        entityId: parseInt(request.params.id),
        actor: request.user,
        comment: request.body?.comment || '',
        documentId: request.body?.document_id || null
      });
    });
  });

  // ─── Бухгалтерия: выдать наличные ───
  fastify.post('/:entityType/:id/issue-cash', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return handleAction(reply, async () => {
      validateEntity(request.params.entityType);
      const amount = parseFloat(request.body?.amount);
      if (!amount || amount <= 0) {
        throw Object.assign(new Error('Укажите сумму'), { statusCode: 400 });
      }
      return approvalService.issueCash(db, {
        entityType: request.params.entityType,
        entityId: parseInt(request.params.id),
        actor: request.user,
        amount,
        comment: request.body?.comment || ''
      });
    });
  });

  // ─── Инициатор: подтвердить получение наличных ───
  fastify.post('/:entityType/:id/confirm-cash', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return handleAction(reply, async () => {
      validateEntity(request.params.entityType);
      return approvalService.confirmCashReceived(db, {
        entityType: request.params.entityType,
        entityId: parseInt(request.params.id),
        actor: request.user
      });
    });
  });

  // ─── Инициатор: отчёт о расходах ───
  fastify.post('/:entityType/:id/expense-report', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return handleAction(reply, async () => {
      validateEntity(request.params.entityType);
      return approvalService.submitExpenseReport(db, {
        entityType: request.params.entityType,
        entityId: parseInt(request.params.id),
        actor: request.user,
        comment: request.body?.comment || '',
        documentId: request.body?.document_id || null
      });
    });
  });

  // ─── Возврат наличных (остаток) ───
  fastify.post('/:entityType/:id/return-cash', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return handleAction(reply, async () => {
      validateEntity(request.params.entityType);
      const amount = parseFloat(request.body?.amount);
      if (!amount || amount <= 0) {
        throw Object.assign(new Error('Укажите сумму возврата'), { statusCode: 400 });
      }
      return approvalService.returnCash(db, {
        entityType: request.params.entityType,
        entityId: parseInt(request.params.id),
        actor: request.user,
        amount,
        comment: request.body?.comment || ''
      });
    });
  });

  // ─── История комментариев согласования ───
  fastify.get('/:entityType/:id/comments', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { entityType, id } = request.params;
    validateEntity(entityType);
    const role = request.user.role;
    const allowed = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM'];
    if (!allowed.includes(role)) {
      return reply.code(403).send({ error: 'Нет доступа к комментариям' });
    }
    const result = await db.query(
      `SELECT ac.*, u.name as user_name, u.role as user_role
       FROM approval_comments ac
       JOIN users u ON ac.user_id = u.id
       WHERE ac.entity_type = $1 AND ac.entity_id = $2
       ORDER BY ac.created_at ASC`,
      [entityType, parseInt(id)]
    );
    return { comments: result.rows };
  });

  // ─── Добавить комментарий ───
  fastify.post('/:entityType/:id/comments', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { entityType, id } = request.params;
    validateEntity(entityType);
    const { comment, parent_id } = request.body || {};
    if (!comment || !comment.trim()) {
      return reply.code(400).send({ error: 'Укажите комментарий' });
    }
    const result = await db.query(
      `INSERT INTO approval_comments (entity_type, entity_id, user_id, action, comment, parent_id)
       VALUES ($1, $2, $3, 'comment', $4, $5) RETURNING *`,
      [entityType, parseInt(id), request.user.id, comment.trim(), parent_id || null]
    );
    // SSE notify участников потока
    if (fastify.sseManager) {
      const participants = await db.query(
        `SELECT DISTINCT user_id FROM approval_comments WHERE entity_type = $1 AND entity_id = $2 AND user_id != $3`,
        [entityType, parseInt(id), request.user.id]
      );
      for (const p of participants.rows) {
        fastify.sseManager.send(p.user_id, {
          type: 'approval_comment',
          entity_type: entityType,
          entity_id: parseInt(id),
          comment: result.rows[0]
        });
      }
    }
    return { comment: result.rows[0] };
  });

  // ─── Очередь бухгалтерии ───
  fastify.get('/pending-buh', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!approvalService.isBuh(request.user.role)) {
      return reply.code(403).send({ error: 'Доступ только для бухгалтерии' });
    }
    const items = await approvalService.getPendingForBuh(db);
    const balance = await approvalService.getCashBalance(db);
    return { items, cash_balance: balance };
  });

  // ─── Баланс кассы (для модалки) ───
  fastify.get('/cash-balance', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const balance = await approvalService.getCashBalance(db);
    return { balance };
  });
}

module.exports = routes;
