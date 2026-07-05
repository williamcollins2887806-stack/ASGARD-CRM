/**
 * DirectorsInbox — API helpers + константы.
 *
 * Backend: src/routes/inbox_applications_ai.js (Wave-2 extension).
 *
 * Endpoint'ы (префикс /api/inbox-applications):
 *   GET    /                  — список с фильтрами
 *   GET    /stats/summary     — счётчики
 *   GET    /:id               — карточка (item + attachments + history)
 *   POST   /:id/assign-pm     {pm_user_id, note?}     — назначить РП (RBAC: ADMIN/DIR/HEAD_PM)
 *   POST   /:id/reject        {reason, send_email?}
 *   POST   /:id/archive
 *   POST   /:id/review        — взять «на рассмотрении»
 *
 * 23.06.2026 Маркетплейс заявок (для PM / HEAD_PM):
 *   GET    /api/pre-tenders?unassigned=1&sort=created_at&order=ASC  — FIFO лента свободных заявок
 *   GET    /api/pre-tenders/my-stats                                — {active_count, limit, can_claim}
 *   POST   /api/pre-tenders/:id/claim                               — забрать себе (409: already_claimed/limit_reached/not_claimable)
 *   SSE    pre_tender:claimed                                       — карточка ушла другому РП
 */
import { api } from '@/api/client';

export const STATUSES = [
  { value: 'new',          label: 'Новая',           tone: 'sent' },
  { value: 'ai_processed', label: 'AI обработана',   tone: 'sent' },
  { value: 'under_review', label: 'На рассмотрении', tone: 'question' },
  { value: 'assigned',     label: 'Назначено',       tone: 'approved' },
  { value: 'accepted',     label: 'Принята',         tone: 'approved' },
  { value: 'rejected',     label: 'Отклонена',       tone: 'rejected' },
  { value: 'archived',     label: 'Архив',           tone: 'draft' }
];

export const COLORS = [
  { value: 'green',  label: '🟢 Наш профиль',     tone: 'approved' },
  { value: 'yellow', label: '🟡 Требует оценки',   tone: 'question' },
  { value: 'red',    label: '🔴 Не наш профиль',   tone: 'rejected' },
  { value: 'gray',   label: '⚪ Не оценено',       tone: 'draft' }
];

export const SOURCE_KINDS = {
  unknown:           '— неизвестно',
  corporate_forward: '↪ Пересланное письмо',
  external_direct:   '✉ Прямое внешнее',
  platform:          '🌐 Площадка',
  manual:            '✋ Создано вручную'
};

export function statusInfo(s) { return STATUSES.find((x) => x.value === s) || { label: s, tone: 'draft' }; }
export function colorInfo(c) { return COLORS.find((x) => x.value === c) || COLORS[3]; }

/* ── API ──────────────────────────────────────────────────────────── */

export function loadList(params = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.color) q.set('color', params.color);
  if (params.search) q.set('search', params.search);
  q.set('limit', String(params.limit || 200));
  return api('/api/inbox-applications/?' + q.toString())
    .then((d) => d?.items || [])
    .catch(() => []);
}

export function loadStats() {
  return api('/api/inbox-applications/stats/summary')
    .then((d) => d?.stats || {})
    .catch(() => ({}));
}

export function loadDetail(id) {
  return api('/api/inbox-applications/' + id);
}

export function assignPm(id, pm_user_id, note) {
  return api('/api/inbox-applications/' + id + '/assign-pm', {
    method: 'POST',
    body: { pm_user_id, note: note || null }
  });
}

export function reject(id, reason, send_email = true) {
  return api('/api/inbox-applications/' + id + '/reject', {
    method: 'POST',
    body: { reason, send_email }
  });
}

export function archive(id) {
  return api('/api/inbox-applications/' + id + '/archive', { method: 'POST', body: {} });
}

export function review(id) {
  return api('/api/inbox-applications/' + id + '/review', { method: 'POST', body: {} });
}

export function loadPmUsers() {
  return api('/api/users?is_active=true&limit=500')
    .then((r) => {
      const list = r?.users || r?.items || [];
      return list.filter((u) => u && u.is_active && ['PM', 'HEAD_PM'].includes(u.role));
    })
    .catch(() => []);
}

