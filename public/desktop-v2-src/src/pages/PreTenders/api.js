/**
 * API-клиент страницы /pre-tenders.
 * Источник: vanilla pre_tenders.js (1633 строки).
 */
import { api } from '@/api/client';

// Backend `pre_tenders.js:88,397,1068` использует 'pending_approval' (на согласовании
// директора) и 'expired' (истекла); они были пропущены — соответствующие фильтры
// и бейджи на этих статусах не работали.
export const STATUSES = [
  { value: 'new',              label: 'Новая',                  tone: 'draft' },
  { value: 'in_review',        label: 'На рассмотрении',        tone: 'sent' },
  { value: 'need_docs',        label: 'Нужны документы',        tone: 'question' },
  { value: 'pending_approval', label: 'На согласовании дир.',   tone: 'question' },
  { value: 'accepted',         label: 'Принята',                tone: 'approved' },
  { value: 'rejected',         label: 'Отклонена',              tone: 'rejected' },
  { value: 'expired',          label: 'Истекла',                tone: 'draft' }
];

export const COLORS = [
  { value: 'green',  label: '🟢 Подходит', tone: 'approved' },
  { value: 'yellow', label: '🟡 Спорно',   tone: 'question' },
  { value: 'red',    label: '🔴 Не подходит', tone: 'rejected' },
  { value: 'gray',   label: '⚪ Не оценено',  tone: 'draft' }
];

export const REJECT_REASONS = [
  { value: 'no_competence', label: 'Нет компетенции' },
  { value: 'too_far',       label: 'Далеко территориально' },
  { value: 'too_small',     label: 'Слишком маленький объём' },
  { value: 'no_capacity',   label: 'Нет свободных мощностей' },
  { value: 'price',         label: 'Цена не интересна' },
  { value: 'deadline',      label: 'Не успеваем по срокам' },
  { value: 'risk',          label: 'Высокий риск' },
  { value: 'other',         label: 'Другое' }
];

export function loadList(params = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.ai_color) q.set('ai_color', params.ai_color);
  if (params.search) q.set('search', params.search);
  q.set('limit', String(params.limit || 500));
  return api(`/api/pre-tenders/?${q.toString()}`).then((d) => d.items || d.pre_tenders || []).catch(() => []);
}

export function loadStats() {
  return api('/api/pre-tenders/stats').catch(() => ({}));
}

export function loadDetail(id) {
  // Backend `pre_tenders.js:182` отдаёт `{ success, item, attachments, thread }`.
  // Сшиваем attachments + thread обратно внутрь item, иначе сeкции «Документы»/«Цепочка»
  // не имели доступа к этим массивам.
  return api(`/api/pre-tenders/${id}`).then((d) => {
    const it = d.pre_tender || d.item || d || null;
    if (!it) return null;
    return {
      ...it,
      email_attachments: d.attachments || it.email_attachments || [],
      email_thread: d.thread || it.email_thread || [],
      manual_documents: it.manual_documents || []
    };
  }).catch(() => null);
}

export function uploadDocs(id, files) {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  // Не используем общий api() — multipart требует свою точку (postMultipart),
  // которая САМА выставляет boundary в Content-Type.
  return import('@/api/upload').then(({ postMultipart }) =>
    postMultipart(`/api/pre-tenders/${id}/upload-docs`, fd)
  );
}

export function analyze(id) {
  return api(`/api/pre-tenders/${id}/analyze`, { method: 'POST', body: {} });
}

export function calcCost(id) {
  return api(`/api/pre-tenders/${id}/calc-cost`, { method: 'POST', body: {} });
}

export function accept(id, body) {
  return api(`/api/pre-tenders/${id}/accept`, { method: 'POST', body });
}

/**
 * Утверждение директором (ветка pending_approval → создание тендера).
 * Backend `pre_tenders.js:455` — тот же endpoint /accept, но статус был pending_approval,
 * и роль директорская: создаёт тендер из заявки.
 */
export function approveAsDirector(id, body) {
  return api(`/api/pre-tenders/${id}/accept`, { method: 'POST', body: body || { comment: 'Утверждено директором' } });
}

/**
 * Отклонение согласования директором.
 * Backend `pre_tenders.js:1093` — POST /:id/reject-approval, RBAC ADMIN/DIRECTOR_*.
 * Возвращает заявку обратно в `in_review`, оповещает запросившего.
 */
export function rejectApproval(id, body) {
  return api(`/api/pre-tenders/${id}/reject-approval`, { method: 'POST', body });
}

export function fastTrack(id, body) {
  return api(`/api/pre-tenders/${id}/fast-track`, { method: 'POST', body });
}

export function reject(id, body) {
  return api(`/api/pre-tenders/${id}/reject`, { method: 'POST', body });
}

export function requestDocs(id, body) {
  return api(`/api/pre-tenders/${id}/request-docs`, { method: 'POST', body });
}

export function update(id, patch) {
  return api(`/api/pre-tenders/${id}`, { method: 'PUT', body: patch });
}

export function createManual(body) {
  return api('/api/pre-tenders/', { method: 'POST', body });
}

export function loadPms() {
  return api('/api/users?role=PM&limit=200').then((d) => d.users || d.items || []).catch(() => []);
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

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '—';
}

export function colorBadge(color) {
  return COLORS.find((c) => c.value === color) || { label: '—', tone: 'draft' };
}

/**
 * SSE-подписка на real-time события заявок.
 * Vanilla: pre_tenders.js:752 — `new EventSource('/api/sse/stream?token=...')`.
 * Возвращает функцию-отписку.
 * События: pre_tender:new, pre_tender:updated, pre_tender:accepted, pre_tender:rejected.
 *
 * ⚠️ Browser EventSource API НЕ поддерживает Authorization header — токен
 * передаётся в query (это ограничение браузера, такой же паттерн в vanilla).
 * Митигация: HTTPS (закрывает MITM), read-only канал, токен короткоживущий.
 */
export function subscribeSse(handlers = {}) {
  if (typeof window === 'undefined') return () => {};
  // Используем единый глобальный SSE-канал (useGlobalSSE), а не открываем
  // второй EventSource. Глобальный хук в App.jsx уже диспатчит CustomEvent
  // 'asgard:pre_tender:*' на window — просто слушаем их.
  const wire = (channel, handlerKey) => {
    const fn = (ev) => {
      try { handlers[handlerKey] && handlers[handlerKey](ev.detail || {}); } catch (_) { /* noop */ }
    };
    window.addEventListener('asgard:' + channel, fn);
    return () => window.removeEventListener('asgard:' + channel, fn);
  };
  const off = [
    wire('pre_tender:new',      'onNew'),
    wire('pre_tender:updated',  'onUpdated'),
    wire('pre_tender:accepted', 'onAccepted'),
    wire('pre_tender:rejected', 'onRejected'),
  ];
  return () => { off.forEach((f) => { try { f(); } catch (_) { /* noop */ } }); };
}
