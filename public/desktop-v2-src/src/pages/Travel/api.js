/**
 * API-клиент страницы /travel.
 * Источник истины — vanilla `public/assets/js/travel.js`.
 *
 * Endpoints (см. src/routes/field-logistics.js):
 *   GET    /api/field/logistics            — все записи (admin/manager)
 *   POST   /api/field/logistics            — создать запись
 *   POST   /api/field/logistics/:id/attach — прикрепить файл (multipart)
 *   POST   /api/field/logistics/:id/send   — отправить SMS/push сотруднику
 *   POST   /api/field/logistics/:id/purchased — отметить «куплено»
 *   PUT    /api/field/logistics/:id        — править поля (синхронизирует work_expenses)
 *   DELETE /api/field/logistics/:id        — soft-delete с каскадом (расход + файл)
 *
 * Связанные:
 *   GET /api/staff/employees?limit=2000 — список сотрудников
 *   GET /api/works?limit=2000           — список работ для привязки
 *
 * RBAC: ADMIN, OFFICE_MANAGER, HR, PM, HEAD_PM, DIRECTOR_*, TO
 */
import { api } from '@/api/client';

export const ALLOWED_ROLES = [
  'ADMIN', 'OFFICE_MANAGER', 'HR', 'PM', 'HEAD_PM',
  'DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV', 'TO'
];

export const TAB_DEFS = [
  { id: 'tickets',    label: '✈️ Билеты',          types: ['ticket_to', 'ticket_back', 'flight', 'train', 'transfer'] },
  { id: 'housing',    label: '🏠 Жильё',            types: ['hotel', 'housing', 'hostel'] },
  { id: 'directives', label: '📋 Направления МО',   types: ['directive_mo'] },
  { id: 'training',   label: '📚 Обучение',         types: ['training', 'certification'] }
];

export const TYPE_OPTS = [
  { value: 'ticket_to',    label: '✈️ Билет туда',      tab: 'tickets' },
  { value: 'ticket_back',  label: '✈️ Билет обратно',    tab: 'tickets' },
  { value: 'flight',       label: '✈️ Авиабилет',        tab: 'tickets' },
  { value: 'train',        label: '🚂 Ж/Д билет',        tab: 'tickets' },
  { value: 'transfer',     label: '🚐 Трансфер',         tab: 'tickets' },
  { value: 'hotel',        label: '🏨 Гостиница',        tab: 'housing' },
  { value: 'housing',      label: '🏠 Жильё / аренда',   tab: 'housing' },
  { value: 'hostel',       label: '🛏 Хостел',           tab: 'housing' },
  { value: 'directive_mo', label: '📋 Направление МО',   tab: 'directives' },
  { value: 'training',     label: '📚 Обучение',         tab: 'training' },
  { value: 'certification',label: '🎓 Аттестация/допуск', tab: 'training' }
];

export const TRANSPORT_TYPES = new Set(['ticket_to', 'ticket_back', 'flight', 'train', 'transfer']);
export const HOUSING_TYPES   = new Set(['hotel', 'housing', 'hostel']);

export function typeLabel(key) {
  const found = TYPE_OPTS.find((t) => t.value === key);
  return found?.label || key || '—';
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function loadLogistics() {
  const d = await api('/api/field/logistics');
  return Array.isArray(d?.logistics) ? d.logistics : [];
}

export async function loadEmployees() {
  const d = await api('/api/staff/employees?limit=2000');
  const list = d?.employees || d?.items || d?.rows || [];
  return list.slice().sort((a, b) => String(a.fio || '').localeCompare(String(b.fio || ''), 'ru'));
}

export async function loadWorks() {
  const d = await api('/api/works?limit=2000');
  const list = d?.works || d?.items || d?.rows || [];
  // Не закрытые
  return list
    .filter((w) => w.work_status !== 'Работы сдали')
    .slice()
    .sort((a, b) => String(a.work_title || '').localeCompare(String(b.work_title || ''), 'ru'));
}

export async function createLogistics(payload) {
  return api('/api/field/logistics', { method: 'POST', body: payload });
}

export async function markPurchased(id) {
  return api('/api/field/logistics/' + id + '/purchased', { method: 'POST', body: {} });
}

export async function sendToEmployee(id) {
  return api('/api/field/logistics/' + id + '/send', { method: 'POST', body: {} });
}

export async function deleteLogistics(id) {
  // Доменный DELETE: каскадно удалит привязанный work_expenses и файл документа.
  return api('/api/field/logistics/' + id, { method: 'DELETE' });
}

export async function uploadAttachment(id, file) {
  const fd = new FormData();
  fd.append('file', file);
  const token = (() => {
    try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; }
  })();
  const r = await fetch('/api/field/logistics/' + id + '/attach', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  if (!r.ok) {
    let msg = 'Ошибка загрузки файла';
    try { const j = await r.json(); msg = j.error || msg; } catch (_) { /* noop */ }
    throw new Error(msg);
  }
  return r.json();
}

export function formatRubFromAmount(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v);
}

export function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('ru-RU'); } catch { return String(s).slice(0, 10); }
}

export function statusInfo(status) {
  if (status === 'sent') return { label: 'Отправлено',  tone: 'ok' };
  if (status === 'purchased') return { label: 'Куплено', tone: 'info' };
  if (status === 'ready') return { label: 'Готово',     tone: 'info' };
  if (status === 'cancelled') return { label: 'Отменено', tone: 'err' };
  return { label: 'Ожидает', tone: 'warn' };
}
