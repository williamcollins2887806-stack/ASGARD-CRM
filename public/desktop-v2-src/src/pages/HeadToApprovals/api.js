/**
 * API-клиент страницы /head-to-approvals — очередь согласования просчётов ТО для Рук. ТО (Хосе).
 * Источник: vanilla `public/assets/js/head_to_approvals.js` (217 строк).
 *
 * Эндпоинты:
 *   GET  /api/tenders?limit=2000             — фильтруем calculator_kind='to'
 *   GET  /api/estimates?tender_id=N         — для каждого тендера ищем sent estimate
 *   POST /api/approval/estimates/:id/approve
 *   POST /api/approval/estimates/:id/rework
 *   POST /api/approval/estimates/:id/question
 *   POST /api/approval/estimates/:id/reject
 *
 * Бэкенд знает, что для calculator_kind='to' согласует HEAD_TO (см. approvalService.js).
 */
import { api } from '@/api/client';

export function loadToTenders() {
  return api('/api/tenders?limit=2000')
    .then((d) => (d.tenders || d.items || []).filter((t) => t.calculator_kind === 'to'));
}

export function loadSentEstimates(tenderId) {
  return api(`/api/estimates?tender_id=${tenderId}`)
    .then((d) => (d.estimates || d.items || []).filter((e) => e.approval_status === 'sent'))
    .catch(() => []);
}

export async function loadPendingQueue() {
  const tenders = await loadToTenders();
  if (!tenders.length) return [];
  const promises = tenders.map((t) =>
    loadSentEstimates(t.id).then((arr) => arr.map((e) => ({ tender: t, estimate: e })))
  );
  const nested = await Promise.all(promises);
  const flat = nested.flat();
  flat.sort((a, b) =>
    String(b.estimate.sent_for_approval_at || '').localeCompare(String(a.estimate.sent_for_approval_at || ''))
  );
  return flat;
}

export function approveEstimate(estId, comment = '') {
  return api(`/api/approval/estimates/${estId}/approve`, {
    method: 'POST', body: { comment }
  });
}

export function reworkEstimate(estId, comment) {
  return api(`/api/approval/estimates/${estId}/rework`, {
    method: 'POST', body: { comment }
  });
}

export function questionEstimate(estId, comment) {
  return api(`/api/approval/estimates/${estId}/question`, {
    method: 'POST', body: { comment }
  });
}

export function rejectEstimate(estId, comment) {
  return api(`/api/approval/estimates/${estId}/reject`, {
    method: 'POST', body: { comment }
  });
}

export function fmtMoney(n) {
  if (!Number.isFinite(+n) || +n <= 0) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '—';
}
