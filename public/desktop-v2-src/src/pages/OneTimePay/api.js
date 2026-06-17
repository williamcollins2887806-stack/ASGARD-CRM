/**
 * API-клиент страницы /one-time-pay.
 * Источник: vanilla `public/assets/js/payroll.js` (renderOneTimePay, ~250 строк) +
 *          `public/assets/js/cash.js` (797 строк, выдача и возврат подотчётных).
 *
 * Бэкенд (роуты `/api/payroll/*` + `/api/cash/*`):
 *   GET   /api/payroll/one-time?status=&limit=        — список (PM видит только свои)
 *   POST  /api/payroll/one-time                       — создать запрос
 *   PUT   /api/payroll/one-time/:id/approve           — согласовать (директор)
 *   PUT   /api/payroll/one-time/:id/reject  body:{director_comment} — отклонить (директор)
 *   PUT   /api/payroll/one-time/:id/pay                — отметить оплаченным (BUH/директор)
 *
 *   POST   /api/cash                                  — создать заявку в кассу (advance/loan)
 *   POST   /api/cash/:id/expense                      — добавить расход (FormData)
 *   DELETE /api/cash/:id/expense/:expenseId           — удалить расход
 *   POST   /api/cash/:id/return                       — вернуть остаток
 *   POST   /api/cash/:id/reply                        — ответить на вопрос директора
 *   PUT    /api/cash/:id/receive                      — подтвердить получение
 *   PUT    /api/cash/:id/submit-report                — подать авансовый отчёт
 *
 *   GET   /api/data/employees           — справочник рабочих (для модалки)
 *   GET   /api/works?limit=2000          — работы (для привязки)
 */
import { api } from '@/api/client';

export const PAYMENT_TYPES = {
  one_time: { label: 'Разовая',   icon: '💵' },
  taxi:     { label: 'Такси',     icon: '🚕' },
  fuel:     { label: 'Топливо',   icon: '⛽' },
  meal:     { label: 'Питание',   icon: '🍽' },
  material: { label: 'Материалы', icon: '🔧' },
  other:    { label: 'Прочее',    icon: '📦' }
};

export const PAYMENT_TYPE_OPTIONS = Object.entries(PAYMENT_TYPES).map(([value, { label, icon }]) => ({
  value,
  label: `${icon} ${label}`
}));

export const OTP_STATUSES = {
  pending:  { label: 'На согласовании', tone: 'sent' },
  approved: { label: 'Согласовано',     tone: 'approved' },
  paid:     { label: 'Оплачено',        tone: 'paid' },
  rejected: { label: 'Отклонено',       tone: 'rejected' }
};

export const STATUS_TABS = [
  { id: 'all',      label: 'Все' },
  { id: 'pending',  label: 'Ожидают' },
  { id: 'approved', label: 'Согласовано' },
  { id: 'paid',     label: 'Оплачено' },
  { id: 'rejected', label: 'Отказ' }
];

export function statusMeta(s) {
  return OTP_STATUSES[s] || { label: s || '—', tone: 'draft' };
}

export function typeMeta(t) {
  return PAYMENT_TYPES[t] || PAYMENT_TYPES.other;
}

export function loadOneTime({ status, limit = 200 } = {}) {
  const q = new URLSearchParams();
  if (status && status !== 'all') q.set('status', status);
  q.set('limit', String(limit));
  return api(`/api/payroll/one-time?${q.toString()}`)
    .then((d) => d.items || [])
    .catch(() => []);
}

export function loadEmployees() {
  return api('/api/data/employees?limit=2000')
    .then((d) => d.employees || d.items || [])
    .catch(() => []);
}

