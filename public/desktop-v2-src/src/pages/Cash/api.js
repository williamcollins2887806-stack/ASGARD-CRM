/**
 * API-клиент страницы /cash — Казна Дружины (РП-карточка).
 * Источник: vanilla `public/assets/js/cash.js` (797 строк).
 * Backend: src/routes/cash.js (prefix /api/cash).
 *
 * Vanilla endpoint mappings:
 *   '/api/cash/' (vanilla: fetch('/api/cash/' + id)) → '/api/cash/:id' (loadRequest)
 *   '/api/cash/:id/receipt/:id' (vanilla: receipt_file URL) → receiptDownloadUrl()
 */
import { api } from '@/api/client';

export const STATUS_LABELS = {
  requested:    'Ожидает',
  approved:     'Согласовано',
  money_issued: 'Деньги выданы',
  received:     'Получено',
  reporting:    'Отчёт',
  closed:       'Закрыто',
  rejected:     'Отклонено',
  question:     'Вопрос'
};

export const STATUS_TONE = {
  requested:    'warn',
  approved:     'ok',
  money_issued: 'info',
  received:     'info',
  reporting:    'info',
  closed:       'draft',
  rejected:     'err',
  question:     'warn'
};

export const TYPE_LABELS = {
  advance: 'Аванс на проект',
  loan:    'Долг до ЗП'
};

export const TYPE_OPTIONS = [
  { value: 'advance', label: 'Аванс на проект' },
  { value: 'loan',    label: 'Личный долг до ЗП' }
];

export const EXPENSE_CATEGORIES = [
  { value: 'materials', label: 'Материалы',     icon: '🧱' },
  { value: 'transport', label: 'Транспорт',     icon: '🚗' },
  { value: 'food',      label: 'Питание',       icon: '🍽️' },
  { value: 'housing',   label: 'Проживание',    icon: '🏨' },
  { value: 'tools',     label: 'Инструмент',    icon: '🔧' },
  { value: 'fuel',      label: 'Топливо',       icon: '⛽' },
  { value: 'other',     label: 'Прочее',        icon: '📦' }
];

export const CATEGORY_BY_VALUE = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, c]));

// Step order — money_issued добавлен между approved и received
export const ADVANCE_STEPS = ['requested', 'approved', 'money_issued', 'received', 'reporting', 'closed'];
export const LOAN_STEPS    = ['requested', 'approved', 'money_issued', 'received', 'closed'];
export const STEP_LABELS = {
  requested:    'Заявка',
  approved:     'Согласов.',
  money_issued: 'Выдано',
  received:     'Получено',
  reporting:    'Отчёт',
  closed:       'Закрыто'
};

// ─────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────

/** GET /api/cash/my-balance — баланс пользователя (виджет). */
export function loadMyBalance() {
  return api('/api/cash/my-balance');
}

/** GET /api/cash/my — заявки пользователя. */
export function loadMyRequests() {
  return api('/api/cash/my');
}

/** GET /api/cash/:id — детали заявки (доступно владельцу/BUH/директору). */
export function loadRequest(id) {
  return api(`/api/cash/${id}`);
}

/** POST /api/cash — создать заявку (advance/loan). */
export function createRequest(payload) {
  return api('/api/cash', { method: 'POST', body: payload });
}

/** PUT /api/cash/:id/receive — РП подтверждает получение денег. */
export function confirmReceive(id) {
  return api(`/api/cash/${id}/receive`, { method: 'PUT' });
}

/** PUT /api/cash/:id/submit-report — РП подаёт авансовый отчёт. */
export function submitReport(id) {
  return api(`/api/cash/${id}/submit-report`, { method: 'PUT' });
}

/** POST /api/cash/:id/return — возврат остатка. */
export function returnRemainder(id, body) {
  return api(`/api/cash/${id}/return`, { method: 'POST', body });
}

/** POST /api/cash/:id/reply — ответ РП на вопрос директора. */
export function replyToQuestion(id, message) {
  return api(`/api/cash/${id}/reply`, { method: 'POST', body: { message } });
}

/** DELETE /api/cash/:id/expense/:expenseId — удалить расход. */
export function deleteExpense(id, expenseId) {
  return api(`/api/cash/${id}/expense/${expenseId}`, { method: 'DELETE' });
}

/** GET /api/works — список работ для выбора проекта. */
export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || d || [])
    .catch(() => []);
}

/** POST /api/cash/:id/expense — добавить расход (multipart). */
export async function addExpense(id, formData) {
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

/** Открыть чек в новой вкладке БЕЗ токена в URL (blob через Authorization header). */
export async function openReceipt(requestId, filename) {
  const { openProtected } = await import('@/api/download');
  return openProtected(`/api/cash/${requestId}/receipt/${encodeURIComponent(filename)}`, filename);
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

export function fmtMoney(val) {
  const n = Math.round(Number(val || 0));
  return new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
}

export function fmtDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function fmtDateTime(val) {
  if (!val) return '—';
  const d = new Date(val);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '—';
}

/** Подсчёт дедлайна — { hours, mins, isOverdue, color }. */
export function deadlineMeta(deadline, isOverdueFlag) {
  if (!deadline) return null;
  const deadDate = new Date(deadline);
  if (isOverdueFlag || deadDate < new Date()) {
    return { isOverdue: true, hours: 0, mins: 0, tone: 'err' };
  }
  const diff = deadDate - new Date();
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return {
    isOverdue: false,
    hours,
    mins,
    tone: hours < 2 ? 'err' : 'warn'
  };
}
