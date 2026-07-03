/**
 * API-клиент страницы /pm-works.
 * Источник: vanilla `public/assets/js/pm_works.js` (≈1932 строки).
 */
import { api } from '@/api/client';

// КРУГ B Smoke: backend хранит русские лейблы (works.js:73 STATUS_TRANSITIONS),
// vanilla pm_works.js работал по русским строкам. React-миграция ошибочно перевела
// в английские коды — фильтры/кнопка «Закрыть работу» не срабатывали.
// value = label = русская строка (как в БД).
export const WORK_STATUSES = [
  { value: 'Новая',           label: 'Новая',           tone: 'draft',    group: 'PREP' },
  { value: 'Подготовка',      label: 'Подготовка',      tone: 'question', group: 'PREP' },
  { value: 'Мобилизация',     label: 'Мобилизация',     tone: 'sent',     group: 'PREP' },
  { value: 'В работе',        label: 'В работе',        tone: 'approved', group: 'ACTIVE' },
  { value: 'На паузе',        label: 'На паузе',        tone: 'draft',    group: 'ACTIVE' },
  { value: 'Подписание акта', label: 'Подписание акта', tone: 'sent',     group: 'CLOSEOUT' },
  { value: 'Работы сдали',    label: 'Работы сдали',    tone: 'approved', group: 'CLOSEOUT' },
  { value: 'Закрыт',          label: 'Закрыт',          tone: 'approved', group: 'CLOSED' },
  { value: 'Отменена',        label: 'Отменена',        tone: 'rejected', group: 'CLOSED' }
];

/**
 * Допустимые переходы статусов работы (источник: works.js:73 STATUS_TRANSITIONS).
 * Русские лейблы — точно как в БД (см. work_status).
 */
export const WORK_STATUS_TRANSITIONS = {
  'Новая':            ['Подготовка'],
  'Подготовка':       ['Мобилизация', 'Новая'],
  'Мобилизация':      ['В работе', 'Подготовка'],
  'В работе':         ['Подписание акта', 'На паузе'],
  'На паузе':         ['В работе'],
  'Подписание акта':  ['Работы сдали'],
  'Работы сдали':     ['Закрыт'],
  'Закрыт':           []
};

// 23.06.2026 BUG-FIX (Sites D-M10/D-M11): re-export канонических наборов из helpers/work-status,
// чтобы локальные потребители PmWorks/api ничего не ломали, но истина — одна.
export { PREP_STATUSES, isPrepWork } from '@/helpers/work-status';
import { PREP_STATUSES as _PREP_STATUSES } from '@/helpers/work-status';
export const ACTIVE_STATUSES = ['В работе', 'На паузе'];
export const CLOSEOUT_STATUSES = ['Подписание акта', 'Работы сдали'];
// Vanilla pm_works имел расширенный набор финальных статусов (см. MyDashboard DONE_SET).
// Без «Завершена/Сдан/Закрыто» PM не видел свои старые контракты (баг найден у Андросова,
// работа АРХБУМ id=10 со статусом «Завершена» уезжала в никуда).
export const CLOSED_STATUSES = [
  'Закрыт', 'Закрыта', 'Закрыто',
  'Завершена', 'Завершено', 'Завершен', 'Завершён',
  'Сдан', 'Сдана', 'Сдано',
  'Отменена', 'Отменено', 'Отменён', 'Отменен', 'Отмена'
];

export function loadWorks(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 500));
  if (params.status) q.set('status', params.status);
  return api(`/api/works?${q.toString()}`).then((d) => d.works || d.items || []);
}

export function loadFinancialSummary(workId) {
  return api(`/api/works/${workId}/financial-summary`).catch(() => ({}));
}

export function loadReadinessSummary(workIds = []) {
  if (!workIds.length) return Promise.resolve({});
  const q = workIds.map((i) => `ids=${i}`).join('&');
  return api(`/api/work-readiness/summary?${q}`).catch(() => ({}));
}

export function updateWork(workId, payload) {
  return api(`/api/works/${workId}`, { method: 'PUT', body: payload });
}

export function loadProcurementForWork(workId) {
  return api(`/api/procurement?work_id=${workId}`).then((d) => d.requests || d.items || []).catch(() => []);
}

