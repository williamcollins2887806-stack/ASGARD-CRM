/**
 * API-клиент страницы /correspondence — реестр входящей/исходящей переписки с заказчиками.
 *
 * Источник: vanilla `public/assets/js/correspondence.js` (~857 строк) +
 * backend `src/routes/correspondence.js` (создание/правка) +
 * `src/routes/data.js` для list/get (generic /api/data/correspondence).
 *
 * RBAC: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, OFFICE_MANAGER, PM, HEAD_PM, TO, HEAD_TO.
 *
 * Endpoints (базовый префикс маршрута — `/api/correspondence/`, см. routes/correspondence.js):
 *   GET    /api/data/correspondence              — список (generic)
 *   GET    /api/data/correspondence/:id          — детали (generic)
 *   POST   /api/correspondence                   — создать (allocate номер исх.)
 *   PUT    /api/correspondence/:id               — править
 *   GET    /api/correspondence/next-outgoing-number?date=YYYY-MM-DD — preview номера
 *   POST   /api/correspondence/:id/link-doc      — привязать загруженный документ
 *   POST   /api/files/upload                     — мульти-парт загрузка файла
 *   DELETE /api/data/correspondence/:id          — удалить (через generic)
 *   GET    /api/customers                        — список заказчиков для привязки
 *   GET    /api/tenders                          — тендеры для привязки
 *   GET    /api/works                            — работы для привязки
 *   GET    /api/users                            — список авторов (для отображения)
 */
import { api } from '@/api/client';

export const CORR_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'OFFICE_MANAGER', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO'
];

export const DIRECTIONS = {
  incoming: { label: 'Входящее',  icon: '📥', tone: 'info' },
  outgoing: { label: 'Исходящее', icon: '📤', tone: 'ok'   }
};

export const DIRECTION_OPTIONS = [
  { value: '',         label: 'Все' },
  { value: 'incoming', label: '📥 Входящие' },
  { value: 'outgoing', label: '📤 Исходящие' }
];

export const DOC_TYPES = [
  { value: 'letter',       label: '✉️ Письмо' },
  { value: 'request',      label: '❓ Запрос' },
  { value: 'response',     label: '💬 Ответ' },
  { value: 'contract',     label: '📜 Договор' },
  { value: 'act',          label: '📋 Акт' },
  { value: 'invoice',      label: '💰 Счёт' },
  { value: 'claim',        label: '⚠️ Претензия' },
  { value: 'notification', label: '📢 Уведомление' },
  { value: 'other',        label: '📄 Прочее' }
];

export const DOC_TYPE_OPTIONS = [{ value: '', label: 'Все типы' }, ...DOC_TYPES];

export const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

export const MONTH_OPTIONS = [{ value: '', label: 'Все' }, ...MONTHS.map((m, i) => ({ value: String(i), label: m }))];

/* ── Список ─────────────────────────────────────────────────────────── */
export function loadCorrespondence(limit = 5000) {
  // Generic data endpoint — soft-delete фильтр обрабатывает бэк.
  return api(`/api/data/correspondence?limit=${limit}`)
    .then((d) => Array.isArray(d) ? d : (d?.items || d?.rows || []))
    .catch(() => []);
}

export function loadOne(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/data/correspondence/${_id}`).catch(() => null);
}

export function getNextOutgoingNumber(date) {
  const url = date
    ? `/api/correspondence/next-outgoing-number?date=${encodeURIComponent(date)}`
    : '/api/correspondence/next-outgoing-number';
  return api(url)
    .then((d) => d?.number || '')
    .catch(() => '');
}

export function createOne(payload) {
  return api('/api/correspondence', { method: 'POST', body: payload });
}

export function updateOne(id, payload) {
  const _id = encodeURIComponent(id);
  return api(`/api/correspondence/${_id}`, { method: 'PUT', body: payload });
}

export function deleteOne(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/data/correspondence/${_id}`, { method: 'DELETE' });
}

export function linkDoc(id, documentId) {
  const _id = encodeURIComponent(id);
  return api(`/api/correspondence/${_id}/link-doc`, {
    method: 'POST',
    body: { document_id: documentId }
  });
}

/* ── Mimir AI autofill ───────────────────────────────────────────────── */
/**
 * Запросить у Мимира предзаполнение полей формы корреспонденции.
 * @param {object} ctx — { direction, existing_fields }
 * @returns {Promise<{fields: object}>}
 */
export function mimirSuggestForm(ctx) {
  return api('/api/mimir/suggest-form', {
    method: 'POST',
    body: { form_type: 'correspondence', context: ctx }
  });
}

/* ── Аплоад файла ──────────────────────────────────────────────────── */
export async function uploadFile(file, label = 'Корреспонденция') {
  const token = localStorage.getItem('asgard_token') || '';
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', label);
  const resp = await fetch('/api/files/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  if (!resp.ok) throw new Error('Не удалось загрузить файл');
  return resp.json();
}

/* ── Справочники ───────────────────────────────────────────────────── */
export function loadUsers() {
  return api('/api/users?is_active=true')
    .then((d) => Array.isArray(d) ? d : (d?.items || d?.users || []))
    .catch(() => []);
}

export function loadCustomers() {
  return api('/api/customers?limit=2000')
    .then((d) => Array.isArray(d) ? d : (d?.items || d?.customers || []))
    .catch(() => []);
}

export function loadTenders() {
  return api('/api/tenders?limit=2000')
    .then((d) => Array.isArray(d) ? d : (d?.items || d?.tenders || []))
    .catch(() => []);
}

export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => Array.isArray(d) ? d : (d?.items || d?.works || []))
    .catch(() => []);
}

/* ── Утилиты ───────────────────────────────────────────────────────── */
export function hasAccess(user) {
  if (!user) return false;
  if (CORR_ROLES.includes(user.role)) return true;
  if (Array.isArray(user.roles)) return user.roles.some((r) => CORR_ROLES.includes(r));
  return false;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('ru-RU');
}

export function getDocTypeInfo(type) {
  return DOC_TYPES.find((t) => t.value === type) || { value: type, label: '📄 ' + (type || 'Прочее') };
}

export function getDirInfo(dir) {
  return DIRECTIONS[dir] || DIRECTIONS.incoming;
}
