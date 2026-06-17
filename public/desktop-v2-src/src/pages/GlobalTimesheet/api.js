/**
 * API-клиент страницы /global-timesheet.
 * Источник истины — vanilla `public/assets/js/global_timesheet.js`
 * + backend `src/routes/global-timesheet.js`.
 *
 * Endpoints:
 *   GET /api/timesheet/global/:year/:month         — табель за месяц
 *   GET /api/timesheet/global/:year/:month/export  — Excel/JSON (backend пока JSON)
 *   PUT /api/timesheet/global/entry                — поставить отметку (день/ночь/прочие)
 *
 * Backend возвращает структуру:
 *   { year, month, days_in_month, employees: [{ employee_id, fio, role_tag,
 *       works: [{ work_id, work_title, cells: { "YYYY-MM-DD": {type,amount,hours} } }],
 *       totals: { days, amount } }], total }
 *
 * RBAC просмотра:
 *   ADMIN, DIRECTOR_*, TO, HEAD_TO, WAREHOUSE, HR, HR_MANAGER
 * RBAC редактирования (PUT /global/entry):
 *   ADMIN, DIRECTOR_*       — все типы
 *   TO, HEAD_TO             — только 'medical'
 *   WAREHOUSE               — только 'warehouse'
 */
import { api } from '@/api/client';

export const VIEW_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'TO', 'HEAD_TO', 'WAREHOUSE', 'HR', 'HR_MANAGER'];

export const CELL_TYPES = {
  day:       { label: 'Д',  bg: 'var(--ok-bg)',   color: 'var(--ok-t)',   title: 'Дневная смена' },
  night:     { label: 'Н',  bg: 'var(--info-bg)', color: 'var(--info-t)', title: 'Ночная смена' },
  travel:    { label: '🚗', bg: 'var(--warn-bg)', color: 'var(--warn-t)', title: 'Дорога' },
  warehouse: { label: '📦', bg: 'var(--info-bg)', color: 'var(--info-t)', title: 'Склад' },
  medical:   { label: '🏥', bg: 'var(--err-bg)',  color: 'var(--err-t)',  title: 'Медосмотр' },
  waiting:   { label: '⏳', bg: 'var(--inner-bg)', color: 'var(--t-2)',    title: 'Ожидание' }
};

const ALL_TYPES = Object.keys(CELL_TYPES);

const EDIT_ROLES = {
  ADMIN:         ALL_TYPES,
  DIRECTOR_GEN:  ALL_TYPES,
  DIRECTOR_COMM: ALL_TYPES,
  DIRECTOR_DEV:  ALL_TYPES,
  TO:            ['medical'],
  HEAD_TO:       ['medical'],
  WAREHOUSE:     ['warehouse']
};

export function editableTypesForRole(role) {
  if (EDIT_ROLES[role]) return EDIT_ROLES[role];
  const s = String(role || '');
  if (s.startsWith('DIRECTOR')) return ALL_TYPES;
  return [];
}

export function isDirectorRole(role) {
  const s = String(role || '');
  return s === 'DIRECTOR' || s.startsWith('DIRECTOR_');
}

export function fmt(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(n));
}

export function daysInMonth(year, month) {
  // month: 1..12
  return new Date(year, month, 0).getDate();
}

export function monthLabel(year, month) {
  return new Date(year, month - 1).toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
}

export async function loadTimesheet(year, month) {
  return api(`/api/timesheet/global/${year}/${month}`);
}

export async function putEntry({ employee_id, work_id, date, type, amount, hours, note }) {
  return api('/api/timesheet/global/entry', {
    method: 'PUT',
    body: { employee_id, work_id: work_id || null, date, type, amount, hours, note }
  });
}

export async function downloadExport(year, month) {
  const token = (() => {
    try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; }
  })();
  const r = await fetch(`/api/timesheet/global/${year}/${month}/export`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ext = (r.headers.get('content-type') || '').includes('json') ? 'json' : 'xlsx';
  a.download = `табель_${year}_${String(month).padStart(2, '0')}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Преобразуем ответ бэка в плоский список «рабочий × работа» с total для строки.
 */
export function flatten(data) {
  const employees = data?.employees || [];
  const rows = [];
  for (const emp of employees) {
    const works = (emp.works && emp.works.length) ? emp.works : [{ work_id: 0, work_title: 'Без объекта', cells: {} }];
    for (const w of works) {
      let days = 0, amount = 0;
      for (const c of Object.values(w.cells || {})) {
        days += 1;
        amount += Number(c.amount || 0);
      }
      rows.push({
        employee_id: emp.employee_id,
        fio: emp.fio,
        role_tag: emp.role_tag,
        work_id: w.work_id,
        work_title: w.work_title || 'Без объекта',
        cells: w.cells || {},
        total_days: days,
        total_amount: amount
      });
    }
  }
  // Группировка по объекту (для отображения групп)
  return rows;
}

export function groupByWork(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.work_title || 'Без объекта';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return Array.from(groups.entries()).map(([title, items]) => ({ title, items }));
}
