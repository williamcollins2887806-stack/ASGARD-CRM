/**
 * API-клиент страниц зарплаты:
 *   /payroll        — список ведомостей + Excel-сетка баллов
 *   /payroll-sheet  — карточка ведомости (рабочие + ставки + премии + штрафы)
 *   /payroll-grid   — самостоятельный экран Excel-сетки (табель + баллы + суточные)
 *   /reports/payroll — отчёты по выплатам (реестр payment_registry + Excel)
 *
 * Источник: vanilla `public/assets/js/payroll.js` (1584 строки, AsgardPayrollPage).
 *
 * Бэкенды:
 *   • `src/routes/payroll.js`        — /api/payroll/sheets, /items, /one-time, /self-employed, /payments, /stats, /rates
 *   • `src/routes/worker-payments.js` — /api/worker-payments/reports/payroll-grid/:y/:m (+ /save + /export)
 */
import { api } from '@/api/client';

/* ─── константы ─── */
export const SHEET_STATUSES = {
  draft:     { label: 'Черновик',         tone: 'draft' },
  pending:   { label: 'На согласовании',  tone: 'sent' },
  approved:  { label: 'Согласовано',      tone: 'approved' },
  rework:    { label: 'Доработка',        tone: 'rework' },
  paid:      { label: 'Оплачено',         tone: 'paid' },
  cancelled: { label: 'Отменено',         tone: 'draft' }
};

export const SHEET_STATUS_TABS = [
  { id: 'all',      label: 'Все' },
  { id: 'draft',    label: 'Черновик' },
  { id: 'pending',  label: 'На согл.' },
  { id: 'approved', label: 'Согл-но' },
  { id: 'paid',     label: 'Оплачено' },
  { id: 'rework',   label: 'Доработка' }
];

export const PAYMENT_REGISTRY_STATUSES = {
  pending:    { label: 'Ожидает',       tone: 'sent' },
  processing: { label: 'В работе',      tone: 'sent' },
  paid:       { label: 'Оплачено',      tone: 'paid' },
  failed:     { label: 'Ошибка',        tone: 'rejected' },
  cancelled:  { label: 'Отменено',      tone: 'draft' }
};

export const PAYMENT_METHODS = {
  card:           { label: 'На карту',     icon: '💳' },
  cash:           { label: 'Наличные',     icon: '💵' },
  self_employed:  { label: 'СЗ / ГПХ',     icon: '🪪' },
  salary:         { label: 'З/п',          icon: '💰' },
  one_time:       { label: 'Разовая',      icon: '💸' },
  other:          { label: 'Прочее',       icon: '📦' }
};

export const MONTHS_RU = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
];

/* Категории дней по баллам — берётся из тарифной сетки (gridData.tariff_categories).
 * fallback: статичные диапазоны. Цвета через CSS-переменные, чтоб не ломать темы.
 */
export const CATEGORY_COLORS = {
  medical:   { bg: 'rgba(206, 147, 216, 0.45)',  fg: 'var(--t-1)', label: 'Медосмотр / обучение' },
  road:      { bg: 'rgba(59, 130, 246, 0.35)',   fg: 'var(--t-1)', label: 'Дорога / ожидание' },
  warehouse: { bg: 'rgba(245, 158, 11, 0.35)',   fg: 'var(--t-1)', label: 'Склад' },
  work:      { bg: 'rgba(34, 197, 94, 0.5)',     fg: 'var(--t-1)', label: 'Работа (смена)' },
  work_hard: { bg: 'rgba(34, 197, 94, 0.75)',    fg: 'var(--t-1)', label: 'Работа (сложная)' },
  senior:    { bg: 'rgba(59, 130, 246, 0.75)',   fg: 'var(--t-1)', label: 'Мастер / ИТР' },
  overtime:  { bg: 'rgba(255, 215, 0, 0.6)',     fg: 'var(--t-1)', label: 'Переработка / высокая' },
  combo:     { bg: 'rgba(168, 85, 247, 0.45)',   fg: 'var(--t-1)', label: 'Совмещение (+1)' }
};

export function statusMeta(s) { return SHEET_STATUSES[s] || { label: s || '—', tone: 'draft' }; }
export function regStatusMeta(s) { return PAYMENT_REGISTRY_STATUSES[s] || { label: s || '—', tone: 'draft' }; }
export function paymentMethodMeta(m) { return PAYMENT_METHODS[m] || { label: m || '—', icon: '📄' }; }

/* ─── RBAC ─── */
export const PAYROLL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM', 'BUH'];
export const APPROVE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
export const PAY_ROLES     = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

