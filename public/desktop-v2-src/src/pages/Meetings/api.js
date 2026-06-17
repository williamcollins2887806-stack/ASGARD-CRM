/**
 * Meetings — API helpers.
 *
 * Backend: src/routes/meetings.js (prefix /api/meetings).
 */
import { api } from '@/api/client';

export const STATUS_MAP = {
  scheduled:   'Запланировано',
  in_progress: 'Идёт',
  completed:   'Завершено',
  cancelled:   'Отменено'
};

export const STATUS_TONES = {
  scheduled:   'sent',
  in_progress: 'gold',
  completed:   'approved',
  cancelled:   'rejected'
};

export const RSVP_MAP = {
  pending:   'Ожидает',
  accepted:  'Принято',
  tentative: 'Возможно',
  declined:  'Отказ'
};

export const ITEM_TYPE_MAP = {
  note:     '📝 Заметка',
  decision: '✅ Решение',
  action:   '📋 Действие',
  question: '❓ Вопрос'
};

export function loadList(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v != null) q.set(k, String(v)); });
  return api(`/api/meetings?${q.toString()}`).then((d) => d?.meetings || []);
}

export function loadOne(id) {
  return api(`/api/meetings/${id}`);
}

export function loadStats() {
  return api('/api/meetings/stats').catch(() => ({}));
}

export function loadUpcoming(limit = 5) {
  return api(`/api/meetings/upcoming?limit=${limit}`).then((d) => d?.meetings || d?.items || []).catch(() => []);
}

export function createMeeting(body) {
  return api('/api/meetings', { method: 'POST', body });
}

export function updateMeeting(id, body) {
  return api(`/api/meetings/${id}`, { method: 'PUT', body });
}

export function deleteMeeting(id) {
  return api(`/api/meetings/${id}`, { method: 'DELETE' });
}

export function addParticipants(id, user_ids) {
  return api(`/api/meetings/${id}/participants`, { method: 'POST', body: { user_ids } });
}

export function rsvp(id, status, comment = '') {
  return api(`/api/meetings/${id}/rsvp`, { method: 'PUT', body: { status, comment } });
}

export function addMinutes(meetingId, body) {
  return api(`/api/meetings/${meetingId}/minutes`, { method: 'POST', body });
}

export function updateMinute(meetingId, id, body) {
  return api(`/api/meetings/${meetingId}/minutes/${id}`, { method: 'PUT', body });
}

export function createTaskFromMinutes(meetingId, id) {
  return api(`/api/meetings/${meetingId}/minutes/${id}/create-task`, { method: 'POST' });
}

export function finalize(id, minutes_text) {
  return api(`/api/meetings/${id}/finalize`, { method: 'PUT', body: { minutes_text } });
}

export function loadUsers() {
  return api('/api/users?limit=500').then((d) => d?.users || []).catch(() => []);
}
