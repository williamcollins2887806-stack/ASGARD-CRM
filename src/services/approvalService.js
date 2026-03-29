'use strict';

/**
 * ASGARD CRM — Универсальный модуль согласований
 * ═══════════════════════════════════════════════════════════════
 * 
 * Единый маршрут для всех сущностей, требующих согласования.
 * 
 * МАРШРУТ БЕЗ ОПЛАТЫ (requires_payment = false):
 *   инициатор → директор [Согласовать / Доработка / Вопрос / Отклонить] → готово
 * 
 * МАРШРУТ С ОПЛАТОЙ (requires_payment = true):
 *   инициатор → директор [Согласовать / Доработка / Вопрос / Отклонить] → 
 *   бухгалтерия [Оплатить ПП / Выдать наличные / Доработка / Вопрос] →
 *     ├─ ПП: бухгалтер прикладывает платёжку → «Оплачено» → готово
 *     └─ Наличные: видит баланс кассы → вводит сумму + комментарий →
 *        касса уменьшается → уведомление инициатору →
 *        инициатор подтверждает получение → тратит → прикладывает чеки → готово
 * 
 * СУЩНОСТИ (12 с requires_payment):
 *   cash_requests, pre_tender_requests, bonus_requests,
 *   work_expenses, office_expenses, expenses,
 *   one_time_payments, procurement_requests, payroll_sheets,
 *   business_trips, travel_expenses, training_applications
 * 
 * СУЩНОСТИ (7 без requires_payment — только директор):
 *   estimates, tkp, staff_requests, pass_requests,
 *   permit_applications, site_inspections, seal_transfers
 */

const { createNotification } = require('./notify');

// Ленивая загрузка telegram (избежать circular dependency)
function getTelegram() {
  try { return require('./telegram'); } catch (e) { return null; }
}

/**
 * Отправить уведомление с кнопками согласования в Telegram.
 * Для директора: 4 кнопки (Согласовать/Доработка/Вопрос/Отклонить)
 * Для бухгалтерии: 4 кнопки (ПП/Наличные/Доработка/Вопрос)
 */
function sendApprovalTelegram(userId, label, message, approvalData) {
  const tg = getTelegram();
  if (!tg || !tg.sendApprovalRequest) return;
  // Fire-and-forget: don't await Telegram (can timeout 30s+ and block API response)
  tg.sendApprovalRequest(userId, `🔔 *${label}*\n\n${message}`, approvalData)
    .catch(() => { /* telegram optional */ });
}

/**
 * Вызывается при отправке сущности на согласование директору.
 * Можно вызывать из любого route при смене статуса на pending/requested/sent.
 */
async function notifyDirectorsForApproval(db, { entityType, entityId, actorName, title, message, requiresPayment }) {
  const directors = await db.query(
    "SELECT id FROM users WHERE role IN ('ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active = true"
  );
  const label = title || `${getLabel(entityType)} #${entityId}`;
  const msg = message || `${actorName || 'Сотрудник'} отправил на согласование`;
  for (const dir of directors.rows) {
    createNotification(db, {
      user_id: dir.id, title: label, message: msg, type: 'approval',
      link: `#/${entityType}?id=${entityId}`
    });
    await sendApprovalTelegram(dir.id, label, msg, {
      type: entityType, id: entityId, stage: 'director', requires_payment: !!requiresPayment
    });
  }
}

/**
 * Уведомить бухгалтерию с кнопками оплаты.
 */
