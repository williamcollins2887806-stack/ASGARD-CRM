/**
 * API-клиент страницы /self-employed.
 * Источник: vanilla `public/assets/js/payroll.js` (renderSelfEmployed + renderInlineGrid).
 *
 * Бэкенды:
 *   src/routes/payroll.js:
 *     GET   /api/payroll/self-employed?search=     — список (с поиском)
 *     POST  /api/payroll/self-employed             — добавить (валидация ИНН 12 цифр)
 *     PUT   /api/payroll/self-employed/:id         — обновить
 *     GET   /api/payroll/self-employed/:id/payments — история выплат
 *     GET   /api/data/employees                    — справочник для employee_id-привязки
 *
 *   src/routes/worker-payments.js (ведомость-сетка — вкладка «Ведомость» в vanilla payroll.js):
 *     GET   /api/worker-payments/reports/payroll-grid/:year/:month        — расчёт сетки
 *     PUT   /api/worker-payments/reports/payroll-grid/:year/:month/save   — сохранить правки
 *     GET   /api/worker-payments/reports/payroll-grid/:year/:month/export — Excel
 */
import { api } from '@/api/client';

export const NPD_STATUSES = [
  { value: 'active',    label: 'Активен',     tone: 'approved' },
  { value: 'suspended', label: 'Приостановлен', tone: 'question' },
  { value: 'closed',    label: 'Закрыт',      tone: 'rejected' }
];

export const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Все статусы НПД' },
  ...NPD_STATUSES.map((s) => ({ value: s.value, label: s.label }))
];

export function npdMeta(status) {
  return NPD_STATUSES.find((s) => s.value === status) || { label: status || 'active', tone: 'approved' };
}

export function loadSelfEmployed({ search } = {}) {
  const q = new URLSearchParams();
  if (search) q.set('search', search);
  return api(`/api/payroll/self-employed?${q.toString()}`)
    .then((d) => d.items || [])
    .catch(() => []);
}

export function loadEmployees() {
  return api('/api/data/employees?limit=2000')
    .then((d) => d.employees || d.items || [])
    .catch(() => []);
}

export function loadPayments(id) {
  return api(`/api/payroll/self-employed/${id}/payments`)
    .then((d) => ({ payments: d.payments || [], total_paid: d.total_paid || 0 }))
    .catch(() => ({ payments: [], total_paid: 0 }));
}

export function createSelfEmployed(payload) {
  return api('/api/payroll/self-employed', { method: 'POST', body: payload });
}

export function updateSelfEmployed(id, payload) {
  return api(`/api/payroll/self-employed/${id}`, { method: 'PUT', body: payload });
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

export function maskAccount(acc) {
  if (!acc || acc.length < 4) return acc || '';
  return '****' + acc.slice(-4);
}

export function filterByQuery(items, q) {
  if (!q || !q.trim()) return items;
  const lq = q.trim().toLowerCase();
  return items.filter((it) =>
    (it.full_name || '').toLowerCase().includes(lq) ||
    (it.inn || '').includes(lq) ||
    (it.phone || '').includes(lq) ||
    (it.bank_name || '').toLowerCase().includes(lq) ||
    String(it.id).includes(lq)
  );
}

export function filterByNpd(items, status) {
  if (!status) return items;
  return items.filter((it) => (it.npd_status || 'active') === status);
}

/* ════════════════════ ВЕДОМОСТЬ-СЕТКА (payroll-grid) ════════════════════
 * Источник: vanilla `payroll.js` → вкладка «📋 Ведомость» (renderInlineGrid).
 * В vanilla сетка живёт ВНУТРИ /payroll рядом с реестром СЗ; в React-миграции
 * её основная реализация — в `pages/Payroll/PayrollGrid.jsx`, а здесь мы
 * подключаем те же endpoints как вкладку «Ведомость-сетка» в реестре СЗ,
 * чтобы бухгалтер мог одной страницей и СЗ ввести, и табель свести.
 *
 *   GET /api/worker-payments/reports/payroll-grid/:year/:month         — данные
 *   PUT /api/worker-payments/reports/payroll-grid/:year/:month/save    — сохранить баллы
 *   GET /api/worker-payments/reports/payroll-grid/:year/:month/export  — Excel
 */

export const PAYROLL_GRID_MONTHS_RU = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
];

