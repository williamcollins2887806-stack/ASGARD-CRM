/**
 * API-клиент страницы /correspondence — реестр входящей/исходящей переписки с заказчиками.
 *
 * Источник: vanilla `public/assets/js/correspondence.js` (1301 строки после S-11A) +
 * backend `src/routes/correspondence.js` (создание/правка/by-parent/finalize/delete) +
 * `src/routes/letter.js` (PDF/DOCX render + new-revision) +
 * `src/routes/data.js` для generic list/get.
 *
 * RBAC: 9 ролей (см. _LETTER_CONTRACT.md §5):
 *   - ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV    — full + delete (только GEN+ADMIN)
 *   - OFFICE_MANAGER                                      — full доступ кроме edit-text и delete
 *   - PM, HEAD_PM, TO, HEAD_TO                            — view + create + edit/finalize/new-revision «своих»
 *
 * Endpoints:
 *   GET    /api/data/correspondence              — список (generic, фильтр deleted_at в бэке)
 *   GET    /api/data/correspondence/:id          — детали (generic)
 *   GET    /api/correspondence/by-parent         — список по тендеру/работе/просчёту/заявке (с RBAC и full join)
 *   POST   /api/correspondence                   — создать (для outgoing draft — БЕЗ номера до finalize)
 *   PUT    /api/correspondence/:id               — править (только draft)
 *   GET    /api/correspondence/next-outgoing-number?date=YYYY-MM-DD — preview
 *   POST   /api/correspondence/:id/finalize      — alias на /api/letter/:id/finalize
 *   POST   /api/letter/:id/new-revision          — создать новую редакцию (draft + v+1)
 *   POST   /api/letter/:id/render/pdf            — отрендерить PDF (опц. ?with_signature=1&with_stamp=1)
 *   POST   /api/letter/:id/render/docx           — отрендерить DOCX
 *   POST   /api/correspondence/:id/link-doc      — привязать загруженный документ
 *   POST   /api/files/upload                     — мульти-парт загрузка файла
 *   DELETE /api/correspondence/:id               — soft delete (ADMIN/DIRECTOR_GEN only)
 *   GET    /api/customers / /api/tenders / /api/works / /api/users — справочники
 */
import { api } from '@/api/client';

/* ─────────────────────── RBAC ─────────────────────── */

export const CORR_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'OFFICE_MANAGER', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO'
];

// Полный доступ к ЧУЖИМ письмам в реестре (видят всё, могут открывать).
export const FULL_ACCESS_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'];

// Soft delete: только ADMIN + DIRECTOR_GEN (см. §5).
export const DELETE_ROLES = ['ADMIN', 'DIRECTOR_GEN'];

// Могут финализировать любое чужое письмо (OFFICE_MANAGER — НЕ может, см. §5).
export const FINALIZE_ANY_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

// Могут отправлять email + рендерить PDF/Word: те же что FINALIZE_ANY + OFFICE_MANAGER.
export const SEND_EMAIL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'];

function _hasRole(user, list) {
  if (!user) return false;
  if (list.includes(user.role)) return true;
  if (Array.isArray(user.roles)) return user.roles.some((r) => list.includes(r));
  return false;
}

export function hasAccess(user) {
  return _hasRole(user, CORR_ROLES);
}

export function hasFullAccess(user) {
  return _hasRole(user, FULL_ACCESS_ROLES);
}

export function canDelete(user) {
  return _hasRole(user, DELETE_ROLES);
}

export function canFinalizeAny(user) {
  return _hasRole(user, FINALIZE_ANY_ROLES);
}

/** PM/HEAD_PM/TO/HEAD_TO — view-only по умолчанию (видит свои письма + создаёт). */
export function isViewOnlyRole(user) {
  return hasAccess(user) && !hasFullAccess(user);
}

/**
 * «Моё» письмо для PM/TO — created_by==me ИЛИ родительская сущность под моим управлением.
 * Backend by-parent уже фильтрует выдачу для PM/TO/HEAD_*, но дублируем гард на фронте
 * для render'а action-кнопок и view-only пользователей.
 */
