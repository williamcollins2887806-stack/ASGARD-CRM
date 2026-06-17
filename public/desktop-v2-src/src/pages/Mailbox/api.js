/**
 * API-клиент страницы /mailbox — Общий почтовый ящик организации.
 *
 * Источник: vanilla `public/assets/js/mailbox.js` (~993 строк) +
 * backend `src/routes/mailbox.js` (prefix `/api/mailbox`).
 *
 * RBAC: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, HEAD_TO.
 *
 * Endpoints (используемые):
 *   GET    /api/mailbox/emails                  — список писем с фильтрами
 *   GET    /api/mailbox/emails/:id              — детали письма + thread + attachments + application
 *   PATCH  /api/mailbox/emails/:id              — пометить (is_read/is_starred/is_archived/is_deleted)
 *   POST   /api/mailbox/emails/bulk             — массовые действия { ids, action }
 *   GET    /api/mailbox/attachments/:id/download — скачать вложение
 *   POST   /api/mailbox/send                    — отправить письмо
 *   GET    /api/mailbox/stats                   — статистика по папкам
 *   GET    /api/mailbox/accounts                — список email-аккаунтов для фильтра
 *   POST   /api/inbox-applications/from-email   — создать заявку из письма с AI-анализом
 *   POST   /api/inbox-applications/:id/accept   — принять заявку
 *   POST   /api/inbox-applications/:id/reject   — отклонить заявку
 *   POST   /api/inbox-applications/:id/review   — взять на рассмотрение
 *   POST   /api/inbox-applications/:id/analyze  — переанализировать
 *   POST   /api/inbox-applications/:id/archive  — архивировать заявку
 */
import { api } from '@/api/client';

export const MAILBOX_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO'];

/* ── Типы писем ──────────────────────────────────────────────────────── */
export const EMAIL_TYPES = {
  direct_request:   { name: 'Прямой запрос',     tone: 'ok',     icon: '📨' },
  platform_tender:  { name: 'Тендерная площадка', tone: 'amber',  icon: '🎯' },
  newsletter:       { name: 'Рассылка',          tone: 't2',     icon: '📢' },
  internal:         { name: 'Внутренняя',        tone: 'info',   icon: '🏢' },
  crm_outbound:     { name: 'Исходящее',         tone: 'purple', icon: '📤' },
  unknown:          { name: 'Неизвестно',        tone: 't2',     icon: '❓' },
  spam:             { name: 'Спам',              tone: 'err',    icon: '🚫' }
};

export const EMAIL_TYPE_OPTIONS = [
  { value: '',                 label: 'Все типы' },
  { value: 'direct_request',   label: '📨 Прямые запросы' },
  { value: 'platform_tender',  label: '🎯 Тендерные' },
  { value: 'newsletter',       label: '📢 Рассылки' },
  { value: 'internal',         label: '🏢 Внутренние' },
  { value: 'crm_outbound',     label: '📤 Исходящие' },
  { value: 'spam',             label: '🚫 Спам' }
];

/* ── Папки (стиль Gmail) ─────────────────────────────────────────────── */
export const FOLDERS = [
  { key: 'inbox',    name: '📥 Входящие',   filter: { direction: 'inbound', is_archived: 'false' } },
  { key: 'starred',  name: '⭐ Избранное',   filter: { is_starred: 'true' } },
  { key: 'sent',     name: '📤 Отправленные', filter: { direction: 'outbound' } },
  { key: 'drafts',   name: '📝 Черновики',  filter: { is_draft: 'true' } },
  { key: 'archive',  name: '📦 Архив',      filter: { is_archived: 'true' } },
  { key: 'trash',    name: '🗑 Корзина',    filter: { is_deleted: 'true' } }
];

/* ── AI цвета / статусы ──────────────────────────────────────────────── */
export const AI_COLOR_MAP = {
  green:  { tone: 'ok',    icon: '🟢', label: 'Наш профиль' },
  yellow: { tone: 'amber', icon: '🟡', label: 'Требует оценки' },
  red:    { tone: 'err',   icon: '🔴', label: 'Не наш профиль' }
};

export const AI_STATUS_MAP = {
  new:           { label: 'Новая',           tone: 'info'   },
  ai_processed:  { label: 'AI обработана',   tone: 'purple' },
  under_review:  { label: 'На рассмотрении', tone: 'amber'  },
  accepted:      { label: 'Принята',         tone: 'ok'     },
  rejected:      { label: 'Отклонена',       tone: 'err'    },
  archived:      { label: 'Архив',           tone: 't2'     }
};

