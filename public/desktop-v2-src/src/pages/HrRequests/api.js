/**
 * API-клиент страницы /hr-requests — «Заявки персонала v2».
 * Источник истины — vanilla `public/assets/js/hr_requests.js` (911 строк).
 *
 * Backend: src/routes/staff-requests-v2.js (prefix /api/staff-requests).
 *
 * PM:
 *   POST   /api/staff-requests                    — создать черновик
 *   PUT    /api/staff-requests/:id/draft          — обновить
 *   PUT    /api/staff-requests/:id/submit         — отправить HR
 *   GET    /api/staff-requests/my                 — мои заявки
 *   GET    /api/staff-requests/:id                — детали
 *   PUT    /api/staff-requests/:id/add-to-crew    — добавить утверждённых в бригаду
 *
 * HR:
 *   GET    /api/staff-requests/pending                   — ожидающие
 *   PUT    /api/staff-requests/:id/take                  — взять в работу
 *   PUT    /api/staff-requests/:id/assign                — добавить рабочего
 *   DELETE /api/staff-requests/:id/assign/:assignment_id — убрать рабочего
 *   PUT    /api/staff-requests/:id/send-to-pm            — отправить РП
 *   PUT    /api/staff-requests/:id/approve               — утвердить
 *   PUT    /api/staff-requests/:id/rework                — вернуть
 *
 * Доп.:
 *   GET    /api/staff-requests/:id/available-workers
 *   GET    /api/works?my=1
 *   GET    /api/permits/types
 *   GET/POST/DELETE /api/permits/work/:wId/requirements*
 */
import { api } from '@/api/client';

export const STATUS_V2 = {
  draft:         { label: 'Черновик',        tone: 'draft' },
  new:           { label: 'Ожидает HR',      tone: 'sent' },
  in_progress:   { label: 'В работе HR',     tone: 'question' },
  sent_to_pm:    { label: 'На согласовании', tone: 'rework' },
  approved:      { label: 'Утверждена',      tone: 'approved' },
  added_to_crew: { label: 'В бригаде',       tone: 'approved' },
  rework:        { label: 'На доработке',    tone: 'rework' },
  cancelled:     { label: 'Отменена',        tone: 'draft' },
  sent:          { label: 'Отправлен',       tone: 'sent' },
  answered:      { label: 'Ответ HR',        tone: 'question' },
};

export const POSITION_ROLES = [
  { key: 'master',    label: 'Мастера' },
  { key: 'fitter',    label: 'Слесари' },
  { key: 'welder',    label: 'Сварщики' },
  { key: 'pto',       label: 'ПТО' },
  { key: 'chemist',   label: 'Химики' },
  { key: 'insulator', label: 'Изолировщики' },
  { key: 'assembler', label: 'Монтажники' },
  { key: 'laborer',   label: 'Разнорабочие' },
];

export const FOOD_OPTS = [
  { value: 'ration',  label: 'Сухпаёк' },
  { value: 'canteen', label: 'Столовая' },
  { value: 'self',    label: 'Самостоятельно' },
];
export const HOUSING_OPTS = [
  { value: 'wagon',     label: 'Вагон-дом' },
  { value: 'hotel',     label: 'Гостиница' },
  { value: 'dormitory', label: 'Общежитие' },
];

export const PERMIT_CATEGORIES = [
  { value: 'special',   label: 'Спецработы' },
  { value: 'safety',    label: 'Безопасность' },
  { value: 'electric',  label: 'Электрика' },
  { value: 'gas',       label: 'Газоопасные' },
  { value: 'medical',   label: 'Медицина' },
  { value: 'attest',    label: 'Аттестация' },
  { value: 'offshore',  label: 'Шельф / Морские' },
  { value: 'transport', label: 'Транспорт' },
];

/* ─── RBAC ────────────────────────────────────────────────────────────────── */
export const ROLES_PM = ['PM', 'HEAD_PM'];
export const ROLES_HR = ['ADMIN', 'HR', 'HR_MANAGER'];

function isDirectorRole(role) {
  const r = String(role || '');
  return r === 'DIRECTOR' || r.startsWith('DIRECTOR_');
}
export function isPmRole(role) { return ROLES_PM.includes(role); }
export function isHrRole(role) { return ROLES_HR.includes(role) || isDirectorRole(role); }
export function canView(role) { return isPmRole(role) || isHrRole(role); }

/* ─── API ─────────────────────────────────────────────────────────────────── */
export function loadMy() {
  return api('/api/staff-requests/my').then(unwrap);
}
export function loadPending() {
  return api('/api/staff-requests/pending').then(unwrap);
}
export function loadRequest(id) {
  return api(`/api/staff-requests/${id}`).then((d) => d.request || d);
}
export function createDraft(payload) {
  return api('/api/staff-requests', { method: 'POST', body: payload }).then((d) => d.request || d);
}
export function updateDraft(id, payload) {
  return api(`/api/staff-requests/${id}/draft`, { method: 'PUT', body: payload }).then((d) => d.request || d);
}
// PUT /api/staff-requests/:id/submit — РП отправляет черновик HR (vanilla hr_requests.js:551).
export function submitToHr(id) {
  return api(`/api/staff-requests/${id}/submit`, { method: 'PUT' });
}
export function takeRequest(id) {
  return api(`/api/staff-requests/${id}/take`, { method: 'PUT' });
}
export function assignWorker(id, payload) {
  return api(`/api/staff-requests/${id}/assign`, { method: 'PUT', body: payload });
}
export function unassignWorker(reqId, assignmentId) {
  return api(`/api/staff-requests/${reqId}/assign/${assignmentId}`, { method: 'DELETE' });
}
export function sendToPm(id) {
  return api(`/api/staff-requests/${id}/send-to-pm`, { method: 'PUT' });
}
export function approveRequest(id) {
  return api(`/api/staff-requests/${id}/approve`, { method: 'PUT' });
}
export function reworkRequest(id, comment) {
  return api(`/api/staff-requests/${id}/rework`, { method: 'PUT', body: { comment } });
}
export function addToCrew(id) {
  return api(`/api/staff-requests/${id}/add-to-crew`, { method: 'PUT' });
}
export function loadAvailableWorkers(reqId, role) {
  const q = role ? '?role=' + encodeURIComponent(role) : '';
  return api(`/api/staff-requests/${reqId}/available-workers${q}`).then(unwrap);
}

/* ─── Доп. справочники ──────────────────────────────────────────────────── */
export function loadMyWorks() {
  return api('/api/works?my=1').then(unwrap);
}
export function loadPermitTypes() {
  return api('/api/permits/types').then((d) => d.types || d || []).catch(() => []);
}
export function loadWorkPermitRequirements(workId) {
  return api(`/api/permits/work/${workId}/requirements`).then((d) => d.requirements || []).catch(() => []);
}
export function addWorkPermit(workId, payload) {
  return api(`/api/permits/work/${workId}/requirements`, { method: 'POST', body: payload });
}
export function addCustomWorkPermit(workId, payload) {
  return api(`/api/permits/work/${workId}/requirements/custom`, { method: 'POST', body: payload });
}
export function deleteWorkPermit(workId, reqId) {
  return api(`/api/permits/work/${workId}/requirements/${reqId}`, { method: 'DELETE' });
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function unwrap(d) {
  if (Array.isArray(d)) return d;
  return d.requests || d.workers || d.items || d.data || d.works || [];
}

export function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU'); }
  catch { return String(d).slice(0, 10); }
}

export function describeStatus(code) {
  return STATUS_V2[code] || STATUS_V2.new;
}
