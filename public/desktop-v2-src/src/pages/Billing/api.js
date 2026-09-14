/**
 * API единой страницы «Счета и акты».
 */
import { api } from '@/api/client';
import { VAT_DEFAULT_PCT } from '@/lib/money';

export { formatMoney as fmtMoney, formatMoneyShort as fmtMoneyShort, VAT_DEFAULT_PCT } from '@/lib/money';

export const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HEAD_PM', 'PM', 'BUH'];

export const INV_STATUSES = {
  draft:     { label: 'Черновик',   tone: 'draft',    color: 'var(--t-3)' },
  sent:      { label: 'Выставлен',  tone: 'info',     color: 'var(--info)' },
  pending:   { label: 'Ожидает',    tone: 'question', color: 'var(--amber)' },
  partial:   { label: 'Частично',   tone: 'question', color: 'var(--amber)' },
  paid:      { label: 'Оплачен',    tone: 'approved', color: 'var(--ok)' },
  cancelled: { label: 'Отменён',    tone: 'rejected', color: 'var(--err)' }
};

export const ACT_STATUSES = {
  draft:  { label: 'Черновик',  tone: 'draft',    color: 'var(--t-3)' },
  sent:   { label: 'Отправлен', tone: 'info',     color: 'var(--info)' },
  signed: { label: 'Подписан',  tone: 'approved', color: 'var(--ok)' },
  paid:   { label: 'Оплачен',   tone: 'approved', color: 'var(--gold)' }
};

export const INV_STATUS_OPTIONS = [
  { value: 'draft', label: 'Черновик' },
  { value: 'sent', label: 'Выставлен' },
  { value: 'pending', label: 'Ожидает' },
  { value: 'partial', label: 'Частично' },
  { value: 'paid', label: 'Оплачен' },
  { value: 'cancelled', label: 'Отменён' }
];

export const ACT_STATUS_OPTIONS = [
  { value: 'draft', label: 'Черновик' },
  { value: 'sent', label: 'Отправлен' },
  { value: 'signed', label: 'Подписан' },
  { value: 'paid', label: 'Оплачен' }
];

export const ALL_STATUS_OPTIONS = [
  { value: 'draft', label: 'Черновик' },
  { value: 'sent', label: 'Выставлен / отправлен' },
  { value: 'pending', label: 'Ожидает оплаты' },
  { value: 'partial', label: 'Частично оплачен' },
  { value: 'signed', label: 'Подписан' },
  { value: 'paid', label: 'Оплачен' },
  { value: 'cancelled', label: 'Отменён' }
];

export function displayText(value, fallback = '—') {
  const t = String(value || '').trim();
  if (!t) return fallback;
  const junk = (t.match(/[?\uFFFD]/g) || []).length;
  if (junk >= 3 || junk / t.length > 0.25) return fallback;
  return t;
}

export function statusMeta(kind, status) {
  const map = kind === 'act' ? ACT_STATUSES : INV_STATUSES;
  return map[status] || map.draft || { label: status || '—', tone: 'draft', color: 'var(--t-3)' };
}

export function parseItems(raw) {
  if (!raw) return [];
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.items)) return v.items;
  return [];
}

export function calcTotals(items, vatPct = VAT_DEFAULT_PCT) {
  let netto = 0;
  for (const it of items || []) {
    netto += (Number(it.qty) || 0) * (Number(it.price) || 0);
  }
  const vat = netto * (Number(vatPct) || 0) / 100;
  return { netto, vat, total: netto + vat };
}

export function emptyItem() {
  return { id: Date.now() + Math.random(), name: '', unit: 'усл.', qty: 1, price: 0 };
}

export function loadInvoices(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 2000));
  if (params.status) q.set('status', params.status);
  if (params.work_id) q.set('work_id', String(params.work_id));
  return api('/api/invoices?' + q.toString()).then((d) => d.invoices || []);
}

export function loadActs(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 2000));
  if (params.status) q.set('status', params.status);
  if (params.work_id) q.set('work_id', String(params.work_id));
  return api('/api/acts?' + q.toString()).then((d) => d.acts || []);
}

