/**
 * API-клиент страницы /telephony.
 * Источник: vanilla telephony.js (2280 строк).
 */
import { api } from '@/api/client';

export const CALL_TYPES = [
  { value: 'incoming', label: '📞 Входящий', tone: 'approved' },
  { value: 'outgoing', label: '📤 Исходящий', tone: 'sent' },
  { value: 'missed',   label: '☎ Пропущенный', tone: 'rejected' },
  { value: 'internal', label: '🔄 Внутренний', tone: 'draft' }
];

export const CALL_OUTCOMES = [
  { value: 'success',   label: '✓ Дозвонились' },
  { value: 'no_answer', label: '✗ Не ответили' },
  { value: 'busy',      label: '⛔ Занято' },
  { value: 'rejected',  label: '⛔ Отбили' }
];

export function loadCalls(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit || 200));
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.user_id) q.set('user_id', String(params.user_id));
  if (params.search) q.set('search', params.search);
  if (params.type) q.set('type', params.type);
  return api(`/api/telephony/calls?${q.toString()}`).then((d) => d.call_history || d.calls || d.items || []).catch(() => []);
}

export function loadCallStats(period = 'today') {
  return api(`/api/telephony/stats?period=${period}`).catch(() => ({}));
}

export function loadDispatcherSettings() {
  return api('/api/telephony/call-control/settings').catch(() => ({}));
}

// E-2 fix: backend telephony.js:1556 — POST /call-control/toggle-dispatcher
// (settings — read-only GET). Vanilla тоже шёл через toggle.
export function updateDispatcherSettings(body) {
  return api('/api/telephony/call-control/toggle-dispatcher', { method: 'POST', body });
}

// E-2 fix: backend telephony.js:1592 — GET /employees (не /operators).
export function loadOperators() {
  return api('/api/telephony/employees').then((d) => d.employees || d.items || []).catch(() => []);
}

export function loadCallDetail(id) {
  return api(`/api/telephony/calls/${id}`).catch(() => null);
}

/**
 * Получить blob-URL записи звонка БЕЗ токена в URL.
 * Возвращает Promise<string> — blob-url для <audio src>.
 * Вызывающий обязан URL.revokeObjectURL при unmount.
 */
export async function loadRecordingBlobUrl(callId) {
  const { fetchBlobUrl } = await import('@/api/download');
  const { blobUrl } = await fetchBlobUrl(`/api/telephony/calls/${callId}/recording`);
  return blobUrl;
}

// E-2: loadIvrFlows удалена — endpoint /api/telephony/ivr не существует,
// функция нигде не импортировалась (dead code).

export function makeCall(payload) {
  // Z4 FIX: backend exposes /api/telephony/call/start (vanilla telephony.js:853),
  // /make-call does NOT exist → 404 — found by submit-flow z4 test.
  return api('/api/telephony/call/start', { method: 'POST', body: payload });
}

export function postCallNote(callId, body) {
  return api(`/api/telephony/calls/${callId}/note`, { method: 'POST', body });
}

export function tagCall(callId, body) {
  return api(`/api/telephony/calls/${callId}/tag`, { method: 'POST', body });
}

/* Note: loadCallReports*, loadTelephonyRoot, loadCallsRoot удалены 2026-06-14 —
 * не импортировались, добавлялись только под coverage-audit метрику. */

// ────────────────────────────────────────────────────────────────────────────
// Wave 12 — недостающие 4 вкладки + IncomingCallPopup.
// Endpoints проверены по src/routes/telephony.js (см. отчёт агента).
// ────────────────────────────────────────────────────────────────────────────

// Tab «Пропущенные» — backend telephony.js:934 (GET /missed)
// Возвращает { items, total, unacknowledged, page, limit }.
export function loadMissed(params = {}) {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  q.set('limit', String(params.limit || 200));
  if (params.acknowledged === false || params.acknowledged === 'false') q.set('acknowledged', 'false');
  return api(`/api/telephony/missed?${q.toString()}`).catch(() => ({ items: [], total: 0, unacknowledged: 0 }));
}

// telephony.js:991 — отметить пропущенный как просмотренный
export function ackMissed(id) {
  return api(`/api/telephony/missed/${id}/acknowledge`, { method: 'POST', body: {} });
}

// Tab «Статистика» — backend telephony.js:1002 (GET /stats)
// Возвращает { period, totals: { total, inbound, outbound, missed, avg_duration, target_calls, converted_to_leads }, by_period: [{period,total,inbound,outbound,missed}] }.
export function loadStatsRange({ date_from, date_to, group_by = 'day' } = {}) {
  const q = new URLSearchParams();
  if (date_from) q.set('date_from', date_from);
  if (date_to) q.set('date_to', date_to);
  q.set('group_by', group_by);
  return api(`/api/telephony/stats?${q.toString()}`).catch(() => ({ totals: {}, by_period: [] }));
}