export function loadWorks() {
  return api('/api/works?limit=2000', { method: 'GET' })
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

/**
 * GET /api/cash/my-balance — баланс пользователя по кассе (виджет).
 * Vanilla: cash.js:85.
 */
export function loadCashBalance() {
  return api('/api/cash/my-balance', { method: 'GET' })
    .catch(() => ({ balance: 0 }));
}

/**
 * GET /api/cash/my — заявки пользователя.
 * Vanilla: cash.js:126.
 */
export function loadMyCashRequests() {
  return api('/api/cash/my', { method: 'GET' })
    .then((d) => d.items || d.requests || [])
    .catch(() => []);
}

/**
 * GET /api/cash/:id — детали заявки (доступно владельцу/BUH/директору).
 * Vanilla: cash.js:401.
 */
export function loadCashRequest(id) {
  return api(`/api/cash/${id}`, { method: 'GET' });
}

export function createOneTime(payload) {
  return api('/api/payroll/one-time', {
    method: 'POST',
    body: {
      employee_id: payload?.employee_id,
      amount: payload?.amount,
      reason: payload?.reason || '',
      work_id: payload?.work_id ?? null,
      payment_type: payload?.payment_type || 'one_time'
    }
  });
}

export function approveOneTime(id) {
  return api(`/api/payroll/one-time/${id}/approve`, { method: 'PUT' });
}

export function rejectOneTime(id, directorComment) {
  return api(`/api/payroll/one-time/${id}/reject`, {
    method: 'PUT',
    body: { director_comment: directorComment }
  });
}

export function payOneTime(id) {
  return api(`/api/payroll/one-time/${id}/pay`, { method: 'PUT' });
}

/* ─────────────────────────────────────────────────────────────
 * Cash workflow (vanilla cash.js): для разовых оплат, где деньги
 * выдаются под отчёт (advance/loan) → требуется приёмка, расходы
 * и возврат остатка. Полный workflow выдачи денег под отчёт.
 * ─────────────────────────────────────────────────────────────*/

/**
 * POST /api/cash — создать заявку в кассу (тип advance/loan).
 * Vanilla: cash.js:363.
 */
export function createCashRequest(payload) {
  return api('/api/cash', {
    method: 'POST',
    body: {
      type: payload?.type || 'advance',
      work_id: payload?.work_id ?? null,
      amount: payload?.amount,
      purpose: payload?.purpose || '',
      cover_letter: payload?.cover_letter || null
    }
  });
}

/**
 * PUT /api/cash/:id/receive — РП подтверждает получение денег.
 * Vanilla: cash.js:575.
 */
export function confirmCashReceive(id) {
  return api(`/api/cash/${id}/receive`, { method: 'PUT' });
}

/**
 * PUT /api/cash/:id/submit-report — РП подаёт авансовый отчёт.
 * Vanilla: cash.js:587.
 */
export function submitCashReport(id) {
  return api(`/api/cash/${id}/submit-report`, { method: 'PUT' });
}

/**
 * POST /api/cash/:id/return — вернуть остаток. Vanilla cash.js:720.
 */
export function returnCashRemainder(id, payload) {
  return api(`/api/cash/${id}/return`, {
    method: 'POST',
    body: {
      amount: payload?.amount,
      note: payload?.note || null
    }
  });
}

/**
 * POST /api/cash/:id/reply — ответить на вопрос директора.
 * Vanilla: cash.js:763.
 */
export function replyCashQuestion(id, message) {
  return api(`/api/cash/${id}/reply`, {
    method: 'POST',
    body: { message }
  });
}

/**
 * POST /api/cash/:id/expense — добавить расход (multipart FormData).
 * Vanilla: cash.js:659.
 */
export async function addCashExpense(id, formData) {
  let token = '';
  try { token = localStorage.getItem('asgard_token') || ''; } catch { /* noop */ }
  const r = await fetch(`/api/cash/${id}/expense`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: formData
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let err = '';
    try { err = JSON.parse(t).error || t; } catch { err = t; }
    throw new Error(err || `HTTP ${r.status}`);
  }
  return r.json();
}

/**
 * DELETE /api/cash/:id/expense/:expenseId — удалить расход.
 * Vanilla: cash.js:676.
 */
export function deleteCashExpense(id, expenseId) {
  return api(`/api/cash/${id}/expense/${expenseId}`, { method: 'DELETE' });
}

export function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(num)) + ' ₽';
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
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* Note: loadCashRoot и loadCashReceipt удалены 2026-06-14 — не импортировались,
 * добавлялись только под coverage-audit. */

export function filterByQuery(items, q) {
  if (!q || !q.trim()) return items;
  const lq = q.trim().toLowerCase();
  return items.filter((it) =>
    (it.employee_name || '').toLowerCase().includes(lq) ||
    (it.requester_name || '').toLowerCase().includes(lq) ||
    (it.work_title || '').toLowerCase().includes(lq) ||
    (it.reason || '').toLowerCase().includes(lq) ||
    String(it.id).includes(lq)
  );
}
