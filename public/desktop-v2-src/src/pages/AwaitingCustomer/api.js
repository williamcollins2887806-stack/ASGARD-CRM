/**
 * API-клиент страницы /awaiting-customer — просчёты в ожидании заказчика.
 * Источник: vanilla `public/assets/js/awaiting-customer.js` (266 строк).
 * Backend: src/routes/mimir-conductor.js — /api/mimir/conductor/awaiting-customer и letter/*.
 */
import { api } from '@/api/client';

const API = '/api/mimir/conductor';

/** GET /awaiting-customer */
export function loadAwaiting() {
  return api(`${API}/awaiting-customer`);
}

/** GET /run/:id — для получения списка clarifications */
export function loadRun(runId) {
  return api(`${API}/run/${runId}`);
}

/** POST /letter/generate */
export function generateLetter(runId, clarificationIds) {
  return api(`${API}/letter/generate`, {
    method: 'POST',
    body: { run_id: Number(runId), clarification_ids: clarificationIds },
  });
}

/** POST /letter/:id/mark-sent */
export function markLetterSent(letterId, channel = 'manual') {
  return api(`${API}/letter/${letterId}/mark-sent`, {
    method: 'POST',
    body: { channel },
  });
}

/** POST /letter/:id/upload-reply — текст или файл (FormData) */
export async function uploadReply(letterId, { text, file }) {
  const token = localStorage.getItem('asgard_token') || '';
  let body;
  const headers = { Authorization: 'Bearer ' + token };
  if (file) {
    body = new FormData();
    body.append('file', file);
    if (text) body.append('text', text);
  } else {
    body = JSON.stringify({ text });
    headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(`${API}/letter/${letterId}/upload-reply`, {
    method: 'POST',
    headers,
    body,
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

/** POST /letter/:id/apply-mapping */
export function applyMapping(letterId, mapping) {
  return api(`${API}/letter/${letterId}/apply-mapping`, {
    method: 'POST',
    body: { mapping },
  });
}

/** Скачать PDF/DOCX как Blob (с заголовком Bearer). */
export async function downloadLetter(letterId, format) {
  const token = localStorage.getItem('asgard_token') || '';
  const resp = await fetch(`${API}/letter/${letterId}/download/${format}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.blob();
}

export function fmtRub(v) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ru-RU') + ' ₽';
}
