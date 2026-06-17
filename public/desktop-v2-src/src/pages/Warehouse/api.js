/**
 * Warehouse 2.0 — API helpers.
 *
 * Vanilla источники:
 *   public/assets/js/warehouse-v2.js          — 5 вкладок + корзина закупки
 *   public/assets/js/warehouse-v2-equipment.js — поштучный учёт оборудования
 *   public/assets/js/warehouse.js              — старая страница (редирект)
 *
 * Backend:
 *   src/routes/equipment.js       — /api/equipment/*
 *   src/routes/stock.js           — /api/stock/*
 *   src/routes/warehouse-cart.js  — /api/warehouse-cart/*
 *   src/routes/warehouse-locations.js — /api/warehouse/locations/*
 */
import { api } from '@/api/client';

/* ── Хелперы fetch с raw-ответом (для 409 stock_changed/equipment_taken) ── */
export async function rawApi(url, opts = {}) {
  const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('asgard_token') : '';
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const r = await fetch(url, { method: 'GET', headers, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, ok: r.ok, data };
}

/* ─────────── Каталог расходников ─────────── */
export const loadProducts = (search) =>
  api(`/api/products?limit=2000${search ? '&search=' + encodeURIComponent(search) : ''}`)
    .then((d) => d.items || [])
    .catch(() => []);

export const loadProductCard = (id) =>
  api(`/api/stock/product/${id}/card`);

export const loadProductAvailability = (productId) =>
  api(`/api/stock/availability/${productId}`).catch(() => ({ total: 0, slots: [] }));

export const createQuickProduct = (body) =>
  api('/api/stock/quick-product', { method: 'POST', body });

/* ─────────── Наличие на складе ─────────── */
export const loadStock = (search) =>
  api(`/api/stock?limit=2000${search ? '&search=' + encodeURIComponent(search) : ''}`)
    .then((d) => d.items || [])
    .catch(() => []);

export const loadLowStock = () =>
  api('/api/stock/low').then((d) => d.items || []).catch(() => []);

/* ─────────── Складские операции ─────────── */
export const stockReceipt = (body) =>
  api('/api/stock/receipt', { method: 'POST', body });

export const stockIssue = (body) =>
  api('/api/stock/issue', { method: 'POST', body });

export const stockTransfer = (body) =>
  api('/api/stock/transfer', { method: 'POST', body });

export const stockWriteoff = (body) =>
  api('/api/stock/writeoff', { method: 'POST', body });

export const loadMovements = () =>
  api('/api/stock/movements?limit=2000')
    .then((d) => d.items || [])
    .catch(() => []);

/* ─────────── Приёмка (incoming) ─────────── */
export const loadIncoming = () =>
  api('/api/stock/incoming?target=all').catch(() => ({ items: [], summary: {} }));

/* ─────────── Ячейки ─────────── */
export const loadLocations = (limit = 1000) =>
  api(`/api/warehouse/locations?limit=${limit}`)
    .then((d) => d.items || [])
    .catch(() => []);

export const bulkCreateLocations = (body) =>
  api('/api/warehouse/locations/bulk', { method: 'POST', body });

/* ─────────── Оборудование ─────────── */
export const loadEquipment = (params = {}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v)); });
  if (!qs.has('limit')) qs.set('limit', '200');
  return api(`/api/equipment?${qs.toString()}`)
    .then((d) => ({ equipment: d.equipment || d.items || [], total: d.total || d.count || 0 }))
    .catch(() => ({ equipment: [], total: 0 }));
};

export const loadEquipmentItem = (id) =>
  api(`/api/equipment/${id}`);

export const loadEquipmentCategories = () =>
  api('/api/equipment/categories').then((d) => d.categories || []).catch(() => []);

export const loadObjects = () =>
  api('/api/equipment/objects').then((d) => d.objects || []).catch(() => []);

export const loadWarehouses = () =>
  api('/api/equipment/warehouses').then((d) => d.warehouses || []).catch(() => []);

export const loadEquipmentStats = () =>
  api('/api/equipment/stats/dashboard').catch(() => api('/api/equipment/stats/summary').catch(() => ({})));

