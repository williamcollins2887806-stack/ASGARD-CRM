/**
 * API-клиент страницы /office-expenses.
 * Источник: vanilla `public/assets/js/office_expenses.js` (603 строки, AsgardOfficeExpensesPage).
 *
 * Бэкенд:
 *   GET   /api/expenses/office?status=&category=&date_from=&date_to=&limit= — список
 *   POST  /api/expenses/office                                              — создать
 *   PUT   /api/expenses/office/:id                                          — обновить
 *   DELETE /api/expenses/office/:id                                         — удалить
 *
 *   POST  /api/approval/office_expenses/:id/send                            — отправить на согласование
 *   POST  /api/approval/office_expenses/:id/approve                         — согласовать
 *   POST  /api/approval/office_expenses/:id/reject                          — отклонить
 *   POST  /api/approval/office_expenses/:id/rework                          — на доработку
 *
 * Доступ: ADMIN, OFFICE_MANAGER, DIRECTOR_*, BUH.
 */
import { api } from '@/api/client';

export const CATEGORIES = [
  { key: 'rent',             label: 'Аренда офиса',         icon: '🏢' },
  { key: 'utilities',        label: 'Коммунальные',         icon: '💡' },
  { key: 'office_supplies',  label: 'Канцелярия',           icon: '📎' },
  { key: 'communication',    label: 'Связь и интернет',     icon: '📡' },
  { key: 'transport',        label: 'Транспорт/такси',      icon: '🚕' },
  { key: 'household',        label: 'Хозтовары',            icon: '🧹' },
  { key: 'office_equipment', label: 'Оборудование офиса',   icon: '🖥' },
  { key: 'software',         label: 'ПО и подписки',        icon: '💿' },
  { key: 'representation',   label: 'Представительские',    icon: '🎁' },
  { key: 'project_expense',  label: 'Расходы на объект',    icon: '🏗' },
  { key: 'tools',            label: 'Инструменты/СИЗ',      icon: '🔨' },
  { key: 'other',            label: 'Прочее',               icon: '📦' }
];

export const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({
  value: c.key,
  label: `${c.icon} ${c.label}`
}));

export const STATUSES = {
  draft:     { label: 'Черновик',         tone: 'draft' },
  pending:   { label: 'На согласовании',  tone: 'sent' },
  sent:      { label: 'На согласовании',  tone: 'sent' },
  approved:  { label: 'Согласовано',      tone: 'approved' },
  rejected:  { label: 'Отклонено',        tone: 'rejected' },
  rework:    { label: 'На доработку',     tone: 'rework' },
  question:  { label: 'Вопрос',           tone: 'question' },
  paid:      { label: 'Оплачено',         tone: 'paid' }
};

export const STATUS_TABS = [
  { id: 'all',      label: 'Все' },
  { id: 'pending',  label: 'На согласовании' },
  { id: 'approved', label: 'Согласовано' },
  { id: 'rejected', label: 'Отклонено' },
  { id: 'draft',    label: 'Черновики' }
];

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

export function categoryMeta(key) {
  return CATEGORIES.find((c) => c.key === key) || { key, label: key || '—', icon: '📦' };
}

export function statusMeta(s) {
  const k = s === 'sent' ? 'pending' : s;
  return STATUSES[k] || { label: s || '—', tone: 'draft' };
}

/** GET список. Бэк фильтрует по status/category/date_from/date_to. */
export function loadExpenses({ status, category, date_from, date_to, limit = 500 } = {}) {
  const q = new URLSearchParams();
  if (status && status !== 'all') {
    // bridge: backend хранит 'pending', vanilla называет 'pending'.
    q.set('status', status === 'pending' ? 'pending' : status);
  }
  if (category) q.set('category', category);
  if (date_from) q.set('date_from', date_from);
  if (date_to) q.set('date_to', date_to);
  q.set('limit', String(limit));
  return api(`/api/expenses/office?${q.toString()}`)
    .then((d) => d.expenses || d.items || [])
    .catch(() => []);
}

export function createExpense(payload) {
  return api('/api/expenses/office', { method: 'POST', body: payload });
}

export function updateExpense(id, payload) {
  return api(`/api/expenses/office/${id}`, { method: 'PUT', body: payload });
}

export function deleteExpense(id) {
  return api(`/api/expenses/office/${id}`, { method: 'DELETE' });
}

/** Workflow согласования через универсальные approval-маршруты. */
export function sendForApproval(id) {
  return api(`/api/approval/office_expenses/${id}/send`, { method: 'POST', body: {} });
}

export function approveExpense(id, comment = '') {
  return api(`/api/approval/office_expenses/${id}/approve`, { method: 'POST', body: { comment } });
}

export function rejectExpense(id, comment) {
  return api(`/api/approval/office_expenses/${id}/reject`, { method: 'POST', body: { comment } });
}

export function reworkExpense(id, comment) {
  return api(`/api/approval/office_expenses/${id}/rework`, { method: 'POST', body: { comment } });
}

export function loadComments(id) {
  return api(`/api/approval/office_expenses/${id}/comments`)
    .then((d) => d.comments || [])
    .catch(() => []);
}

/* ─── Хелперы ─── */

export function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(num)) + ' ₽';
}

export function fmtMoneyShort(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + ' млн ₽';
  if (num >= 1_000)     return (num / 1_000).toFixed(0) + ' тыс ₽';
  return fmtMoney(num);
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

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function buildYearOptions() {
  const now = new Date().getFullYear();
  return [
    { value: '', label: 'Все годы' },
    ...[0, 1, 2, 3].map((d) => ({ value: String(now - d), label: String(now - d) }))
  ];
}

export function buildMonthOptions() {
  return [
    { value: '', label: 'Все месяцы' },
    ...MONTHS.map((m, i) => ({ value: String(i), label: m }))
  ];
}

/** Клиентская фильтрация для тех случаев, когда бэк отдал всё. */
export function filterByYearMonth(list, year, month) {
  return list.filter((e) => {
    if (!e.date) return false;
    const d = new Date(e.date);
    if (!Number.isFinite(d.getTime())) return false;
    if (year !== '' && year != null && d.getFullYear() !== Number(year)) return false;
    if (month !== '' && month != null && d.getMonth() !== Number(month)) return false;
    return true;
  });
}

export function filterByQuery(items, q) {
  if (!q || !q.trim()) return items;
  const lq = q.trim().toLowerCase();
  return items.filter((e) =>
    (e.supplier || '').toLowerCase().includes(lq) ||
    (e.comment || '').toLowerCase().includes(lq) ||
    (e.description || '').toLowerCase().includes(lq) ||
    (e.doc_number || '').toLowerCase().includes(lq) ||
    String(e.id).includes(lq)
  );
}

export function sumByCategory(list) {
  const totals = {};
  CATEGORIES.forEach((c) => { totals[c.key] = 0; });
  for (const e of list) {
    const k = e.category;
    if (totals[k] !== undefined) totals[k] += Number(e.amount || 0);
  }
  return totals;
}

export function getStatusKey(e) {
  // На стороне approval-машины поле меняется на approval_status. Берём то, что есть.
  return e.approval_status || e.status || 'draft';
}
