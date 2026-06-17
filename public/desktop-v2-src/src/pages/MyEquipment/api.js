/**
 * API-клиент страницы /my-equipment (Моё оборудование).
 * Источник: vanilla `public/assets/js/my_equipment.js` (276 строк, AsgardMyEquipment).
 *
 * Бэкенд (`src/routes/equipment.js`):
 *   GET   /api/equipment/by-holder/:holderId  — оборудование на руках у пользователя
 *   GET   /api/equipment/objects              — список объектов (для формы передачи)
 *   POST  /api/equipment/return                — возврат на склад (текущий держатель → склад)
 *   POST  /api/equipment/transfer-request      — запрос на передачу другому РП
 *
 *   GET   /api/users?role=PM                   — список РП для передачи
 *   GET   /api/works?status=active&limit=50    — активные работы для привязки
 */
import { api } from '@/api/client';

export const CONDITIONS = {
  new:          { label: 'Новое',     tone: 'approved' },
  good:         { label: 'Хорошее',   tone: 'sent' },
  satisfactory: { label: 'Удовл.',    tone: 'question' },
  poor:         { label: 'Плохое',    tone: 'rework' },
  broken:       { label: 'Сломано',   tone: 'rejected' }
};

export const CONDITION_OPTIONS = [
  { value: 'new',          label: 'Новое' },
  { value: 'good',         label: 'Хорошее' },
  { value: 'satisfactory', label: 'Удовлетворительное' },
  { value: 'poor',         label: 'Плохое' },
  { value: 'broken',       label: 'Сломано' }
];

export function loadMyEquipment(userId) {
  return api(`/api/equipment/by-holder/${userId}`)
    .then((d) => d.equipment || d.items || [])
    .catch(() => []);
}

export function loadObjects() {
  return api('/api/equipment/objects')
    .then((d) => d.objects || [])
    .catch(() => []);
}

export function loadPms() {
  return api('/api/users?role=PM&limit=2000')
    .then((d) => d.users || d.items || [])
    .catch(() => []);
}

export function loadActiveWorks() {
  // status=active в /api/works игнорится и возвращает все, но это безопасно — отфильтруем на клиенте.
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

/** POST /api/equipment/return — Возврат на склад. */
export function returnEquipment(equipmentId, condition, notes) {
  return api('/api/equipment/return', {
    method: 'POST',
    body: {
      equipment_id: Number(equipmentId),
      condition,
      notes: notes || ''
    }
  });
}

/** POST /api/equipment/transfer-request — Заявка на передачу другому держателю. */
export function transferRequest({ equipment_id, target_holder_id, work_id, object_id, notes }) {
  return api('/api/equipment/transfer-request', {
    method: 'POST',
    body: {
      equipment_id: Number(equipment_id),
      to_user_id: target_holder_id ? Number(target_holder_id) : null,
      work_id: work_id ? Number(work_id) : null,
      object_id: object_id ? Number(object_id) : null,
      notes: notes || ''
    }
  });
}

/* ─── Helpers ─── */

export function conditionMeta(c) {
  return CONDITIONS[c] || { label: c || '—', tone: 'draft' };
}

export function filterByQuery(items, q) {
  if (!q || !q.trim()) return items;
  const lq = q.trim().toLowerCase();
  return items.filter((e) =>
    (e.name || '').toLowerCase().includes(lq) ||
    (e.inventory_number || '').toLowerCase().includes(lq) ||
    (e.serial_number || '').toLowerCase().includes(lq) ||
    (e.category_name || '').toLowerCase().includes(lq) ||
    (e.object_name || '').toLowerCase().includes(lq) ||
    (e.work_number || '').toLowerCase().includes(lq)
  );
}

export function groupByCategory(items) {
  const groups = new Map();
  for (const e of items) {
    const k = e.category_name || 'Без категории';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return groups;
}
