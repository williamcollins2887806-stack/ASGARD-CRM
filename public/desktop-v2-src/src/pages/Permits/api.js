/**
 * API-клиент страницы /permits — Разрешения и допуски (M6).
 * Источник: vanilla `public/assets/js/permits.js` (1314 строк).
 * Backend: src/routes/permits.js (prefix /api/permits).
 *
 * Vanilla endpoint mappings:
 *   '/api/permit-applications/types/' (vanilla DELETE typeId) → '/api/permit-applications/types/:id' (deleteAppType)
 *   '/api/files/download/' (vanilla scan-link) → fileDownloadUrl()
 */
import { api } from '@/api/client';

export const ALLOWED_READ_ROLES = ['ADMIN', 'HR', 'TO', 'HEAD_TO', 'HR_MANAGER', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
export const WRITE_ROLES = ['ADMIN', 'HR', 'TO', 'HEAD_TO', 'HR_MANAGER'];
export const TYPE_MGMT_ROLES = ['ADMIN', 'HR', 'TO', 'HEAD_TO', 'HR_MANAGER'];

export const CATEGORIES = {
  safety:    { name: 'Безопасность',         color: 'var(--ok)',     icon: '🛡️' },
  electric:  { name: 'Электрика',             color: 'var(--amber)',  icon: '⚡' },
  special:   { name: 'Спецработы',            color: 'var(--info)',   icon: '🔧' },
  medical:   { name: 'Медицина',              color: 'var(--err)',    icon: '🏥' },
  attest:    { name: 'Аттестация',            color: 'var(--purple)', icon: '📜' },
  offshore:  { name: 'Шельф / Морские',       color: 'var(--cyan)',   icon: '🚢' },
  gas:       { name: 'Газоопасные',           color: 'var(--orange)', icon: '🔥' },
  transport: { name: 'Транспорт',             color: 'var(--t-2)',    icon: '🚛' },
  nuclear:   { name: 'Ядерная безопасность',  color: 'var(--err)',    icon: '☢️' },
  welding:   { name: 'Сварка',                color: 'var(--orange)', icon: '🔩' },
  docs:      { name: 'Документы',             color: 'var(--cyan)',   icon: '📋' }
};

// Должности (синхронно с hr_requests.js POSITION_ROLES)
export const POSITION_ROLES = [
  { key: 'master',    label: 'Мастера' },
  { key: 'fitter',    label: 'Слесари' },
  { key: 'welder',    label: 'Сварщики' },
  { key: 'pto',       label: 'ПТО' },
  { key: 'chemist',   label: 'Химики' },
  { key: 'insulator', label: 'Изолировщики' },
  { key: 'assembler', label: 'Монтажники' },
  { key: 'laborer',   label: 'Разнорабочие' }
];

export const ROLE_LABEL = (k) => (POSITION_ROLES.find((r) => r.key === k) || {}).label || k;

export const STATUS_FILTER_OPTIONS = [
  { value: '',             label: 'Все статусы' },
  { value: 'expired',      label: 'Истёкшие' },
  { value: 'expiring_14',  label: 'Истекают ≤14 дн.' },
  { value: 'expiring_30',  label: 'Истекают ≤30 дн.' },
  { value: 'active',       label: 'Действующие' }
];

export const CATEGORY_FILTER_OPTIONS = [
  { value: '', label: 'Все категории' },
  ...Object.entries(CATEGORIES).map(([id, c]) => ({ value: id, label: c.name }))
];

// ─────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────

export function loadTypes() {
  return api('/api/permits/types').then((d) => d.types || []);
}

export function loadStats() {
  return api('/api/permits/stats');
}

export function loadPermits(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  const qs = q.toString();
  return api(`/api/permits${qs ? '?' + qs : ''}`).then((d) => d.permits || []);
}

export function loadPermit(id) {
  return api(`/api/permits/${id}`).then((d) => d.permit || null);
}

export function loadMatrix(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  const qs = q.toString();
  return api(`/api/permits/matrix${qs ? '?' + qs : ''}`);
}

export function loadWorkRequirements(workId) {
  return api(`/api/permits/work/${workId}/requirements`).then((d) => d.requirements || []);
}

export function loadWorkCompliance(workId) {
  return api(`/api/permits/work/${workId}/compliance`);
}

/** POST /api/permits — создать допуск. Поддерживает multipart (file) и JSON. */
export async function createPermit(formData) {
  let token = '';
  try { token = localStorage.getItem('asgard_token') || ''; } catch { /* noop */ }
  const r = await fetch('/api/permits', {
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

export function updatePermit(id, body) {
  return api(`/api/permits/${id}`, { method: 'PUT', body });
}

export async function uploadScan(id, file) {
  const fd = new FormData();
  fd.append('file', file);
  let token = '';
  try { token = localStorage.getItem('asgard_token') || ''; } catch { /* noop */ }
  const r = await fetch(`/api/permits/${id}/scan`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let err = '';
    try { err = JSON.parse(t).error || t; } catch { err = t; }
    throw new Error(err || `HTTP ${r.status}`);
  }
  return r.json();
}

export function renewPermit(id, body) {
  return api(`/api/permits/${id}/renew`, { method: 'POST', body });
}

export function bulkRenew(body) {
  return api('/api/permits/bulk-renew', { method: 'POST', body });
}

export function deletePermit(id) {
  return api(`/api/permits/${id}`, { method: 'DELETE' });
}

export function checkExpiry() {
  return api('/api/permits/check-expiry');
}

export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || d || [])
    .catch(() => []);
}

export function loadEmployees() {
  return api('/api/staff/employees?limit=1000')
    .then((d) => d.employees || [])
    .catch(() => []);
}

export function addRequirement(workId, body) {
  return api(`/api/permits/work/${workId}/requirements`, { method: 'POST', body });
}

export function deleteRequirement(workId, id) {
  return api(`/api/permits/work/${workId}/requirements/${id}`, { method: 'DELETE' });
}

// Управление справочником типов через permit-applications (как в vanilla)
export function loadAppTypes() {
  return api('/api/permit-applications/types').then((d) => d.types || []);
}

export function createAppType(body) {
  return api('/api/permit-applications/types', { method: 'POST', body });
}

export function deleteAppType(id) {
  return api(`/api/permit-applications/types/${id}`, { method: 'DELETE' });
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function getTypeById(types, id) {
  return types.find((t) => t.id === id) || { id, name: id, category: 'safety' };
}

export function statusInfo(status, daysLeft) {
  if (status === 'expired') return { label: 'Истёк', color: 'var(--err)', tone: 'err' };
  if (status === 'expiring_14') return { label: `${daysLeft} дн.`, color: 'var(--err)', tone: 'err' };
  if (status === 'expiring_30') return { label: `${daysLeft} дн.`, color: 'var(--amber)', tone: 'warn' };
  return { label: 'Действует', color: 'var(--ok)', tone: 'ok' };
}

/**
 * Открыть скан-файл допуска БЕЗ токена в URL (blob через Authorization header).
 * Vanilla URL pattern (для coverage-audit): `/api/files/download/${filename}` нормализуется в `/api/files/download/:id`
 */
export async function openScan(filename) {
  const { openProtected } = await import('@/api/download');
  return openProtected(`/api/files/download/${encodeURIComponent(filename)}`, filename);
}
