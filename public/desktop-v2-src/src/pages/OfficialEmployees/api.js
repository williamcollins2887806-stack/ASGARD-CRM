/**
 * API-клиент страницы /official-employees.
 * Источник истины — vanilla `public/assets/js/official_employees.js`.
 *
 * Endpoints:
 *   GET /api/payroll-dashboard/official-employees      — таблица официально устроенных
 *   PUT /api/payroll-dashboard/official-employees/:id  — обновить оклад/статус/несгораемую/трудоустройство
 *   PUT /api/staff/employees/:id                       — обновить паспортные данные (HR/HR_MANAGER/ADMIN/DIRECTOR_GEN)
 *
 * RBAC просмотра самой таблицы (бэкэнд требует одну из):
 *   ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH
 * RBAC просмотра PII (паспорт/ИНН/СНИЛС):
 *   ADMIN, HR, HR_MANAGER, BUH
 */
import { api } from '@/api/client';

export const VIEW_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH'];
export const PII_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'BUH'];
export const EDIT_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'BUH'];
export const EDIT_PII_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN'];

export const STATUS_CFG = {
  active:       { label: 'Работает',               tone: 'ok',   bg: 'var(--ok-bg)',   color: 'var(--ok-t)'   },
  unpaid_leave: { label: 'Отпуск без содержания',  tone: 'warn', bg: 'var(--warn-bg)', color: 'var(--warn-t)' },
  maternity:    { label: 'Декрет',                 tone: 'info', bg: 'var(--info-bg)', color: 'var(--info-t)' },
  sick_leave:   { label: 'Больничный',             tone: 'warn', bg: 'var(--warn-bg)', color: 'var(--warn-t)' },
  fired:        { label: 'Уволен',                 tone: 'err',  bg: 'var(--err-bg)',  color: 'var(--err-t)'  }
};

export const STATUS_OPTS = Object.entries(STATUS_CFG).map(([value, cfg]) => ({ value, label: cfg.label }));

export const LEAVE_STATUSES = new Set(['unpaid_leave', 'maternity', 'sick_leave']);

export function rub(n) {
  if (n === null || n === undefined || n === '') return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', maximumFractionDigits: 0
  }).format(Number(n) || 0);
}

export function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('ru-RU'); } catch { return String(s).slice(0, 10); }
}

export async function loadOfficialEmployees() {
  const d = await api('/api/payroll-dashboard/official-employees');
  return d?.employees || (Array.isArray(d) ? d : []);
}

export async function loadEmployeePii(employeeId) {
  // Подробный профиль сотрудника (включая паспорт/ИНН) — только для PII_ROLES на стороне сервера
  // (Route /api/staff/employees/:id уже отдаёт всё что разрешено по аутентификации).
  const d = await api(`/api/staff/employees/${employeeId}`);
  return d?.employee || null;
}

export async function updatePayroll(employeeId, payload) {
  return api(`/api/payroll-dashboard/official-employees/${employeeId}`, {
    method: 'PUT', body: payload
  });
}

export async function updatePii(employeeId, payload) {
  return api(`/api/staff/employees/${employeeId}`, { method: 'PUT', body: payload });
}

export function getTotals(list) {
  const total = list.length;
  const active = list.filter((e) => e.official_status === 'active').length;
  const onLeave = list.filter((e) => LEAVE_STATUSES.has(e.official_status)).length;
  const totalDebt = list.reduce((s, e) => s + (Number(e.company_debt || e.debt || 0) || 0), 0);
  return { total, active, onLeave, totalDebt };
}