export const loadEquipmentRequests = () =>
  api('/api/equipment/requests?status=pending').then((d) => d.requests || d.items || []).catch(() => []);

export const loadAvailableForRequest = () =>
  api('/api/equipment/available-for-request').then((d) => d.equipment || []).catch(() => []);

export const loadBatchesForWarehouse = () =>
  api('/api/equipment/requests/batches?status=pending').then((d) => d.batches || []).catch(() => []);

export const createEquipmentForm = (body) =>
  api('/api/equipment', { method: 'POST', body });

export const updateEquipment = (id, body) =>
  api(`/api/equipment/${id}`, { method: 'PUT', body });

export const issueEquipment = (body) =>
  api('/api/equipment/issue', { method: 'POST', body });

export const returnEquipment = (body) =>
  api('/api/equipment/return', { method: 'POST', body });

export const transferRequestEquipment = (body) =>
  api('/api/equipment/transfer-request', { method: 'POST', body });

export const transferExecute = (body) =>
  api('/api/equipment/transfer-execute', { method: 'POST', body });

export const rejectEquipmentRequest = (id, body) =>
  api(`/api/equipment/requests/${id}/reject`, { method: 'POST', body });

export const equipmentSendToRepair = (body) =>
  api('/api/equipment/repair', { method: 'POST', body });

/* Vanilla warehouse-v2-equipment.js:513 — POST /api/equipment/:id/maintenance.
   maintenance_type ∈ {maintenance, repair, calibration, inspection}.
   cost, spare_parts (array), next_date — необязательные. */
export const equipmentAddMaintenance = (eqId, body) =>
  api(`/api/equipment/${eqId}/maintenance`, { method: 'POST', body });

export const equipmentBatchRequest = (body) =>
  api('/api/equipment/requests/batch', { method: 'POST', body });

export const removeBatchItem = (id) =>
  api(`/api/equipment/requests/item/${id}`, { method: 'DELETE' });

export const approveBatch = (batchId) =>
  api(`/api/equipment/requests/batch/${batchId}/approve`, { method: 'PUT' });

export const rejectBatch = (batchId, reason) =>
  api(`/api/equipment/requests/batch/${batchId}/reject`, { method: 'PUT', body: { reason } });

export const loadMyEquipment = (userId) =>
  api(`/api/equipment/by-holder/${userId}`).then((d) => d.equipment || d.items || []).catch(() => []);

export const findByQr = (code) =>
  api(`/api/equipment/by-qr/${encodeURIComponent(code)}`);

/* ─── E-6b: Комплекты оборудования ─── */
/* Vanilla: equipment.js:685, warehouse-v2-equipment.js:351, backend equipment.js:1670 */
export const loadEquipmentKits = () =>
  api('/api/equipment/kits').then((d) => d.kits || d.items || []).catch(() => []);

export const loadEquipmentKit = (id) =>
  api('/api/equipment/kits/' + id).then((d) => d.kit || d.item || d).catch(() => null);

export const createEquipmentKit = (body) =>
  api('/api/equipment/kits', { method: 'POST', body });

export const updateEquipmentKit = (id, body) =>
  api('/api/equipment/kits/' + id, { method: 'PUT', body });

export const deleteEquipmentKit = (id) =>
  api('/api/equipment/kits/' + id, { method: 'DELETE' });

export const assembleEquipmentKit = (id, body) =>
  api('/api/equipment/kits/' + id + '/assemble', { method: 'POST', body });

/* ─── E-6b: Данные для печати QR-кодов (vanilla warehouse.js:477) ─── */
export const equipmentQrPrintData = (ids) =>
  api('/api/equipment/qr-print-data', { method: 'POST', body: { ids: ids.map(Number) } });

/* ─── E-6b: Массовое создание оборудования (vanilla warehouse.js:658) ─── */
export const bulkCreateEquipment = (items) =>
  api('/api/equipment/bulk-create', { method: 'POST', body: { items } });

export const loadWorksList = () =>
  api('/api/works?limit=2000').then((d) => d.works || d.items || d.rows || []).catch(() => []);

export const loadPmUsers = () =>
  api('/api/users?role=PM&limit=2000').then((d) => d.users || []).catch(() => []);

