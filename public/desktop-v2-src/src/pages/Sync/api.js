/**
 * API-клиент страницы /sync.
 *
 * Vanilla `public/assets/js/sync.js` (~656 строк) синхронизировал локальный
 * IndexedDB с внешним REST-сервером. В CRM 2.0 «Sync» — это управление
 * ERP-подключениями (1С, банковский клиент-банк) через бэк
 * `src/routes/integrations.js` (prefix `/api/integrations`).
 *
 * Endpoint'ы:
 *   GET    /api/integrations/erp/connections
 *   POST   /api/integrations/erp/connections           — создать
 *   PUT    /api/integrations/erp/connections/:id       — править
 *   DELETE /api/integrations/erp/connections/:id       — деактивировать
 *   POST   /api/integrations/erp/connections/:id/test  — пинг URL
 *   POST   /api/integrations/erp/connections/:id/export — выгрузить (payroll/bank/tenders)
 *   GET    /api/integrations/erp/sync-log              — журнал
 *
 *   GET    /api/integrations/bank/batches              — банковские выписки
 *   POST   /api/integrations/bank/upload (multipart)   — загрузка выписки
 *   GET    /api/integrations/bank/stats
 *
 * RBAC: ADMIN, DIRECTOR_GEN (см. ERP_ROLES в integrations.js).
 */
import { api } from '@/api/client';

export const SYNC_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

export const ERP_TYPES = [
  { value: '1c',       label: '1С: Бухгалтерия' },
  { value: '1c_zup',   label: '1С: ЗУП' },
  { value: 'sap',      label: 'SAP' },
  { value: 'parus',    label: 'Парус' },
  { value: 'galaktika', label: 'Галактика' },
  { value: 'custom',   label: 'Свой REST API' }
];

export const SYNC_DIRECTIONS = [
  { value: 'export', label: 'Только выгрузка (CRM → ERP)' },
  { value: 'import', label: 'Только загрузка (ERP → CRM)' },
  { value: 'both',   label: 'Двусторонняя' }
];

export const AUTH_TYPES = [
  { value: 'basic',   label: 'Basic (login/password)' },
  { value: 'bearer',  label: 'Bearer token' },
  { value: 'oauth2',  label: 'OAuth 2.0' },
  { value: 'apikey',  label: 'API Key' },
  { value: 'none',    label: 'Без авторизации' }
];

export const EXPORT_ENTITIES = [
  { value: 'payroll',         label: '💰 Зарплата' },
  { value: 'bank',            label: '🏦 Банк-выписки' },
  { value: 'tenders',         label: '📋 Тендеры' },
  { value: 'counterparties',  label: '🏢 Контрагенты' }
];

/* ── ERP connections ───────────────────────────────────────────────────── */
export function loadConnections() {
  return api('/api/integrations/erp/connections').then((d) => d?.items || []);
}

export function createConnection(payload) {
  return api('/api/integrations/erp/connections', { method: 'POST', body: payload });
}

export function updateConnection(id, payload) {
  return api('/api/integrations/erp/connections/' + encodeURIComponent(id), {
    method: 'PUT', body: payload
  });
}

export function deleteConnection(id) {
  return api('/api/integrations/erp/connections/' + encodeURIComponent(id), { method: 'DELETE' });
}

export function testConnection(id) {
  return api('/api/integrations/erp/connections/' + encodeURIComponent(id) + '/test', {
    method: 'POST'
  });
}

export function exportToErp(id, payload) {
  return api('/api/integrations/erp/connections/' + encodeURIComponent(id) + '/export', {
    method: 'POST',
    body: payload
  });
}

export function loadSyncLog(connectionId, limit = 30) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (connectionId) q.set('connection_id', String(connectionId));
  return api('/api/integrations/erp/sync-log?' + q.toString()).then((d) => d?.items || []);
}

/* ── Банковские выписки ────────────────────────────────────────────────── */
export function loadBankBatches(limit = 50) {
  return api('/api/integrations/bank/batches?limit=' + limit).then((d) => d?.items || []);
}

export function loadBankStats() {
  return api('/api/integrations/bank/stats');
}

/* ── helpers ──────────────────────────────────────────────────────────── */
export function statusTone(status) {
  switch ((status || '').toLowerCase()) {
    case 'ok':
    case 'completed':
    case 'success':       return 'success';
    case 'failed':
    case 'error':         return 'danger';
    case 'partial':
    case 'in_progress':   return 'warn';
    default:              return 'info';
  }
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU');
  } catch {
    return '—';
  }
}

export function fmtErpType(t) {
  return ERP_TYPES.find((x) => x.value === t)?.label || t;
}
