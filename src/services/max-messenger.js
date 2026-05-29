'use strict';
/**
 * АСГАРД CRM — Интеграция с мессенджером MAX (max.ru)
 * API: https://platform-api.max.ru
 * Auth: Authorization: <token>  (без Bearer)
 *
 * Возможности:
 *  - Создать групповой чат для работы
 *  - Добавить участников по user_id
 *  - Получить ссылку-приглашение
 *  - Отправить сообщение в чат
 *  - Подписаться на вебхук событий (новый участник)
 */

const BASE_URL = 'https://platform-api.max.ru';

function getToken() {
  return process.env.MAX_BOT_TOKEN || '';
}

function isEnabled() {
  return Boolean(getToken());
}

async function maxRequest(method, path, body) {
  const token = getToken();
  if (!token) throw new Error('MAX_BOT_TOKEN не задан в .env');

  const opts = {
    method,
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const url = BASE_URL + path;
  const res = await fetch(url, opts);
  const text = await res.text();

  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.message || data?.error || text;
    throw new Error(`MAX API ${method} ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

/**
 * Создать групповой чат для работы.
 * Возвращает { chat_id, invite_link } или бросает ошибку.
 */
async function createWorkChat(workId, workTitle) {
  const title = `${workTitle || `Работа #${workId}`}`.slice(0, 100);
  const data = await maxRequest('POST', '/chats', {
    title,
    type: 'group',
    description: `Рабочий чат объекта #${workId} в АСГАРД CRM`
  });
  const chatId = data.chat_id || data.chatId || data.id;
  if (!chatId) throw new Error(`MAX API: chat_id не вернулся: ${JSON.stringify(data)}`);
  return { chat_id: String(chatId), raw: data };
}

/**
 * Получить ссылку-приглашение в чат.
 * MAX может возвращать её в поле invite_link/link внутри GET /chats/{id}.
 */
async function getChatInviteLink(chatId) {
  try {
    const data = await maxRequest('GET', `/chats/${chatId}`);
    return data.invite_link || data.link || data.join_link || null;
  } catch (e) {
    console.warn('[MAX] getChatInviteLink failed:', e.message);
    return null;
  }
}

/**
 * Добавить участников в чат.
 * userIds — массив строк (MAX user_id).
 */
async function addMembers(chatId, userIds) {
  if (!userIds || userIds.length === 0) return { ok: true };
  return maxRequest('POST', `/chats/${chatId}/members`, { user_ids: userIds });
}

/**
 * Получить список участников чата.
 */
async function getMembers(chatId) {
  return maxRequest('GET', `/chats/${chatId}/members`);
}

/**
 * Отправить текстовое сообщение в чат.
 */
async function sendMessage(chatId, text) {
  return maxRequest('POST', '/messages', { chat_id: chatId, text });
}

/**
 * Зарегистрировать вебхук для получения событий (вступление участника и др.).
 * url — публичный HTTPS URL нашего сервера.
 */
async function subscribeWebhook(webhookUrl) {
  return maxRequest('POST', '/subscriptions', {
    url: webhookUrl,
    // события, которые нас интересуют
    update_types: [
      'message_created',
      'chat_member_added',
      'chat_member_removed',
      'bot_started'
    ]
  });
}

/**
 * Отписаться от вебхука.
 */
async function unsubscribeWebhook(webhookUrl) {
  return maxRequest('DELETE', '/subscriptions', { url: webhookUrl });
}

/**
 * Проверить статус бота (ping).
 */
async function getMe() {
  return maxRequest('GET', '/me');
}

module.exports = {
  isEnabled,
  createWorkChat,
  getChatInviteLink,
  addMembers,
  getMembers,
  sendMessage,
  subscribeWebhook,
  unsubscribeWebhook,
  getMe
};