/* ─────────── Корзина закупки ─────────── */
export const loadCart = () =>
  api('/api/warehouse-cart').catch(() => ({ cart: null, items: [] }));

export const addCartItems = (body) =>
  api('/api/warehouse-cart/items', { method: 'POST', body });

export const updateCartItem = (id, body) =>
  api(`/api/warehouse-cart/items/${id}`, { method: 'PUT', body });

export const removeCartItem = (id) =>
  api(`/api/warehouse-cart/items/${id}`, { method: 'DELETE' });

export const clearCart = () =>
  api('/api/warehouse-cart', { method: 'DELETE' });

export const cartManualSearch = (name) =>
  api('/api/warehouse-cart/add-manual', { method: 'POST', body: { name } });

export const cartPreviewSubmit = () =>
  api('/api/warehouse-cart/preview-submit', { method: 'POST', body: {} });

export const submitCart = (body) =>
  rawApi('/api/warehouse-cart/submit', { method: 'POST', body });

/* Note: loadProductsRoot/loadStockRoot/loadAvailabilityRoot/loadCurrentUser/
 * loadCartItemsRoot/catalogImportAi удалены 2026-06-14 — не импортировались,
 * добавлялись только под coverage-audit. */

/* ─────────── Метаданные / справочники ─────────── */
export const STATUS_META = {
  on_warehouse: { label: 'На складе', icon: '📦', tone: 'ok'    },
  issued:       { label: 'Выдано',     icon: '👤', tone: 'info'  },
  in_transit:   { label: 'В пути',     icon: '🚚', tone: 'amber' },
  repair:       { label: 'Ремонт',     icon: '🔧', tone: 'orange'},
  broken:       { label: 'Сломано',    icon: '❌', tone: 'err'   },
  written_off:  { label: 'Списано',    icon: '🗑️', tone: 'mute'  }
};

export const CONDITION_META = {
  new:          { label: 'Новое',    tone: 'ok'    },
  good:         { label: 'Хорошее',  tone: 'info'  },
  satisfactory: { label: 'Удовл.',   tone: 'amber' },
  poor:         { label: 'Плохое',   tone: 'orange'},
  broken:       { label: 'Сломано',  tone: 'err'   }
};

export const MOVE_META = {
  receipt:  { icon: '📥', label: 'Приход',         tone: 'ok'    },
  issue:    { icon: '📤', label: 'Расход',         tone: 'info'  },
  transfer: { icon: '🔄', label: 'Перемещение',    tone: 'gold'  },
  writeoff: { icon: '🗑️', label: 'Списание',       tone: 'err'   },
  return:   { icon: '↩️', label: 'Возврат',        tone: 'ok'    },
  found:    { icon: '✨', label: 'Находка',        tone: 'amber' },
  adjust:   { icon: '⚖️', label: 'Корректировка',  tone: 'mute'  }
};

export const INCOMING_STATUS = {
  pending:             { label: 'Ожидает',     tone: 'mute'  },
  ordered:             { label: 'Заказано',    tone: 'amber' },
  shipped:             { label: 'В пути',      tone: 'info'  },
  delivered:           { label: 'Доставлено',  tone: 'ok'    },
  partially_delivered: { label: 'Частично',    tone: 'amber' }
};

/* ─────────── Роли ─────────── */
export const ADMIN_ROLES        = ['ADMIN', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
export const PM_ROLES           = ['PM', 'HEAD_PM', 'DIRECTOR_DEV', 'DIRECTOR_GEN', 'CHIEF_ENGINEER'];
export const WAREHOUSE_ROLES    = ['ADMIN', 'WAREHOUSE'];
export const CART_USE_ROLES     = ['ADMIN', 'PM', 'HEAD_PM', 'PROC', 'WAREHOUSE'];

export function isAdmin(role)       { return ADMIN_ROLES.includes(role); }
export function isPm(role)          { return PM_ROLES.includes(role); }
export function canUseCart(role)    { return CART_USE_ROLES.includes(role); }

/* ─────────── Формат / утилиты ─────────── */
export function fmt(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString('ru-RU');
}

export function money(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString('ru-RU') + ' ₽';
}

export function formatDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU'); } catch { return '—'; }
}

