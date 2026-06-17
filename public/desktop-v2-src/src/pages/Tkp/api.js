/**
 * API-клиент страницы /tkp.
 * Источник: vanilla tkp_page.js (1872 строки).
 */
import { api } from '@/api/client';

// Backend `tkp.js:615` VALID = ['draft','sent','accepted','rejected','expired'].
// 'ready'/'viewed'/'cancelled' были мёртвым кодом — backend бы отклонил их PUT 400.
// 'expired' (Просрочено) — есть в vanilla tkp-page.js:6-12, был пропущен.
export const STATUSES = [
  { value: 'draft',        label: 'Черновик',     tone: 'draft' },
  { value: 'sent',         label: 'Отправлено',   tone: 'sent' },
  { value: 'accepted',     label: 'Принято',      tone: 'approved' },
  { value: 'rejected',     label: 'Отклонено',    tone: 'rejected' },
  { value: 'expired',      label: 'Просрочено',   tone: 'rework' }
];

export const CLIENT_DECISION = [
  { value: 'no_response', label: 'Нет ответа' },
  { value: 'accepted',    label: 'Принято' },
  { value: 'rejected',    label: 'Отклонено' }
];

export const LINK_TYPE = [
  { value: 'tender',  label: 'От тендера' },
  { value: 'manual',  label: 'Ручное' },
  { value: 'mimir',   label: 'Мимир' },
  { value: 'upload',  label: 'Загружено' }
];

export const PAYMENT_PRESETS = [
  { value: '100_post',     label: '100% постоплата', avans: 0,   postpay_days: 14 },
  { value: '30_70',        label: 'Аванс 30 / 70',   avans: 30,  postpay_days: 14 },
  { value: '50_50',        label: 'Аванс 50 / 50',   avans: 50,  postpay_days: 14 },
  { value: '100_avans',    label: '100% аванс',      avans: 100, postpay_days: 0 },
  { value: 'staged',       label: 'По этапам',       avans: 0,   postpay_days: 14 },
  { value: 'custom',       label: 'Свои условия',    avans: null, postpay_days: null }
];

export const VAT_PCT = 22;

export function loadTkpList() {
  return api('/api/tkp').then((d) => d.tkp || d.items || []).catch(() => []);
}

export function loadTkp(id) {
  return api(`/api/tkp/${id}`).catch(() => null);
}

export function createTkp(body) {
  return api('/api/tkp', { method: 'POST', body });
}

export function updateTkp(id, body) {
  return api(`/api/tkp/${id}`, { method: 'PUT', body });
}

export function copyTkp(id) {
  return api(`/api/tkp/${id}/copy`, { method: 'POST', body: {} });
}

export function lookupCustomers(query) {
  if (!query || query.length < 2) return Promise.resolve([]);
  const q = encodeURIComponent(query);
  const url = '/api/customers?search=' + q + '&limit=10';
  return api(url)
    .then((d) => d.customers || d.items || [])
    .catch(() => []);
}

export function customerByInn(inn) {
  const id = encodeURIComponent(inn);
  return api('/api/customers/lookup/' + id).catch(() => null);
}

/**
 * Предпросмотр PDF из формы ТКП до сохранения.
 * Vanilla: tkp_page.js:984 — POST /api/tkp/preview-pdf body=current form.
 * Возвращает Blob с PDF.
 */
export function previewTkpPdf(body) {
  const token = localStorage.getItem('asgard_token') || '';
  return fetch('/api/tkp/preview-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {})
  }).then((r) => {
    if (!r.ok) return r.json().catch(() => ({})).then((e) => { throw new Error(e.error || 'HTTP ' + r.status); });
    return r.blob();
  });
}

export function sendTkpEmail(id, body) {
  return api(`/api/tkp/${id}/send`, { method: 'POST', body });
}

export function setClientDecision(id, body) {
  return api(`/api/tkp/${id}/client-decision`, { method: 'POST', body });
}

export function mimirSuggest(payload) {
  return api('/api/mimir/suggest-tkp', { method: 'POST', body: payload });
}

export function parseAttachment(payload) {
  return api('/api/tkp/parse-attachment', { method: 'POST', body: payload });
}