async function notifyBuhForPayment(db, { entityType, entityId, actorName, title, message }) {
  const buhUsers = await db.query("SELECT id FROM users WHERE role = 'BUH' AND is_active = true");
  const label = title || `${getLabel(entityType)} #${entityId} — ожидает оплаты`;
  const msg = message || `${actorName || 'Директор'} согласовал. Требуется оплата.`;
  for (const buh of buhUsers.rows) {
    createNotification(db, {
      user_id: buh.id, title: label, message: msg, type: 'approval',
      link: `#/${entityType}?id=${entityId}`
    });
    await sendApprovalTelegram(buh.id, label, msg, {
      type: entityType, id: entityId, stage: 'accounting'
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Константы
// ─────────────────────────────────────────────────────────────────

// SQL injection protection: таблицы, разрешённые для операций через approvalService
// Должен совпадать с ALLOWED_ENTITIES из approval.js (belt + suspenders)
const SAFE_TABLES = new Set([
  'cash_requests', 'pre_tender_requests', 'bonus_requests',
  'work_expenses', 'office_expenses', 'expenses',
  'one_time_payments', 'procurement_requests', 'payroll_sheets',
  'business_trips', 'travel_expenses', 'training_applications',
  'estimates', 'tkp', 'staff_requests', 'pass_requests',
  'permit_applications', 'site_inspections', 'seal_transfers'
]);

const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const BUH_ROLES = ['BUH', 'ADMIN'];

// ─── Матрица допустимых переходов статусов для estimates ───
const ESTIMATE_TRANSITIONS = {
  draft:     ['sent'],
  sent:      ['approved', 'rework', 'question', 'rejected'],
  rework:    ['sent'],
  question:  ['sent'],
  rejected:  [],       // терминальный
  approved:  [],       // терминальный
  cancelled: []        // терминальный
};

/**
 * Проверяет допустимость перехода статуса для estimates.
 * Бросает ошибку 409 если переход недопустим.
 */
function validateEstimateTransition(currentStatus, newStatus) {
  const from = String(currentStatus || 'draft').toLowerCase();
  const allowed = ESTIMATE_TRANSITIONS[from];
  if (!allowed || !allowed.includes(newStatus)) {
    throw Object.assign(
      new Error(`Недопустимый переход статуса: ${from} → ${newStatus}`),
      { statusCode: 409 }
    );
  }
}

const PAYMENT_STATUSES = {
  PENDING: 'pending_payment',    // ждёт бухгалтерию
  PAID_BANK: 'paid',            // оплачено через ПП
  CASH_ISSUED: 'cash_issued',   // наличные выданы
  CASH_RECEIVED: 'cash_received', // инициатор подтвердил получение
  EXPENSE_REPORTED: 'expense_reported', // отчёт о расходах приложен
  REWORK: 'rework',             // бухгалтерия вернула на доработку
  QUESTION: 'question'          // бухгалтерия задала вопрос
};

// Русские названия сущностей для уведомлений
const ENTITY_LABELS = {
  cash_requests: 'Заявка на аванс',
  pre_tender_requests: 'Пред-тендерная заявка',
  bonus_requests: 'Запрос на премию',
  work_expenses: 'Расход по работе',
  office_expenses: 'Офисный расход',
  expenses: 'Расход',
  one_time_payments: 'Разовая выплата',
  procurement_requests: 'Заявка на закупку',
  payroll_sheets: 'Ведомость ЗП',
  business_trips: 'Командировка',
  travel_expenses: 'Командировочный расход',
  training_applications: 'Заявка на обучение',
  estimates: 'Просчёт',
  tkp: 'ТКП',
  staff_requests: 'Заявка на персонал',
  pass_requests: 'Заявка на пропуск',
  permit_applications: 'Заявка на допуск',
  site_inspections: 'Акт осмотра',
  seal_transfers: 'Передача печати'
};

// Маппинг сущность → поле статуса (у большинства 'status')
const STATUS_FIELD = {
  tenders: 'tender_status',
  works: 'work_status',
  estimates: 'approval_status'
  // все остальные: 'status'
};

// Маппинг логических полей → реальные колонки в каждой таблице
// null = колонка отсутствует (не писать в SQL)
const COLUMN_MAP = {
  cash_requests:          { approved_by: 'director_id',     approved_at: null,            comment_field: 'director_comment' },
  pre_tender_requests:    { approved_by: 'decision_by',     approved_at: 'decision_at',   comment_field: 'decision_comment' },
  bonus_requests:         { approved_by: 'approved_by',     approved_at: 'approved_at',   comment_field: 'director_comment' },
  work_expenses:          { approved_by: 'approved_by',     approved_at: null,            comment_field: null },
  office_expenses:        { approved_by: 'approved_by',     approved_at: 'approved_at',   comment_field: null },
  expenses:               { approved_by: null,              approved_at: 'approved_at',   comment_field: null },
  one_time_payments:      { approved_by: 'approved_by',     approved_at: 'approved_at',   comment_field: 'director_comment' },
  procurement_requests:   { approved_by: 'dir_approved_by', approved_at: 'dir_approved_at', comment_field: null },
  payroll_sheets:         { approved_by: 'approved_by',     approved_at: 'approved_at',   comment_field: 'director_comment' },
  business_trips:         { approved_by: 'approved_by',     approved_at: 'approved_at',   comment_field: null },
  travel_expenses:        { approved_by: 'approved_by',     approved_at: 'approved_at',   comment_field: null },
  training_applications:  { approved_by: 'approved_by_dir', approved_at: 'approved_by_dir_at', comment_field: null },
  // Простые сущности без оплаты
  estimates:              { approved_by: 'approved_by',     approved_at: 'approved_at',   comment_field: 'approval_comment' },
  tkp:                    { approved_by: 'approved_by',     approved_at: 'approved_at',   comment_field: null },
  staff_requests:         { approved_by: null,              approved_at: null,            comment_field: null },
  pass_requests:          { approved_by: 'approved_by',     approved_at: 'approved_at',   comment_field: null },
  permit_applications:    { approved_by: 'approved_by',     approved_at: null,            comment_field: null },
  site_inspections:       { approved_by: 'approved_by',     approved_at: 'approved_at',   comment_field: null },
  seal_transfers:         { approved_by: 'approved_by',     approved_at: 'approved_at',   comment_field: null }
};

function getStatusField(entityType) {
  return STATUS_FIELD[entityType] || 'status';
}

function getColumns(entityType) {
  return COLUMN_MAP[entityType] || { approved_by: 'approved_by', approved_at: 'approved_at', comment_field: null };
}

/**
 * Строит безопасный UPDATE с учётом реальных колонок таблицы.
 * Принимает объект { col_name: value } — null-значения пропускаются.
 * Возвращает { sql, values }.
 */
function buildUpdate(entityType, entityId, fields) {
  // SQL injection hardening: проверка entityType по белому списку
  if (!SAFE_TABLES.has(entityType)) {
    throw new Error(`Invalid entity type: ${entityType}`);
  }

  const setParts = [];
  const values = [];
  let idx = 1;

  for (const [col, val] of Object.entries(fields)) {
    if (col === null || val === undefined) continue;
    if (val === '__NOW__') {
      setParts.push(`${col} = NOW()`);
    } else {
      setParts.push(`${col} = $${idx}`);
      values.push(val);
      idx++;
    }
  }

  setParts.push('updated_at = NOW()');
  values.push(entityId);

  const sql = `UPDATE ${entityType} SET ${setParts.join(', ')} WHERE id = $${idx} RETURNING *`;
  return { sql, values };
}

function isDirector(role) {
  return DIRECTOR_ROLES.includes(role);
}

function isBuh(role) {
  return BUH_ROLES.includes(role);
}

function getLabel(entityType) {
  return ENTITY_LABELS[entityType] || entityType;
}

// ─────────────────────────────────────────────────────────────────
// Действие 1: Директор согласовывает
// ─────────────────────────────────────────────────────────────────
async function directorApprove(db, { entityType, entityId, actor, comment }) {
  if (!isDirector(actor.role)) {
    throw Object.assign(new Error('Только директор может согласовать'), { statusCode: 403 });
  }

  const statusField = getStatusField(entityType);
  const cols = getColumns(entityType);
  const record = await getRecord(db, entityType, entityId);
  if (!record) throw Object.assign(new Error('Запись не найдена'), { statusCode: 404 });

  // Проверка допустимости перехода для estimates
  if (entityType === 'estimates') {
    validateEstimateTransition(record[statusField], 'approved');
  }

  const requiresPayment = !!record.requires_payment;
  const label = `${getLabel(entityType)} #${entityId}`;

  // Оборачиваем в транзакцию: UPDATE + уведомления
  const useTransaction = typeof db.connect === 'function';
  const client = useTransaction ? await db.connect() : db;
  try {
    if (useTransaction) await client.query('BEGIN');

    // Собираем поля для UPDATE динамически
    const fields = {};
    fields[statusField] = 'approved';
    if (entityType === 'estimates') fields.is_approved = true;
    if (cols.approved_by) fields[cols.approved_by] = actor.id;
    if (cols.approved_at) fields[cols.approved_at] = '__NOW__';
    if (comment && cols.comment_field) fields[cols.comment_field] = comment;
    if (requiresPayment) fields.payment_status = PAYMENT_STATUSES.PENDING;

    const { sql, values } = buildUpdate(entityType, entityId, fields);
    await client.query(sql, values);

    // Audit log
    await writeAuditLog(client, actor.id, entityType, entityId, 'approval_approve', {
      from_status: record[statusField],
      to_status: 'approved',
      comment: comment || null,
      requires_payment: requiresPayment
    });

    // Потоковый комментарий
    if (comment) {
      await writeApprovalComment(client, entityType, entityId, actor.id, 'approve', comment);
    }

    // Обновить director_id и last_director_comment для estimates
    if (entityType === 'estimates') {
      const dirFields = { director_id: actor.id };
      if (comment) dirFields.last_director_comment = comment;
      const { sql: dirSql, values: dirVals } = buildUpdate('estimates', entityId, dirFields);
      await client.query(dirSql, dirVals);
    }

    if (requiresPayment) {
      // Уведомляем бухгалтерию С КНОПКАМИ
      await notifyBuhForPayment(client, {
        entityType, entityId,
        actorName: actor.name,
        title: `💰 ${label} — ожидает оплаты`,
        message: `${actor.name || 'Директор'} согласовал. Требуется оплата.${comment ? ' Комментарий: ' + comment : ''}`
      });

      // Уведомляем инициатора (простой текст)
      const initiatorId = getInitiatorId(record, entityType);
      if (initiatorId && initiatorId !== actor.id) {
        createNotification(client, {
          user_id: initiatorId,
          title: `✅ ${label} — согласовано, передано в бухгалтерию`,
          message: `${actor.name || 'Директор'} согласовал. Ожидает оплаты.`,
          type: 'approval',
          link: `#/${entityType}?id=${entityId}`
        });
      }

      if (useTransaction) await client.query('COMMIT');
      return { status: 'approved', payment_status: PAYMENT_STATUSES.PENDING };
    } else {
      const initiatorId = getInitiatorId(record, entityType);
      if (initiatorId && initiatorId !== actor.id) {
        createNotification(client, {
          user_id: initiatorId,
          title: `✅ ${label} — согласовано`,
          message: `${actor.name || 'Директор'} согласовал.${comment ? ' ' + comment : ''}`,
          type: 'approval',
          link: `#/${entityType}?id=${entityId}`
        });
      }

      if (useTransaction) await client.query('COMMIT');
      return { status: 'approved' };
    }
  } catch (err) {
    if (useTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (useTransaction) client.release();
  }
}

// ─────────────────────────────────────────────────────────────────
// Действие 2: Директор/Бухгалтер — на доработку
// ─────────────────────────────────────────────────────────────────
async function requestRework(db, { entityType, entityId, actor, comment }) {
  if (!comment || !comment.trim()) {
    throw Object.assign(new Error('Укажите комментарий для доработки'), { statusCode: 400 });
  }
  if (!isDirector(actor.role) && !isBuh(actor.role)) {
    throw Object.assign(new Error('Нет прав для этого действия'), { statusCode: 403 });
  }

  const statusField = getStatusField(entityType);
  const cols = getColumns(entityType);
  const record = await getRecord(db, entityType, entityId);
  if (!record) throw Object.assign(new Error('Запись не найдена'), { statusCode: 404 });

  // Проверка допустимости перехода для estimates
  if (entityType === 'estimates') {
    validateEstimateTransition(record[statusField], 'rework');
  }

  const isBuhAction = isBuh(actor.role) && record.payment_status === PAYMENT_STATUSES.PENDING;
  const label = `${getLabel(entityType)} #${entityId}`;

  const fields = {};
  if (isBuhAction) {
    fields.payment_status = PAYMENT_STATUSES.REWORK;
    fields.payment_comment = comment.trim();
    fields.buh_id = actor.id;
    fields.buh_acted_at = '__NOW__';
  } else {
    fields[statusField] = 'rework';
    if (cols.comment_field) fields[cols.comment_field] = comment.trim();
  }

  const { sql, values } = buildUpdate(entityType, entityId, fields);
  await db.query(sql, values);

  // Audit log
  const newStatus = isBuhAction ? 'rework_buh' : 'rework';
  await writeAuditLog(db, actor.id, entityType, entityId, 'approval_rework', {
    from_status: record[statusField],
    to_status: newStatus,
    comment: comment.trim(),
    requires_payment: !!record.requires_payment
  });

  // Потоковый комментарий
  await writeApprovalComment(db, entityType, entityId, actor.id, 'rework', comment.trim());

  // Обновить director_id и last_director_comment для estimates
  if (entityType === 'estimates' && !isBuhAction) {
    const dirFields = { director_id: actor.id, last_director_comment: comment.trim() };
    const { sql: dirSql, values: dirVals } = buildUpdate('estimates', entityId, dirFields);
    await db.query(dirSql, dirVals);
  }

  const initiatorId = getInitiatorId(record, entityType);
  if (initiatorId && initiatorId !== actor.id) {
    const who = isBuhAction ? 'Бухгалтерия' : 'Директор';
    createNotification(db, {
      user_id: initiatorId,
      title: `🔄 ${label} — на доработку`,
      message: `${who} (${actor.name || ''}): ${comment.trim()}`,
      type: 'approval',
      link: `#/${entityType}?id=${entityId}`
    });
  }

  return { status: newStatus };
}

// ─────────────────────────────────────────────────────────────────
// Действие 3: Директор/Бухгалтер — вопрос
// ─────────────────────────────────────────────────────────────────
async function askQuestion(db, { entityType, entityId, actor, comment }) {
  if (!comment || !comment.trim()) {
    throw Object.assign(new Error('Введите вопрос'), { statusCode: 400 });
  }
  if (!isDirector(actor.role) && !isBuh(actor.role)) {
    throw Object.assign(new Error('Нет прав для этого действия'), { statusCode: 403 });
  }

  const statusField = getStatusField(entityType);
  const cols = getColumns(entityType);
  const record = await getRecord(db, entityType, entityId);
  if (!record) throw Object.assign(new Error('Запись не найдена'), { statusCode: 404 });

  // Проверка допустимости перехода для estimates
  if (entityType === 'estimates') {
    validateEstimateTransition(record[statusField], 'question');
  }

  const isBuhAction = isBuh(actor.role) && record.payment_status === PAYMENT_STATUSES.PENDING;
  const label = `${getLabel(entityType)} #${entityId}`;

  const fields = {};
  if (isBuhAction) {
    fields.payment_status = PAYMENT_STATUSES.QUESTION;
    fields.payment_comment = comment.trim();
    fields.buh_id = actor.id;
    fields.buh_acted_at = '__NOW__';
  } else {
    fields[statusField] = 'question';
    if (cols.comment_field) fields[cols.comment_field] = comment.trim();
  }

  const { sql, values } = buildUpdate(entityType, entityId, fields);
  await db.query(sql, values);

  // Audit log
  const newStatus = isBuhAction ? 'question_buh' : 'question';
  await writeAuditLog(db, actor.id, entityType, entityId, 'approval_question', {
    from_status: record[statusField],
    to_status: newStatus,
    comment: comment.trim(),
    requires_payment: !!record.requires_payment
  });

  // Потоковый комментарий
  await writeApprovalComment(db, entityType, entityId, actor.id, 'question', comment.trim());

  // Обновить director_id и last_director_comment для estimates
  if (entityType === 'estimates' && !isBuhAction) {
    const dirFields = { director_id: actor.id, last_director_comment: comment.trim() };
    const { sql: dirSql, values: dirVals } = buildUpdate('estimates', entityId, dirFields);
    await db.query(dirSql, dirVals);
  }

  const initiatorId = getInitiatorId(record, entityType);
  if (initiatorId && initiatorId !== actor.id) {
    const who = isBuhAction ? 'Бухгалтерия' : 'Директор';
    createNotification(db, {
      user_id: initiatorId,
      title: `❓ ${label} — вопрос`,
      message: `${who} (${actor.name || ''}): ${comment.trim()}`,
      type: 'approval',
      link: `#/${entityType}?id=${entityId}`
    });
  }

  return { status: newStatus };
}

// ─────────────────────────────────────────────────────────────────
// Действие 4: Директор отклоняет
// ─────────────────────────────────────────────────────────────────
async function directorReject(db, { entityType, entityId, actor, comment }) {
  if (!isDirector(actor.role)) {
    throw Object.assign(new Error('Только директор может отклонить'), { statusCode: 403 });
  }
  if (!comment || !comment.trim()) {
    throw Object.assign(new Error('Укажите причину отклонения'), { statusCode: 400 });
  }

  const statusField = getStatusField(entityType);
  const cols = getColumns(entityType);
  const record = await getRecord(db, entityType, entityId);
  if (!record) throw Object.assign(new Error('Запись не найдена'), { statusCode: 404 });

  // Проверка допустимости перехода для estimates
  if (entityType === 'estimates') {
    validateEstimateTransition(record[statusField], 'rejected');
  }

  const fields = {};
  fields[statusField] = 'rejected';
  if (cols.comment_field) fields[cols.comment_field] = comment.trim();

  const { sql, values } = buildUpdate(entityType, entityId, fields);
  await db.query(sql, values);

  // Audit log
  await writeAuditLog(db, actor.id, entityType, entityId, 'approval_reject', {
    from_status: record[statusField],
    to_status: 'rejected',
    comment: comment.trim(),
    requires_payment: !!record.requires_payment
  });

  // Потоковый комментарий
  await writeApprovalComment(db, entityType, entityId, actor.id, 'reject', comment.trim());

  // Обновить director_id и last_director_comment для estimates
  if (entityType === 'estimates') {
    const dirFields = { director_id: actor.id, last_director_comment: comment.trim() };
    const { sql: dirSql, values: dirVals } = buildUpdate('estimates', entityId, dirFields);
    await db.query(dirSql, dirVals);
  }

  const label = `${getLabel(entityType)} #${entityId}`;
  const initiatorId = getInitiatorId(record, entityType);
  if (initiatorId && initiatorId !== actor.id) {
    createNotification(db, {
      user_id: initiatorId,
      title: `❌ ${label} — отклонено`,
      message: `${actor.name || 'Директор'}: ${comment.trim()}`,
      type: 'approval',
      link: `#/${entityType}?id=${entityId}`
    });
  }

  return { status: 'rejected' };
}

// ─────────────────────────────────────────────────────────────────
// Действие 4.5: PM переотправляет после доработки/вопроса
// ─────────────────────────────────────────────────────────────────
async function resubmit(db, { entityType, entityId, actor }) {
  const statusField = getStatusField(entityType);
  const record = await getRecord(db, entityType, entityId);
  if (!record) throw Object.assign(new Error('Запись не найдена'), { statusCode: 404 });

  // Проверяем что actor = инициатор (pm_id или created_by) или ADMIN
  const initiatorId = getInitiatorId(record, entityType);
  if (Number(actor.id) !== Number(initiatorId) && actor.role !== 'ADMIN') {
    throw Object.assign(new Error('Только инициатор может переотправить'), { statusCode: 403 });
  }

  // Текущий статус должен быть rework или question
  const currentStatus = String(record[statusField] || '').toLowerCase();
  if (!['rework', 'question'].includes(currentStatus)) {
    throw Object.assign(
      new Error(`Переотправка доступна только из статуса "rework" или "question", текущий: ${currentStatus}`),
      { statusCode: 409 }
    );
  }

  // Проверка по матрице переходов
  if (entityType === 'estimates') {
    validateEstimateTransition(currentStatus, 'sent');
  }

  const fields = {};
  fields[statusField] = 'sent';
  fields.sent_for_approval_at = '__NOW__';

  const { sql, values } = buildUpdate(entityType, entityId, fields);
  await db.query(sql, values);

  // Потоковый комментарий
  await writeApprovalComment(db, entityType, entityId, actor.id, 'resubmit', 'Переотправлено после доработки');

  // Уведомляем директоров
  const label = `${getLabel(entityType)} #${entityId}`;
  await notifyDirectorsForApproval(db, {
    entityType, entityId,
    actorName: actor.name,
    title: `📋 ${label} — повторная отправка`,
    message: `${actor.name || 'РП'} переотправил ${getLabel(entityType)} #${entityId} после доработки`,
    requiresPayment: false
  });

  return { status: 'sent' };
}

// ─────────────────────────────────────────────────────────────────
// Действие 5: Бухгалтерия — оплатить через ПП
// ─────────────────────────────────────────────────────────────────
async function payByBankTransfer(db, { entityType, entityId, actor, comment, documentId }) {
  if (!isBuh(actor.role)) {
    throw Object.assign(new Error('Только бухгалтерия может оплатить'), { statusCode: 403 });
  }

  const record = await getRecord(db, entityType, entityId);
  if (!record) throw Object.assign(new Error('Запись не найдена'), { statusCode: 404 });
  if (record.payment_status !== PAYMENT_STATUSES.PENDING) {
    throw Object.assign(new Error('Оплата доступна только на этапе бухгалтерии'), { statusCode: 409 });
  }

  await db.query(
    `UPDATE ${entityType} SET 
     payment_method = 'bank_transfer',
     payment_status = 'paid',
     payment_comment = $1,
     payment_doc_id = $2,
     buh_id = $3,
     buh_acted_at = NOW(),
     updated_at = NOW()
     WHERE id = $4`,
    [comment || null, documentId || null, actor.id, entityId]
  );

  const label = `${getLabel(entityType)} #${entityId}`;
  const initiatorId = getInitiatorId(record, entityType);
  if (initiatorId && initiatorId !== actor.id) {
    createNotification(db, {
      user_id: initiatorId,
      title: `💳 ${label} — оплачено через ПП`,
      message: `Бухгалтерия (${actor.name || ''}) оплатила.${comment ? ' ' + comment : ''}`,
      type: 'approval',
      link: `#/${entityType}?id=${entityId}`
    });
  }

  // Уведомляем директоров
  await notifyDirectors(db, actor.id,
    `💳 ${label} — оплачено`,
    `Бухгалтерия (${actor.name || ''}) оплатила через ПП.`
  );

  return { status: 'paid', payment_method: 'bank_transfer' };
}

// ─────────────────────────────────────────────────────────────────
// Действие 6: Бухгалтерия — выдать наличные
// ─────────────────────────────────────────────────────────────────
async function issueCash(db, { entityType, entityId, actor, amount, comment }) {
  if (!isBuh(actor.role)) {
    throw Object.assign(new Error('Только бухгалтерия может выдать наличные'), { statusCode: 403 });
  }
  if (!amount || amount <= 0) {
    throw Object.assign(new Error('Укажите сумму выдачи'), { statusCode: 400 });
  }

  const record = await getRecord(db, entityType, entityId);
  if (!record) throw Object.assign(new Error('Запись не найдена'), { statusCode: 404 });
  if (record.payment_status !== PAYMENT_STATUSES.PENDING) {
    throw Object.assign(new Error('Выдача наличных доступна только на этапе бухгалтерии'), { statusCode: 409 });
  }

  // Проверяем баланс кассы
  const balanceResult = await db.query(
    'SELECT amount FROM cash_balance_log ORDER BY created_at DESC, id DESC LIMIT 1'
  );
  const currentBalance = balanceResult.rows[0] ? parseFloat(balanceResult.rows[0].amount) : 0;

  if (amount > currentBalance) {
    throw Object.assign(
      new Error(`Недостаточно средств в кассе. Баланс: ${currentBalance.toLocaleString('ru-RU')} ₽, запрошено: ${amount.toLocaleString('ru-RU')} ₽`),
      { statusCode: 400, balance: currentBalance }
    );
  }

  // Списываем из кассы
  const newBalance = currentBalance - amount;
  await db.query(
    `INSERT INTO cash_balance_log (amount, change_amount, change_type, description, related_request_id, user_id)
     VALUES ($1, $2, 'cash_issued', $3, $4, $5)`,
    [newBalance, -amount, `Выдача по ${getLabel(entityType)} #${entityId}`, entityId, actor.id]
  );

  // Обновляем запись
  await db.query(
    `UPDATE ${entityType} SET
     payment_method = 'cash',
     payment_status = $1,
     payment_comment = $2,
     buh_id = $3,
     buh_acted_at = NOW(),
     updated_at = NOW()
     WHERE id = $4`,
    [PAYMENT_STATUSES.CASH_ISSUED, comment || `Выдано ${amount} ₽ наличными`, actor.id, entityId]
  );

  const label = `${getLabel(entityType)} #${entityId}`;
  const initiatorId = getInitiatorId(record, entityType);

  // Уведомляем инициатора — получите наличные
  if (initiatorId) {
    createNotification(db, {
      user_id: initiatorId,
      title: `💵 ${label} — получите наличные в бухгалтерии`,
      message: `${actor.name || 'Бухгалтер'} выдал ${amount.toLocaleString('ru-RU')} ₽.${comment ? ' ' + comment : ''} Подтвердите получение.`,
      type: 'cash',
      link: `#/${entityType}?id=${entityId}`
    });
  }

  // Уведомляем директоров
  await notifyDirectors(db, actor.id,
    `💵 Выдано из кассы: ${amount.toLocaleString('ru-RU')} ₽`,
    `${label}. Баланс кассы: ${newBalance.toLocaleString('ru-RU')} ₽`
  );

  return {
    status: PAYMENT_STATUSES.CASH_ISSUED,
    payment_method: 'cash',
    amount_issued: amount,
    cash_balance: newBalance
  };
}

// ─────────────────────────────────────────────────────────────────
// Действие 7: Инициатор подтверждает получение наличных
// ─────────────────────────────────────────────────────────────────
async function confirmCashReceived(db, { entityType, entityId, actor }) {
  const record = await getRecord(db, entityType, entityId);
  if (!record) throw Object.assign(new Error('Запись не найдена'), { statusCode: 404 });

  const initiatorId = getInitiatorId(record, entityType);
  if (Number(actor.id) !== Number(initiatorId) && actor.role !== 'ADMIN') {
    throw Object.assign(new Error('Только инициатор может подтвердить получение'), { statusCode: 403 });
  }
  if (record.payment_status !== PAYMENT_STATUSES.CASH_ISSUED) {
    throw Object.assign(new Error('Подтверждение доступно только после выдачи наличных'), { statusCode: 409 });
  }

  await db.query(
    `UPDATE ${entityType} SET payment_status = $1, updated_at = NOW() WHERE id = $2`,
    [PAYMENT_STATUSES.CASH_RECEIVED, entityId]
  );

  const label = `${getLabel(entityType)} #${entityId}`;

  // Уведомляем бухгалтера
  if (record.buh_id) {
    createNotification(db, {
      user_id: record.buh_id,
      title: `✅ ${label} — получение подтверждено`,
      message: `${actor.name || 'Сотрудник'} подтвердил получение наличных.`,
      type: 'cash',
      link: `#/${entityType}?id=${entityId}`
    });
  }

  return { status: PAYMENT_STATUSES.CASH_RECEIVED };
}

// ─────────────────────────────────────────────────────────────────
// Действие 8: Инициатор прикладывает отчёт о расходах
// ─────────────────────────────────────────────────────────────────
async function submitExpenseReport(db, { entityType, entityId, actor, comment, documentId }) {
  const record = await getRecord(db, entityType, entityId);
  if (!record) throw Object.assign(new Error('Запись не найдена'), { statusCode: 404 });

  const initiatorId = getInitiatorId(record, entityType);
  if (Number(actor.id) !== Number(initiatorId) && actor.role !== 'ADMIN') {
    throw Object.assign(new Error('Только инициатор может подать отчёт'), { statusCode: 403 });
  }
  if (record.payment_status !== PAYMENT_STATUSES.CASH_RECEIVED) {
    throw Object.assign(new Error('Отчёт доступен только после подтверждения получения'), { statusCode: 409 });
  }

  await db.query(
    `UPDATE ${entityType} SET payment_status = $1, 
     payment_comment = COALESCE(payment_comment, '') || E'\n' || $2,
     payment_doc_id = COALESCE($3, payment_doc_id),
     updated_at = NOW() WHERE id = $4`,
    [PAYMENT_STATUSES.EXPENSE_REPORTED, comment || 'Отчёт приложен', documentId || null, entityId]
  );

  const label = `${getLabel(entityType)} #${entityId}`;

  // Уведомляем бухгалтера и директоров
  if (record.buh_id) {
    createNotification(db, {
      user_id: record.buh_id,
      title: `📋 ${label} — отчёт о расходах`,
      message: `${actor.name || 'Сотрудник'} приложил отчёт.${comment ? ' ' + comment : ''}`,
      type: 'cash',
      link: `#/${entityType}?id=${entityId}`
    });
  }

  await notifyDirectors(db, actor.id,
    `📋 ${label} — отчёт приложен`,
    `${actor.name || 'Сотрудник'} отчитался о расходах.`
  );

  return { status: PAYMENT_STATUSES.EXPENSE_REPORTED };
}

// ─────────────────────────────────────────────────────────────────
// Действие 9: Возврат наличных (остаток) → баланс кассы восстанавливается
// ─────────────────────────────────────────────────────────────────
async function returnCash(db, { entityType, entityId, actor, amount, comment }) {
  if (!amount || amount <= 0) {
    throw Object.assign(new Error('Укажите сумму возврата'), { statusCode: 400 });
  }

  const record = await getRecord(db, entityType, entityId);
  if (!record) throw Object.assign(new Error('Запись не найдена'), { statusCode: 404 });

  // Возврат доступен только после получения наличных
  if (!['cash_received', 'expense_reported'].includes(record.payment_status)) {
    throw Object.assign(new Error('Возврат доступен только после получения наличных'), { statusCode: 409 });
  }

  const initiatorId = getInitiatorId(record, entityType);
  if (Number(actor.id) !== Number(initiatorId) && !isBuh(actor.role) && actor.role !== 'ADMIN') {
    throw Object.assign(new Error('Нет прав для возврата'), { statusCode: 403 });
  }

  // Возвращаем в кассу
  const balanceResult = await db.query(
    'SELECT amount FROM cash_balance_log ORDER BY created_at DESC, id DESC LIMIT 1'
  );
  const currentBalance = balanceResult.rows[0] ? parseFloat(balanceResult.rows[0].amount) : 0;
  const newBalance = currentBalance + amount;

  await db.query(
    `INSERT INTO cash_balance_log (amount, change_amount, change_type, description, related_request_id, user_id)
     VALUES ($1, $2, 'return', $3, $4, $5)`,
    [newBalance, amount, `Возврат по ${getLabel(entityType)} #${entityId}${comment ? ': ' + comment : ''}`, entityId, actor.id]
  );

  // Обновляем payment_comment
  await db.query(
    `UPDATE ${entityType} SET payment_comment = COALESCE(payment_comment, '') || E'\nВозврат: ' || $1 || ' ₽', updated_at = NOW() WHERE id = $2`,
    [amount.toString(), entityId]
  );

  const label = `${getLabel(entityType)} #${entityId}`;

  // Уведомляем бухгалтера
  if (record.buh_id) {
    createNotification(db, {
      user_id: record.buh_id,
      title: `💵 ${label} — возврат ${amount.toLocaleString('ru-RU')} ₽`,
      message: `${actor.name || 'Сотрудник'} вернул остаток. Баланс кассы: ${newBalance.toLocaleString('ru-RU')} ₽`,
      type: 'cash',
      link: `#/${entityType}?id=${entityId}`
    });
  }

  await notifyDirectors(db, actor.id,
    `💵 Возврат в кассу: ${amount.toLocaleString('ru-RU')} ₽`,
    `${label}. Баланс кассы: ${newBalance.toLocaleString('ru-RU')} ₽`
  );

  return { status: 'returned', amount_returned: amount, cash_balance: newBalance };
}

// ─────────────────────────────────────────────────────────────────
// Хелперы
// ─────────────────────────────────────────────────────────────────

async function getRecord(db, entityType, entityId) {
  // SQL injection hardening: проверка entityType по белому списку
  if (!SAFE_TABLES.has(entityType)) {
    throw new Error(`Invalid entity type: ${entityType}`);
  }
  const result = await db.query(`SELECT * FROM ${entityType} WHERE id = $1`, [entityId]);
  return result.rows[0] || null;
}

/**
 * Записать в audit_log действие согласования.
 * Используется в approve/rework/question/reject.
 */
async function writeAuditLog(db, actorUserId, entityType, entityId, action, payload) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [actorUserId, entityType, entityId, action, JSON.stringify(payload)]
    );
  } catch (err) {
    // audit_log не должен ломать основной flow — логируем и продолжаем
    console.error('[approvalService] audit_log write failed:', err.message);
  }
}

/**
 * Записать потоковый комментарий в approval_comments.
 */
async function writeApprovalComment(db, entityType, entityId, userId, action, comment) {
  try {
    await db.query(
      `INSERT INTO approval_comments (entity_type, entity_id, user_id, action, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [entityType, entityId, userId, action, comment]
    );
  } catch (err) {
    console.error('[approvalService] approval_comments write failed:', err.message);
  }
}

function getInitiatorId(record, entityType) {
  // Разные таблицы хранят инициатора в разных полях
  return Number(
    record.user_id ||
    record.created_by ||
    record.requested_by ||
    record.pm_id ||
    record.author_id ||
    0
  ) || null;
}

async function notifyDirectors(db, excludeId, title, message) {
  const directors = await db.query(
    "SELECT id FROM users WHERE role IN ('ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active = true"
  );
  for (const dir of directors.rows) {
    if (dir.id !== excludeId) {
      createNotification(db, {
        user_id: dir.id, title, message, type: 'approval', link: null
      });
    }
  }
}

// Получить баланс кассы (для модалки бухгалтерии)
async function getCashBalance(db) {
  const result = await db.query(
    'SELECT amount FROM cash_balance_log ORDER BY created_at DESC, id DESC LIMIT 1'
  );
  return result.rows[0] ? parseFloat(result.rows[0].amount) : 0;
}

// Получить все заявки, ожидающие бухгалтерию
async function getPendingForBuh(db) {
  const tables = [
    'pre_tender_requests', 'bonus_requests', 'work_expenses',
    'office_expenses', 'expenses', 'one_time_payments',
    'procurement_requests', 'payroll_sheets', 'business_trips',
    'travel_expenses', 'training_applications'
  ];

  const items = [];
  for (const table of tables) {
    try {
      const result = await db.query(
        `SELECT id, payment_status, requires_payment, updated_at FROM ${table}
         WHERE requires_payment = true AND payment_status = $1
         ORDER BY updated_at DESC`,
        [PAYMENT_STATUSES.PENDING]
      );
      for (const row of result.rows) {
        items.push({ ...row, entity_type: table, label: getLabel(table) });
      }
    } catch (e) {
      // Таблица может не иметь нужных колонок ещё
    }
  }

  return items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

// ─────────────────────────────────────────────────────────────────
// Экспорт
// ─────────────────────────────────────────────────────────────────
module.exports = {
  // Действия
  directorApprove,
  requestRework,
  askQuestion,
  directorReject,
  resubmit,
  payByBankTransfer,
  issueCash,
  confirmCashReceived,
  submitExpenseReport,
  returnCash,

  // Хелперы
  getRecord,
  getInitiatorId,
  getCashBalance,
  getPendingForBuh,
  getLabel,
  isDirector,
  isBuh,
  notifyDirectorsForApproval,
  notifyBuhForPayment,
  sendApprovalTelegram,
  validateEstimateTransition,
  writeAuditLog,
  writeApprovalComment,

  // Константы
  DIRECTOR_ROLES,
  BUH_ROLES,
  PAYMENT_STATUSES,
  ENTITY_LABELS,
  ESTIMATE_TRANSITIONS,
  SAFE_TABLES
};
