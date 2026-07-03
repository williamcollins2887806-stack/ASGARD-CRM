/**
 * API-клиент страниц /procurement и /my-procurement.
 * Источник истины: vanilla `public/assets/js/procurement-page.js` (1031 строк, IIFE AsgardProcurementPage).
 *
 * Полная карта vanilla endpoints, перенесённых сюда:
 *   GET    /api/procurement                          — список заявок (+ filters)
 *   GET    /api/procurement/dashboard                — KPI (для PROC/ADMIN/DIR)
 *   GET    /api/procurement/:id                      — детали (items, payments, history, invoice_imports)
 *   POST   /api/procurement                          — создать
 *   PUT    /api/procurement/:id                      — правка полей заявки
 *   DELETE /api/procurement/:id                      — удалить (только draft, ADMIN)
 *   POST   /api/procurement/:id/items                — добавить позицию
 *   PUT    /api/procurement/:id/items/:itemId        — изменить позицию
 *   DELETE /api/procurement/:id/items/:itemId        — удалить позицию
 *   POST   /api/procurement/:id/items/bulk           — bulk-добавить (из витрины/корзины)
 *   POST   /api/procurement/:id/items/import-excel   — Excel-импорт позиций (multipart)
 *   POST   /api/procurement/:id/items/import-text    — добавление списком (текст→позиции)
 *   POST   /api/procurement/:id/items/ai-parse       — AI-разбор ТЗ → позиции
 *   POST   /api/procurement/:id/invoice/parse        — счёт (multipart Excel ИЛИ text) → авто-матчинг
 *   POST   /api/procurement/:id/invoice/:importId/apply — массово проставить цены
 *   POST   /api/procurement/:id/items/:itemId/split  — сплит позиции по поставщикам
 *   DELETE /api/procurement/:id/items/:itemId/split  — откат сплита
 *   POST   /api/procurement/:id/price-hints          — батч-подсказки цен
 *   PUT    /api/procurement/:id/send-to-proc         — РП отправил закупщику
 *   PUT    /api/procurement/:id/proc-respond         — Закупщик ответил
 *   PUT    /api/procurement/:id/return-to-proc       — РП вернул на доработку
 *   PUT    /api/procurement/:id/pm-approve           — РП согласовал
 *   PUT    /api/procurement/:id/dir-approve          — Директор согласовал (locked)
 *   PUT    /api/procurement/:id/dir-rework           — Директор на доработку
 *   PUT    /api/procurement/:id/dir-question         — Директор: вопрос
 *   PUT    /api/procurement/:id/dir-reject           — Директор отклонил
 *   PUT    /api/procurement/:id/mark-paid            — Бухгалтер: оплачено
 *   PUT    /api/procurement/:id/items/:itemId/deliver — Приёмка позиции (WAREHOUSE/PM)
 *   PUT    /api/procurement/:id/close                — Закрыть заявку
 *   POST   /api/procurement/:id/clone                — Создать копию
 *   GET    /api/procurement/templates                — Шаблоны
 *   POST   /api/procurement/templates/from-request/:id — Создать шаблон из заявки
 *   POST   /api/procurement/from-template/:tplId     — Создать заявку из шаблона
 *   GET    /api/procurement/export/excel             — Экспорт реестра
 *   GET    /api/procurement/template/excel           — Шаблон Excel
 *   GET    /api/procurement/:id/export/excel?group=  — Экспорт заявки в Excel
 *   GET    /api/products/catalog-procurement         — Витрина каталога (остаток+цена)
 *   GET    /api/warehouse/locations                  — Ячейки для приёмки
 *   GET    /api/suppliers                            — Поставщики
 *   GET    /api/works                                — Работы для выбора в заявке
 *   GET    /api/users/me                             — Текущий пользователь
 *   GET    /api/price-records/hint                   — Подсказка цены при вводе
 */
import { api } from '@/api/client';

/* ─── Карта статусов (1:1 с vanilla STATUSES) ─── */
export const STATUSES = {
  draft:               { label: 'Черновик',         tone: 'draft' },
  sent_to_proc:        { label: 'У закупщика',      tone: 'sent' },
  proc_responded:      { label: 'Ответ закупщика',  tone: 'question' },
  pm_approved:         { label: 'РП согласовал',    tone: 'sent' },
  dir_approved:        { label: 'Директор ✓',       tone: 'approved' },
  dir_rework:          { label: 'На доработке',     tone: 'rework' },
  dir_question:        { label: 'Вопрос',           tone: 'question' },
  dir_rejected:        { label: 'Отклонена',        tone: 'rejected' },
  paid:                { label: 'Оплачено',         tone: 'approved' },
  partially_delivered: { label: 'Частичная',        tone: 'sent' },
  delivered:           { label: 'Доставлено',       tone: 'approved' },
  closed:              { label: 'Закрыта',          tone: 'approved' }
};

