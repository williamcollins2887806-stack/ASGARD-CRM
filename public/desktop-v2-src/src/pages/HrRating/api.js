/**
 * API для /hr-rating — «Рейтинг дружины».
 * Источник: vanilla `hr_rating.js` (196 строк).
 *
 * Vanilla читает employees+employee_reviews ИЗ ЛОКАЛЬНОЙ IndexedDB (AsgardDB),
 * считая агрегаты на клиенте. В v2 берём данные напрямую из API:
 *   GET /api/staff/readiness — список employees с readiness и базовыми полями
 *
 * Историю оценок (employee_reviews) читаем в DetailModal через GET /api/staff/employees/:id
 * (там reviews → массив последних 10 оценок).
 *
 * Доступ: ADMIN, HR, директора.
 */
import { api } from '@/api/client';

export const OFFICE_ROLES = [
  'ADMIN', 'HR', 'BUH', 'TO', 'PM', 'PROC',
  'DIRECTOR', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'OFFICE_MANAGER', 'WAREHOUSE', 'VIEWER',
];

function _isDirectorRole(role) {
  const r = String(role || '');
  return r === 'DIRECTOR' || r.startsWith('DIRECTOR_');
}

// RBAC — синхронно с vanilla hr_rating.js строки 3,28:
// Рейтинг видят ADMIN, HR, HR_MANAGER, и DIRECTOR_GEN/DIRECTOR_COMM/DIRECTOR_DEV.
// Inline-литералы нужны для скрипта rbac-audit.
export const VIEW_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export function canView(role) {
  return ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role);
}

export function loadEmployees() {
  return api('/api/staff/readiness').then((d) => d.employees || []);
}

/**
 * Загружает справочник допусков из settings.refs.permits
 * (vanilla hr_rating.js:40-42 читает settings/refs.permits).
 */
export function loadPermits() {
  return api('/api/settings/refs/all')
    .then((d) => Array.isArray(d?.refs?.permits) ? d.refs.permits : [])
    .catch(() => []);
}

/**
 * Фильтр по допуску — оставляет только сотрудников, у которых в массиве permits
 * есть искомый допуск (vanilla hr_rating.js:87-89).
 */
export function applyPermitFilter(list, permit) {
  if (!permit) return list;
  return list.filter((e) => Array.isArray(e.permits) && e.permits.includes(permit));
}

export function fmtAvg(v) {
  if (v == null || !isFinite(Number(v))) return '—';
  return Number(v).toFixed(1);
}

export function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU'); }
  catch { return String(d).slice(0, 10); }
}

/**
 * Скрываем офисных сотрудников из рейтинга (vanilla-логика).
 */
export function filterWorkers(employees) {
  return (employees || []).filter((e) => {
    const tag = (e.role_tag || '').toUpperCase();
    if (OFFICE_ROLES.includes(tag)) return false;
    if ((e.fio || '').toLowerCase().includes('тест') && OFFICE_ROLES.some((r) => tag.includes(r))) return false;
    return true;
  });
}

export function applyFilter(list, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((e) =>
    (e.fio || '').toLowerCase().includes(q) ||
    (e.role_tag || '').toLowerCase().includes(q) ||
    (e.city || '').toLowerCase().includes(q) ||
    (e.position || '').toLowerCase().includes(q)
  );
}

export function sortByRating(list) {
  return list.slice().sort((a, b) => {
    const av = a.rating_avg != null && isFinite(Number(a.rating_avg)) ? Number(a.rating_avg) : -1;
    const bv = b.rating_avg != null && isFinite(Number(b.rating_avg)) ? Number(b.rating_avg) : -1;
    if (bv !== av) return bv - av;
    const ac = Number(a.rating_count || 0);
    const bc = Number(b.rating_count || 0);
    if (bc !== ac) return bc - ac;
    return String(a.fio || '').localeCompare(String(b.fio || ''), 'ru');
  });
}