export function isOwnItem(user, item) {
  if (!user || !item) return false;
  const uid = Number(user.id);
  if (Number(item.created_by) === uid) return true;
  const ownerFields = [
    'responsible_pm_id', 'assigned_pm_id', 'pm_id',
    'calculator_user_id', 'to_user_id', 'head_to_user_id', 'head_pm_user_id'
  ];
  for (const f of ownerFields) {
    if (item[f] != null && Number(item[f]) === uid) return true;
  }
  return false;
}

/** Edit (текст черновика). OFFICE_MANAGER НЕ редактирует (по контракту §5). */
export function canEditItem(user, item) {
  if (!item) return false;
  // Финализированное/отправленное — никто не редактирует, только new-revision.
  if (item.signing_status && item.signing_status !== 'draft') return false;
  // OFFICE_MANAGER — НЕ редактирует (только просмотр + скачивание + send email).
  if (user && (user.role === 'OFFICE_MANAGER' || (Array.isArray(user.roles) && user.roles.includes('OFFICE_MANAGER')))) {
    return false;
  }
  if (_hasRole(user, ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])) return true;
  // PM/HEAD_PM/TO/HEAD_TO — только своё.
  return isOwnItem(user, item);
}

/** Финализировать draft → finalized (аллокация Исх.№). */
export function canFinalizeItem(user, item) {
  if (!item) return false;
  if (item.signing_status && item.signing_status !== 'draft') return false;
  if (item.direction !== 'outgoing') return false;
  if (canFinalizeAny(user)) return true;
  if (_hasRole(user, ['PM', 'HEAD_PM', 'TO', 'HEAD_TO'])) return isOwnItem(user, item);
  return false;
}

/** Создать новую редакцию (всегда от finalized/sent outgoing). */
export function canNewRevision(user, item) {
  if (!item) return false;
  if (!['finalized', 'sent'].includes(item.signing_status)) return false;
  if (item.direction !== 'outgoing') return false;
  if (canFinalizeAny(user)) return true;
  if (_hasRole(user, ['OFFICE_MANAGER'])) return true; // OFFICE_MANAGER может создавать редакции
  if (_hasRole(user, ['PM', 'HEAD_PM', 'TO', 'HEAD_TO'])) return isOwnItem(user, item);
  return false;
}

/** Скачать PDF / Word — для готовых outgoing-писем (finalized | sent). */
export function canDownloadLetter(user, item) {
  if (!item || item.direction !== 'outgoing') return false;
  if (!['finalized', 'sent'].includes(item.signing_status)) return false;
  if (!hasAccess(user)) return false;
  if (hasFullAccess(user)) return true;
  return isOwnItem(user, item);
}

/* ─────────────────────── Константы / справочники ─────────────────────── */

export const DIRECTIONS = {
  incoming: { label: 'Входящее',  icon: '📥', tone: 'info' },
  outgoing: { label: 'Исходящее', icon: '📤', tone: 'ok'   }
};

export const DIRECTION_OPTIONS = [
  { value: '',         label: 'Все' },
  { value: 'incoming', label: '📥 Входящие' },
  { value: 'outgoing', label: '📤 Исходящие' }
];

export const DOC_TYPES = [
  { value: 'letter',       label: '✉️ Письмо' },
  { value: 'request',      label: '❓ Запрос' },
  { value: 'response',     label: '💬 Ответ' },
  { value: 'contract',     label: '📜 Договор' },
  { value: 'act',          label: '📋 Акт' },
  { value: 'invoice',      label: '💰 Счёт' },
  { value: 'claim',        label: '⚠️ Претензия' },
  { value: 'notification', label: '📢 Уведомление' },
  { value: 'other',        label: '📄 Прочее' }
];

export const DOC_TYPE_OPTIONS = [{ value: '', label: 'Все типы' }, ...DOC_TYPES];

export const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

export const MONTH_OPTIONS = [{ value: '', label: 'Все' }, ...MONTHS.map((m, i) => ({ value: String(i), label: m }))];

