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
  'permit_applications', 'site_inspections', 'seal_transfers',
  'payment_invoices'
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
      const result = await approvalService.directorApprove(db, {
        entityType: request.params.entityType,
        entityId: parseInt(request.params.id),
        actor: request.user,
        comment: request.body?.comment || ''
      });

      // Любой путь согласования просчёта триггерит /approve-finalize:
      // он генерит HTML+PDF+Excel отчёт и кладёт в documents с tender_id.
      // Идемпотентен: при повторном вызове просто перезапишет отчёты.
      if (request.params.entityType === 'estimates' && result?.status === 'approved') {
        setImmediate(() => {
          fastify.inject({
            method: 'POST',
            url: `/api/estimates/${request.params.id}/approve-finalize`,
            headers: { authorization: request.headers.authorization || '' },
            payload: {}
          }).catch(err => fastify.log.warn('[approval] auto approve-finalize failed:', err.message));
        });

        // FEEDBACK-LOOP: утверждённая смета → авто-эталон в mimir_reference_projects
        // (база обучения Conductor растёт от каждого согласованного проекта).
        setImmediate(() => {
          try {
            const { learnFromEstimate } = require('../services/mimir-conductor/reference-learner');
            learnFromEstimate(parseInt(request.params.id), { createdBy: request.user?.id })
              .then((r) => {
                if (r.ok) {
                  fastify.log.info(`[approval] feedback-loop: estimate #${request.params.id} → reference #${r.reference_id} (${r.created ? 'created' : 'updated'})`);
                } else {
                  fastify.log.warn(`[approval] feedback-loop skipped: ${r.reason || r.error}`);
                }
              })
              .catch((e) => fastify.log.warn(`[approval] feedback-loop error: ${e.message}`));
          } catch (e) { fastify.log.warn(`[approval] learnFromEstimate require failed: ${e.message}`); }
        });
      }

      return result;
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

      // TO/HEAD_TO могут отправлять estimates на согласование ТОЛЬКО если тендер помечен
      // calculator_kind='to' (ТО считает сам) — иначе это «проверочный» просчёт для РП.
      // Для остальных ролей (PM/HEAD_PM/DIRECTOR_*/ADMIN) ограничений нет.
      let approverRoles;
      if (entityType === 'estimates') {
        approverRoles = await approvalService.getEstimateApproverRoles(db, entity);
        if (['TO', 'HEAD_TO'].includes(actor.role) && !approverRoles.includes('HEAD_TO')) {
          throw Object.assign(
            new Error('Тендерный отдел отправляет на согласование только просчёты со своим флагом «считает ТО»'),
            { statusCode: 403 }
          );
        }
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

      // Notify approvers (для estimates с kind='to' это HEAD_TO; иначе директора)
      await approvalService.notifyDirectorsForApproval(db, {
        entityType, entityId,
        actorName: actor.name,
        title: 'На согласование',
        message: `${actor.name || 'Расчётчик'} отправил на согласование #${entityId}`,
        requiresPayment: false,
        approverRoles
      });

      // Перевести тендер в «Согласование ТКП» при отправке просчёта
      if (entityType === 'estimates' && entity.tender_id) {
        await db.query(`
          UPDATE tenders SET tender_status = 'Согласование ТКП', updated_at = NOW()
          WHERE id = $1 AND tender_status = 'Отправлено на просчёт'
        `, [entity.tender_id]);
      }

      // H1: Создать чат в Хугинне для просчётов
      if (entityType === 'estimates') {
        const estimateChat = require('../services/estimateChat');
        setImmediate(async () => {
          try {
            await estimateChat.createEstimateChat(db, entityId, actor);
          } catch (err) {
            console.error('[H1] Chat creation error:', err.message);
          }
        });
      }

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

  // ─── Очередь директора (D1, 21.09) ───
  // Раньше директор не имел своей очереди в этом разделе: nav открывал страницу бухгалтерии,
  // запрос pending-buh падал 403, и директор видел пустой/битый экран. Возвращаем его срез —
  // счета, ожидающие решения директора (status='awaiting_dir').
  fastify.get('/pending-dir', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const role = request.user.role;
    const isDir = approvalService.isDirector(role);
    // ADMIN видит очередь директора для разбора инцидентов (read-only решения не отменяет).
    if (!isDir && role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Доступ только для директора' });
    }
    const { rows } = await db.query(`
      SELECT pi.id, pi.supplier_name, pi.amount, pi.currency, pi.basis_type, pi.basis_text, pi.work_id,
             pi.status, pi.payment_status, pi.pay_timing, pi.created_at, pi.updated_at, pi.file_name,
             pi.due_date, pi.approval_expires_at, pi.doc_registry_id,
             u.name AS initiator_name, s.inn AS supplier_inn
        FROM payment_invoices pi
        LEFT JOIN users u ON u.id = pi.created_by
        LEFT JOIN suppliers s ON s.id = pi.supplier_id
       WHERE pi.status = 'awaiting_dir'
       ORDER BY pi.created_at ASC
    `);
    const items = rows.map((r) => ({
      // ВАЖНО: ровно то же значение, что отдаёт очередь бухгалтерии ('payment_invoices').
      // С единственным числом карточка уходила в чужую ветку обработчика клика и модалка не открывалась.
      entity_type: 'payment_invoices',
      id: r.id,
      label: 'Счёт',
      title: r.supplier_name || ('Счёт #' + r.id),
      amount: r.amount,
      currency: r.currency,
      basis_type: r.basis_type,
      basis_text: r.basis_text,
      work_id: r.work_id,
      status: r.status,
      payment_status: r.payment_status,
      pay_timing: r.pay_timing,
      file_name: r.file_name,
      due_date: r.due_date,
      approval_expires_at: r.approval_expires_at,
      supplier_inn: r.supplier_inn,
      initiator_name: r.initiator_name,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    const total = items.reduce((s, x) => s + Number(x.amount || 0), 0);
    return { items, total, count: items.length };
  });

  // ─── Баланс кассы (для модалки) ───
  fastify.get('/cash-balance', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const balance = await approvalService.getCashBalance(db);
    return { balance };
  });

  // ─── 17.10: АРХИВ решений — согласовано / оплачено / выдано ───
  // Заказчик: «всё что согласовано — в архив, оплачено и выдано тоже; в архиве
  // можно открыть и посмотреть, кто кому сколько и кто согласовал».
  fastify.get('/archive', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const role = request.user.role;
    if (!approvalService.isBuh(role) && !approvalService.isDirector(role) && role !== 'ADMIN') {
      return { items: [] };
    }
    const limit = Math.min(Math.max(parseInt(request.query.limit, 10) || 100, 1), 300);
    const kind = String(request.query.kind || '').toLowerCase();  // invoice|cash|payout|''
    const items = [];

    async function whoNames(ids) {
      const uniq = [...new Set(ids.filter(Boolean).map(Number))];
      if (!uniq.length) return {};
      const r = await db.query(`SELECT id, name FROM users WHERE id = ANY($1::int[])`, [uniq]);
      return Object.fromEntries(r.rows.map((x) => [Number(x.id), x.name]));
    }

    if (!kind || kind === 'invoice') {
      const { rows } = await db.query(
        `SELECT id, supplier_name, amount, status, payment_status, pay_timing,
                created_by, dir_approved_by, dir_approved_at, buh_id, buh_acted_at,
                archived_at, updated_at, file_name, doc_registry_id
           FROM payment_invoices
          WHERE status IN ('pending_payment','paid','archived','expired','rejected')
          ORDER BY COALESCE(buh_acted_at, dir_approved_at, archived_at, updated_at) DESC
          LIMIT $1`, [limit]);
      const names = await whoNames(rows.flatMap((r) => [r.created_by, r.dir_approved_by, r.buh_id]));
      for (const r of rows) {
        items.push({
          kind: 'invoice', id: r.id, title: r.supplier_name || ('Счёт #' + r.id),
          amount: r.amount, status: r.status,
          initiator: names[Number(r.created_by)] || null,
          approved_by: names[Number(r.dir_approved_by)] || null,
          approved_at: r.dir_approved_at,
          paid_by: names[Number(r.buh_id)] || null,
          paid_at: r.buh_acted_at,
          archived_at: r.archived_at,
          at: r.buh_acted_at || r.dir_approved_at || r.archived_at || r.updated_at,
          file_name: r.file_name, doc_registry_id: r.doc_registry_id
        });
      }
    }

    if (!kind || kind === 'cash') {
      const { rows } = await db.query(
        `SELECT cr.id, cr.amount, cr.issued_amount, cr.status, cr.purpose,
                cr.user_id, cr.issued_by, cr.issued_at, cr.created_at, cr.updated_at
           FROM cash_requests cr
          WHERE cr.status IN ('money_issued','closed','reporting','received')
          ORDER BY COALESCE(cr.issued_at, cr.updated_at) DESC LIMIT $1`, [limit]).catch(() => ({ rows: [] }));
      const names = await whoNames(rows.flatMap((r) => [r.user_id, r.issued_by]));
      for (const r of rows) {
        items.push({
          kind: 'cash', id: r.id, title: names[Number(r.user_id)] || ('Заявка #' + r.id),
          amount: r.issued_amount != null ? r.issued_amount : r.amount, status: r.status,
          purpose: r.purpose, issued_by: names[Number(r.issued_by)] || null,
          paid_at: r.issued_at, at: r.issued_at || r.updated_at
        });
      }
    }

    items.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    return { items: items.slice(0, limit) };
  });
}

module.exports = routes;
