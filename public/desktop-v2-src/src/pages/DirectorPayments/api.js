/**
 * DirectorPayments — API-клиент (Stage W).
 *
 * Backend:
 *   GET  /api/director-payments/history?year=&month=&work_id=&employee_id=&type=
 *        → { items: [...worker_payments where paid_by_role='director'] }
 *   POST /api/director-payments/
 *        body: { employee_id, work_id, type, amount, payment_method, comment }
 *        → проксирует на worker-payments/pay-worker с paid_by_role='director'.
 */
import { api } from '@/api/client';

export const PAYMENT_TYPES = [
  { value: '',          label: 'Все типы' },
  { value: 'per_diem',  label: 'Суточные', icon: '🌙' },
  { value: 'advance',   label: 'Аванс ЗП', icon: '💵' },
  { value: 'salary',    label: 'Зарплата', icon: '💼' },
  { value: 'bonus',     label: 'Премия',   icon: '⭐' },
  { value: 'penalty',   label: 'Удержание', icon: '⚠' }
];

export const TYPE_LABEL = Object.fromEntries(
  PAYMENT_TYPES.filter((t) => t.value).map((t) => [t.value, t.label])
);

export const METHOD_LABEL = {
  cash:     'Наличные',
  card:     'На карту',
  transfer: 'Перевод',
  auto:     'Авто'
};

export function loadHistory({ year, month, workId, employeeId, type } = {}) {
  const q = new URLSearchParams();
  if (year)       q.set('year', year);
  if (month)      q.set('month', month);
  if (workId)     q.set('work_id', workId);
  if (employeeId) q.set('employee_id', employeeId);
  if (type)       q.set('type', type);
  const qs = q.toString();
  return api('/api/director-payments/history' + (qs ? '?' + qs : ''))
    .then((d) => {
      if (Array.isArray(d)) return d;
      if (Array.isArray(d?.items)) return d.items;
      if (Array.isArray(d?.payments)) return d.payments;
      return [];
    });
}

export function payAsDirector(payload) {
  return api('/api/director-payments/', {
    method: 'POST',
    body: { ...payload, paid_by_role: 'director' }
  });
}

// Список работ — используется в фильтрах.
export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || d || [])
    .catch(() => []);
}

// Список сотрудников — для фильтра/выбора в модалке.
// На текущей кодовой базе employees через /api/staff/employees (см. src/routes/staff.js).
export function loadEmployees() {
  const parse = (d) => {
    const arr = Array.isArray(d) ? d
      : Array.isArray(d?.employees) ? d.employees
      : Array.isArray(d?.items) ? d.items
      : [];
    return arr.map((e) => ({
      id: e.id,
      full_name: e.full_name || e.fio || e.name || `#${e.id}`,
      // 2026-06-29 — нужны для радио-карточек «Источник денег» (bank/self disabled)
      is_officially_employed: !!(e.is_officially_employed === true || e.is_officially_employed === 1),
      is_self_employed:       !!(e.is_self_employed === true || e.is_self_employed === 1)
    }));
  };
  return api('/api/staff/employees?limit=2000')
    .then(parse)
    .catch(() => api('/api/employees?limit=2000').then(parse).catch(() => []));
}

export function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  return new Intl.NumberFormat('ru-RU').format(v) + ' ₽';
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '—';
}

export function buildPeriodOptions() {
  const now = new Date();
  const opts = [{ value: '', label: 'Все месяцы' }];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const lbl = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    opts.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: lbl });
  }
  return opts;
}

// helper: разбор '2026-06' → { year, month }
export function parsePeriod(p) {
  if (!p) return { year: null, month: null };
  const [y, m] = p.split('-').map(Number);
  return { year: y, month: m };
}
