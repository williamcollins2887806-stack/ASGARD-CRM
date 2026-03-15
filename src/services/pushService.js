'use strict';

/**
 * ASGARD CRM — Push Service
 * Отправка push-уведомлений с action-кнопками.
 * Использует web-push и VAPID ключи из env.
 *
 * Вызывается из notify.js (createNotification) или напрямую
 * из approvalService / бизнес-логики для push с кнопками.
 *
 * Session 15: Push Actions + Badge
 */

let webpush;
try { webpush = require('web-push'); } catch (e) { webpush = null; }

function initVapid() {
  if (!webpush) return false;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  const email = process.env.VAPID_EMAIL || 'mailto:admin@asgard-crm.ru';
  webpush.setVapidDetails(email, pub, priv);
  return true;
}

/**
 * Получить badge_count для пользователя
 * badge = непрочитанные уведомления + ожидающие согласования (для директоров) + непрочитанные чаты
 */
async function getBadgeCount(db, userId) {
  try {
    const [notif, chats] = await Promise.all([
      db.query('SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false', [userId]),
      db.query(
        "SELECT COUNT(*) FROM chat_messages WHERE is_read = false AND sender_id != $1 AND chat_id IN (SELECT chat_id FROM chat_members WHERE user_id = $1)",
        [userId]
      ).catch(() => ({ rows: [{ count: '0' }] }))
    ]);
    return parseInt(notif.rows[0].count, 10) + parseInt(chats.rows[0].count, 10);
  } catch (e) {
    return 0;
  }
}

/**
 * Отправить push-уведомление пользователю.
 *
 * @param {object} db — pool подключения
 * @param {number} userId — кому
 * @param {object} payload — { title, body, tag, url, actions, data }
 *   actions: [{ action: 'approve', title: '✅ Согласовать' }, ...]
 *   data: { entityType, entityId, action_type, url }
 */
async function sendPush(db, userId, payload) {
  if (!initVapid()) return { sent: 0, reason: 'vapid_not_configured' };

  const subs = await db.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );
  if (subs.rows.length === 0) return { sent: 0, reason: 'no_subscriptions' };

  const badgeCount = await getBadgeCount(db, userId);

  const pushPayload = JSON.stringify({
    title: payload.title || 'АСГАРД CRM',
    body: payload.body || '',
    icon: payload.icon || './assets/img/icon-192.png',
    badge: './assets/img/icon-96.png',
    tag: payload.tag || 'asgard-notification',
    badge_count: badgeCount,
    actions: (payload.actions || []).slice(0, 2),
    data: Object.assign({
      url: payload.url || '/',
      badge_count: badgeCount
    }, payload.data || {})
  });

  let sent = 0;
  for (const sub of subs.rows) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, pushPayload);
      sent++;
    } catch (pushErr) {
      if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
        await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      } else {
        console.error('[pushService] Error for sub', sub.id, pushErr.statusCode || pushErr.message);
      }
    }
  }
  return { sent };
}

/**
 * Отправить push нескольким пользователям
 */
async function sendPushToMany(db, userIds, payload) {
  let total = 0;
  for (const uid of userIds) {
    const res = await sendPush(db, uid, payload);
    total += res.sent;
  }
  return { sent: total };
}

// ═══════════════════════════════════════════════════════════════
// Предустановленные шаблоны push с actions
// ═══════════════════════════════════════════════════════════════

/**
 * 1. Просчёт на согласование → директорам
 */
async function pushEstimateForApproval(db, directorIds, { entityId, actorName, estimateTitle }) {
  return sendPushToMany(db, directorIds, {
    title: '📋 Просчёт на согласование',
    body: (actorName || 'Сотрудник') + ' отправил просчёт #' + entityId + (estimateTitle ? ': ' + estimateTitle : ''),
    tag: 'approval-estimate-' + entityId,
    url: '#/approvals',
    actions: [
      { action: 'approve', title: '✅ Согласовать' },
      { action: 'reject', title: '❌ Отклонить' }
    ],
    data: {
      entityType: 'estimates',
      entityId: entityId,
      action_type: 'director_approval'
    }
  });
}

/**
 * 2. Заявка с оплатой → бухгалтерии
 */
async function pushPaymentRequest(db, accountantIds, { entityType, entityId, actorName, title }) {
  return sendPushToMany(db, accountantIds, {
    title: '💰 Заявка на оплату',
    body: (actorName || 'Сотрудник') + ' — ' + (title || entityType + ' #' + entityId),
    tag: 'payment-' + entityType + '-' + entityId,
    url: '#/approval-payment',
    actions: [
      { action: 'pay', title: '💳 Оплатить' },
      { action: 'revise', title: '📝 На доработку' }
    ],
    data: {
      entityType: entityType,
      entityId: entityId,
      action_type: 'accounting_payment'
    }
  });
}

/**
 * 3. Наличные выданы → инициатору
 */
async function pushCashIssued(db, initiatorId, { entityType, entityId, amount }) {
  return sendPush(db, initiatorId, {
    title: '💵 Наличные выданы',
    body: 'Получите ' + (amount ? amount.toLocaleString('ru-RU') + ' ₽' : 'сумму') + ' в кассе',
    tag: 'cash-issued-' + entityId,
    url: '#/cash',
    actions: [
      { action: 'confirm', title: '✅ Подтвердить получение' }
    ],
    data: {
      entityType: entityType,
      entityId: entityId,
      action_type: 'cash_confirm'
    }
  });
}

/**
 * 4. Задача назначена → исполнителю
 */
async function pushTaskAssigned(db, assigneeId, { taskId, taskTitle, actorName }) {
  return sendPush(db, assigneeId, {
    title: '📌 Новая задача',
    body: (actorName || 'Руководитель') + ': ' + (taskTitle || 'Задача #' + taskId),
    tag: 'task-' + taskId,
    url: '#/tasks/' + taskId,
    actions: [
      { action: 'accept', title: '✅ Принять' }
    ],
    data: {
      entityType: 'tasks',
      entityId: taskId,
      action_type: 'task_accept'
    }
  });
}

/**
 * 5. Новое сообщение в чате
 */
async function pushChatMessage(db, recipientId, { chatId, senderName, messagePreview }) {
  return sendPush(db, recipientId, {
    title: '💬 ' + (senderName || 'Сообщение'),
    body: (messagePreview || '').substring(0, 100),
    tag: 'chat-' + chatId,
    url: '#/messenger/' + chatId,
    actions: [
      { action: 'reply', title: '💬 Ответить' }
    ],
    data: {
      entityType: 'chats',
      entityId: chatId,
      action_type: 'chat_reply'
    }
  });
}

module.exports = {
  sendPush,
  sendPushToMany,
  getBadgeCount,
  pushEstimateForApproval,
  pushPaymentRequest,
  pushCashIssued,
  pushTaskAssigned,
  pushChatMessage
};
