/**
 * ASGARD CRM — Предварительные заявки
 * Шаг 10: CRUD + accept/reject + AI-анализ + статистика
 * Prefix: /api/pre-tenders
 *
 * KNOWN ISSUE (🟡 D-16, помечено 23.06.2026):
 *   customer_name на pre_tender_requests, inbox_applications, tenders, works — ПЛОСКОЕ
 *   поле VARCHAR(500), а не FK на справочник customers (PK = inn). Это легаси-решение
 *   из V001 (так и было), миграцию на FK не делаем — слишком много исторических данных
 *   с неуникальными customer_inn (NULL/дубли) и customer_name введёнными до появления
 *   справочника. При переименовании клиента в customers — pre_tender_requests.customer_name
 *   НЕ обновляется. UI компенсирует через COALESCE(c.name, t.customer_name) в /:id-эндпоинтах
 *   (см. tenders.js:374). Перенос на FK — отдельный архитектурный проект.
 */

'use strict';

const db = require('../services/db');
const preTenderService = require('../services/pre-tender-service');
const { sendToUser, sendToRoles, broadcast } = require('./sse');
const { createNotification } = require('../services/notify');
// Wave D: для ensureDefaultSubstages (BUG-7)
const personalKanban = require('./personal-kanban');
const path = require('path');
const fs = require('fs');

// Wave A+ fix BLOCKER#1: PM добавлен — после Wave B он получает карту через /to-pre-tender
// и должен иметь доступ к assigned-to-него pre_tender'у. Доступ к чужим закрыт owner-guard'ом.
const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO', 'HEAD_PM', 'TO', 'PM'];
const DIRECTOR_LIKE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO', 'HEAD_PM'];

// 23.06.2026 Маркетплейс заявок: лимит активных заявок у одного РП.
// При попытке забрать 6-ю — 409 limit_reached. Лимит покрывает «живые» main_status pre_tender:
// new, in_review, need_docs, pending_approval, approved.
// 23.06.2026 BUG-FIX (🟡 D-15): убраны 'sent' и 'kp_prep' — это v3-колонки, а не main_status
// (CHECK на pre_tender_requests.status таких значений не разрешает, см. CANONICAL_MAIN_STATUSES.pre_tender
// в personal-kanban.js:51-55). До фикса они никогда не матчились и в счёт лимита не шли.
const MARKETPLACE_LIMIT = 5;
const MARKETPLACE_ACTIVE_STATUSES = ['new', 'in_review', 'need_docs', 'pending_approval', 'approved'];
const MARKETPLACE_CLAIMABLE_STATUSES = ['new', 'in_review', 'need_docs'];
const PM_ROLES_MARKETPLACE = ['PM', 'HEAD_PM'];

// Подсчёт активных заявок у конкретного РП (для лимита маркетплейса).
async function countActiveAssigned(userId) {
  const r = await db.query(
    `SELECT status, COUNT(*)::int AS cnt
       FROM pre_tender_requests
      WHERE assigned_to = $1 AND status = ANY($2::text[])
      GROUP BY status`,
    [userId, MARKETPLACE_ACTIVE_STATUSES]);
  const breakdown = {};
  let total = 0;
  for (const row of r.rows) {
    breakdown[row.status] = row.cnt;
    total += row.cnt;
  }
  return { total, breakdown };
}

// Helper: создать/переоткрыть карточку личного канбана для нового владельца pre_tender.
// Используется в /claim и /transfer. Возвращает {card_id, is_new}.
async function ensurePersonalCardForPreTender(client, ownerUserId, ptId, movedBy, noteText) {
  const info = await client.query(
    'SELECT customer_name, work_description FROM pre_tender_requests WHERE id=$1', [ptId]);
  const meta = info.rows[0] || {};
  const newSub = await personalKanban.ensureDefaultSubstages(client, ownerUserId, 'pre_tender', 'new');
  const cIns = await client.query(
    `INSERT INTO personal_kanban_cards
        (owner_user_id, flow_type, entity_kind, entity_id, current_main_status, current_substage_id)
      VALUES ($1, 'pre_tender', 'pre_tender', $2, 'new', $3)
      ON CONFLICT (owner_user_id, entity_kind, entity_id)
        DO UPDATE SET is_closed=false, last_moved_at=NOW(), updated_at=NOW()
      RETURNING id, (xmax = 0) AS is_new`,
    [ownerUserId, ptId, newSub]);
  const cardId = cIns.rows[0]?.id;
  const isNew = cIns.rows[0]?.is_new;
  if (cardId) {
    const finalNote = noteText
      || `${isNew ? 'Создана' : 'Переоткрыта'}: ${meta.customer_name || meta.work_description?.slice(0,80) || `pre_tender #${ptId}`}`;
    await client.query(
      `INSERT INTO personal_kanban_card_history
          (card_id, to_main_status, moved_by, action, note)
        VALUES ($1, 'new', $2, $3, $4)`,
      [cardId, movedBy, isNew ? 'create' : 'reopen', finalNote]);
  }
  return { card_id: cardId, is_new: isNew, meta };
}

// Wave A+ fix BLOCKER#1 + MED#4: проверка владельца pre_tender'а.
// Возвращает {ok:true, row} или {ok:false, code, error}. Не бросает.
async function checkPreTenderAccess(user, ptId) {
  if (!user) return { ok: false, code: 401, error: 'unauthorized' };
  if (DIRECTOR_LIKE_ROLES.includes(user.role)) {
    const r = await db.query('SELECT id, assigned_to, email_id FROM pre_tender_requests WHERE id=$1 LIMIT 1', [ptId]);
    if (!r.rows.length) return { ok: false, code: 404, error: 'pre_tender_not_found' };
    return { ok: true, row: r.rows[0] };
  }
  // PM/TO — только свои (assigned_to или created_by)
  const r = await db.query(
    'SELECT id, assigned_to, created_by, email_id FROM pre_tender_requests WHERE id=$1 LIMIT 1',
    [ptId]);
  if (!r.rows.length) return { ok: false, code: 404, error: 'pre_tender_not_found' };
  const row = r.rows[0];
  if (row.assigned_to === user.id || row.created_by === user.id) return { ok: true, row };
  return { ok: false, code: 403, error: 'forbidden' };
}

