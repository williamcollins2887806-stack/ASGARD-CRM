/**
 * API-клиент страницы /acts — Акты выполненных работ.
 * Источник: vanilla `public/assets/js/acts.js` (~240 строк).
 *
 * Endpoints (см. `src/routes/acts.js`):
 *   GET    /api/acts                  — список (status, work_id, customer_name, limit)
 *   GET    /api/acts/next-number      — авто-номер АКТ-ГГГГ-NNN
 *   GET    /api/acts/:id              — карточка
 *   POST   /api/acts                  — создать
 *   PUT    /api/acts/:id              — обновить
 *   DELETE /api/acts/:id              — удалить
 *   GET    /api/acts/:id/pdf           — PDF (через blob + Authorization header, см. openPdf)
 *
 * RBAC на запись: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, PM, BUH.
 */
import { api } from '@/api/client';

export const STATUSES = {
  draft:  { label: 'Черновик',  tone: 'draft',    color: 'var(--t-3)' },
  sent:   { label: 'Отправлен', tone: 'info',     color: 'var(--info)' },
  signed: { label: 'Подписан',  tone: 'approved', color: 'var(--ok)' },
  paid:   { label: 'Оплачен',   tone: 'approved', color: 'var(--gold)' }
};

export const STATUS_OPTIONS = [
  { value: '',       label: 'Все статусы' },
  { value: 'draft',  label: 'Черновик' },
  { value: 'sent',   label: 'Отправлен' },
  { value: 'signed', label: 'Подписан' },
  { value: 'paid',   label: 'Оплачен' }
];

export function loadActs(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 500));
  if (params.status) q.set('status', params.status);
  if (params.work_id) q.set('work_id', String(params.work_id));
  return api('/api/acts?' + q.toString())
    .then((d) => d.acts || [])
    .catch(() => []);
}

export function loadAct(id) {
  return api('/api/acts/' + id);
}

export function nextActNumber() {
  return api('/api/acts/next-number')
    .then((d) => d.number || '')
    .catch(() => '');
}

export function createAct(payload) {
  return api('/api/acts', { method: 'POST', body: payload });
}
export function updateAct(id, payload) {
  return api('/api/acts/' + id, { method: 'PUT', body: payload });
}
export function deleteAct(id) {
  return api('/api/acts/' + id, { method: 'DELETE' });
}

export function loadCustomers() {
  return api('/api/customers?limit=2000')
    .then((d) => d.customers || d.items || [])
    .catch(() => []);
}
export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

/* ─── Форматирование ─────────────────────────────────────────────────── */

export function fmtMoney(n) {
  if (!Number.isFinite(+n) || n === 0) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}
export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

/**
 * Открыть PDF акта в новой вкладке БЕЗ токена в URL (через blob).
 * См. src/api/download.js — токен передаётся в Authorization header.
 */
export async function openPdf(actId) {
  const { openProtected } = await import('@/api/download');
  return openProtected(`/api/acts/${actId}/pdf`, `act_${actId}.pdf`);
}
