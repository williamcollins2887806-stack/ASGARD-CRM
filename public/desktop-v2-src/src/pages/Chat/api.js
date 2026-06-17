/**
 * API-клиент чатов /chat и /messenger.
 * Источник: vanilla chat_groups.js (1851 строка).
 *
 * E-6b (2026-06-14): добавлены потерянные endpoints:
 *   - /api/chat-groups/direct (POST) — создать/получить прямой чат с пользователем
 *   - /api/chat-groups/mimir (GET) + /api/chat-groups/:id/mimir (POST) — Мимир-чат
 *   - /api/chat-groups/link-preview (GET) — превью ссылок в сообщениях
 */
import { api } from '@/api/client';

export function loadGroups() {
  // Backend (src/routes/chat_groups.js:335) возвращает { chats: [...] } — не groups/items.
  return api('/api/chat-groups').then((d) => d.chats || d.groups || d.items || []).catch(() => []);
}

/* Открыть/создать прямой чат 1-на-1 с пользователем (vanilla chat_groups.js:113). */
export function openDirectChat(userId) {
  return api('/api/chat-groups/direct', { method: 'POST', body: { user_id: Number(userId) } });
}

/* Получить (или создать) Мимир-чат текущего пользователя (vanilla chat_groups.js:145). */
export function getMimirChat() {
  return api('/api/chat-groups/mimir').catch(() => null);
}

/* Отправить вопрос Мимиру в чат (vanilla chat_groups.js:151). */
export function sendMimirMessage(chatId, message, model) {
  return api(`/api/chat-groups/${chatId}/mimir`, { method: 'POST', body: { message, model: model || undefined } });
}

/* Реестр моделей чата Мимира (GET /api/mimir/chat/models). */
export function loadMimirModels() {
  return api('/api/mimir/chat/models');
}

/* Превью ссылки в сообщении (vanilla chat_groups.js:1507). */
export function loadLinkPreview(url) {
  return api('/api/chat-groups/link-preview?url=' + encodeURIComponent(url)).catch(() => null);
}

export function loadGroup(id) {
  return api(`/api/chat-groups/${id}`).catch(() => null);
}

export function loadMessages(groupId, params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit || 100));
  if (params.before_id) q.set('before_id', String(params.before_id));
  if (params.search) q.set('search', String(params.search));
  return api(`/api/chat-groups/${groupId}/messages?${q.toString()}`)
    .then((d) => d.messages || d.items || [])
    .catch(() => []);
}

/* Toggle реакции на сообщение (backend src/routes/chat_groups.js:904). */
export function toggleReaction(chatId, messageId, emoji) {
  return api(`/api/chat-groups/${chatId}/messages/${messageId}/reaction`, {
    method: 'POST',
    body: { emoji }
  });
}

/* Сигнал "печатает" (backend src/routes/chat_groups.js:953). */
export function sendTyping(chatId) {
  return api(`/api/chat-groups/${chatId}/typing`, { method: 'POST', body: {} }).catch(() => {});
}

/* Замьютить чат до timestamp (или null = снять mute) (backend src/routes/chat_groups.js:606). */
export function muteChat(chatId, until) {
  return api(`/api/chat-groups/${chatId}/mute`, {
    method: 'PUT',
    body: { until: until || null }
  });
}

/* Архивировать/разархивировать чат (backend src/routes/chat_groups.js:625). */
export function archiveChat(chatId, archive = true) {
  return api(`/api/chat-groups/${chatId}/archive`, {
    method: 'PUT',
    body: { archive: !!archive }
  });
}

/* Загрузить список чатов с фильтром archived=true|false (backend src/routes/chat_groups.js:261). */
export function loadGroupsByArchive(archived = false) {
  return api(`/api/chat-groups?archived=${archived ? 'true' : 'false'}`)
    .then((d) => d.chats || d.groups || d.items || [])
    .catch(() => []);
}

export function sendMessage(groupId, body) {
  return api(`/api/chat-groups/${groupId}/messages`, { method: 'POST', body });
}

export function editMessage(groupId, messageId, body) {
  return api(`/api/chat-groups/${groupId}/messages/${messageId}`, { method: 'PUT', body });
}

export function deleteMessage(groupId, messageId) {
  return api(`/api/chat-groups/${groupId}/messages/${messageId}`, { method: 'DELETE' });
}

export function createGroup(body) {
  return api('/api/chat-groups', { method: 'POST', body });
}

