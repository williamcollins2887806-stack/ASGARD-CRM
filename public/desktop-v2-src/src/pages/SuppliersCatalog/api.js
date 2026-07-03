/**
 * API-клиент страницы /suppliers-catalog.
 * Источник истины — vanilla `public/assets/js/suppliers-page.js` (~673 строки).
 *
 * Endpoint'ы (см. src/routes/suppliers.js, prefix /api):
 *   GET    /api/suppliers?search=&category=&is_active=&limit=
 *   GET    /api/suppliers/:id                — карточка + контакты
 *   GET    /api/suppliers/:id/stats          — статистика (deals, price_points, top_items)
 *   GET    /api/suppliers/:id/price-history  — история цен (50 последних)
 *   POST   /api/suppliers                    — создать (PROC/ADMIN)
 *   PUT    /api/suppliers/:id                — обновить (PROC/ADMIN)
 *   DELETE /api/suppliers/:id                — удалить (ADMIN)
 *   GET    /api/suppliers/:id/contacts
 *   POST   /api/suppliers/:id/contacts       — добавить контакт
 *   PUT    /api/suppliers/:id/contacts/:cid  — обновить (включая is_primary)
 *   DELETE /api/suppliers/:id/contacts/:cid
 *   GET    /api/price-records?search=&source=&date_from=&date_to=
 *   POST   /api/price-records                — добавить цену вручную
 */
import { api } from '@/api/client';

export const CATEGORIES = [
  { value: 'materials',        label: 'Материалы' },
  { value: 'equipment_rental', label: 'Аренда техники' },
  { value: 'services',         label: 'Услуги' },
  { value: 'other',            label: 'Прочее' }
];

export const SOURCES = [
  { value: 'manual',            label: 'Вручную' },
  { value: 'quote',             label: 'КП' },
  { value: 'ai_search',         label: 'AI-поиск' },
  { value: 'market_monitoring', label: 'Мониторинг' },
  { value: 'procurement',       label: 'Из закупки' }
];

export function loadSuppliers(params = {}) {
  const q = new URLSearchParams();
  if (params.search)     q.set('search',     params.search);
  if (params.category)   q.set('category',   params.category);
  if (params.is_active)  q.set('is_active',  params.is_active);
  if (params.rating_gte) q.set('rating_gte', params.rating_gte);
  q.set('limit', String(params.limit || 500));
  return api('/api/suppliers?' + q.toString()).then((d) => d.items || []);
}

export function loadSupplier(id) {
  return api('/api/suppliers/' + id);
}

export function loadSupplierStats(id) {
  return api('/api/suppliers/' + id + '/stats').catch(() => null);
}

export function loadPriceHistory(id) {
  return api('/api/suppliers/' + id + '/price-history')
    .then((d) => d.items || d.rows || d || [])
    .catch(() => []);
}

export function createSupplier(body) {
  return api('/api/suppliers', { method: 'POST', body });
}

export function updateSupplier(id, body) {
  return api('/api/suppliers/' + id, { method: 'PUT', body });
}

export function deleteSupplier(id) {
  return api('/api/suppliers/' + id, { method: 'DELETE' });
}

export function addContact(supplierId, body) {
  return api('/api/suppliers/' + supplierId + '/contacts', { method: 'POST', body });
}

export function updateContact(supplierId, contactId, body) {
  return api('/api/suppliers/' + supplierId + '/contacts/' + contactId, { method: 'PUT', body });
}

export function deleteContact(supplierId, contactId) {
  return api('/api/suppliers/' + supplierId + '/contacts/' + contactId, { method: 'DELETE' });
}

export function loadPrices(params = {}) {
  const q = new URLSearchParams();
  if (params.search)    q.set('search',    params.search);
  if (params.source)    q.set('source',    params.source);
  if (params.date_from) q.set('date_from', params.date_from);
  if (params.date_to)   q.set('date_to',   params.date_to);
  q.set('limit', String(params.limit || 500));
  return api('/api/price-records?' + q.toString()).then((d) => d.items || []);
}

export function createPriceRecord(body) {
  return api('/api/price-records', { method: 'POST', body });
}

export function fmtMoney(v) {
  if (v == null || v === '') return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(v))) + ' ₽';
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function categoryLabel(c) {
  return CATEGORIES.find((x) => x.value === c)?.label || c || '—';
}

export function sourceLabel(s) {
  return SOURCES.find((x) => x.value === s)?.label || s || '—';
}

export function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:suppliers:changed'));
}