export function loadInvoice(id) {
  return api('/api/invoices/' + id);
}
export function loadAct(id) {
  return api('/api/acts/' + id);
}

export function nextInvoiceNumber() {
  return api('/api/invoices/next-number').then((d) => d.number || '').catch(() => '');
}
export function nextActNumber() {
  return api('/api/acts/next-number').then((d) => d.number || '').catch(() => '');
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

export function createAct(payload) {
  return api('/api/acts', { method: 'POST', body: payload });
}
export function updateAct(id, payload) {
  return api('/api/acts/' + id, { method: 'PUT', body: payload });
}
export function deleteAct(id) {
  return api('/api/acts/' + id, { method: 'DELETE' });
}

export function sendInvoice(id, payload) {
  return api(`/api/invoices/${id}/send`, { method: 'POST', body: payload });
}
export function sendAct(id, payload) {
  return api(`/api/acts/${id}/send`, { method: 'POST', body: payload });
}

export function lookupCustomers(query) {
  if (!query || query.length < 2) return Promise.resolve([]);
  return api('/api/customers?search=' + encodeURIComponent(query) + '&limit=10')
    .then((d) => d.customers || d.items || [])
    .catch(() => []);
}

export function customerByInn(inn) {
  return api('/api/customers/lookup/' + encodeURIComponent(inn)).catch(() => null);
}

export function loadCompanyProfile() {
  return Promise.all([
    api('/api/settings/app').catch(() => ({})),
    api('/api/settings').catch(() => ({}))
  ]).then(([d, all]) => {
    const app = d.value || d.app || d || {};
    const appProfile = app.company_profile || {};
    const keyProfile = (all.settings && all.settings.company_profile) || {};
    const c = { ...appProfile, ...keyProfile };
    return issuerFromCompany({
      name: c.company_name || c.name || 'ООО «Асгард-Сервис»',
      full_name: c.full_name || c.company_name || c.name || 'ООО «Асгард-Сервис»',
      inn: c.inn || '',
      kpp: c.kpp || '',
      ogrn: c.ogrn || '',
      address: c.address || c.legal_address || '',
      phone: c.phone || '',
      email: c.email || '',
      director: c.director_fio || c.director_name || '',
      director_title: c.director_title || 'Генеральный директор',
      accountant: c.accountant_name || '',
      bank_name: c.bank_name || '',
      bank_rs: c.bank_rs || c.rs || '',
      bank_ks: c.bank_ks || c.ks || '',
      bank_bik: c.bank_bik || c.bik || ''
    });
  }).catch(() => issuerFromCompany({ name: 'ООО «Асгард-Сервис»', full_name: 'ООО «Асгард-Сервис»' }));
}

export function issuerFromCompany(c) {
  c = c || {};
  return {
    name: c.name || '',
    full_name: c.full_name || c.name || '',
    inn: c.inn || '',
    kpp: c.kpp || '',
    ogrn: c.ogrn || '',
    address: c.address || c.legal_address || '',
    phone: c.phone || '',
    email: c.email || '',
    director: c.director || c.director_name || '',
    director_title: c.director_title || 'Генеральный директор',
    accountant: c.accountant || c.accountant_name || '',
    bank_name: c.bank_name || '',
    bank_rs: c.bank_rs || '',
    bank_ks: c.bank_ks || '',
    bank_bik: c.bank_bik || ''
  };
}

export function parseIssuer(raw) {
  if (!raw) return null;
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return issuerFromCompany(v);
}

export function loadWorks() {
  return api('/api/works?limit=500')
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

export function loadWork(id) {
  return api('/api/works/' + id).then((d) => d.work || d).catch(() => null);
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export async function openInvoicePdf(id) {
  const { openProtected } = await import('@/api/download');
  return openProtected(`/api/invoices/${id}/pdf`, `invoice_${id}.pdf`);
}
export async function openActPdf(id) {
  const { openProtected } = await import('@/api/download');
  return openProtected(`/api/acts/${id}/pdf`, `act_${id}.pdf`);
}

export async function downloadInvoiceOffice(id, ext) {
  const { downloadProtected } = await import('@/api/download');
  const name = ext === 'xlsx' ? `Schet_${id}.xlsx` : `Schet_${id}.docx`;
  return downloadProtected(`/api/invoices/${id}/${ext}`, name);
}
export async function downloadActOffice(id, ext) {
  const { downloadProtected } = await import('@/api/download');
  const name = ext === 'xlsx' ? `Akt_${id}.xlsx` : `Akt_${id}.docx`;
  return downloadProtected(`/api/acts/${id}/${ext}`, name);
}
export function downloadDocOffice(kind, id, ext) {
  return kind === 'act' ? downloadActOffice(id, ext) : downloadInvoiceOffice(id, ext);
}

function downloadBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'document';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function previewPdf(kind, body) {
  const token = localStorage.getItem('asgard_token') || '';
  const url = kind === 'act' ? '/api/acts/preview-pdf' : '/api/invoices/preview-pdf';
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {})
  }).then((r) => {
    if (!r.ok) return r.json().catch(() => ({})).then((e) => { throw new Error(e.message || e.error || 'HTTP ' + r.status); });
    return r.blob();
  });
}

