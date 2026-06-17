/**
 * API-клиент страницы /tkp-followup — контроль решения клиента по отправленным ТКП.
 *
 * Источник: vanilla `public/assets/js/tkp_followup.js` (~263 строки, использовал
 * клиентский AsgardDB/IndexedDB как заглушку). В v2 переписано на реальные серверные
 * endpoints с записью в `audit_log`.
 *
 * Backend (`src/routes/tkp.js`):
 *   • GET  /api/tkp/followup           — реестр отправленных ТКП + days_since_last_contact + buckets
 *   • POST /api/tkp/:id/followup       — залогировать контакт (call/email/meeting/other/note)
 *   • GET  /api/tkp/:id/followup       — история событий по конкретному ТКП
 *   • POST /api/tkp/:id/client-decision — отметить решение клиента (accepted/rejected/no_response)
 */
import { api } from '@/api/client';

/**
 * Статусы-баскеты — backend выставляет followup_bucket по дням без контакта и client_decision.
 */
export const BUCKETS = [
  { value: '',              label: 'Все',              icon: '📋', tone: 'draft' },
  { value: 'needs_contact', label: 'Требует контакта', icon: '🔴', tone: 'rejected' },
  { value: 'in_progress',   label: 'В работе',         icon: '⏳', tone: 'sent' },
  { value: 'decided',       label: 'Решение принято',  icon: '✅', tone: 'approved' },
  { value: 'archive',       label: 'Архив',            icon: '📦', tone: 'draft' }
];

export const CONTACT_KINDS = [
  { value: 'call',    label: 'Позвонил',  icon: '📞' },
  { value: 'email',   label: 'Написал',   icon: '📧' },
  { value: 'meeting', label: 'Встреча',   icon: '🤝' },
  { value: 'other',   label: 'Другое',    icon: '✏️' },
  { value: 'note',    label: 'Заметка',   icon: '📝' }
];

// Метки для отрисовки лога followup-событий — backend пишет action='followup_call' и т.п.
export const ACTION_LABELS = {
  followup_call:    { label: 'Позвонил',  icon: '📞' },
  followup_email:   { label: 'Написал',   icon: '📧' },
  followup_meeting: { label: 'Встреча',   icon: '🤝' },
  followup_other:   { label: 'Контакт',   icon: '✏️' },
  followup_note:    { label: 'Заметка',   icon: '📝' },
  client_decision:  { label: 'Решение клиента', icon: '⚖️' }
};

export const DECISION_LABELS = {
  accepted:    { label: '✅ Победили',  tone: 'approved' },
  rejected:    { label: '❌ Проиграли', tone: 'rejected' },
  no_response: { label: '⏳ Нет ответа', tone: 'sent' }
};

/**
 * Загрузить реестр followup-карточек.
 * @param {string} [statusFilter] — пусто|needs_contact|in_progress|decided|archive
 */
export function loadFollowup(statusFilter) {
  const q = new URLSearchParams();
  if (statusFilter) q.set('status_filter', statusFilter);
  q.set('limit', '500');
  return api(`/api/tkp/followup?${q.toString()}`)
    .then((d) => ({ items: d.items || [], stats: d.stats || {} }))
    .catch(() => ({ items: [], stats: {} }));
}

export function logContact(tkpId, kind, comment) {
  return api(`/api/tkp/${tkpId}/followup`, { method: 'POST', body: { kind, comment: comment || '' } });
}

export function loadHistory(tkpId) {
  return api(`/api/tkp/${tkpId}/followup`).then((d) => d.items || []).catch(() => []);
}

export function setClientDecision(tkpId, decision, comment) {
  return api(`/api/tkp/${tkpId}/client-decision`, {
    method: 'POST',
    body: { decision, comment: comment || '' }
  });
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

/**
 * Цвет таймера дней с последнего контакта.
 * >7 — красный (требует), 4-7 — оранжевый, ≤3 — нейтральный.
 */
export function daysTone(days) {
  if (days == null) return 'draft';
  if (days > 7) return 'rejected';
  if (days >= 4) return 'question';
  return 'approved';
}