export function canApprove(role)  { return APPROVE_ROLES.includes(role); }
export function canPay(role)      { return PAY_ROLES.includes(role); }
export function canCreate(role)   { return ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM'].includes(role); }
export function hasAccess(role)   { return PAYROLL_ROLES.includes(role); }

/* ═══════════════════ ВЕДОМОСТИ ═══════════════════ */

export function loadSheets({ status, work_id, period_from, period_to, limit = 200 } = {}) {
  const q = new URLSearchParams();
  if (status && status !== 'all') q.set('status', status);
  if (work_id) q.set('work_id', String(work_id));
  if (period_from) q.set('period_from', period_from);
  if (period_to)   q.set('period_to',   period_to);
  q.set('limit', String(limit));
  return api(`/api/payroll/sheets?${q.toString()}`)
    .then((d) => d.sheets || d.items || [])
    .catch(() => []);
}

export function loadSheet(id) {
  return api(`/api/payroll/sheets/${id}`);
}

export function createSheet(payload) {
  return api('/api/payroll/sheets', { method: 'POST', body: payload });
}

export function updateSheet(id, payload) {
  return api(`/api/payroll/sheets/${id}`, { method: 'PUT', body: payload });
}

export function submitSheet(id) {
  return api(`/api/payroll/sheets/${id}/submit`, { method: 'PUT' });
}

export function approveSheet(id) {
  return api(`/api/payroll/sheets/${id}/approve`, { method: 'PUT' });
}

export function reworkSheet(id, comment) {
  return api(`/api/payroll/sheets/${id}/rework`, { method: 'PUT', body: { director_comment: comment } });
}

export function paySheet(id) {
  return api(`/api/payroll/sheets/${id}/pay`, { method: 'PUT' });
}

export function deleteSheet(id) {
  return api(`/api/payroll/sheets/${id}`, { method: 'DELETE' });
}

/* ─── СТРОКИ НАЧИСЛЕНИЙ ─── */

export function addItem(payload) {
  return api('/api/payroll/items', { method: 'POST', body: payload });
}

export function updateItem(id, payload) {
  return api(`/api/payroll/items/${id}`, { method: 'PUT', body: payload });
}

export function deleteItem(id) {
  return api(`/api/payroll/items/${id}`, { method: 'DELETE' });
}

export function autoFillItems(sheet_id) {
  return api('/api/payroll/items/auto-fill', { method: 'POST', body: { sheet_id } });
}

export function recalcItems(sheet_id) {
  return api('/api/payroll/items/recalc', { method: 'POST', body: { sheet_id } });
}

/* ─── СТАВКИ ─── */

export function loadRates(employee_id) {
  return api(`/api/payroll/rates?employee_id=${employee_id}`)
    .then((d) => d.rates || [])
    .catch(() => []);
}

export function currentRate(employee_id) {
  return api(`/api/payroll/rates/current?employee_id=${employee_id}`)
    .then((d) => d.rate || null)
    .catch(() => null);
}

export function createRate(payload) {
  return api('/api/payroll/rates', { method: 'POST', body: payload });
}

/* ─── РЕЕСТР ВЫПЛАТ ─── */

export function loadPayments({ sheet_id, status, employee_id, payment_method, date_from, date_to, limit = 500 } = {}) {
  const q = new URLSearchParams();
  if (sheet_id) q.set('sheet_id', String(sheet_id));
  if (status) q.set('status', status);
  if (employee_id) q.set('employee_id', String(employee_id));
  if (payment_method) q.set('payment_method', payment_method);
  if (date_from) q.set('date_from', date_from);
  if (date_to)   q.set('date_to',   date_to);
  q.set('limit', String(limit));
  return api(`/api/payroll/payments?${q.toString()}`)
    .then((d) => d.payments || [])
    .catch(() => []);
}

export function updatePaymentStatus(id, payload) {
  return api(`/api/payroll/payments/${id}/status`, { method: 'PUT', body: payload });
}

/* Excel-экспорт реестра — отдаёт blob. Возвращаем url для скачивания. */
export async function exportPaymentsExcel({ sheet_id } = {}) {
  const token = (() => { try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; } })();
  const q = new URLSearchParams();
  if (sheet_id) q.set('sheet_id', String(sheet_id));
  const url = `/api/payroll/payments/export?${q.toString()}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const blob = await r.blob();
  const fn = (r.headers.get('content-disposition') || '').match(/filename="?([^"]+)"?/)?.[1]
    || `payroll_${sheet_id || 'all'}.xlsx`;
  return { blob, filename: fn };
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

/* ═══════════════════ АНАЛИТИКА ═══════════════════ */

export function loadStats({ year, month } = {}) {
  const q = new URLSearchParams();
  if (year)  q.set('year',  String(year));
  if (month) q.set('month', String(month));
  return api(`/api/payroll/stats?${q.toString()}`)
    .catch(() => ({ total_accrued: 0, total_paid: 0, total_pending: 0, sheets_count: 0, workers_count: 0, avg_day_rate: 0, by_month: [], by_work: [], top_workers: [] }));
}

/* ═══════════════════ ЭТАЛОННАЯ СЕТКА ─ payroll-grid ═══════════════════ */

/* GET /api/worker-payments/reports/payroll-grid/:year/:month — расчёт сетки баллов */
export function loadPayrollGrid(year, month) {
  return api(`/api/worker-payments/reports/payroll-grid/${year}/${month}`);
}

/* PUT /api/worker-payments/reports/payroll-grid/:year/:month/save — сохранение баллов */
export function savePayrollGrid(year, month, changes) {
  return api(`/api/worker-payments/reports/payroll-grid/${year}/${month}/save`, {
    method: 'PUT',
    body: { changes }
  });
}

/* GET /api/worker-payments/reports/payroll-grid/:year/:month/export — Excel-сетка */
export async function exportPayrollGrid(year, month) {
  const token = (() => { try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; } })();
  const url = `/api/worker-payments/reports/payroll-grid/${year}/${month}/export`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const blob = await r.blob();
  const filename = `Ведомость_${MONTHS_RU[month - 1]}_${year}.xlsx`;
  return { blob, filename };
}

/* ═══════════════════ СПРАВОЧНИКИ ═══════════════════ */

export function loadEmployees() {
  return api('/api/data/employees?limit=2000')
    .then((d) => d.employees || d.items || [])
    .catch(() => []);
}

export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

/* ═══════════════════ ХЕЛПЕРЫ ═══════════════════ */

export function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '0 ₽';
  const num = Number(n);
  if (!Number.isFinite(num)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(num)) + ' ₽';
}

export function fmtMoneyShort(n) {
  const num = Number(n) || 0;
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000)    return Math.round(num / 1000) + 'K';
  return num.toLocaleString('ru-RU');
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

export function num(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(String(x).replace(/\s/g, '').replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

/* Маппинг баллов → тип категории. Строится из tariff_categories. */
export function buildPointsMap(tariffCats) {
  const out = {};
  if (!Array.isArray(tariffCats)) return out;
  for (const tc of tariffCats) {
    const pts = Number(tc.points);
    if (!pts) continue;
    const cat = tc.category;
    const labels = (tc.labels || []).join(', ').toLowerCase();
    let type = 'work';
    if (pts === 1) type = 'combo';
    else if (labels.includes('медосмотр') || labels.includes('обучение')) type = 'medical';
    else if (labels.includes('дорог') || labels.includes('ожидан') || labels.includes('выходной') || labels.includes('карантин')) type = 'road';
    else if (cat === 'warehouse') type = 'warehouse';
    else if (cat === 'ground_hard') type = 'work_hard';
    else if (labels.includes('мастер') || labels.includes('итр') || pts >= 19) type = 'senior';
    else if (labels.includes('переработк') || labels.includes('высокая') || pts >= 18) type = 'overtime';
    else if (cat === 'special' && pts >= 6 && pts <= 7) type = labels.includes('медосмотр') ? 'medical' : 'road';
    out[pts] = type;
  }
  return out;
}

export function guessCategoryType(pts) {
  if (pts <= 0) return '';
  if (pts === 1) return 'combo';
  if (pts <= 7)  return 'road';
  if (pts <= 10) return 'warehouse';
  if (pts <= 14) return 'work';
  if (pts <= 17) return 'work_hard';
  return 'overtime';
}

/* Возвращает {bg, fg, label} для конкретного значения баллов. */
export function pointsCellStyle(pts, pointsMap = {}) {
  if (!pts || pts <= 0) return { bg: '', fg: 'var(--t-3)', label: '' };
  const type = pointsMap[pts] || guessCategoryType(pts);
  return CATEGORY_COLORS[type] || { bg: '', fg: 'var(--t-2)', label: '' };
}

/* Сдвиг периода по ±1 месяц. */
export function shiftMonth(year, month, delta) {
  let m = month + delta;
  let y = year;
  while (m < 1)  { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { year: y, month: m };
}

/* Парсинг ?id=N&view=sheet|grid из hash. */
export function parseHashParams() {
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx < 0) return {};
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return Object.fromEntries(params.entries());
}

/* Note: loadPayrollRoot и loadPayrollGridRoot удалены 2026-06-14 — не импортировались,
 * fake-метрики. Реальный loadPayrollGrid выше. */
