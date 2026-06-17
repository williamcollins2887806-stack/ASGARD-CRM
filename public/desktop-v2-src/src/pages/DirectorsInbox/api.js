/**
 * DirectorsInbox — API helpers + константы.
 *
 * Backend: src/routes/inbox_applications_ai.js (Wave-2 extension).
 *
 * Endpoint'ы (префикс /api/inbox-applications):
 *   GET    /                  — список с фильтрами
 *   GET    /stats/summary     — счётчики
 *   GET    /:id               — карточка (item + attachments + history)
 *   POST   /:id/assign-pm     {pm_user_id, note?}     — назначить РП (RBAC: ADMIN/DIR/HEAD_PM)
 *   POST   /:id/reject        {reason, send_email?}
 *   POST   /:id/archive
 *   POST   /:id/review        — взять «на рассмотрении»
 */
import { api } from '@/api/client';

export const STATUSES = [
  { value: 'new',          label: 'Новая',           tone: 'sent' },
  { value: 'ai_processed', label: 'AI обработана',   tone: 'sent' },
  { value: 'under_review', label: 'На рассмотрении', tone: 'question' },
  { value: 'assigned',     label: 'Назначено',       tone: 'approved' },
  { value: 'accepted',     label: 'Принята',         tone: 'approved' },
  { value: 'rejected',     label: 'Отклонена',       tone: 'rejected' },
  { value: 'archived',     label: 'Архив',           tone: 'draft' }
];

export const COLORS = [
  { value: 'green',  label: '🟢 Наш профиль',     tone: 'approved' },
  { value: 'yellow', label: '🟡 Требует оценки',   tone: 'question' },
  { value: 'red',    label: '🔴 Не наш профиль',   tone: 'rejected' },
  { value: 'gray',   label: '⚪ Не оценено',       tone: 'draft' }
];

export const SOURCE_KINDS = {
  unknown:           '— неизвестно',
  corporate_forward: '↪ Пересланное письмо',
  external_direct:   '✉ Прямое внешнее',
  platform:          '🌐 Площадка',
  manual:            '✋ Создано вручную'
};

export function statusInfo(s) { return STATUSES.find((x) => x.value === s) || { label: s, tone: 'draft' }; }
export function colorInfo(c) { return COLORS.find((x) => x.value === c) || COLORS[3]; }

/* ── API ──────────────────────────────────────────────────────────── */

export function loadList(params = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.color) q.set('color', params.color);
  if (params.search) q.set('search', params.search);
  q.set('limit', String(params.limit || 200));
  return api('/api/inbox-applications/?' + q.toString())
    .then((d) => d?.items || [])
    .catch(() => []);
}

export function loadStats() {
  return api('/api/inbox-applications/stats/summary')
    .then((d) => d?.stats || {})
    .catch(() => ({}));
}

export function loadDetail(id) {
  return api('/api/inbox-applications/' + id);
}

export function assignPm(id, pm_user_id, note) {
  return api('/api/inbox-applications/' + id + '/assign-pm', {
    method: 'POST',
    body: { pm_user_id, note: note || null }
  });
}

export function reject(id, reason, send_email = true) {
  return api('/api/inbox-applications/' + id + '/reject', {
    method: 'POST',
    body: { reason, send_email }
  });
}

export function archive(id) {
  return api('/api/inbox-applications/' + id + '/archive', { method: 'POST', body: {} });
}

export function review(id) {
  return api('/api/inbox-applications/' + id + '/review', { method: 'POST', body: {} });
}

export function loadPmUsers() {
  return api('/api/users?is_active=true&limit=500')
    .then((r) => {
      const list = r?.users || r?.items || [];
      return list.filter((u) => u && u.is_active && ['PM', 'HEAD_PM'].includes(u.role));
    })
    .catch(() => []);
}

/* ── Хелперы ─────────────────────────────────────────────────────── */

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '';
}

export function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '';
}

export function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:director-inbox:changed'));
}
