/**
 * API-клиент страницы /permit-applications + /permit-application-form.
 * Источник: vanilla `public/assets/js/permit_applications.js` (~1278 строк).
 * Backend: src/routes/permit_applications.js (prefix /api/permit-applications).
 */
import { api } from '@/api/client';

export const ALLOWED_ROLES = ['ADMIN', 'HR', 'TO', 'HEAD_TO', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
export const CREATE_ROLES  = ['ADMIN', 'HR', 'TO', 'HEAD_TO', 'HR_MANAGER'];

export const STATUSES = {
  draft:       { label: 'Черновик',    color: 'var(--t-3)',   bg: 'color-mix(in srgb, var(--t-3) 12%, transparent)',   icon: '✎' },
  sent:        { label: 'Отправлена',  color: 'var(--info)',  bg: 'color-mix(in srgb, var(--info) 12%, transparent)',  icon: '✉' },
  in_progress: { label: 'В работе',    color: 'var(--amber)', bg: 'color-mix(in srgb, var(--amber) 12%, transparent)', icon: '⚙' },
  completed:   { label: 'Завершена',   color: 'var(--ok)',    bg: 'color-mix(in srgb, var(--ok) 12%, transparent)',    icon: '✓' },
  cancelled:   { label: 'Отменена',    color: 'var(--err)',   bg: 'color-mix(in srgb, var(--err) 12%, transparent)',   icon: '✕' }
};

export const STATUS_TABS = [
  { value: '',            label: 'Все' },
  { value: 'draft',       label: 'Черновики' },
  { value: 'sent',        label: 'Отправлены' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'completed',   label: 'Завершены' }
];

export const CATEGORIES = {
  safety:    { name: 'Безопасность',         color: 'var(--ok)',     icon: '🛡️', order: 1 },
  medical:   { name: 'Медицина',              color: 'var(--err)',    icon: '🏥', order: 2 },
  electric:  { name: 'Электрика',             color: 'var(--amber)',  icon: '⚡', order: 3 },
  gas:       { name: 'Газоопасные',           color: 'var(--orange)', icon: '🔥', order: 4 },
  special:   { name: 'Спецработы',            color: 'var(--info)',   icon: '🔧', order: 5 },
  attest:    { name: 'Аттестация',            color: 'var(--purple)', icon: '📜', order: 6 },
  offshore:  { name: 'Шельф / Морские',       color: 'var(--cyan)',   icon: '🚢', order: 7 },
  nuclear:   { name: 'Ядерная безопасность',  color: 'var(--err)',    icon: '☢️', order: 8 },
  transport: { name: 'Транспорт',             color: 'var(--t-2)',    icon: '🚛', order: 9 },
  welding:   { name: 'Сварка',                color: 'var(--orange)', icon: '🔩', order: 10 },
  docs:      { name: 'Документы',             color: 'var(--cyan)',   icon: '📋', order: 11 }
};

export const PRESETS = {
  basic:    { name: 'Базовый',      codes: ['height_1', 'fire', 'labor', 'first_aid', 'medical', 'psych'] },
  offshore: { name: 'Шельф / МЛСП', codes: ['height_1', 'fire', 'labor', 'first_aid', 'medical', 'psych', 'bosiet', 'offshore_med', 'confined', 'gas_hazard', 'ice_class', 'helicopter'] },
  gas:      { name: 'Газоопасные',  codes: ['gas_hazard', 'gas_analyzer', 'h2s_safety', 'confined'] },
  electric: { name: 'Электрика',    codes: ['electro_2', 'electro_3', 'electro_4'] },
  welding:  { name: 'Сварка',       codes: ['welder', 'attest_a1', 'fire', 'labor', 'medical', 'first_aid'] }
};

export const PERMIT_ICONS = {
  height_1: '🪜', height_2: '🏗️', height_3: '🗼',
  fire: '🧯', labor: '👷', first_aid: '🩹',
  medical: '🩺', psych: '🧠', confined: '🕳️',
  gas_hazard: '💨', gas_analyzer: '📡', h2s_safety: '☠️',
  electro_2: '🔌', electro_3: '⚡', electro_4: '🔋', electro_5: '⚙️',
  bosiet: '🌊', offshore_med: '🚁', helicopter: '🚁',
  ice_class: '❄️', welder: '🔥', attest_a1: '📝',
  radiation: '☢️', nuclear_safety: '☢️',
  crane_operator: '🏗️', forklift: '🚜', ppe: '🦺',
  scaffolding: '🔨', rigging: '⛓️', excavation: '⛏️'
};

// ─────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────

/**
 * GET /api/permit-applications — список заявок.
 * Vanilla: '/api/permit-applications?' + params.toString()
 * Trailing slash vanilla mapping: '/api/permit-applications/' → '/api/permit-applications/:id'
 */
export function loadApplications({ status, search, limit = 100, offset = 0 } = {}) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (search) q.set('search', search);
  q.set('limit', String(limit));
  q.set('offset', String(offset));
  return api('/api/permit-applications?' + q.toString());
}

export function loadApplication(id) {
  return api(`/api/permit-applications/${id}`);
}

export function createApplication(body) {
  return api('/api/permit-applications', { method: 'POST', body });
}

export function updateApplication(id, body) {
  return api(`/api/permit-applications/${id}`, { method: 'PUT', body });
}

export function deleteApplication(id) {
  return api(`/api/permit-applications/${id}`, { method: 'DELETE' });
}

export function setStatus(id, status, comment = null) {
  return api(`/api/permit-applications/${id}/status`, { method: 'POST', body: { status, comment } });
}

export function sendApplication(id, copyToSelf = false) {
  return api(`/api/permit-applications/${id}/send`, { method: 'POST', body: { copy_to_self: copyToSelf } });
}

export function loadAppTypes() {
  return api('/api/permit-applications/types').then((d) => d.types || []);
}

export function lookupContractors(search) {
  return api('/api/permit-applications/contractors?search=' + encodeURIComponent(search || ''))
    .then((d) => d.contractors || [])
    .catch(() => []);
}

/** GET binary blob — Excel-реестр. */
export async function downloadExcel(id) {
  let token = '';
  try { token = localStorage.getItem('asgard_token') || ''; } catch { /* noop */ }
  const r = await fetch(`/api/permit-applications/${id}/excel`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(t || `HTTP ${r.status}`);
  }
  return r.blob();
}

export function loadEmployees() {
  return api('/api/staff/employees?limit=1000')
    .then((d) => d.employees || [])
    .catch(() => []);
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function shortPermitName(name) {
  if (!name) return '';
  return name
    .replace('Допуск к работам на ', '')
    .replace('Электробезопасность ', 'Электро ')
    .replace('Аттестация промбезопасность ', 'Пром.безоп. ')
    .replace(' (периодический)', '')
    .replace('Медицинский осмотр', 'Медосмотр');
}

export function getPermitStatus(existingPermits, typeCode) {
  const permit = (existingPermits || []).find((p) => p.type_id === typeCode || p.type_code === typeCode);
  if (!permit) return { status: 'none' };
  if (!permit.expiry_date) return { status: 'active', date: null, label: 'Бессрочное' };
  const expiry = new Date(permit.expiry_date);
  const today = new Date();
  const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { status: 'expired',  date: permit.expiry_date, label: 'Истёк ' + fmtDate(permit.expiry_date) };
  if (daysLeft <= 60) return { status: 'expiring', date: permit.expiry_date, label: 'Истекает ' + fmtDate(permit.expiry_date) };
  return { status: 'active', date: permit.expiry_date, label: 'Есть до ' + fmtDate(permit.expiry_date) };
}