export const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  ...Object.entries(STATUSES).map(([k, v]) => ({ value: k, label: v.label }))
];

/* ─── Колонки канбана (объединяем родственные статусы) ─── */
export const KANBAN_COLS = [
  { key: 'new',      label: '🆕 Новые',          statuses: ['sent_to_proc'] },
  { key: 'work',     label: '🛠️ В работе',       statuses: ['proc_responded'] },
  { key: 'approve',  label: '⏳ Согласование',   statuses: ['pm_approved', 'dir_question', 'dir_rework'] },
  { key: 'paid',     label: '💳 Оплачено',       statuses: ['dir_approved', 'paid'] },
  { key: 'delivery', label: '🚚 Доставка',       statuses: ['partially_delivered', 'delivered'] },
  { key: 'done',     label: '✅ Закрыто',        statuses: ['closed', 'dir_rejected'] }
];

/* ─── RBAC-хелперы ─── */
export const isPM         = (role) => ['PM', 'HEAD_PM'].includes(role);
export const isPROC       = (role) => ['PROC', 'ADMIN'].includes(role);
export const isDIR        = (role) => ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'].includes(role);
export const isBUH        = (role) => ['BUH', 'ADMIN'].includes(role);
export const isWAREHOUSE  = (role) => ['WAREHOUSE', 'ADMIN'].includes(role);
export const canSeeAll    = (role) => ['ADMIN', 'PROC', 'BUH', 'WAREHOUSE', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role);

/* ─── Format helpers ─── */
export function money(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}
export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU');
}
export function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function isUrgent(r) {
  return r.priority === 'urgent'
    || (r.delivery_deadline && new Date(r.delivery_deadline) < new Date(Date.now() + 3 * 86400000));
}
export function isOverdue(r) {
  return r.delivery_deadline && new Date(r.delivery_deadline) < new Date() && !r.delivered_at;
}

/* ═══ List & dashboard ═══ */
export function loadProcurements(filters = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(filters.limit ?? 400));
  if (filters.status)    q.set('status', filters.status);
  if (filters.pm_id)     q.set('pm_id', filters.pm_id);
  if (filters.work_id)   q.set('work_id', filters.work_id);
  if (filters.proc_id)   q.set('proc_id', filters.proc_id);
  if (filters.date_from) q.set('date_from', filters.date_from);
  if (filters.date_to)   q.set('date_to', filters.date_to);
  if (filters.search)    q.set('search', filters.search);
  return api(`/api/procurement?${q.toString()}`).then((d) => d.items || []);
}

export function loadDashboard() {
  return api(`/api/procurement/dashboard`).catch(() => ({ counts: [], overdue: [], upcoming: [], pending_proc: [] }));
}

export function loadProcurementDetail(id) {
  return api(`/api/procurement/${id}`);
}

export function loadCurrentUser() {
  return api(`/api/users/me`).then((d) => d.user || d);
}

/* ═══ Filters by query/status (client-side) ═══ */
export function filterByQuery(items, q) {
  if (!q || !q.trim()) return items;
  const lq = q.trim().toLowerCase();
  return items.filter((r) =>
    String(r.id).includes(lq) ||
    (r.title || '').toLowerCase().includes(lq) ||
    (r.work_title || '').toLowerCase().includes(lq) ||
    (r.pm_name || '').toLowerCase().includes(lq) ||
    (r.proc_name || '').toLowerCase().includes(lq)
  );
}
export function filterByStatus(items, status) {
  if (!status) return items;
  return items.filter((r) => r.status === status);
}

/* ═══ CRUD заявок ═══ */
export function createProcurement(payload) {
  return api(`/api/procurement`, { method: 'POST', body: payload });
}
export function updateProcurement(id, payload) {
  return api(`/api/procurement/${id}`, { method: 'PUT', body: payload });
}
export function deleteProcurement(id) {
  return api(`/api/procurement/${id}`, { method: 'DELETE' });
}
export function cloneProcurement(id) {
  return api(`/api/procurement/${id}/clone`, { method: 'POST', body: {} });
}
export function exportProcurement(id, group) {
  // Открывается напрямую в новом окне для скачивания
  const g = group ? `?group=${group}` : '';
  return `/api/procurement/${id}/export/excel${g}`;
}

