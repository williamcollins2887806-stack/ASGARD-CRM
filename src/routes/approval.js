'use strict';

/**
 * ASGARD CRM — Универсальные маршруты согласований
 * ═══════════════════════════════════════════════════════════════
 * 
 * POST /api/approval/:entityType/:id/approve     — директор согласовывает
 * POST /api/approval/:entityType/:id/rework       — доработка (директор/бух)
 * POST /api/approval/:entityType/:id/question      — вопрос (директор/бух)
 * POST /api/approval/:entityType/:id/reject        — директор отклоняет
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