/* RBAC payroll-grid (см. worker-payments.js → isDir):
 *  ADMIN, DIRECTOR_*, HEAD_PM, BUH, TO, HEAD_TO, PROC — видят всех
 *  PM — видит только своих сотрудников по своим работам
 *  Из контекста SelfEmployed сетку имеет смысл показывать только тем,
 *  кто и так на странице (ADMIN/BUH/HEAD_PM/DIRECTOR_*). */
export const PAYROLL_GRID_ROLES = ['ADMIN', 'BUH', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export function loadPayrollGrid(year, month) {
  return api(`/api/worker-payments/reports/payroll-grid/${year}/${month}`);
}

export function savePayrollGrid(year, month, changes) {
  return api(`/api/worker-payments/reports/payroll-grid/${year}/${month}/save`, {
    method: 'PUT',
    body: { changes }
  });
}

/* Excel-экспорт сетки — fetch+blob+Authorization header (БЕЗ токена в URL). */
export async function exportPayrollGrid(year, month) {
  let token = '';
  try { token = localStorage.getItem('asgard_token') || ''; } catch { /* ignore */ }
  const url = `/api/worker-payments/reports/payroll-grid/${year}/${month}/export`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const blob = await r.blob();
  return { blob, filename: `Ведомость_${PAYROLL_GRID_MONTHS_RU[month - 1]}_${year}.xlsx` };
}

/* Категории дней для раскрашивания ячеек (зеркало payroll.js → CATEGORY_COLORS).
 * Цвета согласованы с pages/Payroll — единый язык в обеих локациях. */
export const GRID_CATEGORY_COLORS = {
  medical:   { bg: 'rgba(206, 147, 216, 0.45)', fg: 'var(--t-1)', label: 'Медосмотр / обучение' },
  road:      { bg: 'rgba(59, 130, 246, 0.35)',  fg: 'var(--t-1)', label: 'Дорога / ожидание' },
  warehouse: { bg: 'rgba(245, 158, 11, 0.35)',  fg: 'var(--t-1)', label: 'Склад' },
  work:      { bg: 'rgba(34, 197, 94, 0.5)',    fg: 'var(--t-1)', label: 'Работа (смена)' },
  work_hard: { bg: 'rgba(34, 197, 94, 0.75)',   fg: 'var(--t-1)', label: 'Работа (сложная)' },
  senior:    { bg: 'rgba(59, 130, 246, 0.75)',  fg: 'var(--t-1)', label: 'Мастер / ИТР' },
  overtime:  { bg: 'rgba(255, 215, 0, 0.6)',    fg: 'var(--t-1)', label: 'Переработка / высокая' },
  combo:     { bg: 'rgba(168, 85, 247, 0.45)',  fg: 'var(--t-1)', label: 'Совмещение (+1)' }
};

/* Маппинг баллов → тип категории (зеркало payroll.js → buildPointsMap). */
export function buildGridPointsMap(tariffCats) {
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

export function gridCellStyle(pts, pointsMap) {
  if (!pts) return { bg: '', fg: '' };
  const type = pointsMap[pts] || (
    pts === 1 ? 'combo' :
    pts <= 7 ? 'road' :
    pts <= 10 ? 'warehouse' :
    pts <= 14 ? 'work' :
    pts <= 17 ? 'work_hard' : 'overtime'
  );
  const cfg = GRID_CATEGORY_COLORS[type] || {};
  return { bg: cfg.bg || '', fg: cfg.fg || 'var(--t-1)' };
}

export function gridNum(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(String(x).replace(/\s/g, '').replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}