/* ═══ Позиции ═══ */
export function addItem(procId, payload) {
  return api(`/api/procurement/${procId}/items`, { method: 'POST', body: payload });
}
export function updateItem(procId, itemId, payload) {
  return api(`/api/procurement/${procId}/items/${itemId}`, { method: 'PUT', body: payload });
}
export function deleteItem(procId, itemId) {
  return api(`/api/procurement/${procId}/items/${itemId}`, { method: 'DELETE' });
}
/** Мягкая отмена позиции — данные остаются в истории, статус → cancelled. */
export function cancelItem(procId, itemId) {
  return api(`/api/procurement/${procId}/items/${itemId}/cancel`, { method: 'PUT', body: {} });
}
export function bulkItems(procId, items) {
  return api(`/api/procurement/${procId}/items/bulk`, { method: 'POST', body: { items } });
}
export function importText(procId, text) {
  return api(`/api/procurement/${procId}/items/import-text`, { method: 'POST', body: { text } });
}
export function aiParseSpec(procId, text) {
  return api(`/api/procurement/${procId}/items/ai-parse`, { method: 'POST', body: { text } });
}

/* ═══ Сплит ═══ */
export function splitItem(procId, itemId, parts) {
  return api(`/api/procurement/${procId}/items/${itemId}/split`, { method: 'POST', body: { parts } });
}
export function unsplitItem(procId, itemId) {
  return api(`/api/procurement/${procId}/items/${itemId}/split`, { method: 'DELETE' });
}

