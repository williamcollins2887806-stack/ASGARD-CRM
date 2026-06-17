/**
 * API-клиент страницы /seals — Реестр печатей.
 *
 * Backend: `/api/data/seals` и `/api/data/seal_transfers` (generic CRUD).
 * RBAC: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, OFFICE_MANAGER.
 *
 * Колонки seals (по прод-схеме): id, name, type, inv_number, holder_id,
 *   status (office/employee/transfer/lost), purchase_date, return_date,
 *   is_indefinite, comment, pending_transfer_id, created_at, updated_at.
 * Колонки seal_transfers: id, seal_id, from_id, to_id, transfer_date,
 *   return_date, is_indefinite, purpose, status (pending/confirmed),
 *   created_by, created_at, confirmed_at.
 */
import { api } from '@/api/client';

export const ALLOWED_VIEW_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'
];

export const SEAL_TYPES = [
  { value: 'main',       label: 'Основная (гербовая)' },
  { value: 'documents',  label: 'Для документов' },
  { value: 'contracts',  label: 'Для договоров' },
  { value: 'facsimile',  label: 'Факсимиле директора' },
  { value: 'stamp_date', label: 'Штамп (дата)' },
  { value: 'stamp_in',   label: 'Штамп (входящий)' },
  { value: 'stamp_out',  label: 'Штамп (исходящий)' },
  { value: 'other',      label: 'Другое' }
];

export const SEAL_STATUSES = [
  { value: 'office',   label: 'В офисе',     tone: 'approved' },
  { value: 'employee', label: 'У сотрудника', tone: 'sent' },
  { value: 'transfer', label: 'Передаётся',   tone: 'question' },
  { value: 'lost',     label: 'Утеряна',      tone: 'rejected' }
];

export function describeType(v) {
  return SEAL_TYPES.find((t) => t.value === v) || { value: v, label: v || '—' };
}
export function describeStatus(v) {
  return SEAL_STATUSES.find((s) => s.value === v) || SEAL_STATUSES[0];
}

export function loadSeals() {
  return api('/api/data/seals?limit=1000').then(
    (d) => d.seals || d.items || []
  );
}

export function loadUsers() {
  return api('/api/users?is_active=true&limit=1000').then(
    (d) => d.users || []
  );
}

export function loadTransfersForSeal(sealId) {
  // Универсальный фильтр через ?where={"seal_id":N}
  const where = encodeURIComponent(JSON.stringify({ seal_id: sealId }));
  return api(`/api/data/seal_transfers?where=${where}&limit=200&orderBy=id&desc=true`).then(
    (d) => d.seal_transfers || d.items || []
  );
}

export function createSeal(payload) {
  return api('/api/data/seals', { method: 'POST', body: payload }).then((d) => d.item || d);
}
export function updateSeal(id, payload) {
  return api('/api/data/seals/' + id, { method: 'PUT', body: payload }).then((d) => d.item || d);
}
export function deleteSeal(id) {
  return api('/api/data/seals/' + id, { method: 'DELETE' });
}

export function createTransfer(payload) {
  return api('/api/data/seal_transfers', { method: 'POST', body: payload }).then((d) => d.item || d);
}
export function updateTransfer(id, payload) {
  return api('/api/data/seal_transfers/' + id, { method: 'PUT', body: payload }).then((d) => d.item || d);
}

/* Mark as lost — выделенный helper */
export function markLost(seal) {
  return updateSeal(seal.id, {
    status: 'lost',
    holder_id: null,
    pending_transfer_id: null
  });
}

/* Возврат в офис — helper */
export function returnToOffice(seal) {
  return updateSeal(seal.id, {
    status: 'office',
    holder_id: null,
    return_date: null,
    is_indefinite: false,
    pending_transfer_id: null
  });
}

export function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('ru-RU'); }
  catch { return String(s).slice(0, 10); }
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function filterByQuery(list, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return list;
  return list.filter((c) =>
    String(c.name || '').toLowerCase().includes(s) ||
    String(c.inv_number || '').toLowerCase().includes(s)
  );
}