// V252.signing_status — 3 состояния. Цвета через токены, без хардкода.
export const SIGNING_STATUS = {
  draft:     { label: 'Черновик',       icon: '✎', toneClass: 'muted' },
  finalized: { label: 'Финализировано', icon: '🔒', toneClass: 'info' },
  sent:      { label: 'Отправлено',     icon: '✉', toneClass: 'ok' }
};

export const SIGNING_STATUS_OPTIONS = [
  { value: '',          label: 'Все статусы' },
  { value: 'draft',     label: '✎ Черновики' },
  { value: 'finalized', label: '🔒 Финализировано' },
  { value: 'sent',      label: '✉ Отправлено' }
];

// V252.letter_kind — словарь типов письма (соответствует settings.letter_kinds).
export const LETTER_KINDS = {
  clarification: 'Пояснения к ценовому предложению',
  request:       'Запрос',
  response:      'Ответ на запрос',
  notification:  'Уведомление',
  claim:         'Претензия',
  warranty:      'Гарантийное письмо',
  cover:         'Сопроводительное письмо',
  information:   'Информационное письмо',
  free:          'Свободный формат'
};

export function getSigningStatus(key) {
  return SIGNING_STATUS[key] || SIGNING_STATUS.draft;
}

export function getLetterKindLabel(key) {
  return key && LETTER_KINDS[key] ? LETTER_KINDS[key] : '';
}

export function getDocTypeInfo(type) {
  return DOC_TYPES.find((t) => t.value === type) || { value: type, label: '📄 ' + (type || 'Прочее') };
}

export function getDirInfo(dir) {
  return DIRECTIONS[dir] || DIRECTIONS.incoming;
}

/** Лейбл для бейджа фильтра по родителю (parent_entity_type → читаемое имя). */
export function getParentEntityLabel(type) {
  switch (type) {
    case 'tender':     return { icon: '🎯', label: 'тендеру' };
    case 'work':       return { icon: '📌', label: 'работе' };
    case 'calc':       return { icon: '📊', label: 'просчёту' };
    case 'pre_tender':
    case 'request':    return { icon: '📨', label: 'заявке' };
    default:           return { icon: '🔗', label: type || 'сущности' };
  }
}

/* ─────────────────────── List / read ─────────────────────── */

export function loadCorrespondence(limit = 5000) {
  // Generic data endpoint — soft-delete фильтр обрабатывает бэк.
  return api(`/api/data/correspondence?limit=${limit}`)
    .then((d) => Array.isArray(d) ? d : (d?.items || d?.rows || []))
    .catch(() => []);
}

/**
 * Список писем по родительской сущности (с RBAC и full join из backend).
 * @param {object} args { parent_entity_type, parent_entity_id, direction?, signing_status?, only_current? }
 * @returns {Promise<{items: object[], total: number}>}
 */
export function loadCorrespondenceByParent(args) {
  const p = new URLSearchParams();
  if (args.parent_entity_type) p.set('parent_entity_type', args.parent_entity_type);
  if (args.parent_entity_id)   p.set('parent_entity_id',   String(args.parent_entity_id));
  if (args.direction)          p.set('direction',          args.direction);
  if (args.signing_status)     p.set('signing_status',     args.signing_status);
  if (args.only_current === false) p.set('only_current', '0');
  if (args.limit)  p.set('limit',  String(args.limit));
  if (args.offset) p.set('offset', String(args.offset));
  return api(`/api/correspondence/by-parent?${p.toString()}`)
    .then((d) => ({ items: d?.items || [], total: d?.total ?? (d?.items?.length || 0) }))
    .catch(() => ({ items: [], total: 0 }));
}

