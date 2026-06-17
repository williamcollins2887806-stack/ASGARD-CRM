/* API для /integrations — Банк/1С, площадки, ERP. */
import { api } from '@/api/client';

export const ARTICLES = {
  fot: 'ФОТ', taxes: 'Налоги', rent: 'Аренда', utilities: 'Коммунальные', logistics: 'Логистика',
  materials: 'Материалы', subcontract: 'Субподряд', equipment: 'Оборудование', software: 'ПО',
  bank: 'Банковские', office: 'Офис', communication: 'Связь', other: 'Прочее',
  payment: 'Оплата', advance: 'Аванс', final: 'Оконч. расчёт', refund: 'Возврат'
};

export const TX_STATUS = {
  new:         { l: 'Новая',        c: 'var(--amber)' },
  classified:  { l: 'Классиф.',     c: 'var(--blue)' },
  confirmed:   { l: 'Подтверждена', c: 'var(--ok)' },
  distributed: { l: 'Разнесена',    c: 'var(--ok)' },
  exported_1c: { l: 'Экспорт 1С',   c: 'var(--t-2)' },
  skipped:     { l: 'Пропущена',    c: 'var(--t-2)' }
};

export const fmtMoney = (v) => {
  const n = Math.round(Number(v || 0));
  return (n).toLocaleString('ru-RU') + ' ₽';
};

export const fmtDate = (s) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('ru-RU'); } catch { return s; }
};

/* ── Bank ── */
export const bankStats        = () => api('/api/integrations/bank/stats');
export const bankTransactions = (params = '') => api('/api/integrations/bank/transactions' + params);
export const bankRules        = () => api('/api/integrations/bank/rules');
export const bankBulkClassify = (ids, article) => api('/api/integrations/bank/transactions/bulk-classify', { method: 'POST', body: { ids, article } });
export const bankBulkDistribute = (ids, work_id) => api('/api/integrations/bank/transactions/bulk-distribute', { method: 'POST', body: { ids, work_id } });

/* ── Platforms ── */
export const platformsStats      = () => api('/api/integrations/platforms/stats');
export const platformsList       = (params = '') => api('/api/integrations/platforms' + params);
export const platformsGet        = (id) => api('/api/integrations/platforms/' + id);
export const platformsParseBatch = (limit = 100) => api('/api/integrations/platforms/parse-batch', { method: 'POST', body: { limit } });
export const platformsCreatePT   = (id) => api('/api/integrations/platforms/' + id + '/create-pre-tender', { method: 'POST', body: {} });

/* ── ERP ── */
export const erpConnections    = () => api('/api/integrations/erp/connections');
export const erpSyncLog        = (limit = 10) => api('/api/integrations/erp/sync-log?limit=' + limit);
export const erpCreate         = (body) => api('/api/integrations/erp/connections', { method: 'POST', body });
export const erpTest           = (id) => api('/api/integrations/erp/connections/' + id + '/test', { method: 'POST', body: {} });
export const erpExport         = (id, body) => api('/api/integrations/erp/connections/' + id + '/export', { method: 'POST', body });
