/**
 * Training — API helpers.
 *
 * Backend: src/routes/training_applications.js (prefix /api/training-applications).
 */
import { api } from '@/api/client';

export const STATUS_MAP = {
  draft:            { label: 'Черновик' },
  pending_approval: { label: 'На согласовании' },
  approved:         { label: 'Согласовано' },
  budget_approved:  { label: 'Бюджет утверждён' },
  paid:             { label: 'Оплачено' },
  completed:        { label: 'Завершено' },
  rejected:         { label: 'Отклонено' }
};

export const STATUS_TONES = {
  draft:            'draft',
  pending_approval: 'sent',
  approved:         'approved',
  budget_approved:  'sent',
  paid:             'approved',
  completed:        'approved',
  rejected:         'rejected'
};

export const TYPE_MAP = {
  external:      'Внешнее',
  internal:      'Внутреннее',
  conference:    'Конференция',
  certification: 'Сертификация',
  online:        'Онлайн-курс'
};

export const TYPE_OPTIONS = Object.entries(TYPE_MAP).map(([value, label]) => ({ value, label }));

export function loadList(params = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  q.set('limit', String(params.limit || 200));
  return api(`/api/training-applications/?${q.toString()}`).then((d) => d?.applications || []);
}

export function loadOne(id) {
  return api(`/api/training-applications/${id}`).then((d) => d?.item || null);
}

export function createApp(body) {
  return api('/api/training-applications/', { method: 'POST', body });
}

export function updateApp(id, body) {
  return api(`/api/training-applications/${id}`, { method: 'PUT', body });
}

export function deleteApp(id) {
  return api(`/api/training-applications/${id}`, { method: 'DELETE' });
}

export function updateStatus(id, action, extra = {}) {
  return api(`/api/training-applications/${id}/status`, {
    method: 'PUT',
    body: { action, ...extra }
  });
}