export function loadOne(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/data/correspondence/${_id}`)
    .then((d) => d?.item || d?.row || d || null)
    .catch(() => null);
}

export function getNextOutgoingNumber(date) {
  const url = date
    ? `/api/correspondence/next-outgoing-number?date=${encodeURIComponent(date)}`
    : '/api/correspondence/next-outgoing-number';
  return api(url)
    .then((d) => d?.number || '')
    .catch(() => '');
}

/* ─────────────────────── Write (CRUD + state machine) ─────────────────────── */

export function createCorrespondence(payload) {
  return api('/api/correspondence', { method: 'POST', body: payload });
}

/** Alias для обратной совместимости — используется в CorrFormModal. */
export const createOne = createCorrespondence;

export function updateCorrespondence(id, payload) {
  const _id = encodeURIComponent(id);
  return api(`/api/correspondence/${_id}`, { method: 'PUT', body: payload });
}
export const updateOne = updateCorrespondence;

/**
 * Финализация черновика — аллокация Исх.№ + блокировка от редактирования.
 * Backend: POST /api/correspondence/:id/finalize → alias на /api/letter/:id/finalize.
 */
export function finalizeCorrespondence(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/correspondence/${_id}/finalize`, { method: 'POST', body: {} });
}

/**
 * Создать новую редакцию от уже finalized|sent письма.
 * Backend: POST /api/letter/:id/new-revision { revision_note? }.
 */
export function createNewRevision(id, note) {
  const _id = encodeURIComponent(id);
  const body = note ? { revision_note: note } : {};
  return api(`/api/letter/${_id}/new-revision`, { method: 'POST', body });
}

/**
 * Soft delete (только ADMIN + DIRECTOR_GEN).
 * Backend: DELETE /api/correspondence/:id (RBAC-проверка в route).
 */
export function deleteCorrespondence(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/correspondence/${_id}`, { method: 'DELETE' });
}
export const deleteOne = deleteCorrespondence;

/* ─────────────────────── Render PDF / DOCX ─────────────────────── */

/** Возвращает URL для openProtected/downloadProtected. С опциями подпись/печать. */
export function letterRenderUrl(id, format, opts = {}) {
  const params = new URLSearchParams();
  if (opts.with_signature !== undefined) params.set('with_signature', opts.with_signature ? '1' : '0');
  if (opts.with_stamp     !== undefined) params.set('with_stamp',     opts.with_stamp     ? '1' : '0');
  const qs = params.toString();
  return `/api/letter/${encodeURIComponent(id)}/render/${format}${qs ? '?' + qs : ''}`;
}

/** Имя файла для скачивания на основе номера или id (без запрещённых символов). */
export function letterFileBase(item) {
  const base = item?.number || ('letter-' + (item?.id || 'new'));
  return String(base).replace(/[\\\/\:\*\?"<>\|]/g, '_');
}

/* ─────────────────────── Link doc / Upload ─────────────────────── */

export function linkDoc(id, documentId) {
  const _id = encodeURIComponent(id);
  return api(`/api/correspondence/${_id}/link-doc`, {
    method: 'POST',
    body: { document_id: documentId }
  });
}

/* Mimir AI autofill — для CorrFormModal (заполняет subject/note/counterparty/contact). */
export function mimirSuggestForm(ctx) {
  return api('/api/mimir/suggest-form', {
    method: 'POST',
    body: { form_type: 'correspondence', context: ctx }
  });
}

export async function uploadFile(file, label = 'Корреспонденция') {
  const token = localStorage.getItem('asgard_token') || '';
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', label);
  const resp = await fetch('/api/files/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  if (!resp.ok) throw new Error('Не удалось загрузить файл');
  return resp.json();
}

/* ─────────────────────── Reference data ─────────────────────── */

export function loadUsers() {
  return api('/api/users?is_active=true')
    .then((d) => Array.isArray(d) ? d : (d?.items || d?.users || []))
    .catch(() => []);
}

export function loadCustomers() {
  return api('/api/customers?limit=2000')
    .then((d) => Array.isArray(d) ? d : (d?.items || d?.customers || []))
    .catch(() => []);
}

export function loadTenders() {
  return api('/api/tenders?limit=2000')
    .then((d) => Array.isArray(d) ? d : (d?.items || d?.tenders || []))
    .catch(() => []);
}

export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => Array.isArray(d) ? d : (d?.items || d?.works || []))
    .catch(() => []);
}

/* ─────────────────────── Utils ─────────────────────── */

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('ru-RU');
}
