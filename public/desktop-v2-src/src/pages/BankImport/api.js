/**
 * API для /bank-import — Импорт банковских выписок (миграция vanilla `bank_import.js`).
 * Все 20+ endpoints прокидываются через единый `api()` (Bearer-токен внутри).
 * Bulk-классификация делает AI на бэке — на фронте AI-логику НЕ дублируем.
 *
 * Backend: `src/routes/integrations.js` префикс `/api/integrations`.
 */
import { api } from '@/api/client';

/* ── Справочники статей (для UI label/value) ────────────────────────── */
export const EXPENSE_ARTICLES = [
  { value: 'fot',          label: 'ФОТ' },
  { value: 'taxes',        label: 'Налоги и сборы' },
  { value: 'rent',         label: 'Аренда' },
  { value: 'utilities',    label: 'Коммунальные' },
  { value: 'logistics',    label: 'Логистика' },
  { value: 'materials',    label: 'Материалы' },
  { value: 'subcontract',  label: 'Субподряд' },
  { value: 'equipment',    label: 'Оборудование' },
  { value: 'software',     label: 'ПО и лицензии' },
  { value: 'bank',         label: 'Банковские комиссии' },
  { value: 'office',       label: 'Офисные расходы' },
  { value: 'communication',label: 'Связь' },
  { value: 'other',        label: 'Прочее' }
];

export const INCOME_ARTICLES = [
  { value: 'advance', label: 'Аванс' },
  { value: 'payment', label: 'Оплата по договору' },
  { value: 'final',   label: 'Окончательный расчёт' },
  { value: 'refund',  label: 'Возврат' },
  { value: 'other',   label: 'Прочее' }
];

export const ARTICLES = (() => {
  const m = {};
  [...EXPENSE_ARTICLES, ...INCOME_ARTICLES].forEach((a) => { m[a.value] = a.label; });
  return m;
})();

export const TX_STATUSES = {
  new:         { label: 'Новая',        tone: 'amber' },
  classified:  { label: 'Классиф.',     tone: 'info' },
  confirmed:   { label: 'Подтверждена', tone: 'ok' },
  distributed: { label: 'Разнесена',    tone: 'ok' },
  exported_1c: { label: 'Экспорт 1С',   tone: 'default' },
  skipped:     { label: 'Пропущена',    tone: 'default' }
};

export const DIRECTIONS = {
  income:  { label: 'Доход',  sign: '+', cls: 'in'  },
  expense: { label: 'Расход', sign: '−', cls: 'out' }
};

export const MATCH_FIELDS = [
  { value: 'all',                label: 'Везде' },
  { value: 'counterparty_name',  label: 'Контрагент' },
  { value: 'payment_purpose',    label: 'Назначение' },
  { value: 'counterparty_inn',   label: 'ИНН' }
];

/* ── Helpers ────────────────────────────────────────────────────────── */
export const fmtMoney = (v) => {
  const n = Math.round(Number(v || 0));
  return n.toLocaleString('ru-RU') + ' ₽';
};
export const fmtDate = (s) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('ru-RU'); } catch { return s; }
};
export const fmtDateTime = (s) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('ru-RU'); } catch { return s; }
};

/* ── Batches ────────────────────────────────────────────────────────── */
export const loadBatches = (limit = 100, offset = 0) =>
  api(`/api/integrations/bank/batches?limit=${limit}&offset=${offset}`);

/* ── Upload ────────────────────────────────────────────────────────── */
/** Загрузка файла выписки. multipart/form-data — поэтому fetch напрямую. */
export async function uploadStatement(file, format = null) {
  const token = (() => { try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; } })();
  const fd = new FormData();
  fd.append('file', file);
  const url = '/api/integrations/bank/upload' + (format ? '?format=' + encodeURIComponent(format) : '');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.success) {
    const err = new Error(d?.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return d;
}

/* ── Transactions ──────────────────────────────────────────────────── */
export const loadTransactions = (params = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v === null || v === undefined) continue;
    qs.set(k, v);
  }
  return api('/api/integrations/bank/transactions?' + qs.toString());
};
export const loadTransaction = (id) =>
  api('/api/integrations/bank/transactions/' + id);
export const updateTransaction = (id, body) =>
  api('/api/integrations/bank/transactions/' + id, { method: 'PUT', body });
export const bulkClassify = (ids, article, work_id = null) =>
  api('/api/integrations/bank/transactions/bulk-classify', { method: 'POST', body: { ids, article, work_id } });
export const distributeTransaction = (id) =>
  api('/api/integrations/bank/transactions/' + id + '/distribute', { method: 'POST', body: {} });
export const bulkDistribute = (ids, work_id = null) =>
  api('/api/integrations/bank/transactions/bulk-distribute', { method: 'POST', body: { ids, work_id } });

/* ── Rules ─────────────────────────────────────────────────────────── */
export const loadRules = (direction = '', search = '') => {
  const qs = new URLSearchParams();
  if (direction) qs.set('direction', direction);
  if (search) qs.set('search', search);
  return api('/api/integrations/bank/rules?' + qs.toString());
};
export const createRule = (body) =>
  api('/api/integrations/bank/rules', { method: 'POST', body });
export const updateRule = (id, body) =>
  api('/api/integrations/bank/rules/' + id, { method: 'PUT', body });
export const deleteRule = (id) =>
  api('/api/integrations/bank/rules/' + id, { method: 'DELETE' });

/* ── Stats / Summary ──────────────────────────────────────────────── */
export const loadStats   = () => api('/api/integrations/bank/stats');
export const loadSummary = () => api('/api/integrations/bank/summary');

/* ── Sync ─────────────────────────────────────────────────────────── */
export const syncFromClient = (transactions) =>
  api('/api/integrations/bank/sync-from-client', { method: 'POST', body: { transactions } });

/* ── Works (для выпадайки распределения) ──────────────────────────── */
export const loadWorks = (limit = 500) =>
  api('/api/works?limit=' + limit).then((d) => d.works || d.items || d.rows || []).catch(() => []);

/* ── Excel-/1C-экспорт через blob ─────────────────────────────────── */
export const buildExportUrl = (kind, params = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v === null || v === undefined) continue;
    qs.set(k, v);
  }
  return '/api/integrations/bank/export/' + kind + (qs.toString() ? '?' + qs.toString() : '');
};