/* ── Маркетплейс заявок (PM / HEAD_PM) ─────────────────────────────── */

// Вспомогательное определение режима по роли пользователя.
// HEAD_PM участвует в обоих режимах — приоритет «director» (распределение).
// Vanilla: director_inbox.js:823-832.
export const DIRECTOR_ROLES = ['ADMIN', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
export const PM_MARKETPLACE_ROLES = ['PM', 'HEAD_PM'];
export const MARKETPLACE_LIMIT = null;

export function inferModeFromRole(role) {
  if (DIRECTOR_ROLES.includes(role)) return 'director';
  if (PM_MARKETPLACE_ROLES.includes(role)) return 'marketplace';
  return 'director';
}

// GET /api/pre-tenders?unassigned=1&sort=created_at&order=ASC
// FIFO лента свободных pre-tender'ов. Backend форсит ASC сам, но дублируем для надёжности.
// Vanilla ref: director_inbox.js:115-122.
export function loadMarketplaceList({ limit = 200 } = {}) {
  const q = new URLSearchParams();
  q.set('unassigned', '1');
  q.set('limit', String(limit));
  q.set('offset', '0');
  q.set('sort', 'created_at');
  q.set('order', 'ASC');
  return api('/api/pre-tenders/?' + q.toString())
    .then((d) => {
      const items = (d && d.items) ? d.items : [];
      items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      return items;
    })
    .catch(() => []);
}

// 27.06.2026: ВСЕ pre_tender'ы (не только свободные) — нужны единому маркетплейсу
// /director-inbox чтобы вместе с inbox_applications показать единую воронку.
// Backend GET /api/pre-tenders/ возвращает pt.* + ai_classification (через JOIN
// inbox_applications, добавлено в pre_tenders.js 27.06.2026) — для разделения
// по табам «Приглашения на тендер» vs «Заявки».
export function loadAllPreTenders({ limit = 200 } = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(limit));
  q.set('offset', '0');
  q.set('sort', 'created_at');
  q.set('order', 'DESC');
  return api('/api/pre-tenders/?' + q.toString())
    .then((d) => (d && d.items) ? d.items : [])
    .catch(() => []);
}

// POST /api/pre-tenders/:id/reject — отклонить pre_tender (для единства UI с inbox).
export function rejectPreTender(ptId, reason, send_email = true) {
  return api(`/api/pre-tenders/${ptId}/reject`, {
    method: 'POST', body: { reason, send_email }
  });
}

// POST /api/pre-tenders/from-email — превратить inbox-приглашение в pre_tender (для ТО).
// Использует существующий endpoint, без нового кода. После вызова inbox получает
// status='assigned' (тригерр), pre_tender появляется в очереди ТО.
export function preTenderFromEmail(emailId) {
  return api('/api/pre-tenders/from-email', { method: 'POST', body: { email_id: emailId } });
}

// GET /api/pre-tenders/my-stats → {success, active_count, limit, breakdown, can_claim}
// Vanilla ref: director_inbox.js:153-160.
export function loadMyStats() {
  return api('/api/pre-tenders/my-stats')
    .then((d) => {
      if (!d || !d.success) return { active_count: 0, limit: null, can_claim: true };
      return {
        active_count: d.active_count || 0,
        limit: d.limit ?? null,
        breakdown: d.breakdown || null,
        can_claim: d.can_claim !== false
      };
    })
    .catch(() => ({ active_count: 0, limit: null, can_claim: true }));
}

// POST /api/pre-tenders/:id/claim
// 409 коды: already_claimed / not_claimable / limit_reached.
// silent:true → api НЕ показывает toast, мы сами разбираем e.status / e.data.
// Vanilla ref: director_inbox.js:404-447.
export function claimPreTender(ptId) {
  return api(`/api/pre-tenders/${ptId}/claim`, { method: 'POST', body: {}, silent: true });
}

/* ── Хелперы ─────────────────────────────────────────────────────── */

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '';
}

export function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '';
}

export function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:director-inbox:changed'));
}
