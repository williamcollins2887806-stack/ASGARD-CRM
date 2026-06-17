/**
 * API-клиент страницы /cash-admin — Казна Управление (БУХ/директор).
 * Источник: vanilla `public/assets/js/cash_admin.js` (~1145 строк).
 * Backend: src/routes/cash.js (prefix /api/cash).
 *
 * Vanilla endpoint mappings:
 *   '/api/cash/' (vanilla: '/api/cash/' + id) → '/api/cash/:id' (loadRequest)
 *   '/api/cash/all' (vanilla: '/api/cash/all') → loadAllRequests
 *   '/api/cash/:id/receipt/:id' (vanilla: receipt_file URL) → receiptDownloadUrl()
 */
import { api } from '@/api/client';

export {
  STATUS_LABELS, STATUS_TONE, TYPE_LABELS, TYPE_OPTIONS,
  EXPENSE_CATEGORIES, CATEGORY_BY_VALUE,
  ADVANCE_STEPS, LOAN_STEPS, STEP_LABELS,
  fmtMoney, fmtDate, fmtDateTime, deadlineMeta,
  openReceipt, loadRequest
} from '../Cash/api';

/** GET /api/cash/all?status= — все заявки (с фильтром). */
export function loadAllRequests({ status } = {}) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  const qs = q.toString();
  return api('/api/cash/all' + (qs ? '?' + qs : ''));
}

/** GET /api/cash/summary — сводка по сотрудникам. */
export function loadSummary() {
  return api('/api/cash/summary');
}

/** GET /api/cash/balance — баланс кассы + последние операции. */
export function loadCashBalance() {
  return api('/api/cash/balance');
}

/** POST /api/cash/balance/adjust — корректировка баланса кассы. */
export function adjustBalance(body) {
  return api('/api/cash/balance/adjust', { method: 'POST', body });
}

/** PUT /api/cash/:id/approve — согласовать заявку. */
export function approveRequest(id, comment = null) {
  return api(`/api/cash/${id}/approve`, { method: 'PUT', body: { comment } });
}

/** PUT /api/cash/:id/issue — выдать деньги. */
export function issueMoney(id) {
  return api(`/api/cash/${id}/issue`, { method: 'PUT', body: {} });
}

/** PUT /api/cash/:id/reject — отклонить. */
export function rejectRequest(id, comment) {
  return api(`/api/cash/${id}/reject`, { method: 'PUT', body: { comment } });
}

/** PUT /api/cash/:id/question — задать вопрос. */
export function askQuestion(id, message) {
  return api(`/api/cash/${id}/question`, { method: 'PUT', body: { message } });
}

/** PUT /api/cash/:id/close — закрыть заявку (force при остатке). */
export function closeRequest(id, body) {
  return api(`/api/cash/${id}/close`, { method: 'PUT', body });
}

/** PUT /api/cash/:id/return/:returnId/confirm — подтвердить возврат. */
export function confirmReturn(id, returnId) {
  return api(`/api/cash/${id}/return/${returnId}/confirm`, { method: 'PUT' });
}

export const ADMIN_STATUS_OPTIONS = [
  { value: '',             label: 'Все статусы' },
  { value: 'requested',    label: 'Ожидают согласования' },
  { value: 'approved',     label: 'Согласованы' },
  { value: 'money_issued', label: 'Деньги выданы' },
  { value: 'received',     label: 'Получены' },
  { value: 'reporting',    label: 'Отчёт' },
  { value: 'question',     label: 'Вопрос' },
  { value: 'closed',       label: 'Закрыты' },
  { value: 'rejected',     label: 'Отклонены' }
];

export const ADMIN_TYPE_OPTIONS = [
  { value: '',        label: 'Все типы' },
  { value: 'advance', label: 'Аванс' },
  { value: 'loan',    label: 'Долг до ЗП' }
];
