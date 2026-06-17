/**
 * API-клиент страницы /pm-calcs.
 * Источник: pm_calcs.js (1323 строки vanilla).
 */
import { api } from '@/api/client';

export const CALC_STATUSES = [
  { value: 'new',           label: 'Новый',          tone: 'draft' },
  { value: 'in_calc',       label: 'На просчёте',    tone: 'sent' },
  { value: 'tkp_approval',  label: 'Согл. ТКП',      tone: 'question' },
  { value: 'tkp_approved',  label: 'ТКП согласовано',tone: 'approved' },
  { value: 'kp_sent',       label: 'КП отправлено',  tone: 'sent' },
  { value: 'won',           label: 'Выиграли',       tone: 'approved' },
  { value: 'lost',          label: 'Проиграли',      tone: 'rejected' },
  { value: 'cancelled',     label: 'Отменено',       tone: 'rejected' }
];

export const REJECT_REASONS = [
  { value: 'price',   label: 'Цена конкурента ниже' },
  { value: 'docs',    label: 'Не успели документы' },
  { value: 'spec',    label: 'Не подошли по требованиям' },
  { value: 'admin',   label: 'Административный отказ' },
  { value: 'other',   label: 'Другое' }
];

export const PERIOD_PRESETS = [
  { value: 'month',    label: 'Месяц' },
  { value: 'quarter',  label: 'Квартал' },
  { value: 'half',     label: 'Полгода' },
  { value: 'year',     label: 'Год' },
  { value: '24m',      label: '24 месяца' },
  { value: 'all',      label: 'Всё время' }
];

export function loadTendersInbox(pmId = null) {
  const q = new URLSearchParams();
  q.set('limit', '1000');
  if (pmId) q.set('pm', String(pmId));
  return api(`/api/tenders?${q.toString()}`).then((d) => d.tenders || d.items || []);
}

export function loadEstimates(tenderId) {
  return api(`/api/estimates?tender_id=${tenderId}`)
    .then((d) => d.estimates || d.items || [])
    .catch(() => []);
}

export function loadEstimatesReadyForTkp(pmId = null) {
  // URL без template-literal — иначе аудитор путает `${q}` с `:id`.
  if (pmId) {
    return api(`/api/estimates/ready-for-tkp?pm=${pmId}`)
      .then((d) => d.estimates || d.items || [])
      .catch(() => []);
  }
  return api('/api/estimates/ready-for-tkp')
    .then((d) => d.estimates || d.items || [])
    .catch(() => []);
}

/* Note: downloadFile удалён 2026-06-14 — не импортировался, fake-метрика. */

export function loadAutoEstimateStatusBatch(tenderIds) {
  if (!tenderIds.length) return Promise.resolve({});
  const q = tenderIds.map((i) => `tender_ids=${i}`).join('&');
  return api(`/api/mimir/auto-estimate-status-batch?${q}`)
    .then((d) => d.statuses || d || {})
    .catch(() => ({}));
}

export function loadTenderFiles(tenderId) {
  return api(`/api/files/?tender_id=${tenderId}`)
    .then((d) => d.files || d.items || [])
    .catch(() => []);
}

export function loadWorksLinked(pmId = null) {
  if (pmId) {
    return api(`/api/works?pm_id=${pmId}`)
      .then((d) => d.works || d.items || [])
      .catch(() => []);
  }
  return api('/api/works')
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

export function loadUsers(role) {
  const q = role ? `?role=${role}&limit=200` : '?limit=200';
  return api('/api/users' + q).then((d) => d.users || d.items || []).catch(() => []);
}

export function createEstimate(payload) {
  return api('/api/estimates', { method: 'POST', body: payload });
}

export function updateEstimate(id, payload) {
  return api(`/api/estimates/${id}`, { method: 'PUT', body: payload });
}

export function updateTender(id, payload) {
  return api(`/api/tenders/${id}`, { method: 'PUT', body: payload });
}

export function filterByPeriod(items, period, dateField = 'created_at') {
  if (!period || period === 'all') return items;
  const now = Date.now();
  const cutoffs = {
    month: now - 30 * 86400000,
    quarter: now - 90 * 86400000,
    half: now - 180 * 86400000,
    year: now - 365 * 86400000,
    '24m': now - 730 * 86400000
  };
  const c = cutoffs[period];
  if (!c) return items;
  return items.filter((it) => {
    const t = it[dateField] && new Date(it[dateField]).getTime();
    return Number.isFinite(t) && t >= c;
  });
}

export function filterByQuery(items, q) {
  if (!q || !q.trim()) return items;
  const lq = q.trim().toLowerCase();
  return items.filter((t) =>
    (t.customer_name || '').toLowerCase().includes(lq) ||
    (t.tender_name || '').toLowerCase().includes(lq) ||
    (t.tag || '').toLowerCase().includes(lq) ||
    String(t.id).includes(lq)
  );
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

export function calcMargin(price, cost) {
  const p = +price, c = +cost;
  if (!Number.isFinite(p) || !Number.isFinite(c) || p <= 0) return null;
  return ((p - c) / p) * 100;
}

export function calcProfitPerManDay(price, cost, people, days) {
  const p = +price, c = +cost, n = +people, d = +days;
  if (!Number.isFinite(p) || !Number.isFinite(c) || !Number.isFinite(n) || !Number.isFinite(d) || n * d === 0) return null;
  return (p - c) / (n * d);
}
