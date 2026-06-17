/**
 * API-клиент страницы /assembly.
 * Источник: vanilla `assembly-page.js` (211) + `assembly-dnd.js` (605).
 *
 * Endpoint'ы (см. src/routes/assembly.js, prefix /api/assembly):
 *   GET    /                    — список ведомостей (?work_id=&type=&status=)
 *   GET    /:id                 — детали (item + items + pallets)
 *   POST   /                    — создать (mob/demob/transfer)
 *   PUT    /:id                 — обновить (только draft/confirmed)
 *   PUT    /:id/confirm         — подтвердить (draft → confirmed)
 *   PUT    /:id/send            — отправить (confirmed/packing/packed → in_transit)
 *   PUT    /:id/receive-all     — принять на склад демоб (returned)
 *   POST   /:id/create-demob    — создать демоб из моб
 *   POST   /:id/items/quick     — быстрое добавление позиции
 *   POST   /:id/items           — добавить позицию (полный)
 *   PUT    /:id/items/:itemId   — обновить позицию
 *   DELETE /:id/items/:itemId
 *   PUT    /:id/items/:itemId/pack             — отметить «собрано»
 *   PUT    /:id/items/:itemId/return-status    — для демоба (returning/damaged/lost/consumed)
 *   PUT    /:id/items/:itemId/assign-pallet    — назначить паллет
 *   PUT    /:id/items/:itemId/unassign-pallet
 *   GET    /:id/pallets
 *   POST   /:id/pallets
 *   PUT    /:id/pallets/:pid
 *   DELETE /:id/pallets/:pid
 *   PUT    /:id/pallets/:pid/pack
 *   GET    /:id/checklist-pdf
 *   GET    /:id/export-excel
 *
 *   GET    /api/products/search?q=  — автокомплит каталога расходников
 *   GET    /api/works               — для выбора работы при создании
 */
import { api } from '@/api/client';

export const STATUSES = [
  { value: 'draft',      label: 'Черновик',     tone: 'draft' },
  { value: 'confirmed',  label: 'Подтверждена', tone: 'sent' },
  { value: 'packing',    label: 'Сборка',       tone: 'sent' },
  { value: 'packed',     label: 'Собрано',      tone: 'approved' },
  { value: 'in_transit', label: 'В пути',       tone: 'sent' },
  { value: 'received',   label: 'Принято',      tone: 'approved' },
  { value: 'returned',   label: 'Возвращено',   tone: 'approved' },
  { value: 'closed',     label: 'Закрыта',      tone: 'draft' }
];

export const TYPES = [
  { value: 'mobilization',   label: '🚛 Мобилизация',    iconLabel: 'Мобилизация' },
  { value: 'demobilization', label: '🏠 Демобилизация',  iconLabel: 'Демобилизация' },
  { value: 'transfer',       label: '↔️ Перемещение',    iconLabel: 'Перемещение' }
];

export const SOURCE_LABELS = {
  reservation:           'Со склада',
  procurement_warehouse: 'Закупка→склад',
  procurement_object:    'Закупка→объект',
  from_warehouse:        'Со склада (расход)',
  manual:                'Вручную',
  on_site_purchase:      'Купл. на объекте'
};

export const RETURN_STATUSES = [
  { value: 'returning', label: 'Возврат',     tone: 'sent' },
  { value: 'damaged',   label: 'Сломано',     tone: 'rejected' },
  { value: 'lost',      label: 'Утеряно',     tone: 'rejected' },
  { value: 'consumed',  label: 'Израсходовано', tone: 'paid' }
];

export function statusInfo(s) {
  return STATUSES.find((x) => x.value === s) || { label: s, tone: 'draft' };
}

export function typeInfo(t) {
  return TYPES.find((x) => x.value === t) || { label: t, iconLabel: t };
}

export function loadList(params = {}) {
  const q = new URLSearchParams();
  if (params.work_id) q.set('work_id', params.work_id);
  if (params.type)    q.set('type', params.type);
  if (params.status)  q.set('status', params.status);
  q.set('limit', String(params.limit || 200));
  return api('/api/assembly?' + q.toString()).then((d) => d.items || []);
}

export function loadDetail(id) {
  return api('/api/assembly/' + id);
}

export function createAssembly(body) {
  return api('/api/assembly', { method: 'POST', body });
}

export function updateAssembly(id, body) {
  return api('/api/assembly/' + id, { method: 'PUT', body });
}

export function confirmAssembly(id) {
  return api('/api/assembly/' + id + '/confirm', { method: 'PUT', body: {} });
}

export function sendAssembly(id) {
  return api('/api/assembly/' + id + '/send', { method: 'PUT', body: {} });
}

export function receiveAll(id) {
  return api('/api/assembly/' + id + '/receive-all', { method: 'PUT', body: {} });
}

export function createDemob(id) {
  return api('/api/assembly/' + id + '/create-demob', { method: 'POST', body: {} });
}

export function quickAddItem(id, body) {
  return api('/api/assembly/' + id + '/items/quick', { method: 'POST', body });
}

export function deleteItem(asmId, itemId) {
  return api('/api/assembly/' + asmId + '/items/' + itemId, { method: 'DELETE' });
}

export function packItem(asmId, itemId) {
  return api('/api/assembly/' + asmId + '/items/' + itemId + '/pack', { method: 'PUT', body: {} });
}

export function setReturnStatus(asmId, itemId, body) {
  return api('/api/assembly/' + asmId + '/items/' + itemId + '/return-status', { method: 'PUT', body });
}

export function assignPallet(asmId, itemId, palletId) {
  return api('/api/assembly/' + asmId + '/items/' + itemId + '/assign-pallet', { method: 'PUT', body: { pallet_id: palletId } });
}

export function unassignPallet(asmId, itemId) {
  return api('/api/assembly/' + asmId + '/items/' + itemId + '/unassign-pallet', { method: 'PUT', body: {} });
}

export function createPallet(asmId, body) {
  return api('/api/assembly/' + asmId + '/pallets', { method: 'POST', body });
}

export function deletePallet(asmId, palletId) {
  return api('/api/assembly/' + asmId + '/pallets/' + palletId, { method: 'DELETE' });
}

export function packPallet(asmId, palletId) {
  return api('/api/assembly/' + asmId + '/pallets/' + palletId + '/pack', { method: 'PUT', body: {} });
}

export function searchProducts(q) {
  if (!q || q.length < 2) return Promise.resolve([]);
  return api('/api/products/search?q=' + encodeURIComponent(q))
    .then((d) => d.items || [])
    .catch(() => []);
}

export function loadWorks() {
  return api('/api/works?limit=2000').then((d) => d.items || d.works || []).catch(() => []);
}

export function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:assembly:changed'));
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : '—';
}
