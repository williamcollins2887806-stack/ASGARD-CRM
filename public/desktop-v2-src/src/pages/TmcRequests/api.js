/**
 * API-клиент страницы /tmc-requests.
 * Источник: vanilla `tmc-requests-page.js` (192) + backend `src/routes/tmc_requests.js`.
 *
 * Endpoint'ы (prefix /api/tmc-requests):
 *   GET    /                  — список (?work_id=&status=&priority=)
 *   GET    /:id               — карточка
 *   GET    /export            — массовый Excel (через blob + Authorization header)
 *   GET    /:id/excel         — одна заявка Excel (через blob + Authorization header)
 *   POST   /                  — создать
 *   PUT    /:id               — обновить (draft/submitted)
 *   DELETE /:id               — удалить (только draft, ADMIN)
 *   PUT    /:id/status        — сменить статус
 *
 * RBAC: WRITE = ADMIN, PM, HEAD_PM, TO, HEAD_TO, DIRECTOR_GEN, DIRECTOR_COMM, BUH
 */
import { api } from '@/api/client';

export const STATUSES = [
  { value: 'draft',     label: 'Черновик',  tone: 'draft' },
  { value: 'submitted', label: 'Подана',    tone: 'sent' },
  { value: 'approved',  label: 'Одобрена',  tone: 'approved' },
  { value: 'rejected',  label: 'Отклонена', tone: 'rejected' },
  { value: 'ordered',   label: 'Заказано',  tone: 'sent' },
  { value: 'delivered', label: 'Доставлено', tone: 'paid' },
  { value: 'closed',    label: 'Закрыта',   tone: 'draft' }
];

export const PRIORITIES = [
  { value: 'low',    label: 'Низкий',  color: 'var(--t-3)' },
  { value: 'normal', label: 'Обычный', color: 'var(--info)' },
  { value: 'high',   label: 'Высокий', color: 'var(--amber)' },
  { value: 'urgent', label: 'Срочный', color: 'var(--err)' }
];

export function statusInfo(s) {
  return STATUSES.find((x) => x.value === s) || { label: s, tone: 'draft' };
}

export function priorityInfo(p) {
  return PRIORITIES.find((x) => x.value === p) || PRIORITIES[1];
}

export function loadList(params = {}) {
  const q = new URLSearchParams();
  if (params.work_id)  q.set('work_id', params.work_id);
  if (params.status)   q.set('status', params.status);
  if (params.priority) q.set('priority', params.priority);
  q.set('limit', String(params.limit || 200));
  return api('/api/tmc-requests?' + q.toString()).then((d) => d.items || []);
}

export function loadDetail(id) {
  return api('/api/tmc-requests/' + id).then((d) => d.item);
}

export function createRequest(body) {
  return api('/api/tmc-requests', { method: 'POST', body });
}

export function updateRequest(id, body) {
  return api('/api/tmc-requests/' + id, { method: 'PUT', body });
}

export function deleteRequest(id) {
  return api('/api/tmc-requests/' + id, { method: 'DELETE' });
}

export function setStatus(id, status) {
  return api('/api/tmc-requests/' + id + '/status', { method: 'PUT', body: { status } });
}

export function loadWorks() {
  return api('/api/works?limit=2000').then((d) => d.items || d.works || []).catch(() => []);
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

export function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:tmc-requests:changed'));
}