export function updateGroup(id, body) {
  return api(`/api/chat-groups/${id}`, { method: 'PUT', body });
}

export function deleteGroup(id) {
  return api(`/api/chat-groups/${id}`, { method: 'DELETE' });
}

export function addMember(groupId, userId) {
  return api(`/api/chat-groups/${groupId}/members`, { method: 'POST', body: { user_id: userId } });
}

export function removeMember(groupId, userId) {
  return api(`/api/chat-groups/${groupId}/members/${userId}`, { method: 'DELETE' });
}

export function markRead(groupId) {
  return api(`/api/chat-groups/${groupId}/read`, { method: 'POST', body: {} });
}

export function loadUsers() {
  return api('/api/users?limit=300').then((d) => d.users || d.items || []).catch(() => []);
}

// E-2 fix: vanilla chat_groups.js:121 использует /api/chat-groups/:id/upload-file
// с FormData (multipart). Старый код /upload с base64 — несуществующий endpoint.
export async function uploadAttachment(chatId, file) {
  const fd = new FormData();
  fd.append('file', file);
  const token = localStorage.getItem('asgard_token') || '';
  const r = await fetch(`/api/chat-groups/${chatId}/upload-file`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  if (!r.ok) throw new Error('Upload failed: ' + r.status);
  return r.json();
}

/**
 * Voice message upload + send (vanilla chat_groups.js:318-369).
 *
 * Backend `/upload-file` (src/routes/chat_groups.js:1069) принимает мультипарт,
 * сохраняет файл и создаёт сообщение. Но не выставляет message_type='voice' и
 * file_duration. Поэтому делаем 2 шага:
 *   1) upload-file → получить attachment (file_path, file_name)
 *   2) POST /messages с message_type='voice', file_url, file_duration —
 *      это создаёт правильную voice-запись (src/routes/chat_groups.js:741).
 *
 * Промежуточное сообщение из upload-file удалит deleteMessage — иначе будет дубль.
 * При ошибке шага 2 промежуточное сообщение тоже удаляем.
 */
export async function uploadVoiceMessage(chatId, blob, durationSec) {
  const token = localStorage.getItem('asgard_token') || '';
  const fd = new FormData();
  fd.append('file', new File([blob], 'voice.webm', { type: blob.type || 'audio/webm' }));
  const uploadRes = await fetch(`/api/chat-groups/${chatId}/upload-file`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  if (!uploadRes.ok) throw new Error('Загрузка голосового не удалась: ' + uploadRes.status);
  const uploaded = await uploadRes.json();
  const attachment = uploaded?.attachment || (uploaded?.message?.attachments || [])[0] || null;
  const tempMsgId = uploaded?.message?.id || null;

  // Сформировать file_url: /api/chat-groups/:id/files/:filename
  // file_path хранится как 'chat/<safeName>' — нам нужен safeName (file_name).
  const fileName = attachment?.file_name || attachment?.filename;
  if (!fileName) throw new Error('Загрузка вернула некорректные данные');
  const fileUrl = `/api/chat-groups/${chatId}/files/${encodeURIComponent(fileName)}`;

  try {
    const voiceMsg = await api(`/api/chat-groups/${chatId}/messages`, {
      method: 'POST',
      body: {
        text: '',
        message_type: 'voice',
        file_url: fileUrl,
        file_duration: Math.max(1, Math.round(durationSec || 0))
      }
    });
    // Удалить промежуточное сообщение от upload-file (без message_type=voice).
    if (tempMsgId) {
      api(`/api/chat-groups/${chatId}/messages/${tempMsgId}`, { method: 'DELETE' }).catch(() => {});
    }
    return voiceMsg;
  } catch (e) {
    if (tempMsgId) {
      api(`/api/chat-groups/${chatId}/messages/${tempMsgId}`, { method: 'DELETE' }).catch(() => {});
    }
    throw e;
  }
}

/**
 * Обновить pinned-карточку просчёта (для ec-pinned-card refresh).
 * Backend: src/routes/chat_groups.js:1927 PUT /:chatId/update-estimate-card.
 * Используется при ручном «📌 Обновить» — обычно карточка обновляется автоматически
 * из estimates.js при изменении расчёта (SSE chat:estimate_updated прилетает сам).
 */
export function updateEstimateCard(chatId, estimateId) {
  return api(`/api/chat-groups/${chatId}/update-estimate-card`, {
    method: 'PUT',
    body: { estimate_id: estimateId }
  });
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}