export const AI_CLASS_MAP = {
  direct_request:      'Прямой запрос',
  platform_tender:     'Тендер с площадки',
  commercial_offer:    'Коммерческое предложение',
  newsletter:          'Рассылка',
  spam:                'Спам',
  internal:            'Внутренняя',
  bounce_or_auto_reply:'Автоответ/Bounce',
  other:               'Прочее'
};

/* ── Список писем ────────────────────────────────────────────────────── */
export function loadEmails({ folder = 'inbox', search = '', typeFilter = '', accountId = '', limit = 50, offset = 0 } = {}) {
  const folderDef = FOLDERS.find((f) => f.key === folder) || FOLDERS[0];
  const params = new URLSearchParams();
  if (folderDef.filter) {
    for (const [k, v] of Object.entries(folderDef.filter)) {
      params.set(k, v);
    }
  }
  if (search)       params.set('search', search);
  if (typeFilter)   params.set('type', typeFilter);
  if (accountId)    params.set('account_id', String(accountId));
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const qs = params.toString();
  return api(`/api/mailbox/emails?${qs}`)
    .then((d) => ({ emails: d.emails || [], total: d.total || 0 }))
    .catch(() => ({ emails: [], total: 0 }));
}

export function loadEmailDetail(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/mailbox/emails/${_id}`).catch(() => null);
}

export function patchEmail(id, patch) {
  const _id = encodeURIComponent(id);
  return api(`/api/mailbox/emails/${_id}`, { method: 'PATCH', body: patch });
}

export function bulkAction(ids, action) {
  return api('/api/mailbox/emails/bulk', {
    method: 'POST',
    body: { ids, action }
  });
}

export function attachmentUrl(attId) {
  const _id = encodeURIComponent(attId);
  return `/api/mailbox/attachments/${_id}/download`;
}

export function loadStats() {
  return api('/api/mailbox/stats').catch(() => ({}));
}

export function loadAccounts() {
  return api('/api/mailbox/accounts').then((d) => d?.accounts || []).catch(() => []);
}

export function sendEmail(body) {
  return api('/api/mailbox/send', { method: 'POST', body });
}

/* ── AI заявки (inbox_applications) — базовый префикс '/api/inbox-applications' ─── */
export function createApplicationFromEmail(emailId, autoAnalyze = true) {
  return api('/api/inbox-applications/from-email', {
    method: 'POST',
    body: { email_id: emailId, auto_analyze: autoAnalyze }
  });
}

export function acceptApplication(appId, { createTender = true, sendEmailFlag = true } = {}) {
  const _id = encodeURIComponent(appId);
  return api(`/api/inbox-applications/${_id}/accept`, {
    method: 'POST',
    body: { create_tender: createTender, send_email: sendEmailFlag }
  });
}

export function rejectApplication(appId, reason) {
  const _id = encodeURIComponent(appId);
  return api(`/api/inbox-applications/${_id}/reject`, {
    method: 'POST',
    body: { reason, send_email: true }
  });
}

export function reviewApplication(appId) {
  const _id = encodeURIComponent(appId);
  return api(`/api/inbox-applications/${_id}/review`, { method: 'POST' });
}

export function reanalyzeApplication(appId) {
  const _id = encodeURIComponent(appId);
  return api(`/api/inbox-applications/${_id}/analyze`, { method: 'POST' });
}

export function archiveApplication(appId) {
  const _id = encodeURIComponent(appId);
  return api(`/api/inbox-applications/${_id}/archive`, { method: 'POST' });
}

/* ── helpers ─────────────────────────────────────────────────────────── */
export function fmtEmailDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Вчера';
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' });
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('ru-RU');
}

export function fmtFileSize(bytes) {
  if (!bytes) return '0 Б';
  const k = 1024, sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function parseEmailList(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(raw) ? raw : [];
}

export function extractFirstEmail(raw) {
  const list = parseEmailList(raw);
  if (list.length === 0) return '';
  const first = list[0];
  if (typeof first === 'string') return first;
  return first.name || first.address || first.email || '';
}

export function money(x) {
  const n = Math.round(Number(x || 0));
  return n.toLocaleString('ru-RU') + ' ₽';
}
