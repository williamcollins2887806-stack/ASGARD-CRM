'use strict';
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const NotificationService = require('./NotificationService');

const STAGES = Object.freeze({
  DIRECTOR_REVIEW: 'director_review',
  ACCOUNTING_REVIEW: 'accounting_review',
  PAYMENT_PENDING: 'payment_pending',
  PM_REWORK: 'pm_rework',
  APPROVED_FINAL: 'approved_final',
  PAID: 'paid',
  REJECTED: 'rejected',
  CANCELLED_BY_PM: 'cancelled_by_pm'
});
const FINAL_STAGES = new Set([STAGES.APPROVED_FINAL, STAGES.PAID, STAGES.REJECTED, STAGES.CANCELLED_BY_PM]);
const APPROVAL_MUTATION_FIELDS = new Set(['approval_status','approval_comment','reject_reason','is_approved','approved_by','approved_at','sent_for_approval_at','decided_at','decided_by_user_id']);

function makeError(statusCode, message) { const err = new Error(message); err.statusCode = statusCode; return err; }
function asText(value) { return String(value || '').trim(); }
function normalizeLegacyStatus(value) { return String(value || '').trim().toLowerCase(); }
function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj || {}, key); }
function normalizeRequiresPayment(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['true','1','yes','y','on'].includes(normalized)) return true;
  if (['false','0','no','n','off'].includes(normalized)) return false;
  return fallback;
}
function extractRequiresPayment(source) {
  if (hasOwn(source, 'requiresPayment')) return normalizeRequiresPayment(source.requiresPayment, false);
  if (hasOwn(source, 'requires_payment')) return normalizeRequiresPayment(source.requires_payment, false);
  return undefined;
}
function requestRequiresPayment(request) { return normalizeRequiresPayment(request?.requires_payment, false); }
function normalizeSourceType(value) { const normalized = String(value || '').trim().toLowerCase(); return normalized || null; }
function sourceTypeLabel(sourceType) {
  switch (normalizeSourceType(sourceType)) {
    case 'tkp': return 'ТКП';
    case 'work_expense':
    case 'office_expense': return 'Расход';
    case 'purchase_request': return 'Заявка на закупку';
    case 'estimate': return 'Документ';
    default: return 'Документ';
  }
}
function buildApprovalLabel(request, estimate) {
  const sourceType = normalizeSourceType(request?.source_type);
  const sourceId = Number(request?.source_id || 0) || Number(estimate?.id || 0) || null;
  const label = sourceTypeLabel(sourceType);
  return sourceId ? `${label} #${sourceId}` : label;
}
function approvalLink(estimateId) { return `#/all-estimates?id=${estimateId}`; }
function mapRequestToLegacyStatus(request) {
  if (!request) return 'draft';
  switch (request.current_stage) {
    case STAGES.DIRECTOR_REVIEW: return 'sent';
    case STAGES.ACCOUNTING_REVIEW: return 'accounting_review';
    case STAGES.PAYMENT_PENDING: return 'payment_pending';
    case STAGES.PM_REWORK: return request.last_rework_kind === 'question' ? 'question' : 'rework';
    case STAGES.APPROVED_FINAL: return 'approved';
    case STAGES.PAID: return 'paid';
    case STAGES.REJECTED: return 'rejected';
    case STAGES.CANCELLED_BY_PM: return 'cancelled';
    default: return 'draft';
  }
}
function isDirectorRole(role) { return role === 'ADMIN' || /^DIRECTOR/.test(String(role || '')); }
function isAccountingRole(role) { return role === 'ADMIN' || role === 'BUH'; }
function isPmActorRole(role) { return role === 'ADMIN' || role === 'PM'; }
function getRequesterId(estimate) { return Number(estimate?.pm_id || estimate?.user_id || estimate?.created_by || 0) || null; }
function ensureEstimateOwner(actor, estimate) {
  if (actor.role === 'ADMIN') return;
  const ownerId = getRequesterId(estimate);
  if (!ownerId || ownerId !== Number(actor.id)) throw makeError(403, 'Только автор согласования может выполнить это действие.');
}
function buildEstimateSnapshot(estimate) { return JSON.parse(JSON.stringify(estimate || {})); }