export function loadAssemblyForWork(workId) {
  return api(`/api/assembly?work_id=${workId}`).then((d) => d.orders || d.items || []).catch(() => []);
}

export function loadEquipmentAvailable(from, to) {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  return api(`/api/equipment/available?${q.toString()}`).then((d) => d.items || d.equipment || []).catch(() => []);
}

/* ─── E-6b: Расходы по работе — позиции + аттач чека ───
 * Vanilla work_expenses.js:318 — GET /api/expenses/items/:expense_id
 * Vanilla work_expenses.js:509 — POST /api/expenses/attach/:expense_id (multipart file)
 * Backend src/routes/expenses.js:139, :191.
 */
export function loadWorkExpenses(workId) {
  return api('/api/expenses/work?work_id=' + workId)
    .then((d) => d.expenses || d.items || [])
    .catch(() => []);
}

export function loadExpenseItems(expenseId) {
  return api('/api/expenses/items/' + expenseId)
    .then((d) => d.items || [])
    .catch(() => []);
}

export function loadExpenseCategories() {
  return api('/api/expenses/categories')
    .then((d) => ({
      categories: d.categories || [],
      subcategories: d.subcategories || {},
      payment_methods: d.payment_methods || []
    }))
    .catch(() => ({ categories: [], subcategories: {}, payment_methods: [] }));
}

export function addExpense(payload) {
  return api('/api/expenses/work', { method: 'POST', body: payload });
}

export function addExpenseItem(expenseId, payload) {
  return api('/api/expenses/items/' + expenseId, { method: 'POST', body: payload });
}

export function bulkAddExpenseItems(expenseId, items) {
  return api('/api/expenses/items/' + expenseId + '/bulk', { method: 'POST', body: { items } });
}

/* Аттач файла чека к расходу (multipart). Возвращает {ok, attachment_url}. */
export async function attachExpenseFile(expenseId, file) {
  const fd = new FormData();
  fd.append('file', file);
  const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('asgard_token') : '';
  const r = await fetch('/api/expenses/attach/' + expenseId, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  if (!r.ok) throw new Error('Не удалось прикрепить файл: HTTP ' + r.status);
  return r.json();
}

/* E-6b: импорт эталона в Мимир-Conductor (vanilla pm_works.js:1921).
 * РП внёс факт завершённой работы → Мимир использует как эталон при просчёте похожих.
 */
export function mimirConductorReferenceImport(payload) {
  return api('/api/mimir/conductor/reference/import', { method: 'POST', body: payload });
}

/* E-6b: старт Мимир-Conductor для работы / тендера. */
export function mimirConductorStart(payload) {
  return api('/api/mimir/conductor/start', { method: 'POST', body: payload });
}

export function filterByQuery(works, q) {
  if (!q || !q.trim()) return works;
  const lq = q.trim().toLowerCase();
  return works.filter((w) =>
    (w.customer_name || '').toLowerCase().includes(lq) ||
    (w.work_title || '').toLowerCase().includes(lq) ||
    (w.tender_name || '').toLowerCase().includes(lq) ||
    String(w.id).includes(lq)
  );
}

export function filterByStatus(works, status) {
  if (!status) return works;
  return works.filter((w) => w.work_status === status);
}

export function filterByGroup(works, group) {
  if (!group || group === 'all') return works;
  const map = { prep: _PREP_STATUSES, active: ACTIVE_STATUSES, closeout: CLOSEOUT_STATUSES, closed: CLOSED_STATUSES };
  const allowed = map[group];
  if (!allowed) return works;
  return works.filter((w) => allowed.includes(w.work_status));
}

export function pctDelta(fact, plan) {
  if (!plan || !Number.isFinite(+plan) || +plan === 0) return null;
  return ((+fact - +plan) / +plan) * 100;
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

/* ─── Wrappers под чат-группы и список работ (vanilla pm_works.js) ─── */

/* Note: было 4 wrappers (loadChatGroups/Root/ByEntity, loadWorksRoot).
 * Удалены 2026-06-14 — ни одна не импортируется из UI; добавлены только
 * для накрутки coverage-audit метрик.
 */
