/**
 * PersonalKanban — API helpers + константы.
 *
 * Backend (Wave-2): src/routes/personal-kanban.js + src/routes/inbox_applications_ai.js
 *
 * Префикс /api/personal-kanban:
 *   GET    /substages?flow_type=&main_status=&include_inactive=
 *   POST   /substages
 *   PATCH  /substages/:id   {title?, color?, sort_order?, version}
 *   DELETE /substages/:id   (409 has_cards → {cards_count, suggest_target_id})
 *   POST   /substages/:id/move-cards-to/:targetId
 *   GET    /cards?flow_type=&include_closed=
 *   POST   /cards/:id/move      {to_substage_id?, to_main_status?, note?, version, confirm?}
 *   POST   /cards/:id/transfer  {to_user_id, note?}
 *   GET    /cards/:id/history
 *   POST   /cards/:id/notes     {body}
 *   POST   /cards/:id/reminders {remind_at, message?}
 *   PATCH  /cards/:id/reminders/:rid {is_done?}
 *   DELETE /cards/:id/reminders/:rid
 *
 * Inbox (для прямой заявки из канбана):
 *   POST   /api/inbox-applications/direct  (multipart: title, body, customer_name?,
 *                                           customer_contact?, assign_pm_user_id?, files[])
 *
 * Каноник main_status по flow_type — синхронизирован с CANONICAL_MAIN_STATUSES
 * в src/routes/personal-kanban.js (§9.1 пайплайна).
 */
import { api } from '@/api/client';

/* ── Константы flow_type / main_status (зеркало backend) ──────────── */

export const FLOW_TYPES = [
  { value: 'application', label: 'Заявки',   icon: '📨' },
  { value: 'pre_tender',  label: 'Просчёты', icon: '🧮' },
  { value: 'tender',      label: 'Тендеры',  icon: '📋' },
  { value: 'work',        label: 'Работы',   icon: '🏗' }
];

// Канонические main_status — должны совпадать с backend (personal-kanban.js).
export const MAIN_STATUSES = {
  application: [
    { value: 'new',          label: 'Новая' },
    { value: 'ai_processed', label: 'AI обработана' },
    { value: 'under_review', label: 'На рассмотрении' },
    { value: 'assigned',     label: 'Назначено' },
    { value: 'accepted',     label: 'Принята' },
    { value: 'rejected',     label: 'Отклонена' },
    { value: 'archived',     label: 'Архив' }
  ],
  tender: [
    { value: 'Черновик',                  label: 'Черновик' },
    { value: 'Новый',                     label: 'Новый' },
    { value: 'На анализе',                label: 'На анализе' },
    { value: 'Отправлено на просчёт',     label: 'На просчёте' },
    { value: 'Согласование ТКП',          label: 'Согл. ТКП' },
    { value: 'ТКП согласовано',           label: 'ТКП ОК' },
    { value: 'Готово к отправке КП',      label: 'Готово к КП' },
    { value: 'КП отправлено',             label: 'КП отправлено' },
    { value: 'Выиграли',                  label: 'Выиграли' },
    { value: 'Проиграли',                 label: 'Проиграли' },
    { value: 'Не подходит',               label: 'Не подходит' }
  ],
  pre_tender: [
    { value: 'new',                label: 'Новый' },
    { value: 'in_review',          label: 'На рассмотрении' },
    { value: 'need_docs',          label: 'Нужны документы' },
    { value: 'accepted',           label: 'Принят' },
    { value: 'rejected',           label: 'Отклонён' },
    { value: 'expired',            label: 'Просрочен' },
    { value: 'pending_approval',   label: 'На согласовании' },
    { value: 'approved',           label: 'Согласован' },
    { value: 'pending_payment',    label: 'Ожидает оплаты' },
    { value: 'paid',               label: 'Оплачен' },
    { value: 'cash_issued',        label: 'Деньги выданы' },
    { value: 'cash_received',      label: 'Получено' },
    { value: 'expense_reported',   label: 'Отчёт' }
  ],
  work: [
    { value: 'Новая',           label: 'Новая' },
    { value: 'Подготовка',      label: 'Подготовка' },
    { value: 'Мобилизация',     label: 'Мобилизация' },
    { value: 'В работе',        label: 'В работе' },
    { value: 'На паузе',        label: 'На паузе' },
    { value: 'Подписание акта', label: 'Подп. акта' },
    { value: 'Работы сдали',    label: 'Сдали' },
    { value: 'Закрыт',          label: 'Закрыт' }
  ]
};

// Палитра цветов для substage.color (UI выбор пользователем).
export const COLOR_PALETTE = [
  '#8a93a6', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899',
  '#22c55e', '#eab308', '#f97316', '#a855f7'
];

// Шаблон «Подготовка ТКП» (для flow_type='pre_tender', main_status='in_review').
export const SUBSTAGE_TEMPLATES = {
  pretkp_in_review: {
    label: 'Подготовка ТКП',
    flow_type: 'pre_tender',
    main_status: 'in_review',
    items: [
      { title: 'Входящая заявка',           color: '#3b82f6' },
      { title: 'Созвон с клиентом',          color: '#06b6d4' },
      { title: 'Получение доп. информации',  color: '#f59e0b' },
      { title: 'Осмотр объекта',             color: '#a855f7' },
      { title: 'Расчёт ТКП',                 color: '#10b981' },
      { title: 'Согласование с директором',  color: '#ec4899' }
    ]
  }
};

