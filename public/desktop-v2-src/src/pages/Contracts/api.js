/**
 * API-клиент страницы /contracts — Реестр договоров.
 *
 * Backend: `/api/data/contracts` (generic CRUD, src/routes/data.js).
 * RBAC из ACCESS_MATRIX: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV,
 *                       OFFICE_MANAGER, BUH, PM, HEAD_PM.
 *
 * Доступные endpoints (через generic /api/data):
 *   GET    /api/data/contracts            — список
 *   GET    /api/data/contracts/:id        — карточка
 *   POST   /api/data/contracts            — создать
 *   PUT    /api/data/contracts/:id        — обновить
 *   DELETE /api/data/contracts/:id        — удалить (ADMIN)
 *
 * Колонки в БД (по прод-схеме): id, work_id, tender_id, number, type,
 *   counterparty_id (= ИНН заказчика), counterparty_name, subject,
 *   start_date, end_date, is_perpetual, amount, responsible, status, file_url,
 *   comment, created_at, updated_at.
 */
import { api } from '@/api/client';

export const ALLOWED_VIEW_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'OFFICE_MANAGER', 'BUH', 'PM', 'HEAD_PM'
];

export const CONTRACT_TYPES = [
  { value: 'customer', label: 'Покупатель (заказчик)' },
  { value: 'supplier', label: 'Поставщик' }
];

export const CONTRACT_STATUSES = [
  { value: 'draft',      label: 'Черновик',  tone: 'draft' },
  { value: 'active',     label: 'Действует', tone: 'approved' },
  { value: 'terminated', label: 'Расторгнут', tone: 'rejected' }
];

export const COMPUTED_STATUSES = [
  { value: 'active',     label: 'Действует',  tone: 'approved' },
  { value: 'expiring',   label: 'Истекает',   tone: 'rework' },
  { value: 'expired',    label: 'Истёк',      tone: 'rejected' },
  { value: 'terminated', label: 'Расторгнут', tone: 'rejected' },
  { value: 'draft',      label: 'Черновик',   tone: 'draft' }
];

/* Вычислить computed-статус (учитывая даты, бессрочность и явный статус). */
export function computeStatus(c) {
  if (!c) return 'draft';
  if (c.status === 'terminated' || c.status === 'draft') return c.status;
  if (!c.end_date || c.is_perpetual) return 'active';
  const today = new Date();
  const endDate = new Date(c.end_date);
  if (Number.isNaN(endDate.getTime())) return 'active';
  const days = Math.ceil((endDate.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'active';
}

export function describeStatus(code) {
  return COMPUTED_STATUSES.find((s) => s.value === code) || COMPUTED_STATUSES[0];
}

export function loadContracts() {
  return api('/api/data/contracts?limit=1000').then(
    (d) => d.contracts || d.items || d.rows || []
  );
}

export function loadContract(id) {
  return api('/api/data/contracts/' + id).then((d) => d.item || d);
}

export function createContract(payload) {
  return api('/api/data/contracts', { method: 'POST', body: payload }).then(
    (d) => d.item || d
  );
}

export function updateContract(id, payload) {
  return api('/api/data/contracts/' + id, { method: 'PUT', body: payload }).then(
    (d) => d.item || d
  );
}

export function deleteContract(id) {
  return api('/api/data/contracts/' + id, { method: 'DELETE' });
}

/* Список контрагентов для select (используем существующий endpoint /api/customers). */
export function loadCustomers() {
  return api('/api/customers?limit=1000').then(
    (d) => d.customers || d.items || []
  );
}

/* E-6b: DaData-подсказки по тексту (название/адрес), vanilla contracts.js:927. */
export function suggestCustomers(query) {
  if (!query || query.trim().length < 3) return Promise.resolve([]);
  if (/^\d+$/.test(query.trim())) return Promise.resolve([]); // цифры → lookup
  return api('/api/customers/suggest?q=' + encodeURIComponent(query.trim()) + '&type=party')
    .then((d) => d.suggestions || d.items || [])
    .catch(() => []);
}

/* E-6b: DaData lookup по точному ИНН (10 или 12 цифр), vanilla contracts.js:1087. */
export function lookupCustomerByInn(inn) {
  const digits = String(inn || '').replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 12) {
    return Promise.resolve({ found: false, message: 'ИНН должен содержать 10 или 12 цифр' });
  }
  return api('/api/customers/lookup/' + digits).catch(() => ({ found: false, message: 'Не удалось получить данные ЕГРЮЛ' }));
}

/* E-6b: Мимир подсказывает поля формы (универсальный AI-fill), vanilla contracts.js:1157. */
export function mimirSuggestForm(formType, context) {
  return api('/api/mimir/suggest-form', {
    method: 'POST',
    body: { form_type: formType, context: context || {} }
  }).catch(() => ({ fields: {}, source: 'error' }));
}

export function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('ru-RU'); }
  catch { return String(s).slice(0, 10); }
}

export function fmtMoney(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) + ' ₽';
}

export function filterByQuery(list, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return list;
  return list.filter((c) =>
    String(c.number || '').toLowerCase().includes(s) ||
    String(c.subject || '').toLowerCase().includes(s) ||
    String(c.counterparty_name || '').toLowerCase().includes(s)
  );
}
