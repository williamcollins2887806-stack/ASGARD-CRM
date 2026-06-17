/**
 * API-клиент страницы /all-estimates — Свод Расчётов.
 * Источник: vanilla `public/assets/js/all_estimates.js` (~301 строк).
 * Бэк: GET /api/estimates (PM видит только свои; директора/HEAD — все).
 * Согласование: POST /api/approval/estimates/:id/{approve,rework,question,reject,resubmit}
 */
import { api } from '@/api/client';

/* Согласование: 4 действия + черновик + переотправка + отменено */
export const APPROVAL_STATUSES = [
  { value: 'draft',     label: 'Черновик',        tone: 'draft' },
  { value: 'sent',      label: 'На согласовании', tone: 'sent' },
  { value: 'approved',  label: 'Согласовано',     tone: 'approved' },
  { value: 'rework',    label: 'На доработке',    tone: 'rework' },
  { value: 'question',  label: 'Вопрос',          tone: 'question' },
  { value: 'rejected',  label: 'Отклонено',       tone: 'rejected' },
  { value: 'cancelled', label: 'Отменено',        tone: 'draft' }
];

export const PERIOD_PRESETS = [
  { value: 'all',     label: 'Всё время' },
  { value: 'today',   label: 'Сегодня' },
  { value: 'week',    label: 'Неделя' },
  { value: 'month',   label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year',    label: 'Год' }
];

export function loadEstimates(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 500));
  if (params.status) q.set('status', params.status);
  return api(`/api/estimates?${q.toString()}`).then((d) => d.estimates || d.items || []);
}

export function loadEstimate(id) {
  return api(`/api/estimates/${id}`).then((d) => d.estimate || d);
}

export function loadUsers(role) {
  const q = role ? `?role=${role}&limit=200` : '?limit=200';
  return api('/api/users' + q).then((d) => d.users || d.items || []).catch(() => []);
}

/* ─── Действия директора через /approval ─── */

/* Note: actionEstimate (общий action-endpoint POST /api/approval/estimates/:id)
 * удалён 2026-06-14 — vanilla отправлял POST с body {comment, action в URL},
 * React разнёс на 4 отдельных endpoint'а (/approve, /rework, /question, /reject).
 * Сам этот endpoint существует на бэкенде для совместимости, но из React-UI
 * не вызывается — добавлять обёртку только под аудит-метрику не нужно. */

export function approveEstimate(id, comment = '') {
  return api(`/api/approval/estimates/${id}/approve`, { method: 'POST', body: { comment } });
}
export function reworkEstimate(id, comment) {
  return api(`/api/approval/estimates/${id}/rework`, { method: 'POST', body: { comment } });
}
export function questionEstimate(id, comment) {
  return api(`/api/approval/estimates/${id}/question`, { method: 'POST', body: { comment } });
}
export function rejectEstimate(id, comment) {
  return api(`/api/approval/estimates/${id}/reject`, { method: 'POST', body: { comment } });
}
export function resubmitEstimate(id) {
  return api(`/api/approval/estimates/${id}/resubmit`, { method: 'POST', body: {} });
}

/* ─── Хелперы ─── */

export function isDirectorRole(role) {
  return role === 'ADMIN' || String(role || '').startsWith('DIRECTOR');
}

export function statusMeta(value) {
  return APPROVAL_STATUSES.find((s) => s.value === value) || APPROVAL_STATUSES[0];
}

export function filterByPeriod(items, period) {
  if (!period || period === 'all') return items;
  const now = Date.now();
  const day = 86400000;
  const cutoff = {
    today: now - day,
    week: now - 7 * day,
    month: now - 30 * day,
    quarter: now - 90 * day,
    year: now - 365 * day
  }[period];
  if (!cutoff) return items;
  return items.filter((e) => {
    const c = e.sent_for_approval_at && new Date(e.sent_for_approval_at).getTime();
    if (Number.isFinite(c) && c >= cutoff) return true;
    const c2 = e.created_at && new Date(e.created_at).getTime();
    return Number.isFinite(c2) && c2 >= cutoff;
  });
}

export function filterByQuery(items, q) {
  if (!q || !q.trim()) return items;
  const lq = q.trim().toLowerCase();
  return items.filter((e) =>
    (e.customer || e.customer_name || '').toLowerCase().includes(lq) ||
    (e.title || '').toLowerCase().includes(lq) ||
    String(e.id).includes(lq) ||
    String(e.tender_id || '').includes(lq)
  );
}

export function filterByMatch(items, key, value) {
  if (!value) return items;
  return items.filter((e) => String(e[key] ?? '') === String(value));
}

export function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}