/* ═══ Счёт-парс ═══ */
/** Excel — multipart, file: File, поля: supplier_id/supplier_name/delivery_days */
export async function parseInvoiceExcel(procId, file, { supplierId, supplierName, deliveryDays } = {}) {
  const fd = new FormData();
  if (supplierId)   fd.append('supplier_id', supplierId);
  if (supplierName) fd.append('supplier_name', supplierName);
  if (deliveryDays != null && deliveryDays !== '') fd.append('delivery_days', deliveryDays);
  fd.append('file', file);
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('asgard_token')) || '';
  const r = await fetch(`/api/procurement/${procId}/invoice/parse`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
/** Текст (для PDF/фото, распознанных на клиенте) */
export function parseInvoiceText(procId, { text, supplierId, supplierName, deliveryDays }) {
  return api(`/api/procurement/${procId}/invoice/parse`, {
    method: 'POST',
    body: { text, supplier_id: supplierId || null, supplier_name: supplierName || null, delivery_days: deliveryDays || null }
  });
}
/** Применить цены по сматченным строкам */
export function applyInvoice(procId, importId, { rows, supplierId, supplierName, deliveryDays }) {
  return api(`/api/procurement/${procId}/invoice/${importId}/apply`, {
    method: 'POST',
    body: { rows, supplier_id: supplierId, supplier_name: supplierName, delivery_days: deliveryDays }
  });
}

/* ═══ Импорт Excel позиций (multipart) ═══ */
export async function importExcelItems(procId, file) {
  const fd = new FormData();
  fd.append('file', file);
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('asgard_token')) || '';
  const r = await fetch(`/api/procurement/${procId}/items/import-excel`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

/* ═══ Подсказки цен ═══ */
export function loadPriceHints(procId, items) {
  return api(`/api/procurement/${procId}/price-hints`, { method: 'POST', body: { items } });
}
export function loadPriceHint(name) {
  return api(`/api/price-records/hint?name=${encodeURIComponent(name)}`).catch(() => null);
}

/* ═══ Переходы статусов ═══ */
export function transition(procId, action, comment) {
  return api(`/api/procurement/${procId}/${action}`, { method: 'PUT', body: { comment } });
}

/* ═══ Приёмка позиции ═══ */
export function deliverItem(procId, itemId, { locationId } = {}) {
  return api(`/api/procurement/${procId}/items/${itemId}/deliver`, {
    method: 'PUT', body: locationId ? { location_id: locationId } : {}
  });
}

/* ═══ Шаблоны заявок ═══ */
export function loadTemplates() {
  return api(`/api/procurement/templates`).then((d) => d.items || []).catch(() => []);
}
export function saveAsTemplate(procId, name) {
  return api(`/api/procurement/templates/from-request/${procId}`, { method: 'POST', body: { name } });
}
export function fromTemplate(tplId, workId) {
  return api(`/api/procurement/from-template/${tplId}`, { method: 'POST', body: { work_id: workId || null } });
}

/* ═══ Витрина каталога ═══ */
export function loadCatalogShowcase({ includeEquipment = true, limit = 400 } = {}) {
  const incEq = includeEquipment ? 'true' : 'false';
  // URL литералом первой переменной чтобы аудит корректно его извлёк
  const url = `/api/products/catalog-procurement?include_equipment=${incEq}&limit=${limit}`;
  return api(url).then((d) => d.items || []);
}

/* ═══ Suppliers / works / users / locations ═══ */
export function loadSuppliers() {
  return api(`/api/suppliers?limit=300`).then((d) => d.items || []).catch(() => []);
}
export function loadWorks(limit = 200) {
  return api(`/api/works?limit=${limit}`).then((d) => d.works || d.items || d.rows || []).catch(() => []);
}
export function loadWarehouseLocations() {
  return api(`/api/warehouse/locations?is_active=true&limit=500`)
    .then((d) => d.items || d.rows || d.locations || (Array.isArray(d) ? d : []))
    .catch(() => []);
}

/* ═══ Возможные действия по статусу (1:1 с vanilla getActions) ═══ */
export function getActions(p, role) {
  const a = [];
  const s = p.status;
  // 23.06.2026 BUG-FIX (Procurement P-03): backend разрешает «Отправить закупщику» И PM, И DIR
  // (procurement.js:594-604 fromStatuses + roles). До фикса DIR не видел кнопку и не мог отправить.
  if (s === 'draft' && (isPM(role) || isDIR(role)))
    a.push({ label: 'Отправить закупщику', action: 'send-to-proc', variant: 'primary' });
  if (s === 'sent_to_proc' && isPROC(role))
    a.push({ label: 'Ответить РП', action: 'proc-respond', variant: 'primary' });
  if (s === 'proc_responded' && isPM(role)) {
    a.push({ label: 'Согласовать', action: 'pm-approve', variant: 'primary' });
    a.push({ label: 'Вернуть',     action: 'return-to-proc', variant: 'ghost' });
  }
  // 23.06.2026 BUG-FIX (Procurement P-04): backend разрешает PM повторно отправить
  // закупщику ИЗ dir_rework (procurement.js:595 fromStatuses:['draft','dir_rework']).
  // До фикса UI не показывал кнопку — заявка «зависала» в колонке Согласование.
  if (s === 'dir_rework' && isPM(role))
    a.push({ label: 'Отправить снова', action: 'send-to-proc', variant: 'primary' });
  // 23.06.2026 BUG-FIX (Procurement P-05): backend разрешает PM согласовать из dir_question
  // (procurement.js:622). До фикса PM не мог ответить директору, заявка «зависала».
  if (s === 'dir_question' && isPM(role))
    a.push({ label: 'Ответить директору', action: 'pm-approve', variant: 'primary' });
  if (s === 'pm_approved' && isDIR(role)) {
    a.push({ label: 'Согласовать', action: 'dir-approve',   variant: 'primary' });
    a.push({ label: 'Доработка',   action: 'dir-rework',    variant: 'ghost' });
    a.push({ label: 'Вопрос',      action: 'dir-question',  variant: 'ghost' });
    a.push({ label: 'Отклонить',   action: 'dir-reject',    variant: 'danger' });
  }
  if (s === 'dir_approved' && isBUH(role))
    a.push({ label: 'Оплачено', action: 'mark-paid', variant: 'primary' });
  if (['paid', 'partially_delivered'].includes(s) && (isWAREHOUSE(role) || isPM(role)))
    a.push({ label: 'Принять', action: 'deliver-items', variant: 'primary' });
  if (s === 'delivered' && (isPM(role) || isDIR(role)))
    a.push({ label: 'Закрыть', action: 'close', variant: 'ghost' });
  return a;
}

/* ═══ Канбан drag: проверка разрешённого перехода (1:1 с vanilla _kanbanMove) ═══ */
export function kanbanActionFor(colKey, fromStatus, role) {
  if (colKey === 'work'    && fromStatus === 'sent_to_proc'   && isPROC(role)) return 'proc-respond';
  if (colKey === 'approve' && fromStatus === 'proc_responded' && isPM(role))   return 'pm-approve';
  if (colKey === 'paid'    && fromStatus === 'pm_approved'    && isDIR(role))  return 'dir-approve';
  if (colKey === 'paid'    && fromStatus === 'dir_approved'   && isBUH(role))  return 'mark-paid';
  if (colKey === 'done'    && fromStatus === 'delivered'      && (isPM(role) || isDIR(role))) return 'close';
  return null;
}