export function uploadReady(payload) {
  return api('/api/tkp/upload-ready', { method: 'POST', body: payload });
}

export function quickTkpCreate() {
  return api('/api/tkp-quick/sessions', { method: 'POST', body: {} });
}

export function quickTkpDadata(uid, payload) {
  return api(`/api/tkp-quick/sessions/${uid}/dadata`, { method: 'POST', body: payload });
}

export function quickTkpUpload(uid, payload) {
  return api(`/api/tkp-quick/sessions/${uid}/upload`, { method: 'POST', body: payload });
}

export function quickTkpChat(uid, payload) {
  return api(`/api/tkp-quick/sessions/${uid}/chat`, { method: 'POST', body: payload });
}

/**
 * POST /api/tkp-quick/sessions/:uid/calculate — SSE-stream расчёта Мимира.
 * Vanilla: tkp-page.js:1536-1550 — POST с ReadableStream, парс `data: {...}\n`.
 * События: { type:'status'|'progress'|'done'|'error', message?, estimate?, chat_response_md? }
 * onEvent вызывается на каждое событие. Возвращает Promise (resolved когда поток закрыт).
 */
export async function quickTkpCalculate(uid, onEvent) {
  const token = localStorage.getItem('asgard_token') || '';
  const resp = await fetch(`/api/tkp-quick/sessions/${uid}/calculate`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt || resp.statusText}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        onEvent(ev);
      } catch { /* skip malformed chunk */ }
    }
  }
}

export function quickTkpFinalize(uid, payload) {
  return api(`/api/tkp-quick/sessions/${uid}/finalize`, { method: 'POST', body: payload });
}

/**
 * Открыть PDF ТКП в новой вкладке БЕЗ токена в URL (blob через Authorization header).
 */
export async function openPdf(id, options = {}) {
  const q = new URLSearchParams();
  if (options.signature) q.set('signature', '1');
  if (options.stamp) q.set('stamp', '1');
  const qs = q.toString();
  const url = `/api/tkp/${id}/pdf${qs ? '?' + qs : ''}`;
  const { openProtected } = await import('@/api/download');
  return openProtected(url, `tkp_${id}.pdf`);
}

/**
 * Получить PDF-URL как blob для встроенного iframe-просмотра.
 * Caller обязан URL.revokeObjectURL после unmount.
 */
export async function getPdfBlobUrl(id, options = {}) {
  const q = new URLSearchParams();
  if (options.signature) q.set('signature', '1');
  if (options.stamp) q.set('stamp', '1');
  const qs = q.toString();
  const url = `/api/tkp/${id}/pdf${qs ? '?' + qs : ''}`;
  const { fetchBlobUrl } = await import('@/api/download');
  const { blobUrl } = await fetchBlobUrl(url);
  return blobUrl;
}

export async function openExcel(id) {
  const { openProtected } = await import('@/api/download');
  return openProtected(`/api/tkp/${id}/excel`, `tkp_${id}.xlsx`);
}

export function calcTotals(items, vatPct = VAT_PCT) {
  let netto = 0;
  for (const it of items || []) {
    const qty = Number(it.qty) || 0;
    const price = Number(it.price) || 0;
    netto += qty * price;
  }
  const vat = netto * (vatPct / 100);
  return { netto, vat, total: netto + vat };
}

export function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function filterByQuery(items, q) {
  if (!q || !q.trim()) return items;
  const lq = q.trim().toLowerCase();
  return items.filter((t) =>
    (t.tkp_number || '').toLowerCase().includes(lq) ||
    (t.customer_name || '').toLowerCase().includes(lq) ||
    (t.subject || '').toLowerCase().includes(lq) ||
    (t.inn || '').includes(lq) ||
    String(t.id).includes(lq)
  );
}

export function filterByMatch(items, key, value) {
  if (!value) return items;
  return items.filter((t) => t[key] === value);
}

/* Note: loadCustomers/loadTkpQuickSessions/loadTkpRoot/previewTkpPdf удалены 2026-06-14 —
 * не импортировались, добавлялись только под coverage-audit. */