async function getEstimate(executor, estimateId) {
  const result = await executor.query('SELECT * FROM estimates WHERE id = $1', [estimateId]);
  return result.rows[0] || null;
}
function extractSourceBinding(source) {
  const sourceType = normalizeSourceType(source?.sourceType ?? source?.source_type);
  const rawSourceId = source?.sourceId ?? source?.source_id ?? 0;
  const sourceId = Number(rawSourceId) || null;
  if (!sourceType || !sourceId) return null;
  return { sourceType, sourceId };
}
async function resolveSourceBinding(_executor, estimate, request, params) {
  const explicitBinding = extractSourceBinding(params);
  if (explicitBinding) return explicitBinding;
  const existingBinding = extractSourceBinding(request);
  if (existingBinding) return existingBinding;
  return { sourceType: 'estimate', sourceId: Number(estimate.id) };
}
async function getApprovalRequest(executor, estimateId) {
  const result = await executor.query('SELECT * FROM estimate_approval_requests WHERE estimate_id = $1 LIMIT 1', [estimateId]);
  return result.rows[0] || null;
}
async function getPaymentSlips(executor, requestId) {
  const result = await executor.query(
    `SELECT aps.id, aps.request_id, aps.source_type, aps.source_id, aps.comment, aps.created_at, aps.document_id,
            d.original_name, d.mime_type, d.size, d.download_url, u.name AS uploaded_by_name
     FROM approval_payment_slips aps
     JOIN documents d ON d.id = aps.document_id
     LEFT JOIN users u ON u.id = aps.uploaded_by
     WHERE aps.request_id = $1
     ORDER BY aps.id DESC`,
    [requestId]
  );
  return result.rows;
}
async function getApprovalDetails(executor, estimateId) {
  const request = await getApprovalRequest(executor, estimateId);
  if (!request) return { request: null, events: [], paymentSlips: [] };
  const events = await executor.query(
    `SELECT e.*, u.name AS actor_name
     FROM estimate_approval_events e
     LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.request_id = $1
     ORDER BY e.id ASC`,
    [request.id]
  );
  const paymentSlips = await getPaymentSlips(executor, request.id);
  return { request, events: events.rows, paymentSlips };
}
async function insertApprovalEvent(executor, payload) {
  const result = await executor.query(
    `INSERT INTO estimate_approval_events (
       request_id, estimate_id, action, from_stage, to_stage,
       actor_id, actor_role, comment, payload_json, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING *`,
    [payload.requestId, payload.estimateId, payload.action, payload.fromStage, payload.toStage, payload.actor.id, payload.actor.role, payload.comment || null, payload.payload ? JSON.stringify(payload.payload) : null]
  );
  return result.rows[0];
}
async function updateRequestRow(executor, requestId, fields) {
  const keys = Object.keys(fields);
  const values = keys.map((key) => fields[key]);
  const setParts = keys.map((key, idx) => `${key} = $${idx + 1}`);
  values.push(requestId);
  const result = await executor.query(`UPDATE estimate_approval_requests SET ${setParts.join(', ')}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`, values);
  return result.rows[0];
}
async function updateEstimateMirror(executor, estimateId, fields) {
  const keys = Object.keys(fields);
  const values = keys.map((key) => fields[key]);
  const setParts = keys.map((key, idx) => `${key} = $${idx + 1}`);
  values.push(estimateId);
  const result = await executor.query(`UPDATE estimates SET ${setParts.join(', ')}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`, values);
  return result.rows[0];
}
async function setTenderAwaitingApproval(executor, estimate) {
  if (!estimate?.tender_id) return;
  await executor.query(
    `UPDATE tenders SET tender_status = 'Согласование ТКП', updated_at = NOW()
     WHERE id = $1 AND COALESCE(tender_status, '') <> 'Согласование ТКП'`,
    [estimate.tender_id]
  );
}
async function notifyUsers(db, userIds, title, message, link, tag) {
  const uniqueIds = [...new Set((userIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!uniqueIds.length) return;
  for (const userId of uniqueIds) {
    await NotificationService.send(db, { user_id: userId, type: 'estimate_approval', title, body: message, url: link || null, tag: tag || 'estimate-approval' });
  }
}
async function notifyActionableUsers(db, userIds, title, message, link, approvalData) {
  const uniqueIds = [...new Set((userIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!uniqueIds.length) return;
  for (const userId of uniqueIds) {
    await NotificationService.send(db, { user_id: userId, type: 'estimate_approval', title, body: message, url: link || null, tag: approvalData?.id ? `estimate-approval-${approvalData.id}` : 'estimate-approval' });
    try {
      const telegram = require('./telegram');
      if (telegram && telegram.sendApprovalRequest) await telegram.sendApprovalRequest(userId, `*${title}*

${message}`, approvalData);
    } catch (_) {}
  }
}
async function loadDirectorIds(db) {
  const result = await db.query(`SELECT id FROM users WHERE is_active = true AND (role LIKE 'DIRECTOR%' OR role = 'ADMIN') ORDER BY id ASC`);
  return result.rows.map((row) => Number(row.id)).filter(Boolean);
}
async function loadAccountingIds(db) {
  const result = await db.query(`SELECT id FROM users WHERE is_active = true AND role = 'BUH' ORDER BY id ASC`);
  return result.rows.map((row) => Number(row.id)).filter(Boolean);
}
async function loadParticipantIds(db, requestId) {
  const result = await db.query(
    `SELECT DISTINCT user_id FROM (
       SELECT requested_by AS user_id FROM estimate_approval_requests WHERE id = $1
       UNION ALL SELECT pm_id AS user_id FROM estimate_approval_requests WHERE id = $1
       UNION ALL SELECT last_actor_id AS user_id FROM estimate_approval_requests WHERE id = $1
       UNION ALL SELECT actor_id AS user_id FROM estimate_approval_events WHERE request_id = $1
       UNION ALL SELECT uploaded_by AS user_id FROM approval_payment_slips WHERE request_id = $1
     ) participants WHERE user_id IS NOT NULL`,
    [requestId]
  );
  return result.rows.map((row) => Number(row.user_id)).filter(Boolean);
}
async function persistPaymentSlip(executor, estimate, request, actor, file, comment) {
  const originalName = asText(file?.filename || file?.originalFilename || file?.name || 'payment-slip');
  if (!file?.buffer || !Buffer.isBuffer(file.buffer) || !file.buffer.length) throw makeError(400, 'Не приложен файл платежки.');
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
  await fs.mkdir(uploadDir, { recursive: true });
  const ext = path.extname(originalName) || '';
  const storedFilename = `${uuidv4()}${ext}`;
  await fs.writeFile(path.join(uploadDir, storedFilename), file.buffer);
  const documentResult = await executor.query(
    `INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, work_id, uploaded_by, download_url, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING *`,
    [storedFilename, originalName, file.mimetype || file.mimeType || 'application/octet-stream', file.buffer.length, 'Платежное подтверждение', estimate?.tender_id || null, null, actor.id, `/api/files/download/${storedFilename}`]
  );
  const document = documentResult.rows[0];
  const paymentResult = await executor.query(
    `INSERT INTO approval_payment_slips (request_id, source_type, source_id, document_id, comment, uploaded_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id`,
    [request.id, request.source_type || 'estimate', request.source_id || estimate.id, document.id, comment, actor.id]
  );
  return { id: paymentResult.rows[0].id, documentId: document.id, originalName: document.original_name, downloadUrl: document.download_url };
}

async function transition(db, params) {
  const actor = params.actor || {};
  const comment = asText(params.comment);
  const action = params.action;
  const reworkKind = params.reworkKind === 'question' ? 'question' : 'rework';
  if (!actor.id || !actor.role) throw makeError(400, 'Не указан пользователь, выполняющий действие.');

  const result = await db.transaction(async (executor) => {
    const estimateId = Number(params.estimateId);
    const estimate = await getEstimate(executor, estimateId);
    if (!estimate) throw makeError(404, 'Документ не найден.');
    let request = await getApprovalRequest(executor, estimateId);
    const fromStage = request?.current_stage || null;
    const ownerId = getRequesterId(estimate);
    let nextStage = null;
    let actionName = action;
    let updatedEstimate = null;
    let paymentSlip = null;

    switch (action) {
      case 'submit':
      case 'resubmit': {
        if (!isPmActorRole(actor.role)) throw makeError(403, 'Только РП или администратор могут отправить документ на согласование.');
        ensureEstimateOwner(actor, estimate);
        if (request && ![STAGES.PM_REWORK, STAGES.CANCELLED_BY_PM].includes(request.current_stage)) throw makeError(409, 'Текущий документ уже находится в согласовании.');
        nextStage = STAGES.DIRECTOR_REVIEW;
        actionName = request ? 'resubmit' : 'submit';
        const requestedRequiresPayment = extractRequiresPayment(params);
        const nextRequiresPayment = requestedRequiresPayment !== undefined ? requestedRequiresPayment : (request ? requestRequiresPayment(request) : false);
        const sourceBinding = await resolveSourceBinding(executor, estimate, request, params);
        if (!request) {
          const created = await executor.query(
            `INSERT INTO estimate_approval_requests (
               estimate_id, tender_id, requested_by, pm_id, estimate_version_no, current_stage, requires_payment, last_rework_kind,
               submitted_snapshot_json, submitted_at, last_action_at, last_actor_id, last_comment, source_type, source_id, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, NOW(), NOW(), $9, $10, $11, $12, NOW(), NOW()) RETURNING *`,
            [estimate.id, estimate.tender_id || null, ownerId || actor.id, estimate.pm_id || ownerId || null, estimate.version_no || estimate.version || null, nextStage, nextRequiresPayment, JSON.stringify(buildEstimateSnapshot(estimate)), actor.id, comment || null, sourceBinding.sourceType, sourceBinding.sourceId]
          );
          request = created.rows[0];
        } else {
          request = await updateRequestRow(executor, request.id, {
            tender_id: estimate.tender_id || null, requested_by: ownerId || actor.id, pm_id: estimate.pm_id || ownerId || null,
            estimate_version_no: estimate.version_no || estimate.version || null, current_stage: nextStage, requires_payment: nextRequiresPayment,
            last_rework_kind: null, submitted_snapshot_json: JSON.stringify(buildEstimateSnapshot(estimate)), submitted_at: new Date(), last_action_at: new Date(),
            last_actor_id: actor.id, last_comment: comment || null, source_type: sourceBinding.sourceType, source_id: sourceBinding.sourceId, finalized_at: null, cancelled_at: null
          });
        }
        updatedEstimate = await updateEstimateMirror(executor, estimate.id, {
          approval_status: 'sent', approval_comment: comment || null, reject_reason: null, sent_for_approval_at: new Date(),
          is_approved: false, approved_by: null, approved_at: null, decided_at: null, decided_by_user_id: null
        });
        await setTenderAwaitingApproval(executor, estimate);
        break;
      }

      case 'approve_to_accounting': {
        if (!request) throw makeError(409, 'Согласование по документу не найдено.');
        if (request.current_stage !== STAGES.DIRECTOR_REVIEW) throw makeError(409, 'Согласование доступно только на этапе директора.');
        if (!isDirectorRole(actor.role)) throw makeError(403, 'Только директор может выполнить это действие.');
        const requiresPayment = requestRequiresPayment(request);
        const decisionAt = new Date();
        nextStage = requiresPayment ? STAGES.ACCOUNTING_REVIEW : STAGES.APPROVED_FINAL;
        actionName = requiresPayment ? 'approve_to_accounting' : 'approve_director_final';
        request = await updateRequestRow(executor, request.id, { current_stage: nextStage, last_rework_kind: null, last_action_at: decisionAt, last_actor_id: actor.id, last_comment: comment || null, finalized_at: requiresPayment ? null : decisionAt, cancelled_at: null });
        updatedEstimate = await updateEstimateMirror(executor, estimate.id, requiresPayment ? {
          approval_status: 'accounting_review', approval_comment: comment || null, reject_reason: null, is_approved: false,
          approved_by: null, approved_at: null, decided_at: decisionAt, decided_by_user_id: actor.id
        } : {
          approval_status: 'approved', approval_comment: comment || null, reject_reason: null, is_approved: true,
          approved_by: actor.id, approved_at: decisionAt, decided_at: decisionAt, decided_by_user_id: actor.id
        });
        break;
      }
      case 'request_rework': {
        if (!request) throw makeError(409, 'Согласование по документу не найдено.');
        if (![STAGES.DIRECTOR_REVIEW, STAGES.ACCOUNTING_REVIEW].includes(request.current_stage)) throw makeError(409, 'Возврат доступен только на этапах директора или бухгалтерии.');
        if (!comment) throw makeError(400, reworkKind === 'question' ? 'Для действия "Вопрос" нужен комментарий.' : 'Для действия "На доработку" нужен комментарий.');
        if (request.current_stage === STAGES.DIRECTOR_REVIEW && !isDirectorRole(actor.role)) throw makeError(403, 'Только директор может вернуть документ на доработку на своем этапе.');
        if (request.current_stage === STAGES.ACCOUNTING_REVIEW && !isAccountingRole(actor.role)) throw makeError(403, 'Только бухгалтерия может вернуть документ на доработку на своем этапе.');
        nextStage = STAGES.PM_REWORK;
        request = await updateRequestRow(executor, request.id, { current_stage: nextStage, last_rework_kind: reworkKind, last_action_at: new Date(), last_actor_id: actor.id, last_comment: comment, finalized_at: null, cancelled_at: null });
        updatedEstimate = await updateEstimateMirror(executor, estimate.id, {
          approval_status: reworkKind === 'question' ? 'question' : 'rework', approval_comment: comment, reject_reason: null, is_approved: false,
          approved_by: null, approved_at: null, decided_at: new Date(), decided_by_user_id: actor.id
        });
        break;
      }

      case 'reject': {
        if (!request) throw makeError(409, 'Согласование по документу не найдено.');
        if (request.current_stage !== STAGES.DIRECTOR_REVIEW) throw makeError(409, 'Отклонение доступно только на этапе директора.');
        if (!isDirectorRole(actor.role)) throw makeError(403, 'Только директор может отклонить документ.');
        if (!comment) throw makeError(400, 'Укажите причину отклонения.');
        nextStage = STAGES.REJECTED;
        request = await updateRequestRow(executor, request.id, { current_stage: nextStage, last_action_at: new Date(), last_actor_id: actor.id, last_comment: comment, finalized_at: new Date(), cancelled_at: null });
        updatedEstimate = await updateEstimateMirror(executor, estimate.id, {
          approval_status: 'rejected', approval_comment: comment, reject_reason: comment, is_approved: false,
          approved_by: null, approved_at: null, decided_at: new Date(), decided_by_user_id: actor.id
        });
        break;
      }

      case 'accept_accounting': {
        if (!request) throw makeError(409, 'Согласование по документу не найдено.');
        if (request.current_stage !== STAGES.ACCOUNTING_REVIEW) throw makeError(409, 'Принятие доступно только на этапе бухгалтерии.');
        if (!isAccountingRole(actor.role)) throw makeError(403, 'Только бухгалтерия может принять документ.');
        nextStage = STAGES.PAYMENT_PENDING;
        request = await updateRequestRow(executor, request.id, { current_stage: nextStage, last_action_at: new Date(), last_actor_id: actor.id, last_comment: comment || null, finalized_at: null, cancelled_at: null });
        updatedEstimate = await updateEstimateMirror(executor, estimate.id, {
          approval_status: 'payment_pending', approval_comment: comment || null, reject_reason: null, is_approved: false,
          approved_by: null, approved_at: null, decided_at: new Date(), decided_by_user_id: actor.id
        });
        actionName = 'accept_accounting';
        break;
      }

      case 'mark_paid': {
        if (!request) throw makeError(409, 'Согласование по документу не найдено.');
        if (request.current_stage !== STAGES.PAYMENT_PENDING) throw makeError(409, 'Отметка оплаты доступна только после принятия бухгалтерией.');
        if (!isAccountingRole(actor.role)) throw makeError(403, 'Только бухгалтерия может отметить оплату.');
        if (!requestRequiresPayment(request)) throw makeError(409, 'Оплата не требуется для этого документа.');
        if (!comment) throw makeError(400, 'Комментарий к оплате обязателен.');
        paymentSlip = await persistPaymentSlip(executor, estimate, request, actor, params.paymentFile, comment);
        nextStage = STAGES.PAID;
        request = await updateRequestRow(executor, request.id, { current_stage: nextStage, last_action_at: new Date(), last_actor_id: actor.id, last_comment: comment, finalized_at: new Date(), cancelled_at: null });
        updatedEstimate = await updateEstimateMirror(executor, estimate.id, {
          approval_status: 'paid', approval_comment: comment, reject_reason: null, is_approved: true,
          approved_by: actor.id, approved_at: new Date(), decided_at: new Date(), decided_by_user_id: actor.id
        });
        actionName = 'mark_paid';
        break;
      }
      case 'cancel_by_pm': {
        if (!request) throw makeError(409, 'Нет активного согласования для отмены.');
        if (![STAGES.DIRECTOR_REVIEW, STAGES.PM_REWORK].includes(request.current_stage)) throw makeError(409, 'Отмена доступна только на этапах директора или доработки.');
        ensureEstimateOwner(actor, estimate);
        nextStage = STAGES.CANCELLED_BY_PM;
        request = await updateRequestRow(executor, request.id, { current_stage: nextStage, last_action_at: new Date(), last_actor_id: actor.id, last_comment: comment || null, finalized_at: new Date(), cancelled_at: new Date() });
        updatedEstimate = await updateEstimateMirror(executor, estimate.id, {
          approval_status: 'cancelled', approval_comment: comment || null, decided_at: new Date(), decided_by_user_id: actor.id,
          is_approved: false, approved_by: null, approved_at: null
        });
        break;
      }
      default:
        throw makeError(400, `Неподдерживаемое действие согласования: ${action}`);
    }


    const event = await insertApprovalEvent(executor, {
      requestId: request.id,
      estimateId: estimate.id,
      action: actionName,
      fromStage,
      toStage: nextStage,
      actor,
      comment,
      payload: {
        source: params.source || 'api',
        rework_kind: action === 'request_rework' ? reworkKind : null,
        final_stage: FINAL_STAGES.has(nextStage),
        requires_payment: requestRequiresPayment(request),
        source_type: request.source_type,
        source_id: request.source_id,
        payment_slip_id: paymentSlip?.id || null,
        document_id: paymentSlip?.documentId || null
      }
    });

    return { action: actionName, estimate: updatedEstimate, request, event, ownerId, paymentSlip };
  });

  const label = buildApprovalLabel(result.request, result.estimate);
  const link = approvalLink(result.estimate.id);

  if (result.action === 'submit' || result.action === 'resubmit') {
    const directorIds = (await loadDirectorIds(db)).filter((id) => id !== Number(actor.id));
    const title = result.request.source_type === 'tkp' ? 'ТКП на согласование' : 'Документ на согласование';
    const message = `${label}
Этап: директор
Оплата: ${requestRequiresPayment(result.request) ? 'требуется' : 'не требуется'}${comment ? `
Комментарий автора: ${comment}` : ''}`;
    await notifyActionableUsers(db, directorIds, title, message, link, { type: 'estimate', id: result.estimate.id, stage: 'director', requires_payment: requestRequiresPayment(result.request) });
  }

  if (result.request.current_stage === STAGES.ACCOUNTING_REVIEW) {
    const accountingIds = (await loadAccountingIds(db)).filter((id) => id !== Number(actor.id));
    const title = 'Документ на этапе бухгалтерии';
    const message = `${label}${comment ? `
Комментарий директора: ${comment}` : ''}`;
    await notifyActionableUsers(db, accountingIds, title, message, link, { type: 'estimate', id: result.estimate.id, stage: 'accounting' });
    if (result.ownerId && result.ownerId !== Number(actor.id)) {
      await notifyUsers(db, [result.ownerId], 'Согласование перешло в бухгалтерию', `${label}${comment ? ` · ${comment}` : ''}`, link);
    }
  }
  if (result.action === 'request_rework') {
    const title = result.request.last_rework_kind === 'question' ? 'Вопрос по документу' : 'Документ возвращен на доработку';
    if (result.ownerId && result.ownerId !== Number(actor.id)) {
      await notifyUsers(db, [result.ownerId], title, `${label}${comment ? ` · ${comment}` : ''}`, link);
    }
  }
  if (result.action === 'reject') {
    if (result.ownerId && result.ownerId !== Number(actor.id)) {
      await notifyUsers(db, [result.ownerId], 'Документ отклонен', `${label}${comment ? ` · ${comment}` : ''}`, link);
    }
  }
  if (result.action === 'approve_director_final') {
    if (result.ownerId && result.ownerId !== Number(actor.id)) {
      await notifyUsers(db, [result.ownerId], 'Документ согласован', `${label}${comment ? ` · ${comment}` : ''}`, link);
    }
  }
  if (result.action === 'accept_accounting') {
    const participantIds = (await loadParticipantIds(db, result.request.id)).filter((id) => id !== Number(actor.id));
    await notifyUsers(db, participantIds, 'Документ принят бухгалтерией', `${label}${comment ? ` · ${comment}` : ''}`, link);
  }
  if (result.action === 'mark_paid') {
    const participantIds = await loadParticipantIds(db, result.request.id);
    const fileNote = result.paymentSlip?.originalName ? `
Платежка: ${result.paymentSlip.originalName}` : '';
    await notifyUsers(db, participantIds, 'Документ оплачен', `${label}${comment ? ` · ${comment}` : ''}${fileNote}`, link);
  }
  if (result.action === 'cancel_by_pm') {
    const directorIds = await loadDirectorIds(db);
    await notifyUsers(db, directorIds, 'Согласование отменено', `${label}${comment ? ` · ${comment}` : ''}`, link, `estimate-approval-${result.estimate.id}`);
  }
  return result;
}

async function submit(db, params) { return transition(db, { ...params, action: 'submit' }); }
async function resubmit(db, params) { return transition(db, { ...params, action: 'resubmit' }); }
async function approveToAccounting(db, params) { return transition(db, { ...params, action: 'approve_to_accounting' }); }
async function requestRework(db, params) { return transition(db, { ...params, action: 'request_rework' }); }
async function reject(db, params) { return transition(db, { ...params, action: 'reject' }); }
async function acceptAccounting(db, params) { return transition(db, { ...params, action: 'accept_accounting' }); }
async function markPaid(db, params) { return transition(db, { ...params, action: 'mark_paid' }); }
async function cancelByPm(db, params) { return transition(db, { ...params, action: 'cancel_by_pm' }); }

async function applyLegacyMutation(db, params) {
  const requestedStatus = normalizeLegacyStatus(params.patch?.approval_status);
  const comment = params.patch?.approval_comment || params.patch?.reject_reason || params.patch?.comment || '';
  const request = await getApprovalRequest(db, params.estimateId);
  if (!requestedStatus) throw makeError(409, 'Не указан статус согласования.');
  if (requestedStatus === 'draft') throw makeError(409, 'Возврат в черновик через действие согласования недоступен.');
  if (requestedStatus === 'sent' || requestedStatus === 'pending') {
    return submit(db, {
      ...params,
      comment,
      requiresPayment: extractRequiresPayment(params.patch || {}),
      sourceType: params.patch?.source_type,
      sourceId: params.patch?.source_id
    });
  }
  if (requestedStatus === 'payment_pending') return acceptAccounting(db, { ...params, comment });
  if (requestedStatus === 'approved_final' || requestedStatus === 'approved') {
    if (request?.current_stage === STAGES.ACCOUNTING_REVIEW) return acceptAccounting(db, { ...params, comment });
    if (request?.current_stage === STAGES.PAYMENT_PENDING) {
      throw makeError(409, 'После принятия бухгалтерией завершение возможно только через этап оплаты.');
    }
    return approveToAccounting(db, { ...params, comment });
  }
  if (requestedStatus === 'paid') throw makeError(409, 'Статус "Оплачено" можно установить только с файлом платежки.');
  if (requestedStatus === 'rework' || requestedStatus === 'question') {
    return requestRework(db, { ...params, comment, reworkKind: requestedStatus === 'question' ? 'question' : 'rework' });
  }
  if (requestedStatus === 'rejected') return reject(db, { ...params, comment });
  if (requestedStatus === 'cancelled' || requestedStatus === 'canceled') return cancelByPm(db, { ...params, comment });
  throw makeError(409, `Статус ${requestedStatus} не поддерживается действием согласования.`);
}

module.exports = {
  STAGES,
  FINAL_STAGES,
  APPROVAL_MUTATION_FIELDS,
  normalizeLegacyStatus,
  isDirectorRole,
  isAccountingRole,
  isPmActorRole,
  getRequesterId,
  mapRequestToLegacyStatus,
  getApprovalRequest,
  getApprovalDetails,
  getPaymentSlips,
  submit,
  resubmit,
  approveToAccounting,
  requestRework,
  reject,
  acceptAccounting,
  markPaid,
  cancelByPm,
  applyLegacyMutation,
  normalizeRequiresPayment,
  extractRequiresPayment,
  requestRequiresPayment
};