// Tab «Статистика»+«Аналитика» — backend telephony.js:1053 (GET /stats/managers)
// Возвращает { managers: [{ id, name, total_calls, inbound, outbound, missed, avg_duration, converted }] }.
export function loadManagerStats({ date_from, date_to } = {}) {
  const q = new URLSearchParams();
  if (date_from) q.set('date_from', date_from);
  if (date_to) q.set('date_to', date_to);
  return api(`/api/telephony/stats/managers?${q.toString()}`).then((d) => d.managers || []).catch(() => []);
}

// Tab «Аналитика» — список менеджеров для фильтра, backend telephony.js:1386 (GET /managers).
export function loadManagers() {
  return api('/api/telephony/managers').then((d) => d.managers || []).catch(() => []);
}

// Tab «Аналитика» — перезапуск ИИ-анализа, backend telephony.js:786 (POST /calls/:id/analyze).
// Возвращает { status: 'queued' }. Реальный summary/sentiment появляется в /calls/:id
// после фоновой обработки (опрос или открытие CallDetailModal).
export function analyzeCall(callId) {
  return api(`/api/telephony/calls/${callId}/analyze`, { method: 'POST', body: {} });
}

// Tab «Аналитика» — DaData по номеру. На backend нет универсального
// `/api/dadata/by-phone`. Используем ту же логику что уже стоит в
// telephony.js:1338 (enrichPhoneData) — данные лежат на call.dadata_region/
// dadata_operator/dadata_city. Если на конкретном звонке их нет —
// можно дергать customers fuzzy-поиск по номеру (см. /call/start:894).
// Здесь — просто читаем уже сохранённое из call_history.
export function getDadataFromCall(call) {
  if (!call) return null;
  if (!call.dadata_region && !call.dadata_operator && !call.dadata_city) return null;
  return {
    region: call.dadata_region || '',
    operator: call.dadata_operator || '',
    city: call.dadata_city || '',
    client_name: call.client_name || call.client_contact || ''
  };
}

// Tab «Маршрутизация» — CRUD правил.
// Backend: telephony.js:1087 (GET), :1096 (POST), :1116 (PUT), :1149 (DELETE).
export function loadRoutingRules() {
  return api('/api/telephony/routing').then((d) => d.rules || []).catch(() => []);
}
export function createRoutingRule(payload) {
  return api('/api/telephony/routing', { method: 'POST', body: payload });
}
export function updateRoutingRule(id, payload) {
  return api(`/api/telephony/routing/${id}`, { method: 'PUT', body: payload });
}
export function deleteRoutingRule(id) {
  return api(`/api/telephony/routing/${id}`, { method: 'DELETE' });
}

// IncomingCallPopup — действия со звонком.
// transfer:   backend /call-control/transfer (telephony.js:1734) — body { call_id, employee_id, employee_phone }
// answer:     vanilla telephony_popup.js:770 шлёт POST /call-control/answer.
//   На бэке этого endpoint'а пока нет — оставляем no-op fetch (ловит 404 silent),
//   фактический подъём трубки делает Asterisk dialplan / SIP-телефон сотрудника.
// hangup:     backend /call/hangup (telephony.js:1319) — body { call_id }
export function transferCallTo({ call_id, employee_id, employee_phone }) {
  return api('/api/telephony/call-control/transfer', { method: 'POST', body: { call_id, employee_id, employee_phone } });
}
export function answerCall(call_id) {
  // backend endpoint отсутствует — fetch с silent:true не льёт toast на 404.
  return api('/api/telephony/call-control/answer', { method: 'POST', body: { call_id }, silent: true }).catch(() => null);
}
export function hangupCall(call_id) {
  return api('/api/telephony/call/hangup', { method: 'POST', body: { call_id } });
}
// Заметка по активному звонку (auto-save) — POST /calls/:id/note (telephony.js:827).
// Если звонка ещё нет в БД (только что зазвонило) — silent fail.
export function saveCallNote(call_id, note) {
  if (!call_id || !note) return Promise.resolve(null);
  return api(`/api/telephony/calls/${call_id}/note`, { method: 'POST', body: { note }, silent: true }).catch(() => null);
}

export function fmtDuration(seconds) {
  if (!seconds) return '—';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '—';
}

export function fmtPhone(n) {
  if (!n) return '—';
  const s = String(n).replace(/\D/g, '');
  if (s.length === 11 && (s[0] === '7' || s[0] === '8')) {
    return `+7 (${s.slice(1, 4)}) ${s.slice(4, 7)}-${s.slice(7, 9)}-${s.slice(9, 11)}`;
  }
  return n;
}
