/**
 * API-клиент страницы /mail-settings.
 *
 * Источник: vanilla `public/assets/js/mail_settings.js` (~614 строк) +
 * backend `src/routes/mailbox.js` (prefix `/api/mailbox`).
 *
 * Endpoint'ы (используемые):
 *   GET    /api/mailbox/accounts                           — список email-аккаунтов
 *   POST   /api/mailbox/accounts                           — создать
 *   PUT    /api/mailbox/accounts/:id                       — править
 *   DELETE /api/mailbox/accounts/:id                       — деактивировать
 *   POST   /api/mailbox/accounts/test-imap                 — { imap_host, imap_port, imap_user, imap_pass, imap_tls, imap_folder }
 *   POST   /api/mailbox/accounts/test-smtp                 — { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_tls }
 *   POST   /api/mailbox/accounts/:id/sync                  — ручная синхронизация
 *
 *   GET    /api/mailbox/classification-rules
 *   POST   /api/mailbox/classification-rules
 *   PUT    /api/mailbox/classification-rules/:id
 *   DELETE /api/mailbox/classification-rules/:id
 *   POST   /api/mailbox/classification-rules/test          — { from_email, subject, body_text }
 *
 *   GET    /api/mailbox/templates
 *   POST   /api/mailbox/templates
 *   DELETE /api/mailbox/templates/:id
 *
 *   GET    /api/mailbox/sync-log?limit=100
 *
 * RBAC настроек (SETTINGS_ROLES): ADMIN, DIRECTOR_GEN.
 */
import { api } from '@/api/client';

export const SETTINGS_ROLES = ['ADMIN', 'DIRECTOR_GEN'];

export const RULE_TYPES = [
  { value: 'domain',           label: 'Домен' },
  { value: 'keyword_subject',  label: 'Ключевое слово (тема)' },
  { value: 'keyword_body',     label: 'Ключевое слово (тело)' },
  { value: 'header',           label: 'Заголовок' },
  { value: 'from_pattern',     label: 'От кого' },
  { value: 'combined',         label: 'Комбинированное' }
];

export const MATCH_MODES = [
  { value: 'contains',    label: 'Содержит' },
  { value: 'exact',       label: 'Точное совпадение' },
  { value: 'starts_with', label: 'Начинается с' },
  { value: 'ends_with',   label: 'Заканчивается на' },
  { value: 'regex',       label: 'Регулярка' }
];

export const CLASSIFICATIONS = [
  { value: 'direct_request',  label: 'Прямой запрос', tone: 'success' },
  { value: 'platform_tender', label: 'Тендерная площадка', tone: 'warn' },
  { value: 'newsletter',      label: 'Рассылка', tone: 'info' },
  { value: 'internal',        label: 'Внутренняя', tone: 'info' },
  { value: 'spam',            label: 'Спам', tone: 'danger' }
];

export const TPL_CATEGORIES = [
  { value: 'document',     label: 'Документы' },
  { value: 'tender',       label: 'Тендеры' },
  { value: 'notification', label: 'Уведомления' },
  { value: 'finance',      label: 'Финансы' },
  { value: 'hr',           label: 'HR' },
  { value: 'custom',       label: 'Другое' }
];

/* ── Accounts ──────────────────────────────────────────────────────────── */
export function loadAccounts() {
  return api('/api/mailbox/accounts').then((d) => d?.accounts || []);
}

export function createAccount(payload) {
  return api('/api/mailbox/accounts', { method: 'POST', body: payload });
}

export function updateAccount(id, payload) {
  const _id = encodeURIComponent(id);
  return api(`/api/mailbox/accounts/${_id}`, { method: 'PUT', body: payload });
}

export function deleteAccount(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/mailbox/accounts/${_id}`, { method: 'DELETE' });
}

export function syncAccount(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/mailbox/accounts/${_id}/sync`, { method: 'POST' });
}

export function testImap(payload) {
  return api('/api/mailbox/accounts/test-imap', { method: 'POST', body: payload });
}

export function testSmtp(payload) {
  return api('/api/mailbox/accounts/test-smtp', { method: 'POST', body: payload });
}

/* ── Classification rules ──────────────────────────────────────────────── */
export function loadRules() {
  return api('/api/mailbox/classification-rules').then((d) => d?.rules || []);
}

export function createRule(payload) {
  return api('/api/mailbox/classification-rules', { method: 'POST', body: payload });
}

export function updateRule(id, payload) {
  const _id = encodeURIComponent(id);
  return api(`/api/mailbox/classification-rules/${_id}`, {
    method: 'PUT', body: payload
  });
}

export function deleteRule(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/mailbox/classification-rules/${_id}`, { method: 'DELETE' });
}

export function testClassification(payload) {
  return api('/api/mailbox/classification-rules/test', { method: 'POST', body: payload });
}

/* ── Templates ─────────────────────────────────────────────────────────── */
export function loadTemplates() {
  return api('/api/mailbox/templates').then((d) => d?.templates || []);
}

export function createTemplate(payload) {
  return api('/api/mailbox/templates', { method: 'POST', body: payload });
}

export function updateTemplate(id, payload) {
  const _id = encodeURIComponent(id);
  return api(`/api/mailbox/templates/${_id}`, { method: 'PUT', body: payload });
}

export function deleteTemplate(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/mailbox/templates/${_id}`, { method: 'DELETE' });
}

/* ── Sync log ──────────────────────────────────────────────────────────── */
export function loadSyncLog(limit = 100) {
  return api('/api/mailbox/sync-log?limit=' + limit).then((d) => d?.logs || []);
}

/* ── helpers ──────────────────────────────────────────────────────────── */
export function classTone(cls) {
  return CLASSIFICATIONS.find((c) => c.value === cls)?.tone || 'info';
}

export function classLabel(cls) {
  return CLASSIFICATIONS.find((c) => c.value === cls)?.label || cls;
}

export function ruleTypeLabel(t) {
  return RULE_TYPES.find((x) => x.value === t)?.label || t;
}

export function tplCategoryLabel(c) {
  return TPL_CATEGORIES.find((x) => x.value === c)?.label || c;
}

export function syncStatusTone(s) {
  switch ((s || '').toLowerCase()) {
    case 'success':
    case 'ok':       return 'success';
    case 'error':
    case 'failed':   return 'danger';
    case 'partial':
    case 'running':  return 'warn';
    default:         return 'info';
  }
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU');
  } catch {
    return '—';
  }
}