export function formatDateTime(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}

export function categoryIcon(name) {
  const c = String(name || '').toLowerCase();
  if (c.includes('сиз') || c.includes('защит')) return '🦺';
  if (c.includes('хим') || c.includes('расходн')) return '🧪';
  if (c.includes('метиз') || c.includes('крепёж') || c.includes('крепеж')) return '🔩';
  if (c.includes('электр')) return '⚡';
  if (c.includes('сантех')) return '🚿';
  if (c.includes('насос') || c.includes('оборуд')) return '⚙️';
  if (c.includes('шланг') || c.includes('рукав')) return '🪢';
  if (c.includes('инструм')) return '🛠️';
  if (c.includes('строит')) return '🧱';
  if (c.includes('аренд')) return '🚜';
  return '📦';
}

export function eqIcon(eq) {
  return eq?.custom_icon || eq?.category_icon || '🛠️';
}

/* ─────────── E-PHOTO: Фото / иконки оборудования ───────────
 * Vanilla источник: public/assets/js/equipment.js строки 228-345.
 * Backend: src/routes/equipment.js строки 2206-2258.
 *
 * Endpoint POST /api/equipment/:id/photo поддерживает:
 *   • multipart/form-data (поле 'file') — загрузка файла на сервер
 *   • application/json { custom_icon } — установка emoji-иконки
 *   • application/json { photo_url } — установка внешнего URL
 *
 * DELETE /api/equipment/:id/photo — сброс photo_url И custom_icon.
 */

/** Загрузка фото оборудования через multipart. */
export async function uploadEquipmentPhoto(id, file) {
  const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('asgard_token') : '';
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`/api/equipment/${id}/photo`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  if (!r.ok) {
    let msg = 'Ошибка загрузки фото';
    try { const j = await r.json(); msg = j.message || j.error || msg; } catch { /* noop */ }
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/** Установка emoji-иконки (без файла). */
export const setEquipmentIcon = (id, custom_icon) =>
  api(`/api/equipment/${id}/photo`, { method: 'POST', body: { custom_icon } });

/** Удалить фото И иконку. */
export const deleteEquipmentPhoto = (id) =>
  api(`/api/equipment/${id}/photo`, { method: 'DELETE' });

/** Библиотека emoji-иконок (зеркало vanilla equipment.js строки 180-194). */
export const ICON_LIBRARY = [
  { cat: 'Инструменты', icons: ['🔧','🔨','🪛','🪚','🗜️','⚙️','🔩','🪝','🔗','🧲','🪜','🛠️'] },
  { cat: 'Насосы / Вода', icons: ['💧','🚿','💦','🌊','🫧','🪠','🚰','🧊'] },
  { cat: 'Электрика', icons: ['⚡','🔌','💡','🔋','🔦','🪫','🏮','💠'] },
  { cat: 'Измерения', icons: ['📏','📐','🌡️','⏱️','🧭','🔬','🔭','⏲️'] },
  { cat: 'Сварка / Огонь', icons: ['🔥','🧯','⚗️','🪨','💎','🫠','♨️'] },
  { cat: 'Транспорт', icons: ['🚗','🚛','🏗️','🚜','🚐','🛻','🏎️','🚲'] },
  { cat: 'СИЗ', icons: ['🦺','🧤','🥽','👷','🪖','🫁','👓','🧣'] },
  { cat: 'Ёмкости', icons: ['🛢️','🪣','🧪','🧫','🏺','🫙','🍶','🥫'] },
  { cat: 'Стройка', icons: ['🧱','🪵','🏗️','🪨','🏠','🪟','🪞','🚧'] },
  { cat: 'Уборка / Хим', icons: ['🧹','🧽','🧴','🧼','🫧','🪥','🧻','♻️'] },
  { cat: 'Техника / IT', icons: ['💻','🖨️','📱','📷','🖥️','⌨️','🖱️','📡'] },
  { cat: 'Канцелярия', icons: ['📋','📁','📦','🗃️','🏷️','✂️','📎'] },
  { cat: 'Прочее', icons: ['🔑','🔒','🪪','🔔','⚓','🧰','🎯','⭐','🎪'] }
];
