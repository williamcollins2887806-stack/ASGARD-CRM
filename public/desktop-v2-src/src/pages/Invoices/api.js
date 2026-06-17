/**
 * API-клиент страницы /invoices — Счета и оплаты.
 * Источник: vanilla `public/assets/js/invoices.js` (~332 строки).
 *
 * Endpoints (см. `src/routes/invoices.js`):
 *   GET    /api/invoices                    — список (status, work_id, customer_name, limit)
 *   GET    /api/invoices/next-number        — авто-номер СЧ-ГГГГ-NNN
 *   GET    /api/invoices/:id                — карточка + выплаты
 *   POST   /api/invoices                    — создать
 *   PUT    /api/invoices/:id                — обновить
 *   POST   /api/invoices/:id/payments       — внести оплату
 *   DELETE /api/invoices/:id                — удалить
 *   GET    /api/invoices/:id/pdf            — PDF (через blob + Authorization header)
 *
 * RBAC на запись (бекенд): ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, PM, BUH.
 */
import { api } from '@/api/client';

export const STATUSES = {
  draft:     { label: 'Черновик',   tone: 'draft',    color: 'var(--t-3)' },
  sent:      { label: 'Выставлен',  tone: 'info',     color: 'var(--info)' },
  pending:   { label: 'Ожидает',    tone: 'question', color: 'var(--amber)' },
  partial:   { label: 'Частично',   tone: 'question', color: 'var(--amber)' },
  paid:      { label: 'Оплачен',    tone: 'approved', color: 'var(--ok)' },
  cancelled: { label: 'Отменён',    tone: 'rejected', color: 'var(--err)' }
};

export const STATUS_OPTIONS = [
  { value: '',          label: 'Все статусы' },
  { value: 'draft',     label: 'Черновик' },
  { value: 'sent',      label: 'Выставлен' },
  { value: 'pending',   label: 'Ожидает' },
  { value: 'partial',   label: 'Частично' },
  { value: 'paid',      label: 'Оплачен' },
  { value: 'cancelled', label: 'Отменён' }
];

export function loadInvoices(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 500));
  if (params.status) q.set('status', params.status);
  if (params.work_id) q.set('work_id', String(params.work_id));
  return api('/api/invoices?' + q.toString())
    .then((d) => d.invoices || [])
    .catch(() => []);
}

export function loadInvoice(id) {
  return api('/api/invoices/' + id);
}

export function nextInvoiceNumber() {
  return api('/api/invoices/next-number')
    .then((d) => d.number || '')
    .catch(() => '');
}

export function createInvoice(payload) {
  return api('/api/invoices', { method: 'POST', body: payload });
}
export function updateInvoice(id, payload) {
  return api('/api/invoices/' + id, { method: 'PUT', body: payload });
}
export function deleteInvoice(id) {
  return api('/api/invoices/' + id, { method: 'DELETE' });
}

export function addPayment(invoiceId, payload) {
  return api(`/api/invoices/${invoiceId}/payments`, { method: 'POST', body: payload });
}

export function loadCustomers() {
  return api('/api/customers?limit=2000')
    .then((d) => d.customers || d.items || [])
    .catch(() => []);
}
export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

/* ─── Форматирование ─────────────────────────────────────────────────── */

export function fmtMoney(n) {
  if (!Number.isFinite(+n) || n === 0) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

/** Открыть PDF счёта в новой вкладке БЕЗ токена в URL (blob через Authorization header). */
export async function openPdf(invoiceId) {
  const { openProtected } = await import('@/api/download');
  return openProtected(`/api/invoices/${invoiceId}/pdf`, `invoice_${invoiceId}.pdf`);
}
