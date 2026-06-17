/**
 * API-клиент страницы /inbox-applications — входящие заявки от заказчиков.
 *
 * Источник: vanilla `inbox_applications.js` (392) + backend `src/routes/inbox_applications_ai.js`.
 *
 * Endpoint'ы (prefix /api/inbox-applications):
 *   GET    /                  — список (?status=&color=&classification=&search=)
 *   GET    /stats/summary     — счётчики
 *   GET    /:id               — карточка (item + attachments + analysisHistory)
 *   POST   /:id/analyze       — переанализировать
 *   POST   /:id/review        — взять «на рассмотрение»
 *   POST   /:id/accept        — принять + создать тендер (body: {create_tender, send_email})
 *   POST   /:id/reject        — отклонить (body: {reason, send_email})
 *   POST   /:id/archive       — в архив
 *   PUT    /:id               — обновить поля
 *   DELETE /:id               — удалить (ADMIN)
 *   POST   /:id/calc-cost     — посчитать себестоимость
 */
import { api } from '@/api/client';

export const STATUSES = [
  { value: 'new',          label: 'Новая',          tone: 'sent' },
  { value: 'ai_processed', label: 'AI обработана',  tone: 'sent' },
  { value: 'under_review', label: 'На рассмотрении', tone: 'question' },
  { value: 'accepted',     label: 'Принята',        tone: 'approved' },
  { value: 'rejected',     label: 'Отклонена',      tone: 'rejected' },
  { value: 'archived',     label: 'Архив',          tone: 'draft' }
];

export const COLORS = [
  { value: 'green',  label: '🟢 Наш профиль',     tone: 'approved' },
  { value: 'yellow', label: '🟡 Требует оценки',   tone: 'question' },
  { value: 'red',    label: '🔴 Не наш профиль',  tone: 'rejected' },
  { value: 'gray',   label: '⚪ Не оценено',       tone: 'draft' }
];

export const CLASSIFICATIONS = {
  direct_request:   'Прямой запрос',
  platform_tender:  'Тендер',
  commercial_offer: 'Коммерч. предложение',
  information:      'Информация',
  spam:             'Спам',
  personal:         'Личное',
  other:            'Другое'
};

export function statusInfo(s) {
  return STATUSES.find((x) => x.value === s) || { label: s, tone: 'draft' };
}

export function colorInfo(c) {
  return COLORS.find((x) => x.value === c) || COLORS[3];
}

export function loadList(params = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.color)  q.set('color',  params.color);
  if (params.search) q.set('search', params.search);
  q.set('limit', String(params.limit || 200));
  return api('/api/inbox-applications/?' + q.toString())
    .then((d) => (d && (d.items || [])))
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

export function analyze(id) {
  return api('/api/inbox-applications/' + id + '/analyze', { method: 'POST', body: {} });
}

export function calcCost(id) {
  return api('/api/inbox-applications/' + id + '/calc-cost', { method: 'POST', body: {} });
}

export function accept(id, body = {}) {
  return api('/api/inbox-applications/' + id + '/accept', { method: 'POST', body });
}

export function reject(id, body = {}) {
  return api('/api/inbox-applications/' + id + '/reject', { method: 'POST', body });
}

export function review(id) {
  return api('/api/inbox-applications/' + id + '/review', { method: 'POST', body: {} });
}

export function archive(id) {
  return api('/api/inbox-applications/' + id + '/archive', { method: 'POST', body: {} });
}

export function update(id, patch) {
  return api('/api/inbox-applications/' + id, { method: 'PUT', body: patch });
}

export function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:inbox-applications:changed'));
}

export function fmtMoney(v) {
  if (v == null || v === '') return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(v))) + ' ₽';
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '—';
}