module.exports = async function (fastify) {

  // ═══════════════════════════════════════════════════════════════════
  // 1. GET / — Список заявок
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { status, ai_color, search, sort = 'created_at', order = 'DESC', limit = 50, offset = 0 } = request.query;
    const user = request.user;
    // 23.06.2026 Маркетплейс: PM/HEAD_PM фронт хочет «свободные FIFO» → ?unassigned=1.
    const unassigned = String(request.query.unassigned || '') === '1';

    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (unassigned) {
      // Маркетплейс-режим: только не распределённые в claimable-статусах,
      // PM-owner-фильтр игнорируется (это и есть смысл маркетплейса).
      where += ` AND pt.assigned_to IS NULL AND pt.status = ANY($${idx}::text[])`;
      params.push(MARKETPLACE_CLAIMABLE_STATUSES);
      idx++;
    } else if (!DIRECTOR_LIKE_ROLES.includes(user.role)) {
      // Wave A+ fix BLOCKER#1: PM/TO видят только свои (assigned_to ИЛИ created_by).
      // Директорские роли — без фильтра.
      where += ` AND (pt.assigned_to = $${idx} OR pt.created_by = $${idx})`;
      params.push(user.id);
      idx++;
    }

    if (status) {
      where += ` AND pt.status = $${idx++}`;
      params.push(status);
    } else if (!unassigned) {
      // По умолчанию не показываем архивные (в unassigned уже зашит ANY-фильтр).
      where += ` AND pt.status NOT IN ('expired')`;
    }
    if (ai_color) { where += ` AND pt.ai_color = $${idx++}`; params.push(ai_color); }
    if (search) {
      where += ` AND (pt.customer_name ILIKE $${idx} OR pt.work_description ILIKE $${idx} OR pt.customer_email ILIKE $${idx} OR e.subject ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const allowedSort = ['created_at', 'ai_color', 'status', 'customer_name', 'estimated_sum', 'work_deadline', 'ai_work_match_score'];
    const sortCol = allowedSort.includes(sort) ? sort : 'created_at';
    // Маркетплейс — всегда FIFO (старые сверху), даже если фронт передал DESC.
    const sortOrder = unassigned ? 'ASC' : (order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC');

    const countRes = await db.query(`SELECT COUNT(*) as total FROM pre_tender_requests pt LEFT JOIN emails e ON e.id = pt.email_id ${where}`, params);
    const total = parseInt(countRes.rows[0]?.total || 0);

    // 27.06.2026: добавлен LEFT JOIN inbox_applications — чтобы pre_tender
    // на маркетплейсе мог быть классифицирован по AI (direct_request vs
    // tender_invitation/platform_tender) для разделения по табам.
    // Также добавлен JOIN tenders — чтобы фронт мог скрыть pre_tender,
    // который уже породил полноценный tender (виден на /tenders).
    const dataRes = await db.query(`
      SELECT pt.*,
        e.subject as email_subject,
        e.from_email as email_from,
        e.from_name as email_from_name,
        e.email_date,
        e.has_attachments as email_has_attachments,
        u_dec.name as decision_by_name,
        u_ass.name as assigned_to_name,
        ia.ai_classification as ai_classification,
        ia.ai_color as ai_color,
        ia.ai_summary as ai_summary,
        ia.ai_confidence as ai_confidence,
        ia.source_name as source_name,
        ia.source_email as source_email,
        ia.attachment_count as attachment_count,
        t.id as derived_tender_id,
        t.tender_status as derived_tender_status
      FROM pre_tender_requests pt
      LEFT JOIN emails e ON e.id = pt.email_id
      LEFT JOIN inbox_applications ia ON ia.email_id = pt.email_id
      LEFT JOIN users u_dec ON u_dec.id = pt.decision_by
      LEFT JOIN users u_ass ON u_ass.id = pt.assigned_to
      LEFT JOIN tenders t ON t.source_pre_tender_id = pt.id
      ${where}
      ORDER BY pt.${sortCol} ${sortOrder}
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, Math.min(parseInt(limit), 200), parseInt(offset)]);

    return { success: true, items: dataRes.rows, total, limit: parseInt(limit), offset: parseInt(offset) };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. GET /stats — Статистика
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/stats', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const [statusRes, colorRes, monthRes, avgRes] = await Promise.all([
      db.query(`SELECT status, COUNT(*) as cnt FROM pre_tender_requests GROUP BY status`),
      db.query(`SELECT ai_color, COUNT(*) as cnt FROM pre_tender_requests WHERE status NOT IN ('rejected','expired') GROUP BY ai_color`),
      db.query(`
        SELECT to_char(created_at, 'YYYY-MM') as month,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
          COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
          COUNT(*) FILTER (WHERE status = 'pending_approval') as pending_approval
        FROM pre_tender_requests
        WHERE created_at > NOW() - INTERVAL '6 months'
        GROUP BY to_char(created_at, 'YYYY-MM')
        ORDER BY month DESC
      `),
      db.query(`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (decision_at - created_at)) / 3600), 1) as avg_hours
        FROM pre_tender_requests
        WHERE decision_at IS NOT NULL
      `)
    ]);

    const byStatus = {};
    statusRes.rows.forEach(r => byStatus[r.status] = parseInt(r.cnt));
    const byColor = {};
    colorRes.rows.forEach(r => byColor[r.ai_color || 'gray'] = parseInt(r.cnt));

    return {
      success: true,
      total_new: byStatus.new || 0,
      total_in_review: byStatus.in_review || 0,
      total_need_docs: byStatus.need_docs || 0,
      total_accepted: byStatus.accepted || 0,
      total_pending_approval: byStatus.pending_approval || 0,
      total_rejected: byStatus.rejected || 0,
      by_color: byColor,
      by_month: monthRes.rows,
      avg_decision_time_hours: parseFloat(avgRes.rows[0]?.avg_hours || 0)
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2.5 GET /my-stats — Маркетплейс: счётчик активных заявок у текущего РП
  // ═══════════════════════════════════════════════════════════════════
  // 23.06.2026: фронт показывает «X / 5» бейдж в маркетплейсе.
  fastify.get('/my-stats', {
    preHandler: [fastify.requireRoles(PM_ROLES_MARKETPLACE)]
  }, async (request, reply) => {
    const { total, breakdown } = await countActiveAssigned(request.user.id);
    return {
      success: true,
      active_count: total,
      limit: MARKETPLACE_LIMIT,
      breakdown,
      can_claim: total < MARKETPLACE_LIMIT
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2.6 POST /:id/claim — РП забирает свободную заявку из маркетплейса
  // ═══════════════════════════════════════════════════════════════════
  // 23.06.2026 Маркетплейс заявок.
  // RBAC: только PM/HEAD_PM. Транзакция с SELECT … FOR UPDATE против гонок.
  // Auto-create карточки personal_kanban + SSE + notify руководителям.
  fastify.post('/:id/claim', {
    preHandler: [fastify.requireRoles(PM_ROLES_MARKETPLACE)]
  }, async (request, reply) => {
    const ptId = parseInt(request.params.id, 10);
    if (!Number.isFinite(ptId) || ptId <= 0) {
      return reply.code(400).send({ error: 'bad_id' });
    }
    const user = request.user;

    let result;
    try {
      result = await db.transaction(async (client) => {
        // 1. Лочим строку, читаем текущее состояние.
        const lockRes = await client.query(
          `SELECT id, assigned_to, status, customer_name, work_description
             FROM pre_tender_requests
            WHERE id = $1
            FOR UPDATE`,
          [ptId]);
        if (!lockRes.rows.length) {
          const e = new Error('not_found'); e._code = 404; e._payload = { error: 'pre_tender_not_found' };
          throw e;
        }
        const row = lockRes.rows[0];

        // 2. Кто-то уже забрал — отдаём имя.
        if (row.assigned_to !== null && row.assigned_to !== undefined) {
          const claimer = await client.query(
            'SELECT name, login FROM users WHERE id=$1', [row.assigned_to]);
          const claimedBy = claimer.rows[0]?.name || claimer.rows[0]?.login || `user#${row.assigned_to}`;
          const e = new Error('already_claimed'); e._code = 409;
          e._payload = { error: 'already_claimed', claimed_by_id: row.assigned_to, claimed_by_name: claimedBy };
          throw e;
        }

        // 3. Заявка перешла в нон-claimable статус (rejected/expired/accepted и т.п.).
        if (!MARKETPLACE_CLAIMABLE_STATUSES.includes(row.status)) {
          const e = new Error('not_claimable'); e._code = 409;
          e._payload = { error: 'not_claimable', current_status: row.status };
          throw e;
        }

        // 4. Лимит у РП.
        const limitRes = await client.query(
          `SELECT COUNT(*)::int AS cnt
             FROM pre_tender_requests
            WHERE assigned_to = $1 AND status = ANY($2::text[])`,
          [user.id, MARKETPLACE_ACTIVE_STATUSES]);
        const currentCount = limitRes.rows[0]?.cnt || 0;
        if (currentCount >= MARKETPLACE_LIMIT) {
          const e = new Error('limit_reached'); e._code = 409;
          e._payload = { error: 'limit_reached', current_count: currentCount, limit: MARKETPLACE_LIMIT };
          throw e;
        }

        // 5. Присваиваем + переводим в in_review (если был new).
        const newStatus = row.status === 'new' ? 'in_review' : row.status;
        await client.query(
          `UPDATE pre_tender_requests
              SET assigned_to = $1,
                  status = $2,
                  updated_at = NOW()
            WHERE id = $3`,
          [user.id, newStatus, ptId]);

        // 6. Личный канбан — карточка у нового владельца.
        const cardInfo = await ensurePersonalCardForPreTender(
          client, user.id, ptId, user.id,
          `🎯 Забрана из маркетплейса: ${row.customer_name || row.work_description?.slice(0,80) || `pre_tender #${ptId}`}`);

        // 7. Обновлённая запись для возврата фронту.
        const updated = await client.query(
          `SELECT pt.*, u.name AS assigned_to_name
             FROM pre_tender_requests pt
             LEFT JOIN users u ON u.id = pt.assigned_to
            WHERE pt.id = $1`, [ptId]);

        return {
          item: updated.rows[0],
          card_id: cardInfo.card_id,
          customer_name: row.customer_name
        };
      });
    } catch (err) {
      if (err && err._code) {
        return reply.code(err._code).send(err._payload || { error: err.message });
      }
      request.log.error(err, 'pre-tender claim error');
      return reply.code(500).send({ error: 'internal', message: err.message });
    }

    // SSE: пусть остальные PM-ы (открывшие маркетплейс) уберут карточку из списка.
    try {
      broadcast('pre_tender:claimed', {
        id: ptId,
        claimed_by_id: user.id,
        claimed_by_name: user.name || user.login || `user#${user.id}`
      });
    } catch (_) {}

    // Notify HEAD_PM + директорам: «РП X забрал заявку #N».
    try {
      const recipients = await db.query(
        `SELECT id FROM users
          WHERE is_active = TRUE
            AND role IN ('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM','ADMIN')
            AND id <> $1`,
        [user.id]);
      const claimerName = user.name || user.login || `РП #${user.id}`;
      const title = `${claimerName} забрал заявку №${ptId}`;
      const message = result.customer_name || '';
      for (const r of recipients.rows) {
        Promise.resolve(createNotification(db, {
          user_id: r.id,
          title,
          message,
          type: 'pre_tender_claimed',
          link: `#/director-inbox`
        })).catch(() => {});
      }
    } catch (e) {
      request.log.warn('pre-tender claim notify failed: ' + e.message);
    }

    return {
      success: true,
      item: result.item,
      card_id: result.card_id,
      redirect_to: `#/personal-kanban?card=${result.card_id}`
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2.7 POST /:id/transfer — Передать заявку другому РП
  // ═══════════════════════════════════════════════════════════════════
  // 23.06.2026 Маркетплейс заявок.
  // RBAC: текущий assigned_to ИЛИ HEAD_PM/ADMIN/DIRECTOR_*.
  // PM не может «вернуть в маркетплейс», только передать персонально.
  fastify.post('/:id/transfer', {
    preHandler: [fastify.requireRoles(['PM','HEAD_PM','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const ptId = parseInt(request.params.id, 10);
    if (!Number.isFinite(ptId) || ptId <= 0) {
      return reply.code(400).send({ error: 'bad_id' });
    }
    const toUserId = parseInt(request.body?.to_user_id, 10);
    if (!Number.isFinite(toUserId) || toUserId <= 0) {
      return reply.code(400).send({ error: 'bad_to_user_id' });
    }
    const reason = (request.body?.reason || '').toString().slice(0, 1000) || null;
    const user = request.user;

    if (toUserId === user.id) {
      return reply.code(400).send({ error: 'self_transfer_forbidden' });
    }

    let result;
    try {
      result = await db.transaction(async (client) => {
        // 1. Проверка получателя: должен быть активным PM/HEAD_PM.
        const toRes = await client.query(
          'SELECT id, name, login, role, is_active FROM users WHERE id=$1', [toUserId]);
        if (!toRes.rows.length) {
          const e = new Error('to_user_not_found'); e._code = 404; e._payload = { error: 'to_user_not_found' };
          throw e;
        }
        const toUser = toRes.rows[0];
        if (!toUser.is_active) {
          const e = new Error('to_user_inactive'); e._code = 400; e._payload = { error: 'to_user_inactive' };
          throw e;
        }
        if (!PM_ROLES_MARKETPLACE.includes(toUser.role)) {
          const e = new Error('to_user_not_pm'); e._code = 400;
          e._payload = { error: 'to_user_not_pm', role: toUser.role };
          throw e;
        }

        // 2. Лочим pre_tender, проверяем права.
        const lockRes = await client.query(
          `SELECT id, assigned_to, status, customer_name, work_description
             FROM pre_tender_requests
            WHERE id = $1
            FOR UPDATE`,
          [ptId]);
        if (!lockRes.rows.length) {
          const e = new Error('not_found'); e._code = 404; e._payload = { error: 'pre_tender_not_found' };
          throw e;
        }
        const row = lockRes.rows[0];

        // PM может передавать только свои; директора/HEAD_PM — любые.
        const isPrivileged = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM'].includes(user.role);
        if (!isPrivileged && row.assigned_to !== user.id) {
          const e = new Error('forbidden'); e._code = 403; e._payload = { error: 'forbidden' };
          throw e;
        }
        if (row.assigned_to === toUserId) {
          const e = new Error('already_owns'); e._code = 409; e._payload = { error: 'already_owns' };
          throw e;
        }

        // 3. Лимит у получателя.
        const limitRes = await client.query(
          `SELECT COUNT(*)::int AS cnt
             FROM pre_tender_requests
            WHERE assigned_to = $1 AND status = ANY($2::text[])`,
          [toUserId, MARKETPLACE_ACTIVE_STATUSES]);
        const recipientCount = limitRes.rows[0]?.cnt || 0;
        if (recipientCount >= MARKETPLACE_LIMIT) {
          const e = new Error('recipient_limit_reached'); e._code = 409;
          e._payload = {
            error: 'recipient_limit_reached',
            recipient_id: toUserId,
            recipient_name: toUser.name || toUser.login,
            current_count: recipientCount,
            limit: MARKETPLACE_LIMIT
          };
          throw e;
        }

        const prevAssignedTo = row.assigned_to;

        // 4. Перенос.
        await client.query(
          `UPDATE pre_tender_requests
              SET assigned_to = $1, updated_at = NOW()
            WHERE id = $2`,
          [toUserId, ptId]);

        // 5. Закрыть карточку у предыдущего РП (если был).
        if (prevAssignedTo) {
          await client.query(
            `UPDATE personal_kanban_cards
                SET is_closed = TRUE, updated_at = NOW()
              WHERE owner_user_id = $1
                AND entity_kind = 'pre_tender'
                AND entity_id = $2
                AND NOT is_closed`,
            [prevAssignedTo, ptId]);
        }

        // 6. Создать/переоткрыть карточку у получателя.
        const transferNote = reason
          ? `↻ Передано от ${user.name || user.login || `user#${user.id}`}: ${reason}`
          : `↻ Передано от ${user.name || user.login || `user#${user.id}`}`;
        const cardInfo = await ensurePersonalCardForPreTender(
          client, toUserId, ptId, user.id, transferNote);

        const updated = await client.query(
          `SELECT pt.*, u.name AS assigned_to_name
             FROM pre_tender_requests pt
             LEFT JOIN users u ON u.id = pt.assigned_to
            WHERE pt.id = $1`, [ptId]);

        return {
          item: updated.rows[0],
          card_id: cardInfo.card_id,
          to_user_name: toUser.name || toUser.login,
          prev_assigned_to: prevAssignedTo,
          customer_name: row.customer_name
        };
      });
    } catch (err) {
      if (err && err._code) {
        return reply.code(err._code).send(err._payload || { error: err.message });
      }
      request.log.error(err, 'pre-tender transfer error');
      return reply.code(500).send({ error: 'internal', message: err.message });
    }

    // SSE
    try {
      broadcast('pre_tender:transferred', {
        id: ptId,
        from_user_id: result.prev_assigned_to,
        to_user_id: toUserId,
        to_user_name: result.to_user_name
      });
      broadcast('personal_kanban:card_created', {
        card_id: result.card_id,
        owner_user_id: toUserId,
        entity_kind: 'pre_tender',
        entity_id: ptId
      });
    } catch (_) {}

    // Notify получателю.
    try {
      const fromName = user.name || user.login || `РП #${user.id}`;
      Promise.resolve(createNotification(db, {
        user_id: toUserId,
        title: `Вам передал ${fromName} заявку №${ptId}`,
        message: result.customer_name || '',
        type: 'pre_tender_assigned',
        link: `#/personal-kanban?card=${result.card_id}`
      })).catch(() => {});
    } catch (_) {}

    return {
      success: true,
      item: result.item,
      card_id: result.card_id
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. GET /:id — Одна заявка
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/:id', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;

    // Wave A+ fix BLOCKER#1: PM/TO имеют доступ только к своим (assigned_to/created_by).
    const acc = await checkPreTenderAccess(request.user, id);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });

    const res = await db.query(`
      SELECT pt.*,
        e.subject as email_subject,
        e.body_text as email_body_text,
        e.body_html as email_body_html,
        e.from_email as email_from,
        e.from_name as email_from_name,
        e.email_date,
        e.email_type,
        e.thread_id,
        u_dec.name as decision_by_name,
        u_ass.name as assigned_to_name,
        ia.ai_report as full_ai_report,
        ia.ai_cost_estimate,
        ia.ai_cost_report,
        ia.ai_confidence,
        ia.ai_model,
        ia.ai_work_type,
        ia.ai_keywords,
        ia.ai_color as ia_ai_color,
        ia.ai_recommendation as ia_ai_recommendation,
        ia.ai_summary as ia_ai_summary
      FROM pre_tender_requests pt
      LEFT JOIN emails e ON e.id = pt.email_id
      LEFT JOIN inbox_applications ia ON ia.email_id = pt.email_id
      LEFT JOIN users u_dec ON u_dec.id = pt.decision_by
      LEFT JOIN users u_ass ON u_ass.id = pt.assigned_to
      WHERE pt.id = $1
    `, [id]);

    if (!res.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });

    const item = res.rows[0];

    // Получаем вложения
    let attachments = [];
    if (item.email_id) {
      const attRes = await db.query(
        'SELECT id, filename, original_filename, mime_type, size, file_path FROM email_attachments WHERE email_id = $1',
        [item.email_id]
      );
      attachments = attRes.rows;
    }

    // Цепочка писем
    let thread = [];
    if (item.thread_id) {
      const thRes = await db.query(
        'SELECT id, direction, from_email, from_name, subject, snippet, email_date FROM emails WHERE thread_id = $1 ORDER BY email_date',
        [item.thread_id]
      );
      thread = thRes.rows;
    }

    return { success: true, item, attachments, thread };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. POST /from-email — Создать из письма
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/from-email', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { email_id } = request.body;
    if (!email_id) return reply.code(400).send({ error: 'email_id обязателен' });

    // Проверяем письмо
    const emailRes = await db.query('SELECT * FROM emails WHERE id = $1', [email_id]);
    if (!emailRes.rows.length) return reply.code(404).send({ error: 'Письмо не найдено' });

    const email = emailRes.rows[0];
    if (!['direct_request', 'platform_tender'].includes(email.email_type)) {
      return reply.code(400).send({ error: 'Тип письма не подходит: ' + email.email_type });
    }

    const result = await preTenderService.createPreTenderFromEmail(email_id);
    if (!result) return reply.code(500).send({ error: 'Ошибка создания' });
    if (result.exists) return reply.code(409).send({ error: 'Заявка уже создана', id: result.id });

    return { success: true, id: result.id };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. POST / — Ручное создание
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { customer_name, customer_email, customer_inn, contact_person, contact_phone,
            work_location, work_deadline, estimated_sum,
            assigned_to, source_type, ai_work_type, decision_comment } = request.body;
    let { work_description } = request.body;
    const user = request.user;

    if (!customer_name && !work_description) {
      return reply.code(400).send({ error: 'Укажите заказчика или описание работ' });
    }

    // BUG #1: source_type теперь приходит из body (phone/meeting/email/referral/website/other),
    // дефолт 'manual' если не передан. Валидация по белому списку, чтобы не пропустить мусор.
    const ALLOWED_SOURCE_TYPES = ['manual', 'phone', 'meeting', 'email', 'referral', 'website', 'other'];
    const srcType = ALLOWED_SOURCE_TYPES.includes(source_type) ? source_type : 'manual';

    // BUG #3: колонки ai_work_type в pre_tender_requests НЕТ (есть только в inbox_applications).
    // TODO: добавить миграцию ALTER TABLE pre_tender_requests ADD COLUMN ai_work_type VARCHAR(100).
    // Пока — вшиваем тип работ префиксом в work_description (как объём/сроки во фронте).
    if (ai_work_type && typeof ai_work_type === 'string' && ai_work_type.trim()) {
      work_description = `Тип работ: ${ai_work_type.trim()}\n\n${work_description || ''}`.trim();
    }

    const ins = await db.query(`
      INSERT INTO pre_tender_requests (
        source_type, customer_name, customer_email, customer_inn,
        contact_person, contact_phone, work_description, work_location,
        work_deadline, estimated_sum, ai_color, status, created_by, assigned_to,
        decision_comment
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'gray', 'new', $11, $12, $13)
      RETURNING id
    `, [
      srcType,
      customer_name || '', customer_email || '', customer_inn || '',
      contact_person || '', contact_phone || '',
      work_description || '', work_location || '',
      work_deadline || null, estimated_sum || null,
      user.id, assigned_to || null,
      decision_comment || null
    ]);

    const newId = ins.rows[0].id;

    // Wave C: если указан assigned_to → auto-create karta kanban (как pre_tender).
    let cardId = null;
    if (assigned_to) {
      try {
        // Wave D BUG-7: ensureDefaultSubstages — если у PM 0 подэтапов под (pre_tender, new),
        // создастся дефолтный набор и вернётся id первого.
        const newSub = await personalKanban.ensureDefaultSubstages(db, assigned_to, 'pre_tender', 'new');
        const cIns = await db.query(
          `INSERT INTO personal_kanban_cards
            (owner_user_id, flow_type, entity_kind, entity_id, current_main_status, current_substage_id)
           VALUES ($1, 'pre_tender', 'pre_tender', $2, 'new', $3)
           ON CONFLICT (owner_user_id, entity_kind, entity_id) DO NOTHING
           RETURNING id`,
          [assigned_to, newId, newSub]);
        if (cIns.rowCount > 0) {
          cardId = cIns.rows[0].id;
          await db.query(
            `INSERT INTO personal_kanban_card_history
              (card_id, to_main_status, moved_by, action, note)
             VALUES ($1, 'new', $2, 'create', $3)`,
            [cardId, user.id, `Создан вручную: ${customer_name || work_description || 'pre_tender'}`]);
          try {
            const { createNotification } = require('../services/notify');
            Promise.resolve(createNotification(db, {
              user_id: assigned_to,
              title: `Новый просчёт №${newId}`,
              message: customer_name || work_description?.slice(0, 100) || '',
              type: 'pre_tender_assigned',
              link: `#/personal-kanban?card=${cardId}`,
            })).catch(() => {});
          } catch (_) {}
          try {
            const sse = require('../services/sse');
            sse.broadcast?.('personal_kanban:card_created', {
              card_id: cardId, owner_user_id: assigned_to,
              flow_type: 'pre_tender', entity_kind: 'pre_tender', entity_id: newId,
            });
          } catch (_) {}
        }
      } catch (cardErr) {
        console.error('[PreTender] Manual create kanban hook error:', cardErr.message);
      }
    }

    // SSE: уведомляем о новой заявке
    broadcast('pre_tender:new', {
      id: newId, customer_name: customer_name || '', ai_color: 'gray',
      status: 'new', source_type: srcType, created_by: user.id
    });

    return { success: true, id: newId, kanban_card_id: cardId };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. PUT /:id — Обновить
  // ═══════════════════════════════════════════════════════════════════
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    // Wave A+ fix BLOCKER#1: owner-check для PM/TO.
    const acc = await checkPreTenderAccess(request.user, id);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });
    const allowed = ['customer_name', 'customer_inn', 'customer_email', 'contact_person',
                     'contact_phone', 'work_description', 'work_location', 'work_deadline',
                     'estimated_sum', 'assigned_to', 'ai_color'];

    // Статус можно менять только на допустимые значения (для канбан drag-and-drop).
    // 23.06.2026 BUG-FIX (🟡 D-17): синхронизация с personal-kanban /transition — там UPDATE pre_tender_requests
    // SET status=... ходит без whitelist и может выставить любой CANONICAL_MAIN_STATUSES.pre_tender (см.
    // personal-kanban.js:51-55). До фикса PUT-форма drawer'а позволяла только 3 статуса, а drag-and-drop
    // выставлял ещё 10 — фронт-форма не могла откатить решение, принятое канбаном. Теперь PUT принимает
    // тот же набор. Для запретных кросс-flow-переходов всё ещё валидируется в transition-роуте.
    const ALLOWED_STATUSES = [
      'new', 'in_review', 'need_docs', 'accepted', 'rejected', 'expired',
      'pending_approval', 'approved', 'pending_payment', 'paid',
      'cash_issued', 'cash_received', 'expense_reported'
    ];
    if (request.body.status && ALLOWED_STATUSES.includes(request.body.status)) {
      allowed.push('status');
    }

    const fields = [];
    const vals = [];
    let idx = 1;

    for (const key of allowed) {
      if (request.body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        vals.push(request.body[key]);
      }
    }

    if (!fields.length) return reply.code(400).send({ error: 'Нет полей для обновления' });

    // 22.06.2026 BUG-FIX: при смене assigned_to — пересоздать карточку канбана
    // (закрыть у старого владельца, создать у нового). Раньше карточка создавалась
    // только в POST / (INSERT) — при reassign висел phantom-баг «нет карточки у нового РП».
    let prevAssignedTo = null;
    const reassignRequested = request.body.assigned_to !== undefined;
    if (reassignRequested) {
      const prev = await db.query(
        'SELECT assigned_to FROM pre_tender_requests WHERE id=$1', [id]);
      prevAssignedTo = prev.rows[0]?.assigned_to || null;
    }

    fields.push(`updated_at = NOW()`);
    vals.push(id);

    await db.query(
      `UPDATE pre_tender_requests SET ${fields.join(', ')} WHERE id = $${idx} AND status IN ('new','in_review','need_docs')`,
      vals
    );

    if (reassignRequested) {
      const newAssignedTo = request.body.assigned_to || null;
      if (prevAssignedTo !== newAssignedTo) {
        try {
          if (prevAssignedTo) {
            await db.query(
              `UPDATE personal_kanban_cards
                  SET is_closed=true, updated_at=NOW()
                WHERE owner_user_id=$1 AND entity_kind='pre_tender'
                  AND entity_id=$2 AND NOT is_closed`,
              [prevAssignedTo, id]);
          }
          if (newAssignedTo) {
            const info = await db.query(
              'SELECT customer_name, work_description FROM pre_tender_requests WHERE id=$1', [id]);
            const meta = info.rows[0] || {};
            const newSub = await personalKanban.ensureDefaultSubstages(
              db, newAssignedTo, 'pre_tender', 'new');
            const cIns = await db.query(
              `INSERT INTO personal_kanban_cards
                  (owner_user_id, flow_type, entity_kind, entity_id, current_main_status, current_substage_id)
                VALUES ($1, 'pre_tender', 'pre_tender', $2, 'new', $3)
                ON CONFLICT (owner_user_id, entity_kind, entity_id)
                  DO UPDATE SET is_closed=false, last_moved_at=NOW(), updated_at=NOW()
                RETURNING id, (xmax = 0) AS is_new`,
              [newAssignedTo, id, newSub]);
            const cardId = cIns.rows[0]?.id;
            const isNew = cIns.rows[0]?.is_new;
            if (cardId) {
              await db.query(
                `INSERT INTO personal_kanban_card_history
                    (card_id, to_main_status, moved_by, action, note)
                  VALUES ($1, 'new', $2, $3, $4)`,
                [cardId, user.id, isNew ? 'create' : 'reopen',
                 `Перенаправлено: ${meta.customer_name || meta.work_description?.slice(0,80) || `pre_tender #${id}`}`]);
              try {
                const { createNotification } = require('../services/notify');
                Promise.resolve(createNotification(db, {
                  user_id: newAssignedTo,
                  title: `Вам перенаправлен просчёт №${id}`,
                  message: meta.customer_name || meta.work_description?.slice(0, 100) || '',
                  type: 'pre_tender_assigned',
                  link: `#/personal-kanban?card=${cardId}`,
                })).catch(() => {});
              } catch (_) {}
              broadcast('personal_kanban:card_created', {
                card_id: cardId, owner_user_id: newAssignedTo,
                entity_kind: 'pre_tender', entity_id: parseInt(id),
              });
            }
          }
        } catch (e) {
          fastify.log.warn(`pre_tender reassign card-sync failed (id=${id}, prev=${prevAssignedTo}, new=${newAssignedTo}): ${e.message}`);
        }
      }
    }

    // SSE: уведомляем об обновлении заявки
    broadcast('pre_tender:updated', { id: parseInt(id), updated_fields: Object.keys(request.body) });

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. POST /:id/request-docs — Запрос документов
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/request-docs', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    // Wave A+ fix BLOCKER#1: owner-check для PM/TO.
    const acc = await checkPreTenderAccess(request.user, id);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });
    const body = request.body || {};
    // Wave A+ fix: vanilla шлёт request_text, держим обратную совместимость для comment.
    const note = body.request_text || body.comment || 'Запрошены дополнительные документы';

    await db.query(`
      UPDATE pre_tender_requests SET status = 'need_docs', decision_comment = $1, updated_at = NOW()
      WHERE id = $2 AND status IN ('new','in_review')
    `, [note, id]);

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7.5 POST /:id/upload-docs — Загрузка документов
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/upload-docs', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;

    // Wave A+ fix BLOCKER#1: owner-check для PM/TO.
    const acc = await checkPreTenderAccess(request.user, id);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });

    // Проверяем заявку
    const ptRes = await db.query('SELECT id, manual_documents FROM pre_tender_requests WHERE id = $1', [id]);
    if (!ptRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });

    const parts = request.parts();
    const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'pre_tenders', String(id));
    fs.mkdirSync(uploadDir, { recursive: true });

    const existingDocs = ptRes.rows[0].manual_documents || [];
    const uploaded = [];

    for await (const part of parts) {
      if (part.type !== 'file') continue;
      const safeName = (part.filename || 'file').replace(/[^\w.\-а-яА-ЯёЁ ]/gi, '_').slice(0, 200);
      const filePath = path.join(uploadDir, safeName);
      const chunks = [];
      for await (const chunk of part.file) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(filePath, buf);

      const doc = {
        filename: safeName,
        original_name: part.filename || safeName,
        mime_type: part.mimetype || 'application/octet-stream',
        size: buf.length,
        path: `uploads/pre_tenders/${id}/${safeName}`,
        uploaded_at: new Date().toISOString()
      };
      existingDocs.push(doc);
      uploaded.push(doc);
    }

    if (!uploaded.length) return reply.code(400).send({ error: 'Файлы не загружены' });

    await db.query(
      'UPDATE pre_tender_requests SET manual_documents = $1, has_documents = true, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(existingDocs), id]
    );

    return { success: true, uploaded, total_docs: existingDocs.length };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7.6 (Wave D — BUG-8) GET /:ptId/documents/:docIdx/download
  //     Скачать manual_documents[docIdx] из pre_tender_requests.
  //     Auth: Bearer header ИЛИ query ?token=... (для <a target=_blank>).
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/:ptId/documents/:docIdx/download', {
    preHandler: [
      async (request, reply) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.authenticate
    ]
  }, async (request, reply) => {
    const ptId = Number(request.params.ptId);
    const docIdx = Number(request.params.docIdx);
    if (!Number.isFinite(ptId) || !Number.isFinite(docIdx) || docIdx < 0) {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    // Wave A+ fix MED#4: owner-guard. PM/TO не должен скачивать чужие manual_documents.
    const acc = await checkPreTenderAccess(request.user, ptId);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });
    const r = await db.query(
      `SELECT manual_documents FROM pre_tender_requests WHERE id = $1 LIMIT 1`,
      [ptId]);
    const row = r.rows[0];
    if (!row) return reply.code(404).send({ error: 'pre_tender_not_found' });
    const docs = Array.isArray(row.manual_documents) ? row.manual_documents : [];
    if (docIdx >= docs.length) return reply.code(404).send({ error: 'document_not_found' });
    const doc = docs[docIdx];
    if (!doc || !doc.path) return reply.code(404).send({ error: 'document_path_missing' });

    // Резолв пути — path хранится относительно cwd как 'uploads/pre_tenders/X/file.ext'
    const candidates = [
      doc.path,
      path.join(process.cwd(), doc.path),
      path.join(__dirname, '..', '..', doc.path),
    ];
    let absPath = null;
    for (const p of candidates) {
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) { absPath = p; break; } } catch (_) {}
    }
    if (!absPath) return reply.code(404).send({ error: 'file_not_found_on_disk' });

    // ─── Wave-8 task A: ?format=pdf ────────────────────────────────────────
    // 1) Ищем PDF-сиблинг в manual_documents (parent_kind === doc.kind),
    //    например 'mimir_director_report_pdf' для 'mimir_director_report'.
    // 2) Если нет — конвертим XLSX/DOCX через LibreOffice on-demand.
    // 3) Если исходник уже PDF — отдаём как есть.
    // Без ?format=pdf поведение endpoint не меняется.
    const wantPdf = String(request.query.format || '').toLowerCase() === 'pdf';
    if (wantPdf) {
      const srcMime = String(doc.mime_type || '').toLowerCase();
      const srcExt  = String(path.extname(doc.original_name || doc.filename || absPath) || '').toLowerCase();
      const isPdfSrc = srcMime === 'application/pdf' || srcExt === '.pdf';

      // (3) Исходник — уже PDF: отдаём как есть.
      if (isPdfSrc) {
        const buf = fs.readFileSync(absPath);
        const dispName = (doc.original_name || doc.filename || 'document.pdf').replace(/[\r\n"]/g, '_');
        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Length', buf.length)
          .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(dispName)}`)
          .send(buf);
      }

      // (1) Ищем PDF-сиблинг (parent_kind === doc.kind).
      if (doc.kind) {
        const sibling = docs.find(d => d && d.parent_kind === doc.kind && d.path);
        if (sibling) {
          const sibCandidates = [
            sibling.path,
            path.join(process.cwd(), sibling.path),
            path.join(__dirname, '..', '..', sibling.path),
          ];
          let sibAbs = null;
          for (const p of sibCandidates) {
            try { if (fs.existsSync(p) && fs.statSync(p).isFile()) { sibAbs = p; break; } } catch (_) {}
          }
          if (sibAbs) {
            const buf = fs.readFileSync(sibAbs);
            const sibName = (sibling.original_name || sibling.filename || 'document.pdf').replace(/[\r\n"]/g, '_');
            return reply
              .header('Content-Type', 'application/pdf')
              .header('Content-Length', buf.length)
              .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(sibName)}`)
              .send(buf);
          }
          // сиблинг записан, но файла нет на диске — падаем в on-demand-convert.
        }
      }

      // (2) On-demand LibreOffice convert XLSX/DOCX → PDF.
      const isConvertible = ['.xlsx', '.xls', '.docx', '.doc', '.odt', '.ods', '.rtf'].includes(srcExt)
        || srcMime.includes('spreadsheet')
        || srcMime.includes('wordprocessing')
        || srcMime.includes('msword')
        || srcMime.includes('officedocument');
      if (!isConvertible) {
        return reply.code(415).send({ error: 'pdf_conversion_unsupported_source', source_ext: srcExt, source_mime: srcMime });
      }

      const { spawnSync } = require('child_process');
      const tmpDir = `/tmp/pkpdf_${Date.now()}_${docIdx}_${Math.floor(Math.random() * 1e6)}`;
      try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (_) {}
      let pdfAbs = null;
      try {
        const r = spawnSync('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, absPath], {
          timeout: 30000,
          windowsHide: true
        });
        if (r.status !== 0) {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
          const stderr = (r.stderr && r.stderr.toString()) || (r.error && r.error.message) || 'libreoffice non-zero exit';
          return reply.code(500).send({ error: 'PDF conversion failed', detail: stderr.slice(0, 500) });
        }
        const baseNoExt = path.basename(absPath, path.extname(absPath));
        pdfAbs = path.join(tmpDir, baseNoExt + '.pdf');
        if (!fs.existsSync(pdfAbs)) {
          // LibreOffice мог дать другое имя (нормализация unicode/пробелов) — берём первый .pdf в tmpDir.
          try {
            const list = fs.readdirSync(tmpDir).filter(f => /\.pdf$/i.test(f));
            if (list.length) pdfAbs = path.join(tmpDir, list[0]);
          } catch (_) {}
        }
        if (!pdfAbs || !fs.existsSync(pdfAbs)) {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
          return reply.code(500).send({ error: 'PDF conversion failed', detail: 'output_pdf_not_found' });
        }
        const buf = fs.readFileSync(pdfAbs);
        const srcDispName = (doc.original_name || doc.filename || 'document');
        const pdfDispName = srcDispName.replace(/\.[^.]+$/, '') + '.pdf';
        const safeDispName = pdfDispName.replace(/[\r\n"]/g, '_');
        // Удаляем временную директорию сразу после чтения, до .send (буфер уже в памяти).
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Length', buf.length)
          .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeDispName)}`)
          .send(buf);
      } catch (e) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        return reply.code(500).send({ error: 'PDF conversion failed', detail: String(e && e.message || e).slice(0, 500) });
      }
    }
    // ─── /Wave-8 task A ────────────────────────────────────────────────────

    const buf = fs.readFileSync(absPath);
    const dispName = (doc.original_name || doc.filename || 'document').replace(/[\r\n"]/g, '_');
    reply
      .header('Content-Type', doc.mime_type || 'application/octet-stream')
      .header('Content-Length', buf.length)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(dispName)}`)
      .send(buf);
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7.6b GET /:ptId/documents/:idx/json
  //     Вернуть JSON-представление документа Мимира для in-place правок
  //     (модалка «✏ Просмотр и правки» в drawer'е карты pk3).
  //     Поддерживает: XLSX (смета) → {type:'smeta', rows:[[...]]}
  //                   DOCX (отчёт)  → {type:'director_report', data:{...}, text:'…'}
  //     Auth: Bearer header.
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/:ptId/documents/:idx/json', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const ptId = Number(request.params.ptId);
    const idx  = Number(request.params.idx);
    if (!Number.isFinite(ptId) || !Number.isFinite(idx) || idx < 0) {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    const acc = await checkPreTenderAccess(request.user, ptId);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });
    const r = await db.query(
      'SELECT manual_documents FROM pre_tender_requests WHERE id=$1 LIMIT 1', [ptId]);
    if (!r.rows.length) return reply.code(404).send({ error: 'pre_tender_not_found' });
    const docs = Array.isArray(r.rows[0].manual_documents) ? r.rows[0].manual_documents : [];
    if (idx >= docs.length) return reply.code(404).send({ error: 'document_not_found' });
    const doc = docs[idx];
    if (!doc || !doc.path) return reply.code(404).send({ error: 'document_path_missing' });

    // Если AI положил исходную JSON-структуру (source_data/edits_json) — отдаём её как есть.
    if (doc.source_data && typeof doc.source_data === 'object') {
      return doc.source_data;
    }

    // Резолв пути на диске.
    const candidates = [
      doc.path,
      path.join(process.cwd(), doc.path),
      path.join(__dirname, '..', '..', doc.path),
    ];
    let absPath = null;
    for (const p of candidates) {
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) { absPath = p; break; } } catch (_) {}
    }
    if (!absPath) return reply.code(404).send({ error: 'file_not_found_on_disk' });

    const mime = (doc.mime_type || '').toLowerCase();
    const kindHint = String(doc.kind || '').toLowerCase();
    const isSmeta = mime.includes('spreadsheet') || /\.xlsx?$/i.test(absPath) || kindHint.includes('smeta');
    const isReport = mime.includes('wordprocessing') || /\.docx?$/i.test(absPath)
                  || kindHint.includes('director_report') || kindHint.includes('director');

    try {
      if (isSmeta) {
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(absPath);
        const sheet = wb.worksheets[0];
        const rows = [];
        if (sheet) {
          // eachRow с includeEmpty:false — пропускаем пустые. row.values[0] — undefined (1-based).
          sheet.eachRow({ includeEmpty: false }, (row) => {
            const v = Array.isArray(row.values) ? row.values.slice(1) : [];
            // Нормализуем ячейки: объекты ExcelJS (RichText/Formula) — в строку.
            const norm = v.map(c => {
              if (c == null) return '';
              if (typeof c === 'object') {
                if (c.richText) return c.richText.map(t => t.text || '').join('');
                if (c.result != null) return String(c.result);
                if (c.formula) return String(c.formula);
                if (c.text) return String(c.text);
                return JSON.stringify(c);
              }
              return c;
            });
            rows.push(norm);
          });
        }
        return { type: 'smeta', rows };
      }
      if (isReport) {
        // Парсим DOCX как ZIP → word/document.xml.
        // Структуру шаблона (templates/director-report-tpl.docx) знаем заранее:
        //   "Резюме."         → следующий параграф = summary_paragraph
        //   "Заказчик: {customer_name}"
        //   "Адрес: {customer_address}"
        //   "Объект: {project_object}"
        //   "Предмет: {project_subject}"
        //   "Бригада: {crew_size} чел."
        //   "Срок: {deadline_str}"
        //   "Себестоимость (без НДС): {cost_no_vat}"
        //   "Цена по стандартной наценке (с НДС): {price_standard_vat}"
        //   "Цена по раздельной наценке (с НДС): {price_separate_vat}"
        //   Параграф "3. Риски и допущения" → следующий "•" параграф (warnings: title — text)
        //   "4. Требуется решение руководства" → следующий "•" параграф (decisions)
        //   "____________________  / {author_name} /" — extract author_name
        //   Параграф перед подписью с "Приложение:" — пропускаем; должность = параграф перед линией подписи.
        // На случай битого/чужого DOCX держим fallback: mammoth + позиционная эвристика старого формата.
        const PizZip = require('pizzip');
        const docxBuf = fs.readFileSync(absPath);
        let paragraphs = [];
        let rawText = '';
        try {
          const zip = new PizZip(docxBuf);
          const documentXml = zip.file('word/document.xml').asText();
          // Каждый <w:p> = параграф; все <w:t> внутри склеиваем.
          // Используем регулярные выражения (XML лёгкий, без вложенных <w:p>).
          const pBlocks = documentXml.split(/<w:p\b/).slice(1);
          paragraphs = pBlocks.map(block => {
            // Берём до </w:p>
            const end = block.indexOf('</w:p>');
            const body = end >= 0 ? block.slice(0, end) : block;
            // Все <w:t ...>текст</w:t>
            const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
            let text = '';
            let m;
            while ((m = re.exec(body)) !== null) {
              text += m[1]
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'");
            }
            return text;
          });
          rawText = paragraphs.join('\n');
        } catch (_) {
          // Если pizzip / структура XML не сработала — фоллбэк mammoth.
          try {
            const mammoth = require('mammoth');
            const ext = await mammoth.extractRawText({ path: absPath });
            rawText = ext.value || '';
            paragraphs = rawText.split(/\r?\n/);
          } catch (_) {
            paragraphs = [];
            rawText = '';
          }
        }

        // Утилиты для извлечения значений по префиксу.
        const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
        const paras = paragraphs.map(norm);
        // Найти параграф, где текст начинается с одного из префиксов; вернуть «хвост» после префикса.
        const extractAfterPrefix = (prefixes) => {
          for (const p of paras) {
            for (const pref of prefixes) {
              if (p.startsWith(pref)) {
                const v = p.slice(pref.length).trim();
                if (v && v !== '—' && !/^\{[a-z_]+\}$/i.test(v)) return v;
              }
            }
          }
          return '';
        };
        // Найти индекс первого параграфа, начинающегося с любого из префиксов.
        const findParaIdx = (prefixes, fromIdx = 0) => {
          for (let i = fromIdx; i < paras.length; i++) {
            for (const pref of prefixes) {
              if (paras[i].startsWith(pref)) return i;
            }
          }
          return -1;
        };
        // «Параграф после префикса» (для «Резюме.»).
        const paraAfterPrefix = (prefixes) => {
          const i = findParaIdx(prefixes);
          if (i < 0) return '';
          for (let j = i + 1; j < paras.length; j++) {
            if (paras[j]) return paras[j];
          }
          return '';
        };
        // Собрать «буллет-список» между двумя заголовками: всё, что начинается с "•".
        // Если буллетов нет — берём непустые параграфы.
        const collectBullets = (startPrefixes, endPrefixes) => {
          const si = findParaIdx(startPrefixes);
          if (si < 0) return [];
          const ei = endPrefixes ? findParaIdx(endPrefixes, si + 1) : -1;
          const stop = ei < 0 ? paras.length : ei;
          const items = [];
          for (let i = si + 1; i < stop; i++) {
            const t = paras[i];
            if (!t) continue;
            if (t === '—') continue;
            // Bullet могут быть "• Заголовок — текст" в одном параграфе либо через перевод строки.
            // Шаблон рендерит каждый warning в ОДИН параграф (вид: "• Title — Text").
            if (t.startsWith('•')) {
              const body = t.replace(/^•\s*/, '').trim();
              // "Title — Text" → split по em-dash или двум дефисам.
              const m = body.match(/^(.+?)\s+[—–-]\s+(.+)$/);
              if (m) items.push({ title: m[1].trim(), text: m[2].trim() });
              else items.push({ title: '', text: body });
            } else {
              items.push({ title: '', text: t });
            }
          }
          return items;
        };

        // Извлечение полей.
        const customer_name = extractAfterPrefix(['Заказчик:']);
        const customer_address = extractAfterPrefix(['Адрес:']);
        const project_object = extractAfterPrefix(['Объект:']);
        const project_subject = extractAfterPrefix(['Предмет:']);
        const brigade = extractAfterPrefix(['Бригада:']);
        // "X чел." → оставляем как есть; визуально UI показывает строку.
        const crew_size = brigade.replace(/\s*чел\.?\s*$/i, '').trim() || brigade;
        const deadline_str = extractAfterPrefix(['Срок:']);
        const cost_no_vat = extractAfterPrefix(['Себестоимость (без НДС):']);
        const price_standard_vat = extractAfterPrefix(['Цена по стандартной наценке (с НДС):']);
        const price_separate_vat = extractAfterPrefix(['Цена по раздельной наценке (с НДС):']);
        const summary_paragraph = paraAfterPrefix(['Резюме.', 'Резюме:']);

        const warnings = collectBullets(
          ['3. Риски и допущения', '3.Риски и допущения', 'Риски и допущения'],
          ['4. Требуется решение руководства', '4.Требуется решение руководства', 'Требуется решение руководства', 'Приложение:']
        );
        const decisions = collectBullets(
          ['4. Требуется решение руководства', '4.Требуется решение руководства', 'Требуется решение руководства'],
          ['Приложение:', 'С уважением']
        );

        // Подпись: ищем параграф вида "____________ / Имя /". Имя — между / /.
        let author_name = '';
        let author_position = '';
        for (let i = 0; i < paras.length; i++) {
          const m = paras[i].match(/\/\s*([^/]+?)\s*\/\s*$/);
          if (m && /_{3,}/.test(paras[i])) {
            author_name = m[1].trim();
            // должность — предыдущий непустой параграф (не «Приложение:», не «С уважением»).
            for (let j = i - 1; j >= 0; j--) {
              const t = paras[j];
              if (!t) continue;
              if (/^Приложение:/.test(t)) continue;
              if (/^С уважением/i.test(t)) continue;
              author_position = t;
              break;
            }
            break;
          }
        }

        const data = {
          project_subject,
          customer_name,
          customer_address,
          project_object,
          summary_paragraph,
          crew_size,
          deadline_str,
          cost_no_vat,
          price_standard_vat,
          price_separate_vat,
          warnings,
          decisions: decisions.map(d => ({ text: d.title ? `${d.title} — ${d.text}` : d.text })),
          author_name,
          author_position
        };
        return { type: 'director_report', data, text: rawText };
      }
      return { type: 'unknown', mime: doc.mime_type, filename: doc.filename };
    } catch (e) {
      request.log.error({ err: e }, '[pre-tenders documents/json] parse failed');
      return reply.code(500).send({ error: 'parse_failed', detail: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7.6c POST /:ptId/documents/:idx/save-edits
  //     Принять JSON с правками от фронта (модалка «✏ Просмотр и правки»)
  //     и пересобрать XLSX/DOCX. По умолчанию обновляет файл «на месте»
  //     (перезаписывает doc.path) + сохраняет source_data в manual_documents
  //     чтобы повторный preview-edit давал JSON без потерь.
  //     Body: { kind:'smeta'|'director_report', edits:{...} }
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:ptId/documents/:idx/save-edits', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const ptId = Number(request.params.ptId);
    const idx  = Number(request.params.idx);
    if (!Number.isFinite(ptId) || !Number.isFinite(idx) || idx < 0) {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    const acc = await checkPreTenderAccess(request.user, ptId);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });
    const { kind, edits } = request.body || {};
    if (!kind || !edits) return reply.code(400).send({ error: 'kind_and_edits_required' });
    const normKind = String(kind).toLowerCase();

    const r = await db.query(
      'SELECT manual_documents FROM pre_tender_requests WHERE id=$1 LIMIT 1', [ptId]);
    if (!r.rows.length) return reply.code(404).send({ error: 'pre_tender_not_found' });
    const docs = Array.isArray(r.rows[0].manual_documents) ? r.rows[0].manual_documents : [];
    if (idx >= docs.length) return reply.code(404).send({ error: 'document_not_found' });
    const doc = docs[idx];
    if (!doc || !doc.path) return reply.code(404).send({ error: 'document_path_missing' });

    // Резолвим абсолютный путь файла на диске.
    const candidates = [
      doc.path,
      path.join(process.cwd(), doc.path),
      path.join(__dirname, '..', '..', doc.path),
    ];
    let absPath = null;
    for (const p of candidates) {
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) { absPath = p; break; } } catch (_) {}
    }
    if (!absPath) return reply.code(404).send({ error: 'file_not_found_on_disk' });

    try {
      let buf = null;
      if (normKind === 'smeta' || normKind.includes('smeta')) {
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Смета');
        const rows = Array.isArray(edits.rows) ? edits.rows : [];
        rows.forEach((row, ri) => {
          const r = ws.getRow(ri + 1);
          (Array.isArray(row) ? row : []).forEach((val, ci) => {
            // Пытаемся сохранить числа как числа.
            const sv = String(val == null ? '' : val).replace(/\s+/g, '').replace(',', '.');
            const num = Number(sv);
            if (sv !== '' && !isNaN(num)) {
              r.getCell(ci + 1).value = num;
            } else {
              r.getCell(ci + 1).value = (val == null ? '' : String(val));
            }
          });
          r.commit();
        });
        ws.columns.forEach(c => { c.width = c.width || 18; });
        buf = await wb.xlsx.writeBuffer();
      } else if (normKind === 'director_report' || normKind.includes('director')) {
        // Для отчёта используем docxtemplater через document-generator, передавая edits.data
        // как «estimate+analysis+project+customer» в упрощённом виде.
        const docGen = require('../services/document-generator');
        const d = edits.data || {};
        const fakeEstimate = {
          estimate: {},
          calculation: {},
          totals: {
            // Если пользователь ввёл «3,87 млн ₽» — это уже отформатированная строка;
            // generateDirectorReportDocx _fmtMillions их перетрёт. Мы заменяем их в data ниже.
          },
          analysis: {
            summary: d.summary_paragraph || '',
            warnings: Array.isArray(d.warnings) ? d.warnings : [],
            recommendations: Array.isArray(d.decisions) ? d.decisions.map(x => typeof x === 'string' ? x : (x.text || '')) : []
          }
        };
        const project = { subject: d.project_subject || '—', object: d.project_object || '—', deadline: d.deadline_str || '—' };
        const customer = { name: d.customer_name || '—', address: d.customer_address || '—' };
        const analysis = {
          summary: d.summary_paragraph || '',
          warnings: fakeEstimate.analysis.warnings,
          recommendations: fakeEstimate.analysis.recommendations,
          author_name: d.author_name || undefined,
          author_position: d.author_position || undefined
        };
        // Генерим документ из шаблона. Числовые поля (cost/price/crew/deadline) —
        // forсимуляция: подкладываем готовые строки через TPL-data override.
        // generateDirectorReportDocx сам их пересчитает из totals; мы не хотим этого.
        // Поэтому делаем низкоуровневый рендер шаблона напрямую.
        const { TPL_DIRECTOR } = docGen;
        // Если TPL_DIRECTOR доступен — рендерим вручную через _renderDocxTemplate.
        // Но он не экспортирован. Fallback: зовём generateDirectorReportDocx, а пользовательские
        // экономические строки игнорятся (это TODO). Здесь — выбираем рендер через шаблон, если возможно.
        let renderedBuf;
        try {
          // Прямой рендер: повторяем поля из generateDirectorReportDocx, но с нашими готовыми строками.
          const { Docxtemplater, PizZip } = (() => {
            // та же ленивая загрузка, что и в document-generator.
            return { Docxtemplater: require('docxtemplater'), PizZip: require('pizzip') };
          })();
          const content = fs.readFileSync(TPL_DIRECTOR, 'binary');
          const zip = new PizZip(content);
          const docx = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '—' });
          const warningsTpl = (Array.isArray(d.warnings) ? d.warnings : []).slice(0, 12).map(w => ({
            title: String((w && (w.title || w.kind)) || 'Внимание'),
            text:  String((w && (w.text  || w.message || w.detail)) || '')
          }));
          const decisionsRaw = Array.isArray(d.decisions) ? d.decisions : [];
          const decisionsTpl = decisionsRaw.slice(0, 12).map(x => ({
            text: typeof x === 'string' ? x : String((x && (x.text || x.title)) || '')
          }));
          docx.render({
            customer_name: d.customer_name || '—',
            customer_address: d.customer_address || '—',
            project_object: d.project_object || '—',
            project_subject: d.project_subject || '—',
            report_number: `ПО-${new Date().getFullYear()}/${String(Date.now()).slice(-4)}`,
            report_date: new Date().toLocaleDateString('ru-RU'),
            summary_paragraph: d.summary_paragraph || '—',
            crew_size: d.crew_size || '—',
            deadline_str: d.deadline_str || '—',
            cost_no_vat: d.cost_no_vat || '—',
            price_standard_vat: d.price_standard_vat || '—',
            price_separate_vat: d.price_separate_vat || '—',
            warnings: warningsTpl,
            decisions: decisionsTpl,
            author_name: d.author_name || '(подпись РП)',
            author_position: d.author_position || 'Руководитель проектного отдела'
          });
          renderedBuf = docx.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
        } catch (e) {
          // Фоллбэк: дефолтный генератор (потеряет user-economics, но не упадёт).
          request.log.warn({ err: e }, '[save-edits] direct DOCX render failed, falling back to default');
          renderedBuf = await docGen.generateDirectorReportDocx(fakeEstimate, project, customer, analysis);
        }
        buf = renderedBuf;
      } else {
        return reply.code(400).send({ error: 'unsupported_kind', kind });
      }

      if (!buf) return reply.code(500).send({ error: 'render_returned_empty' });

      // Бэкап старого файла и запись нового.
      const bakPath = absPath + '.bak';
      try { fs.copyFileSync(absPath, bakPath); } catch (_) {}
      fs.writeFileSync(absPath, buf);

      // Обновляем запись в manual_documents: размер, source_data (для будущих правок), edited_at.
      const updated = docs.slice();
      updated[idx] = Object.assign({}, doc, {
        size: buf.length,
        source_data: { type: normKind.includes('smeta') ? 'smeta' : 'director_report', ...edits },
        edited_at: new Date().toISOString(),
        edited_by: request.user && request.user.id
      });
      await db.query(
        'UPDATE pre_tender_requests SET manual_documents=$1, updated_at=NOW() WHERE id=$2',
        [JSON.stringify(updated), ptId]);

      return { ok: true, idx, size: buf.length };
    } catch (e) {
      request.log.error({ err: e }, '[pre-tenders documents/save-edits] failed');
      return reply.code(500).send({ error: 'save_failed', detail: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7.7 (Wave A+ fix BLOCKER#2) GET /:ptId/email-attachments/:attId/download
  //     Скачать email_attachment (из исходного письма) для pre_tender'a.
  //     До этого vanilla бил по /inbox-applications/0/attachments/... — 404 (хардкод).
  //     Security: JOIN на pt.email_id — attachment принадлежит письму pt.
  //     Auth: Bearer header ИЛИ query ?token=...
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/:ptId/email-attachments/:attId/download', {
    preHandler: [
      async (request, reply) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.authenticate
    ]
  }, async (request, reply) => {
    const ptId = Number(request.params.ptId);
    const attId = Number(request.params.attId);
    if (!Number.isFinite(ptId) || !Number.isFinite(attId)) {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    // Wave A+ fix MED#4: owner-guard. PM/TO не должен скачивать вложения чужих pre_tender'ов.
    const acc = await checkPreTenderAccess(request.user, ptId);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });
    // SELECT attachment строго в рамках письма pre_tender'a.
    const r = await db.query(`
      SELECT ea.id, ea.filename, ea.original_filename, ea.mime_type, ea.size, ea.file_path
      FROM email_attachments ea
      JOIN pre_tender_requests pt ON pt.email_id = ea.email_id
      WHERE ea.id = $1 AND pt.id = $2 LIMIT 1
    `, [attId, ptId]);
    const att = r.rows[0];
    if (!att) return reply.code(404).send({ error: 'attachment_not_found' });
    // Резолв пути — аналогично inbox_applications_ai.js
    const candidates = [
      att.file_path,
      path.join(process.cwd(), att.file_path),
      path.join(process.cwd(), 'uploads', att.file_path),
      path.join(process.cwd(), 'uploads', 'mail', att.file_path),
    ];
    let absPath = null;
    for (const p of candidates) {
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) { absPath = p; break; } } catch (_) {}
    }
    if (!absPath) return reply.code(404).send({ error: 'file_not_found_on_disk' });
    const buf = fs.readFileSync(absPath);
    const dispName = (att.original_filename || att.filename || 'attachment').replace(/[\r\n"]/g, '_');
    reply
      .header('Content-Type', att.mime_type || 'application/octet-stream')
      .header('Content-Length', buf.length)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(dispName)}`)
      .send(buf);
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. POST /:id/analyze — AI-анализ
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/analyze', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const result = await preTenderService.analyzePreTender(parseInt(id));
      return { success: true, analysis: result };
    } catch (err) {
      return reply.code(500).send({ error: 'AI-анализ не удался: ' + err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. POST /:id/accept — ПРИНЯТЬ ЗАЯВКУ
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/accept', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    let { comment, contact_person, contact_phone, assigned_pm_id, send_email = true } = request.body || {};
    const user = request.user;

    // Wave A+ fix BLOCKER#1: owner-check для PM/TO.
    const acc = await checkPreTenderAccess(user, id);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });

    // Получаем заявку (без JOIN с emails — для ручных заявок emails не нужны)
    const ptRes = await db.query('SELECT * FROM pre_tender_requests WHERE id = $1', [id]);

    if (!ptRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });
    const pt = ptRes.rows[0];

    // If director approving, use saved data from the original request
    if (!assigned_pm_id && pt.assigned_to) assigned_pm_id = pt.assigned_to;
    if (!contact_person && pt.contact_person) contact_person = pt.contact_person;
    if (!contact_phone && pt.contact_phone) contact_phone = pt.contact_phone;

    if (!['new', 'in_review', 'need_docs', 'pending_approval'].includes(pt.status)) {
      return reply.code(400).send({ error: 'Заявка уже обработана (статус: ' + pt.status + ')' });
    }

    // Director approval workflow: TO/HEAD_TO/PM can only request approval, not accept directly
    const directorRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
    const isDirector = directorRoles.includes(user.role);

    if (!isDirector && pt.status !== 'pending_approval') {
      // Non-director requesting acceptance → set to pending_approval
      await db.query(`
        UPDATE pre_tender_requests SET
          status = 'pending_approval',
          approval_requested_by = $1,
          approval_requested_at = NOW(),
          approval_comment = $2,
          contact_person = COALESCE(NULLIF($3, ''), contact_person),
          contact_phone = COALESCE(NULLIF($4, ''), contact_phone),
          assigned_to = COALESCE($6, assigned_to),
          updated_at = NOW()
        WHERE id = $5
      `, [user.id, comment || null, contact_person || '', contact_phone || '', id, assigned_pm_id || null]);

      // Notify all directors
      const dirRes = await db.query("SELECT id, name FROM users WHERE role IN ('ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active = true");
      for (const dir of dirRes.rows) {
        createNotification(db, {
          user_id: dir.id,
          title: 'Требуется согласование заявки',
          message: user.name + ' запрашивает согласование заявки #' + id + ' от ' + (pt.customer_name || 'заказчика'),
          type: 'warning',
          link: '#/pre-tenders?open=' + id
        });
        sendToUser(dir.id, 'pre_tender:approval_needed', {
          id: parseInt(id),
          customer_name: pt.customer_name || '',
          requested_by: user.name || user.id
        });

        // Telegram inline approval buttons
        try {
          const telegram = require('../services/telegram');
          if (telegram.sendApprovalRequest) {
            const tgMsg = `🔔 *Согласование заявки #${id}*\n\n` +
              `👤 Запросил: ${user.name || 'Сотрудник'}\n` +
              `🏢 Заказчик: ${pt.customer_name || '—'}\n` +
              `📋 ${pt.work_description || ''}\n` +
              `💰 Сумма: ${pt.estimated_sum ? Number(pt.estimated_sum).toLocaleString('ru') + ' ₽' : 'не указана'}`;
            telegram.sendApprovalRequest(dir.id, tgMsg, { type: 'pre_tender', id: parseInt(id) });
          }
        } catch(e) { /* telegram optional */ }
      }

      broadcast('pre_tender:updated', { id: parseInt(id), status: 'pending_approval' });

      return { success: true, pending_approval: true, message: 'Заявка отправлена на согласование директору' };
    }

    // Director approving pending_approval → continue to accept
    if (pt.status === 'pending_approval' && !isDirector) {
      return reply.code(403).send({ error: 'Только руководство может утвердить заявку' });
    }

    // Подгружаем данные письма, только если есть email_id
    let emailData = {};
    if (pt.email_id) {
      try {
        const emailRes = await db.query(
          'SELECT subject as email_subject, from_email, from_name, email_type, id as eid FROM emails WHERE id = $1',
          [pt.email_id]
        );
        if (emailRes.rows.length) emailData = emailRes.rows[0];
      } catch (emailFetchErr) {
        console.error('[PreTender] Accept: email fetch error:', emailFetchErr.message);
      }
    }

    // 1. Создать тендер
    const period = new Date().toISOString().slice(0, 7);
    const tenderType = pt.source_type === 'email' && emailData.email_type === 'platform_tender' ? 'Тендер' : 'Прямой запрос';
    const commentTo = `Создано из заявки #${id}. ${pt.ai_recommendation || ''} ${comment || ''}`.trim().slice(0, 500);

    // Авто-создание записи в customers если указан ИНН (для FK tenders_customer_inn_fkey)
    if (pt.customer_inn) {
      try {
        await db.query(
          `INSERT INTO customers (inn, name) VALUES ($1, $2) ON CONFLICT (inn) DO NOTHING`,
          [pt.customer_inn, pt.customer_name || 'Не указан']
        );
      } catch (_) { /* customers table might not have this constraint */ }
    }

    let tenderId;
    try {
      tenderId = await db.transaction(async (client) => {
        const tenderRes = await client.query(`
          INSERT INTO tenders (
            customer_name, customer_inn, tender_type, tender_status,
            tender_price, docs_deadline, responsible_pm_id,
            comment_to, period, created_by, source_pre_tender_id, created_at
          ) VALUES ($1, $2, $3, 'Новый', $4, $5, $6, $7, $8, $9, $10, NOW())
          RETURNING id
        `, [
          pt.customer_name || emailData.from_name || 'Не указан',
          pt.customer_inn || null,
          tenderType,
          pt.estimated_sum || null,
          pt.work_deadline || null,
          assigned_pm_id || null,
          commentTo,
          period,
          user.id,
          pt.id  // 21.06.2026: связь tender ↔ исходная заявка для works.source_pre_tender_id (см. personal-kanban.js:2128 auto-work hook)
        ]);
        const tId = tenderRes.rows[0].id;

        await client.query(`
          UPDATE pre_tender_requests SET
            status = 'accepted',
            decision_by = $1, decision_at = NOW(), decision_comment = $2,
            created_tender_id = $3,
            contact_person = COALESCE(NULLIF($4, ''), contact_person),
            contact_phone = COALESCE(NULLIF($5, ''), contact_phone),
            assigned_to = $6,
            updated_at = NOW()
          WHERE id = $7
        `, [user.id, comment || null, tId, contact_person || '', contact_phone || '', assigned_pm_id || null, id]);

        await client.query(`
          INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
          VALUES ($1, 'pre_tender', $2, 'accept', $3, NOW())
        `, [user.id, parseInt(id), JSON.stringify({ tender_id: tId, comment })]);

        return tId;
      });
    } catch (txErr) {
      console.error('[PreTender] Accept transaction error:', txErr.message);
      return reply.code(500).send({ error: 'Ошибка: ' + txErr.message });
    }

    // 2. Отправить письмо через /api/mailbox/send
    let responseEmailId = null;
    if (send_email && pt.customer_email) {
      try {
        // Получаем шаблон tender_accept
        const tplRes = await db.query(
          "SELECT * FROM email_templates_v2 WHERE code = 'tender_accept' AND is_active = true LIMIT 1"
        );

        if (tplRes.rows.length) {
          const tpl = tplRes.rows[0];
          const letterhead = require('../services/email-letterhead');

          const subject = letterhead.fillTemplate(tpl.subject_template, {
            original_subject: emailData.email_subject || pt.work_description?.slice(0, 50) || 'заявка'
          });
          const bodyHtml = letterhead.fillTemplate(tpl.body_template, {
            contact_person: contact_person || 'менеджер',
            contact_phone: contact_phone || ''
          });
          const finalHtml = tpl.use_letterhead ? letterhead.wrapInLetterhead(bodyHtml) : bodyHtml;

          // Находим активный аккаунт
          const accRes = await db.query('SELECT id FROM email_accounts WHERE is_active = true AND smtp_host IS NOT NULL LIMIT 1');
          if (accRes.rows.length) {
            const emailIns = await db.query(`
              INSERT INTO emails (
                account_id, direction, to_emails, subject, body_html, body_text,
                email_type, is_read, sent_by_user_id, reply_to_email_id, email_date
              ) VALUES ($1, 'outbound', $2, $3, $4, $5, 'crm_outbound', true, $6, $7, NOW())
              RETURNING id
            `, [
              accRes.rows[0].id,
              JSON.stringify([{ address: pt.customer_email, name: pt.customer_name || '' }]),
              subject,
              finalHtml,
              subject,
              user.id,
              pt.email_id || null
            ]);
            responseEmailId = emailIns.rows[0].id;

            await db.query('UPDATE pre_tender_requests SET response_email_id = $1 WHERE id = $2', [responseEmailId, id]);
          }
        }
      } catch (emailErr) {
        console.error('[PreTender] Accept email error:', emailErr.message);
      }
    }

    // 3. Уведомление назначенному РП
    if (assigned_pm_id) {
      createNotification(db, {
        user_id: assigned_pm_id,
        title: 'Новый тендер назначен',
        message: `Вам назначен тендер от ${pt.customer_name || 'заказчика'}`,
        type: 'info',
        link: `#/tenders?id=${tenderId}`
      });
    }

    // SSE: уведомляем о принятии заявки
    broadcast('pre_tender:accepted', {
      id: parseInt(id), tender_id: tenderId,
      customer_name: pt.customer_name || emailData.from_name || '',
      accepted_by: user.id
    });

    // SSE: уведомляем назначенного РП
    if (assigned_pm_id) {
      sendToUser(assigned_pm_id, 'tender:new_assignment', {
        tender_id: tenderId, customer_name: pt.customer_name || '',
        pre_tender_id: parseInt(id)
      });
    }

    // Wave C: конверсия карты канбана pre_tender → tender (fire-and-forget).
    // Симметрично Wave-5 hook для assign-work-pm. Не валим accept если упадёт.
    // Wave A+ fix MED#5: SELECT FOR UPDATE в транзакции — защищает от параллельной конверсии
    // (если кто-то ещё одновременно нажал accept или Wave-5 hook сработал на ту же карту).
    try {
      await db.transaction(async (client) => {
        const cardRes = await client.query(
          `SELECT id, owner_user_id, current_main_status, current_substage_id, version, entity_kind, entity_id
           FROM personal_kanban_cards
           WHERE entity_kind='pre_tender' AND entity_id=$1 AND is_closed=false
           ORDER BY id DESC LIMIT 1 FOR UPDATE`,
          [parseInt(id)]);
        const card = cardRes.rows[0];
        if (!card) return; // карты нет — ничего не делаем
        // Защита от двойной конверсии: если кто-то уже перевёл карту на tender → выходим.
        if (card.entity_kind !== 'pre_tender' || card.entity_id !== parseInt(id)) return;

        // Wave D BUG-7: default substages если у PM 0 для (tender, Новый)
        const newSubstageId = await personalKanban.ensureDefaultSubstages(client, card.owner_user_id, 'tender', 'Новый');

        await client.query(
          `UPDATE personal_kanban_cards
           SET entity_kind='tender', entity_id=$1, flow_type='tender',
               current_main_status='Новый', current_substage_id=$2,
               last_moved_at=now(), version=version+1, updated_at=now()
           WHERE id=$3`,
          [tenderId, newSubstageId, card.id]);

        await client.query(
          `INSERT INTO personal_kanban_card_history
            (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, action, note)
           VALUES ($1, $2, $3, $4, 'Новый', $5, 'convert', $6)`,
          [card.id, card.current_substage_id, newSubstageId, card.current_main_status, user.id,
           `pre_tender #${id} → tender #${tenderId}`]);

        try {
          const sse = require('../services/sse');
          sse.broadcast?.('personal_kanban:card_converted', {
            card_id: card.id, owner_user_id: card.owner_user_id,
            flow_type: 'tender', entity_kind: 'tender', entity_id: tenderId,
            from_entity_kind: 'pre_tender', from_entity_id: parseInt(id),
          });
        } catch (_) {}
      });
    } catch (cardErr) {
      console.error('[PreTender] Accept kanban convert error:', cardErr.message);
    }

    return { success: true, tender_id: tenderId, response_email_id: responseEmailId };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 10. POST /:id/reject — ОТКЛОНИТЬ ЗАЯВКУ
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/reject', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const { reject_reason, send_email = true } = request.body || {};
    const user = request.user;

    // Wave A+ fix BLOCKER#1: owner-check для PM/TO.
    const acc = await checkPreTenderAccess(user, id);
    if (!acc.ok) return reply.code(acc.code).send({ error: acc.error });

    const ptRes = await db.query('SELECT * FROM pre_tender_requests WHERE id = $1', [id]);

    if (!ptRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });
    const pt = ptRes.rows[0];

    if (!['new', 'in_review', 'need_docs'].includes(pt.status)) {
      return reply.code(400).send({ error: 'Заявка уже обработана' });
    }

    // Подгружаем данные письма, только если есть email_id
    let rejectEmailData = {};
    if (pt.email_id) {
      try {
        const emailRes = await db.query(
          'SELECT subject as email_subject, id as eid FROM emails WHERE id = $1',
          [pt.email_id]
        );
        if (emailRes.rows.length) rejectEmailData = emailRes.rows[0];
      } catch (emailFetchErr) {
        console.error('[PreTender] Reject: email fetch error:', emailFetchErr.message);
      }
    }

    // 1. Обновить заявку
    try {
      await db.query(`
        UPDATE pre_tender_requests SET
          status = 'rejected',
          decision_by = $1, decision_at = NOW(),
          reject_reason = $2,
          updated_at = NOW()
        WHERE id = $3
      `, [user.id, reject_reason || 'Не указана', id]);
    } catch (updateErr) {
      console.error('[PreTender] Reject: UPDATE error:', updateErr.message, updateErr.code);
      return reply.code(500).send({ error: 'Ошибка обновления заявки: ' + updateErr.message });
    }

    // 2. Отправить письмо с отказом
    let responseEmailId = null;
    if (send_email && pt.customer_email) {
      try {
        const tplRes = await db.query(
          "SELECT * FROM email_templates_v2 WHERE code = 'tender_reject' AND is_active = true LIMIT 1"
        );

        if (tplRes.rows.length) {
          const tpl = tplRes.rows[0];
          const letterhead = require('../services/email-letterhead');

          const subject = letterhead.fillTemplate(tpl.subject_template, {
            original_subject: rejectEmailData.email_subject || 'заявка'
          });
          const reasonText = reject_reason ? ', в связи с: ' + reject_reason : '';
          const bodyHtml = letterhead.fillTemplate(tpl.body_template, {
            reject_reason: reasonText
          });
          const finalHtml = tpl.use_letterhead ? letterhead.wrapInLetterhead(bodyHtml) : bodyHtml;

          const accRes = await db.query('SELECT id FROM email_accounts WHERE is_active = true AND smtp_host IS NOT NULL LIMIT 1');
          if (accRes.rows.length) {
            const emailIns = await db.query(`
              INSERT INTO emails (
                account_id, direction, to_emails, subject, body_html, body_text,
                email_type, is_read, sent_by_user_id, reply_to_email_id, email_date
              ) VALUES ($1, 'outbound', $2, $3, $4, $5, 'crm_outbound', true, $6, $7, NOW())
              RETURNING id
            `, [
              accRes.rows[0].id,
              JSON.stringify([{ address: pt.customer_email, name: pt.customer_name || '' }]),
              subject,
              finalHtml,
              subject,
              user.id,
              pt.email_id || null
            ]);
            responseEmailId = emailIns.rows[0].id;
            await db.query('UPDATE pre_tender_requests SET response_email_id = $1 WHERE id = $2', [responseEmailId, id]);
          }
        }
      } catch (emailErr) {
        console.error('[PreTender] Reject email error:', emailErr.message);
      }
    }

    // 3. Архивировать письмо
    if (pt.email_id) {
      try {
        await db.query('UPDATE emails SET is_archived = true WHERE id = $1', [pt.email_id]);
      } catch (_) {}
    }

    // 4. Audit log
    try {
      await db.query(`
        INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
        VALUES ($1, 'pre_tender', $2, 'reject', $3, NOW())
      `, [user.id, parseInt(id), JSON.stringify({ reject_reason })]);
    } catch (_) {}

    // SSE: уведомляем об отклонении
    broadcast('pre_tender:rejected', {
      id: parseInt(id), customer_name: pt.customer_name || '',
      rejected_by: user.id
    });

    return { success: true, response_email_id: responseEmailId };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 11. POST /:id/fast-track — БЫСТРЫЙ ПУТЬ (сразу на просчёт)
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/fast-track', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const { pm_id, contact_person, contact_phone, comment, send_email = true } = request.body || {};
    const user = request.user;

    // Валидация: pm_id обязателен
    if (!pm_id) {
      return reply.code(400).send({ error: 'Необходимо указать РП (pm_id)' });
    }

    // Проверяем что РП существует и имеет нужную роль
    const pmRes = await db.query(
      "SELECT id, name, role FROM users WHERE id = $1 AND is_active = true AND role IN ('PM','HEAD_PM','ADMIN','DIRECTOR_DEV','DIRECTOR_GEN','CHIEF_ENGINEER','HR')",
      [pm_id]
    );
    if (!pmRes.rows.length) {
      return reply.code(400).send({ error: 'Указанный пользователь не найден или не является РП' });
    }
    const pm = pmRes.rows[0];

    // Получаем заявку (без JOIN с emails)
    const ptRes = await db.query('SELECT * FROM pre_tender_requests WHERE id = $1', [id]);

    if (!ptRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });
    const pt = ptRes.rows[0];

    if (!['new', 'in_review', 'need_docs', 'pending_approval'].includes(pt.status)) {
      return reply.code(400).send({ error: 'Заявка уже обработана (статус: ' + pt.status + ')' });
    }

    // Director approval workflow: TO/HEAD_TO/PM can only request approval, not accept directly
    const directorRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
    const isDirector = directorRoles.includes(user.role);

    if (!isDirector && pt.status !== 'pending_approval') {
      // Non-director requesting acceptance → set to pending_approval
      await db.query(`
        UPDATE pre_tender_requests SET
          status = 'pending_approval',
          approval_requested_by = $1,
          approval_requested_at = NOW(),
          approval_comment = $2,
          contact_person = COALESCE(NULLIF($3, ''), contact_person),
          contact_phone = COALESCE(NULLIF($4, ''), contact_phone),
          assigned_to = COALESCE($6, assigned_to),
          updated_at = NOW()
        WHERE id = $5
      `, [user.id, comment || null, contact_person || '', contact_phone || '', id, pm_id || null]);

      // Notify all directors
      const dirRes = await db.query("SELECT id, name FROM users WHERE role IN ('ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active = true");
      for (const dir of dirRes.rows) {
        createNotification(db, {
          user_id: dir.id,
          title: 'Требуется согласование заявки',
          message: user.name + ' запрашивает согласование заявки #' + id + ' от ' + (pt.customer_name || 'заказчика'),
          type: 'warning',
          link: '#/pre-tenders?open=' + id
        });
        sendToUser(dir.id, 'pre_tender:approval_needed', {
          id: parseInt(id),
          customer_name: pt.customer_name || '',
          requested_by: user.name || user.id
        });

        // Telegram inline approval buttons
        try {
          const telegram = require('../services/telegram');
          if (telegram.sendApprovalRequest) {
            const tgMsg = `🔔 *Согласование заявки #${id}*\n\n` +
              `👤 Запросил: ${user.name || 'Сотрудник'}\n` +
              `🏢 Заказчик: ${pt.customer_name || '—'}\n` +
              `📋 ${pt.work_description || ''}\n` +
              `💰 Сумма: ${pt.estimated_sum ? Number(pt.estimated_sum).toLocaleString('ru') + ' ₽' : 'не указана'}`;
            telegram.sendApprovalRequest(dir.id, tgMsg, { type: 'pre_tender', id: parseInt(id) });
          }
        } catch(e) { /* telegram optional */ }
      }

      broadcast('pre_tender:updated', { id: parseInt(id), status: 'pending_approval' });

      return { success: true, pending_approval: true, message: 'Заявка отправлена на согласование директору' };
    }

    // Director approving pending_approval → continue to accept
    if (pt.status === 'pending_approval' && !isDirector) {
      return reply.code(403).send({ error: 'Только руководство может утвердить заявку' });
    }

    // Подгружаем данные письма, только если есть email_id
    let ftEmailData = {};
    if (pt.email_id) {
      try {
        const emailRes = await db.query(
          'SELECT subject as email_subject, from_email, from_name, email_type, id as eid FROM emails WHERE id = $1',
          [pt.email_id]
        );
        if (emailRes.rows.length) ftEmailData = emailRes.rows[0];
      } catch (emailFetchErr) {
        console.error('[PreTender] Fast-track: email fetch error:', emailFetchErr.message);
      }
    }

    const period = new Date().toISOString().slice(0, 7);
    const tenderType = pt.source_type === 'email' && ftEmailData.email_type === 'platform_tender' ? 'Тендер' : 'Прямой запрос';
    const aiComment = pt.ai_recommendation ? `AI: ${pt.ai_recommendation}` : '';
    const fullComment = [
      `Быстрый путь из заявки #${id}`,
      comment || '',
      aiComment
    ].filter(Boolean).join('. ').slice(0, 500);

    // Авто-создание записи в customers если указан ИНН (для FK tenders_customer_inn_fkey)
    if (pt.customer_inn) {
      try {
        await db.query(
          `INSERT INTO customers (inn, name) VALUES ($1, $2) ON CONFLICT (inn) DO NOTHING`,
          [pt.customer_inn, pt.customer_name || 'Не указан']
        );
      } catch (_) { /* customers table might not have this constraint */ }
    }

    // Транзакция: создаём тендер + обновляем заявку + уведомление + audit
    let tenderId;
    try {
      tenderId = await db.transaction(async (client) => {
        // 1. Создаём тендер со статусом "Отправлено на просчёт"
        const tenderRes = await client.query(`
          INSERT INTO tenders (
            customer_name, customer_inn, tender_type, tender_status,
            tender_price, docs_deadline, responsible_pm_id,
            comment_to, period, created_by, source_pre_tender_id, created_at, handoff_at
          ) VALUES ($1, $2, $3, 'Отправлено на просчёт', $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
          RETURNING id
        `, [
          pt.customer_name || ftEmailData.from_name || 'Не указан',
          pt.customer_inn || null,
          tenderType,
          pt.estimated_sum || null,
          pt.work_deadline || null,
          pm_id,
          fullComment,
          period,
          user.id,
          pt.id  // 21.06.2026: связь tender ↔ исходная заявка для works.source_pre_tender_id
        ]);
        const tId = tenderRes.rows[0].id;

        // 2. Обновляем заявку → accepted
        await client.query(`
          UPDATE pre_tender_requests SET
            status = 'accepted',
            decision_by = $1, decision_at = NOW(), decision_comment = $2,
            created_tender_id = $3,
            contact_person = COALESCE(NULLIF($4, ''), contact_person),
            contact_phone = COALESCE(NULLIF($5, ''), contact_phone),
            assigned_to = $6,
            updated_at = NOW()
          WHERE id = $7
        `, [user.id, 'Быстрый путь: сразу на просчёт', tId, contact_person || '', contact_phone || '', pm_id, id]);

        // 3. Уведомление РП
        await client.query(`
          INSERT INTO notifications (user_id, title, message, type, link, entity_id, created_at)
          VALUES ($1, $2, $3, 'estimation_request', $4, $5, NOW())
        `, [
          pm_id,
          'Новый тендер на просчёт',
          `Вам назначен тендер от ${pt.customer_name || 'заказчика'}. ${comment || ''}`.trim(),
          `/tenders/${tId}`,
          tId
        ]);

        // 4. Audit log
        await client.query(`
          INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
          VALUES ($1, 'pre_tender', $2, 'fast_track', $3, NOW())
        `, [user.id, parseInt(id), JSON.stringify({ tender_id: tId, pm_id, comment })]);

        return tId;
      });
    } catch (txErr) {
      console.error('[PreTender] Fast-track transaction error:', txErr.message);
      return reply.code(500).send({ error: 'Ошибка создания тендера: ' + txErr.message });
    }

    // Telegram notification for assigned PM (outside transaction)
    try {
      const telegram = require('../services/telegram');
      if (telegram && telegram.sendNotification) {
        const msgText = `Вам назначен тендер от ${pt.customer_name || 'заказчика'}. ${comment || ''}`.trim();
        await telegram.sendNotification(pm_id, `🔔 *Новый тендер на просчёт*\n\n${msgText}`);
      }
    } catch (_) {}

    // 5. Отправить email заказчику (вне транзакции)
    let responseEmailId = null;
    if (send_email && pt.customer_email) {
      try {
        const tplRes = await db.query(
          "SELECT * FROM email_templates_v2 WHERE code = 'tender_accept' AND is_active = true LIMIT 1"
        );
        if (tplRes.rows.length) {
          const tpl = tplRes.rows[0];
          const letterhead = require('../services/email-letterhead');

          const subject = letterhead.fillTemplate(tpl.subject_template, {
            original_subject: ftEmailData.email_subject || pt.work_description?.slice(0, 50) || 'заявка'
          });
          const bodyHtml = letterhead.fillTemplate(tpl.body_template, {
            contact_person: pm.name || contact_person || 'менеджер',
            contact_phone: contact_phone || ''
          });
          const finalHtml = tpl.use_letterhead ? letterhead.wrapInLetterhead(bodyHtml) : bodyHtml;

          const accRes = await db.query('SELECT id FROM email_accounts WHERE is_active = true AND smtp_host IS NOT NULL LIMIT 1');
          if (accRes.rows.length) {
            const emailIns = await db.query(`
              INSERT INTO emails (
                account_id, direction, to_emails, subject, body_html, body_text,
                email_type, is_read, sent_by_user_id, reply_to_email_id, email_date
              ) VALUES ($1, 'outbound', $2, $3, $4, $5, 'crm_outbound', true, $6, $7, NOW())
              RETURNING id
            `, [
              accRes.rows[0].id,
              JSON.stringify([{ address: pt.customer_email, name: pt.customer_name || '' }]),
              subject, finalHtml, subject, user.id, pt.email_id || null
            ]);
            responseEmailId = emailIns.rows[0].id;
            await db.query('UPDATE pre_tender_requests SET response_email_id = $1 WHERE id = $2', [responseEmailId, id]);
          }
        }
      } catch (emailErr) {
        console.error('[PreTender] Fast-track email error:', emailErr.message);
      }
    }

    // 6. SSE: уведомляем всех о fast-track
    broadcast('pre_tender:accepted', {
      id: parseInt(id), tender_id: tenderId,
      customer_name: pt.customer_name || '', fast_track: true,
      accepted_by: user.id
    });

    // SSE: уведомляем РП о новом тендере на просчёт
    sendToUser(pm_id, 'tender:new_estimation', {
      tender_id: tenderId, customer_name: pt.customer_name || '',
      pre_tender_id: parseInt(id), comment: comment || ''
    });

    return {
      success: true,
      tender_id: tenderId,
      tender_status: 'Отправлено на просчёт',
      assigned_pm: pm.name,
      response_email_id: responseEmailId
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 12. DELETE /:id — Удалить
  // ═══════════════════════════════════════════════════════════════════
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    const ptRes = await db.query('SELECT id, status, created_tender_id FROM pre_tender_requests WHERE id = $1', [id]);
    if (!ptRes.rows.length) {
      return reply.code(404).send({ error: 'Заявка не найдена' });
    }
    const pt = ptRes.rows[0];

    if (pt.created_tender_id) {
      return reply.code(400).send({ error: 'Нельзя удалить заявку с привязанным тендером #' + pt.created_tender_id });
    }

    await db.query('DELETE FROM pre_tender_requests WHERE id = $1', [id]);

    try {
      await db.query(`
        INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
        VALUES ($1, 'pre_tender', $2, 'delete', $3, NOW())
      `, [user.id, parseInt(id), JSON.stringify({ status: pt.status })]);
    } catch (_) {}

    broadcast('pre_tender:deleted', { id: parseInt(id) });

    return { success: true };
  });


  // ═══════════════════════════════════════════════════════════════════
  // 13. POST /bulk-renew — Массовое продление предтендеров
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/bulk-renew', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { ids } = request.body || {};
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'Укажите ids для продления' });
    }

    const result = await db.query(
      `UPDATE pre_tender_requests SET updated_at = NOW() WHERE id = ANY($1::int[]) RETURNING id`,
      [ids]
    );

    return { success: true, renewed: result.rows.length };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 14. POST /:id/renew — Продлить предтендер
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/renew', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { rows } = await db.query('SELECT * FROM pre_tender_requests WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Предтендер не найден' });

    const { extend_days } = request.body || {};
    const days = extend_days || 30;

    // Extend the deadline/validity
    const updated = await db.query(
      `UPDATE pre_tender_requests SET 
        status = CASE WHEN status = 'expired' THEN 'new' ELSE status END,
        updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );

    return { success: true, item: updated.rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 15. POST /:id/scan — Сканирование документов предтендера
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/scan', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { rows } = await db.query('SELECT * FROM pre_tender_requests WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Предтендер не найден' });

    // Scan is a placeholder
    return { success: true, message: 'Сканирование запущено', item_id: id };
  });

  fastify.post('/:id/reject-approval', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const { comment } = request.body || {};
    const user = request.user;

    const ptRes = await db.query('SELECT * FROM pre_tender_requests WHERE id = $1', [id]);
    if (!ptRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });
    const pt = ptRes.rows[0];

    if (pt.status !== 'pending_approval') {
      return reply.code(400).send({ error: 'Заявка не находится на согласовании' });
    }

    await db.query(`
      UPDATE pre_tender_requests SET
        status = 'in_review',
        decision_by = $1, decision_at = NOW(), decision_comment = $2,
        updated_at = NOW()
      WHERE id = $3
    `, [user.id, comment || 'Согласование отклонено директором', id]);

    // Notify the person who requested approval
    if (pt.approval_requested_by) {
      createNotification(db, {
        user_id: pt.approval_requested_by,
        title: 'Согласование отклонено',
        message: (user.name || 'Директор') + ' отклонил согласование заявки #' + id + (comment ? ': ' + comment : ''),
        type: 'error',
        link: '#/pre-tenders?open=' + id
      });
    }

    broadcast('pre_tender:updated', { id: parseInt(id), status: 'in_review' });

    return { success: true, message: 'Согласование отклонено' };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /:id/calc-cost — Рассчитать себестоимость через AI
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/:id/calc-cost', {
    preHandler: [fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;

    // Найти pre_tender и связанную inbox_application
    const ptRes = await db.query('SELECT pt.email_id, ia.id as ia_id FROM pre_tender_requests pt LEFT JOIN inbox_applications ia ON ia.email_id = pt.email_id WHERE pt.id = $1', [id]);
    if (!ptRes.rows.length) return reply.code(404).send({ error: 'Заявка не найдена' });

    const { email_id, ia_id } = ptRes.rows[0];
    if (!ia_id) return reply.code(400).send({ error: 'Нет связанной заявки из почты для расчёта' });

    // Загрузить inbox_application
    const appRes = await db.query('SELECT * FROM inbox_applications WHERE id = $1', [ia_id]);
    if (!appRes.rows.length) return reply.code(404).send({ error: 'Заявка из почты не найдена' });
    const app = appRes.rows[0];

    try {
      const aiProvider = require('../services/ai-provider');
      const { COST_ESTIMATION_PROMPT } = require('../prompts/cost-estimation-prompt');

      const appInfo = [
        'Заявка: ' + (app.subject || 'Без темы'),
        'Отправитель: ' + (app.from_name || app.source_name || '') + ' <' + (app.source_email || '') + '>',
        'Тип работ: ' + (app.ai_work_type || 'не определён'),
        'AI-отчёт: ' + (app.ai_report || ''),
        'AI-рекомендация: ' + (app.ai_recommendation || ''),
        'Краткое описание: ' + (app.ai_summary || '')
      ].join('\n');

      const userMessage = 'Рассчитай себестоимость для следующей заявки:\n\n' + appInfo;

      const response = await aiProvider.complete({
        system: COST_ESTIMATION_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 4096,
        temperature: 0.2
      });

      if (!response.text) {
        console.error('[pre-tender cost-est] AI вернул пустой content. model:', response.model, 'finish_reason:', response.stopReason, 'usage:', JSON.stringify(response.usage));
        return reply.code(502).send({
          error: 'AI вернул пустой ответ. Возможно, сработал контентный фильтр или превышен лимит токенов. См. логи сервера.',
          code: 'empty_response'
        });
      }

      // Parse JSON from AI response
      let costData;
      try {
        let jsonStr = response.text.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();
        costData = JSON.parse(jsonStr);
      } catch (parseErr) {
        await db.query(
          'UPDATE inbox_applications SET ai_cost_report = $1, updated_at = NOW() WHERE id = $2',
          [response.text, ia_id]
        );
        return { success: true, ai_cost_report: response.text, parse_error: true };
      }

      const totalCost = costData.total_cost || 0;
      await db.query(
        'UPDATE inbox_applications SET ai_cost_estimate = $1, ai_cost_report = $2, updated_at = NOW() WHERE id = $3',
        [totalCost, JSON.stringify(costData), ia_id]
      );

      return { success: true, ai_cost_estimate: totalCost, ai_cost_report: costData };
    } catch (err) {
      if (err && err.name === 'AIProviderError') {
        request.log.error({
          err_code: err.code, status: err.status,
          provider_msg: err.providerMessage,
          request_summary: err.requestSummary,
          body_sample: err.body ? String(err.body).substring(0, 500) : null
        }, 'pre-tender calc-cost AI error');
        return reply.code(err.code === 'insufficient_funds' ? 402 : 502).send({
          error: err.userMessage(), code: err.code, provider_status: err.status
        });
      }
      request.log.error(err, 'pre-tender calc-cost error');
      return reply.code(500).send({ error: err.message });
    }
  });

};
