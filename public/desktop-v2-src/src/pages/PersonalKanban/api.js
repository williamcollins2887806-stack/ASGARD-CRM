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

// transferCard — единая обёртка передачи карты другому РП.
//
// 23.06.2026 Маркетплейс: для pre_tender'а передача = reassign самого pre_tender'а
// (а не только карты канбана). Backend endpoint /api/pre-tenders/:id/transfer
// делает: обновляет assigned_to + закрывает карту у старого + создаёт у нового
// + проверяет лимит 5 у получателя.
// Для остальных entity_kind (tender / work / inbox_application) — legacy
// /personal-kanban/cards/:id/transfer.
//
// Опционально принимает контекст карты через `cardCtx` (объект, может содержать
// `entity_kind`, `entity_id`). Если cardCtx.entity_kind === 'pre_tender' и есть entity_id —
// маршрутизируем на pre-tender endpoint. Иначе — legacy.
// Vanilla ref: personal_kanban.js:1691-1740.
export function transferCard(cardId, payload, cardCtx) {
  const entityKind = cardCtx?.entity_kind;
  const entityId = cardCtx?.entity_id;
  if (entityKind === 'pre_tender' && entityId != null) {
    // Pre-tender backend: { to_user_id, reason } (а не note).
    const body = {
      to_user_id: payload?.to_user_id,
      reason: (payload && (payload.reason ?? payload.note)) || null
    };
    // silent: вызывающий сам обработает 409 recipient_limit_reached / already_owns / self_transfer_forbidden.
    return api('/api/pre-tenders/' + entityId + '/transfer',
      { method: 'POST', body, silent: true });
  }
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

/* ═══════════════════════════════════════════════════════════════════════════
 * v3 API — 9-колоночный канбан, ТКП-конструктор, Quick/Conductor/References
 * S-21: добавлена 9-я колонка 'addendum' (Дозапрос) + поддержка scope/owner_id
 *       (S-9 backend готов: VALID_SCOPES = ['auto','owner','to_personal','to_team','all'])
 * ═══════════════════════════════════════════════════════════════════════════ */

export const V3_COLUMNS = ['new', 'calc', 'addendum', 'kp_prep', 'approval', 'sent', 'win', 'lose', 'work'];
export const V3_COL_META = {
  new:      { ic: '📥', title: 'Новые' },
  calc:     { ic: '🧮', title: 'Просчёт' },
  addendum: { ic: '❓', title: 'Дозапрос', cls: 'pk3-col-addendum' },
  kp_prep:  { ic: '📋', title: 'КП готовится' },
  approval: { ic: '⚖️', title: 'Согласование дир' },
  sent:     { ic: '📤', title: 'КП ушло' },
  win:      { ic: '🏆', title: 'Выиграно', cls: 'pk3-col-win' },
  lose:     { ic: '❌', title: 'Проиграно', cls: 'pk3-col-lose' },
  work:     { ic: '🏗', title: 'В работе' },
};
export const V3_STAGE_LABELS = ['📥 Новая', '🧮 Просчёт', '❓ Дозапрос', '📋 КП готов', '⚖️ Согл. дир', '📤 КП ушло', '🏆 Выигр.', '❌ Проигр.', '🏗 В работе'];

// S-21: scope ('auto' | 'owner' | 'to_personal' | 'to_team' | 'all') и owner_id (HEAD_TO для чужого канбана).
// Backend (S-9, src/routes/personal-kanban.js) сам резолвит auto → owner/to_personal/to_team/all по роли,
// а для TO/HEAD_TO форсит flow_filter='tender' (отсюда — isToRole убирает наш flow_filter из строки).
// Старые вызовы loadV3Board(flowFilter) остаются совместимыми (scope='auto').
function _buildV3Query(flowFilter, scope, ownerId, isToRole) {
  const parts = [];
  if (!isToRole) parts.push('flow_filter=' + encodeURIComponent(flowFilter || 'all'));
  parts.push('scope=' + encodeURIComponent(scope || 'auto'));
  if (ownerId != null && String(ownerId).length) parts.push('owner_id=' + encodeURIComponent(String(ownerId)));
  return parts.join('&');
}
export async function loadV3Board(flowFilter, scope, ownerId, isToRole) {
  const qs = _buildV3Query(flowFilter, scope, ownerId, isToRole);
  return await api(`/api/personal-kanban/board?${qs}`) || { columns: {}, total: 0 };
}
export async function loadV3Counts(flowFilter, scope, ownerId, isToRole) {
  const qs = _buildV3Query(flowFilter, scope, ownerId, isToRole);
  return await api(`/api/personal-kanban/columns/counts?${qs}`) || {};
}
// 409 → возвращаем payload вместо throw (см. _handleErrorResponse: 409 silent, но Error всё равно).
// Вызывающий обрабатывает {error:'confirm_required'} как подтверждение перехода.
async function _v3Soft409(path, body) {
  try {
    return await api(path, { method: 'POST', body, silent: true });
  } catch (e) {
    if (e?.status === 409 && e?.data) return e.data;
    throw e;
  }
}
export async function v3Transition(cardId, toCol, note, confirm) {
  return await _v3Soft409(
    `/api/personal-kanban/cards/${cardId}/transition`,
    { to_v3_column: toCol, note: note || null, confirm: !!confirm },
  );
}
export async function v3StartQuick(cardId) {
  return await api(`/api/personal-kanban/cards/${cardId}/start-quick`, { method: 'POST', body: {} });
}
export async function v3StartConductor(cardId) {
  return await api(`/api/personal-kanban/cards/${cardId}/start-conductor`, { method: 'POST', body: {} });
}
export async function v3ConvertToPretender(cardId) {
  return await api(`/api/personal-kanban/cards/${cardId}/convert-to-pretender`, { method: 'POST', body: {} });
}
export async function v3SearchReferences(params) {
  const q = new URLSearchParams();
  if (params.work_type)  q.set('work_type', params.work_type);
  if (params.volume_min) q.set('volume_min', String(params.volume_min));
  if (params.volume_max) q.set('volume_max', String(params.volume_max));
  q.set('limit', String(params.limit || 10));
  return await api(`/api/mimir/references/search?${q.toString()}`);
}
export async function tkpFromCard(cardId, templateKind) {
  return await api(`/api/tkp/from-card/${cardId}`, {
    method: 'POST',
    body: { template_kind: templateKind || 'universal' },
  });
}
export async function tkpLoadBlocks(tkpId) {
  return await api(`/api/tkp/${tkpId}/blocks`);
}
export async function tkpSaveBlocks(tkpId, blocks) {
  return await api(`/api/tkp/${tkpId}/blocks`, { method: 'PUT', body: { blocks } });
}
export async function tkpRenderPdf(tkpId) {
  return await api(`/api/tkp/${tkpId}/render-pdf`, { method: 'POST', body: {} });
}
export async function tkpAttachToCard(tkpId, cardId) {
  return await api(`/api/tkp/${tkpId}/attach-to-card/${cardId}`, { method: 'POST', body: {} });
}
export async function tkpSendToClient(cardId, payload) {
  return await api(`/api/tkp/${cardId}/send-tkp-to-client`, { method: 'POST', body: payload });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Notes (доска заметок) — паритет с vanilla personal_kanban.js:5279..5450
 *   GET    /cards/:cardId/history             → { notes:[...] }
 *   POST   /cards/:cardId/notes               { body }
 *   PUT    /cards/:cardId/notes/:noteId       { body }
 *   PATCH  /cards/:cardId/notes/:noteId/position { pos_x, pos_y }
 *   DELETE /cards/:cardId/notes/:noteId
 * ═══════════════════════════════════════════════════════════════════════════ */

export async function loadNotes(cardId) {
  const r = await api(`/api/personal-kanban/cards/${cardId}/history`);
  return Array.isArray(r?.notes) ? r.notes : [];
}

export async function createNote(cardId, body) {
  const r = await api(`/api/personal-kanban/cards/${cardId}/notes`, {
    method: 'POST', body: { body }
  });
  return r?.item || r;
}

export async function updateNoteText(cardId, noteId, body) {
  const r = await api(`/api/personal-kanban/cards/${cardId}/notes/${noteId}`, {
    method: 'PUT', body: { body }
  });
  return r?.item || r;
}

export async function updateNotePosition(cardId, noteId, pos_x, pos_y) {
  const r = await api(`/api/personal-kanban/cards/${cardId}/notes/${noteId}/position`, {
    method: 'PATCH', body: { pos_x, pos_y }
  });
  return r?.item || r;
}

export async function deleteNote(cardId, noteId) {
  return await api(`/api/personal-kanban/cards/${cardId}/notes/${noteId}`, {
    method: 'DELETE'
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Контрагенты (customers) — паритет с vanilla personal_kanban.js:3554..3742
 *   GET    /api/customers?search=&limit=
 *   GET    /api/customers/:inn
 *   GET    /api/customers/lookup/:inn  (dadata/ЕГРЮЛ)
 *   POST   /api/customers              { inn, name, ... }
 * ═══════════════════════════════════════════════════════════════════════════ */

export async function searchCustomers(query) {
  const q = (query || '').trim();
  const qs = q.length >= 2
    ? `?search=${encodeURIComponent(q)}&limit=50`
    : '?limit=30';
  const r = await api('/api/customers' + qs);
  return Array.isArray(r?.customers) ? r.customers : [];
}

export async function lookupCustomerByInn(inn) {
  // {found, suggestion:{inn,name,full_name,kpp,ogrn,address}, message?}
  return await api('/api/customers/lookup/' + encodeURIComponent(inn));
}

export async function getCustomerByInn(inn) {
  return await api('/api/customers/' + encodeURIComponent(inn));
}

export async function createCustomer(payload) {
  return await api('/api/customers', { method: 'POST', body: payload });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Patch card fields (customer_*, work_*, contact_*) — backend whitelist в
 * /cards/:cardId/update (см. routes/personal-kanban.js / vanilla строка 4290).
 * ═══════════════════════════════════════════════════════════════════════════ */

export async function patchCard(cardId, patch) {
  return await api(`/api/personal-kanban/cards/${cardId}/update`, {
    method: 'POST', body: patch
  });
}