export function previewOffice(kind, body, ext) {
  const token = localStorage.getItem('asgard_token') || '';
  const fmt = ext === 'xlsx' ? 'xlsx' : 'docx';
  const url = kind === 'act' ? '/api/acts/preview-' + fmt : '/api/invoices/preview-' + fmt;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {})
  }).then((r) => {
    if (!r.ok) return r.json().catch(() => ({})).then((e) => { throw new Error(e.message || e.error || 'HTTP ' + r.status); });
    return r.blob();
  }).then((blob) => {
    const prefix = kind === 'act' ? 'Akt' : 'Schet';
    downloadBlobFile(blob, `${prefix}_preview.${fmt}`);
    return blob;
  });
}

export function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:billing:changed'));
  window.dispatchEvent(new CustomEvent('asgard:invoices:changed'));
  window.dispatchEvent(new CustomEvent('asgard:acts:changed'));
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

export function buildPayload(kind, form, totals, status) {
  const items = (form.items || [])
    .filter((it) => String(it.name || '').trim())
    .map((it) => ({
      name: String(it.name).trim(),
      unit: it.unit || 'усл.',
      qty: Number(it.qty) || 0,
      price: Number(it.price) || 0
    }));
  const base = {
    customer_name: form.customer_name || null,
    customer_inn: form.customer_inn || form.inn || null,
    customer_kpp: form.customer_kpp || form.kpp || null,
    customer_address: form.customer_address || form.address || null,
    customer_id: form.customer_id || null,
    contact_person: form.contact_person || null,
    contact_email: form.contact_email || null,
    contact_phone: form.contact_phone || null,
    work_id: form.work_id ? Number(form.work_id) : null,
    description: form.description || form.subject || null,
    notes: form.notes || null,
    items,
    items_json: items,
    amount: totals.netto,
    vat_pct: Number(form.vat_pct) || VAT_DEFAULT_PCT,
    vat_amount: totals.vat,
    total_amount: totals.total,
    status: status || form.status || 'draft'
  };
  const iss = form.issuer;
  if (iss && (iss.name || iss.full_name || iss.inn || iss.bank_rs)) {
    base.issuer = iss;
    base.issuer_json = iss;
  }
  if (kind === 'act') {
    return {
      ...base,
      act_number: form.number || undefined,
      act_date: form.date,
      act_type: form.origin === 'register' ? 'registered' : 'issued',
      signed_date: form.signed_date || null
    };
  }
  return {
    ...base,
    invoice_number: form.number || undefined,
    invoice_date: form.date,
    invoice_type: form.origin === 'register' ? 'incoming' : 'outgoing',
    due_date: form.due_date || null
  };
}