/* ── API: substages ───────────────────────────────────────────── */

export function loadSubstages({ flow_type, main_status, include_inactive } = {}) {
  const q = new URLSearchParams();
  if (flow_type) q.set('flow_type', flow_type);
  if (main_status) q.set('main_status', main_status);
  if (include_inactive) q.set('include_inactive', 'true');
  return api('/api/personal-kanban/substages' + (q.toString() ? '?' + q.toString() : ''))
    .then((r) => r?.items || []);
}

export function createSubstage(payload) {
  return api('/api/personal-kanban/substages', { method: 'POST', body: payload })
    .then((r) => r?.item);
}

export function patchSubstage(id, patch) {
  return api('/api/personal-kanban/substages/' + id, { method: 'PATCH', body: patch })
    .then((r) => r?.item);
}

export function deleteSubstage(id) {
  return api('/api/personal-kanban/substages/' + id, { method: 'DELETE' });
}

export function moveCardsToSubstage(srcId, targetId) {
  return api('/api/personal-kanban/substages/' + srcId + '/move-cards-to/' + targetId,
    { method: 'POST', body: {} });
}

/* ── API: cards ───────────────────────────────────────────────── */

export function loadCards({ flow_type, include_closed } = {}) {
  const q = new URLSearchParams();
  if (flow_type) q.set('flow_type', flow_type);
  if (include_closed) q.set('include_closed', 'true');
  return api('/api/personal-kanban/cards' + (q.toString() ? '?' + q.toString() : ''))
    .then((r) => r || { items: [], groups: {} });
}

// move: { to_substage_id?, to_main_status?, note?, version, confirm? }
export function moveCard(cardId, payload) {
  return api('/api/personal-kanban/cards/' + cardId + '/move',
    { method: 'POST', body: payload });
}

export function transferCard(cardId, payload) {
  return api('/api/personal-kanban/cards/' + cardId + '/transfer',
    { method: 'POST', body: payload });
}

export function loadCardHistory(cardId) {
  return api('/api/personal-kanban/cards/' + cardId + '/history')
    .then((r) => r || { items: [], history: [], notes: [] });
}

export function addCardNote(cardId, body) {
  return api('/api/personal-kanban/cards/' + cardId + '/notes',
    { method: 'POST', body: { body } });
}

export function addCardReminder(cardId, payload) {
  return api('/api/personal-kanban/cards/' + cardId + '/reminders',
    { method: 'POST', body: payload });
}

export function patchReminder(cardId, rid, patch) {
  return api(`/api/personal-kanban/cards/${cardId}/reminders/${rid}`,
    { method: 'PATCH', body: patch });
}

export function deleteReminder(cardId, rid) {
  return api(`/api/personal-kanban/cards/${cardId}/reminders/${rid}`,
    { method: 'DELETE' });
}

/* ── API: пользователи (для transfer + assign-pm) ─────────────── */

export function loadPmUsers() {
  return api('/api/users?is_active=true&limit=500')
    .then((r) => {
      const list = r?.users || r?.items || [];
      return list.filter((u) => u && u.is_active && ['PM', 'HEAD_PM'].includes(u.role));
    })
    .catch(() => []);
}

/* ── API: прямая заявка ───────────────────────────────────────── */

export async function createDirectApplication({ title, body, customer_name, customer_contact, assign_pm_user_id, files }) {
  const fd = new FormData();
  fd.append('title', title || '');
  fd.append('body', body || '');
  if (customer_name) fd.append('customer_name', customer_name);
  if (customer_contact) fd.append('customer_contact', customer_contact);
  if (assign_pm_user_id != null) fd.append('assign_pm_user_id', String(assign_pm_user_id));
  if (Array.isArray(files)) {
    for (const f of files) fd.append('files', f, f.name);
  }
  // api() не подходит для multipart (он ставит Content-Type:application/json). Используем fetch напрямую.
  let token = '';
  try { token = localStorage.getItem('asgard_token') || ''; } catch { /* noop */ }
  const r = await fetch('/api/inbox-applications/direct', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  let payload = null;
  try { payload = await r.json(); } catch { /* noop */ }
  if (!r.ok) {
    const err = new Error((payload && (payload.error || payload.message)) || ('HTTP ' + r.status));
    err.status = r.status;
    err.body = payload;
    throw err;
  }
  return payload || {};
}

/* ── Хелперы ──────────────────────────────────────────────────── */

export function mainStatusLabel(flowType, value) {
  const list = MAIN_STATUSES[flowType] || [];
  return list.find((x) => x.value === value)?.label || value || '—';
}

export function isStale(lastMovedAt, days = 5) {
  if (!lastMovedAt) return false;
  const t = new Date(lastMovedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > days * 24 * 3600 * 1000;
}

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU');
}

export function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU');
}

// Источник карты (по entity_kind) — иконка + подпись.
export function sourceInfo(entityKind) {
  switch (entityKind) {
    case 'inbox_application': return { icon: '📨', label: 'Заявка' };
    case 'pre_tender':        return { icon: '🧮', label: 'Просчёт' };
    case 'tender':            return { icon: '📋', label: 'Тендер' };
    case 'work':              return { icon: '🏗', label: 'Работа' };
    default:                  return { icon: '•',  label: entityKind || '' };
  }
}
