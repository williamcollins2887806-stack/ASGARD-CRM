/**
 * API-клиент страницы /tenders.
 * Источник истины — vanilla `public/assets/js/tenders.js` (4529 строк).
 * Эта обёртка собирает только методы, нужные React-каркасу.
 * Полная миграция модалок — в задачах для агентов.
 */
import { api } from '@/api/client';

export const TENDER_TYPES = [
  { value: 'commercial', label: 'Коммерческий' },
  { value: 'state',      label: 'Государственный' },
  { value: 'addendum',   label: 'Доп. объём' }
];

// КРИТИЧНО: backend хранит tender_status как RUSSIAN string (см. tenders.js:10-20
// TENDER_TRANSITIONS + :403 defaultStatuses + :477 VALID_TENDER_STATUSES).
// До этого фикса React слал english (won/lost/kp_sent) — backend отклонял 400,
// бейджи рендерились без tone (fallback 'info'), архив-фильтр не работал.
// 'Дозапрос' добавлен в S-13 (vanilla d97b6056) + backend S-13.1 (83287577).
export const TENDER_STATUSES = [
  { value: 'Черновик',                    label: 'Черновик' },
  { value: 'Новый',                       label: 'Новый' },
  { value: 'На анализе',                  label: 'На анализе' },
  { value: 'Отправлено на просчёт',       label: 'Отправлено на просчёт' },
  { value: 'Согласование ТКП',            label: 'Согласование ТКП' },
  { value: 'ТКП согласовано',             label: 'ТКП согласовано' },
  { value: 'Готово к отправке КП',        label: 'Готово к отправке КП' },
  { value: 'КП отправлено',               label: 'КП отправлено' },
  { value: 'Дозапрос',                    label: 'Дозапрос' },
  { value: 'Выиграли',                    label: 'Выиграли' },
  { value: 'Проиграли',                   label: 'Проиграли' },
  { value: 'Не подходит',                 label: 'Не подходит (архив)' }
];

// Карта статус → CSS-токен для цветной полоски/бейджа (хаб тендеров).
// Используем токены темы (без хардкод-цветов). 'Дозапрос' → var(--gold)
// (соответствует vanilla TENDER_STATUS_COLORS['Дозапрос'] = '#D4A843').
export const TENDER_STATUS_COLORS = {
  'Черновик':              'var(--t-4)',
  'Новый':                 'var(--info)',
  'На анализе':            'var(--purple)',
  'Отправлено на просчёт': 'var(--warn-t)',
  'Согласование ТКП':      'var(--warn-t)',
  'ТКП согласовано':       'var(--ok)',
  'Готово к отправке КП':  'var(--gold)',
  'КП отправлено':         'var(--info)',
  'Дозапрос':              'var(--gold)',
  'Выиграли':              'var(--ok)',
  'Проиграли':             'var(--err)',
  'Не подходит':           'var(--t-3)'
};

// Источник заявки/тендера (новое поле tenders.source_kind после V250 S-2).
// Лейблы и CSS-классы 1:1 с vanilla S-13 (tenders.js SOURCE_LABELS/SOURCE_CLS).
export const SOURCE_LABELS = {
  'platform':      '📡 Площадка',
  'email_invite':  '📧 Приглашение',
  'email_request': '📧 Письмо',
  'phone':         '📞 Звонок',
  'pm_manual':     '👤 От РП',
  'manual':        '🖐 Вручную'
};

export const SOURCE_CLS = {
  'platform':      'tnd-src-platform',
  'email_invite':  'tnd-src-email',
  'email_request': 'tnd-src-email',
  'phone':         'tnd-src-phone',
  'pm_manual':     'tnd-src-manual',
  'manual':        'tnd-src-manual'
};

export const SOURCE_OPTIONS = [
  { value: '', label: 'Все источники' },
  { value: 'platform',      label: '📡 Площадки' },
  { value: 'email_invite',  label: '📧 Приглашения' },
  { value: 'email_request', label: '📧 Письма' },
  { value: 'phone',         label: '📞 Звонки' },
  { value: 'pm_manual',     label: '👤 От РП' },
  { value: 'manual',        label: '🖐 Вручную' }
];

export const PERIOD_PRESETS = [
  { value: 'today',     label: 'Сегодня' },
  { value: 'week',      label: 'Неделя' },
  { value: 'month',     label: 'Месяц' },
  { value: 'quarter',   label: 'Квартал' },
  { value: 'year',      label: 'Год' },
  { value: 'all',       label: 'Всё время' }
];

// Backend /api/tenders-hub/feed принимает свой формат периода (3d/7d/30d/year/all).
// Используется для feed-запросов в applications/all табах.
export const HUB_PERIOD_PRESETS = [
  { value: 'all',  label: 'Все обращения' },
  { value: '3d',   label: '3 дня' },
  { value: '7d',   label: '7 дней' },
  { value: '30d',  label: '30 дней' },
  { value: 'year', label: 'За год' }
];

export function loadTenders(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 500));
  if (params.archived) q.set('archived', 'true');
  return api(`/api/tenders?${q.toString()}`).then((d) => d.tenders || d.items || []);
}

export function loadTags() {
  return api('/api/tenders/tags').then((d) => d.tags || d.items || []).catch(() => []);
}

export function loadWinPending() {
  return api('/api/tenders/win-pending').then((d) => d.tenders || d.items || []).catch(() => []);
}

export function loadKpReady() {
  return api('/api/tenders?status=kp_ready&limit=50').then((d) => d.tenders || d.items || []).catch(() => []);
}

export function loadUsers(role) {
  const q = role ? `?role=${role}&limit=200` : '?limit=200';
  return api('/api/users' + q).then((d) => d.users || d.items || []).catch(() => []);
}

export function loadAuthorHistory(tenderId) {
  return api(`/api/tenders/${tenderId}/author-history`).catch(() => ({ history: [] }));
}

export function postArchive(tenderId, payload) {
  return api(`/api/tenders/${tenderId}/archive`, { method: 'POST', body: payload });
}

export function postUnarchive(tenderId) {
  return api(`/api/tenders/${tenderId}/unarchive`, { method: 'POST', body: {} });
}

// E-2 fix: backend tenders.js:1020 ожидает PUT, не POST.
export function postChangeAuthor(tenderId, payload) {
  return api(`/api/tenders/${tenderId}/change-author`, { method: 'PUT', body: payload });
}

export function loadArchiveReasons() {
  return api('/api/tenders/archive-reasons').then((d) => d.reasons || d.items || []).catch(() => []);
}

/**
 * ZIP-архив тендерных документов — отмена выбора файлов из ранее загруженного архива.
 * Эквивалент vanilla tenders.js:2268. tenderId+sessionId — сервер удаляет временный архив.
 */
export function postArchiveCancel(tenderId, sessionId) {
  return api(`/api/tenders/${tenderId}/archive/${sessionId}/cancel`, {
    method: 'POST',
    body: {}
  });
}

/**
 * ZIP-архив — подтвердить выбранные файлы для прикрепления.
 * Эквивалент vanilla tenders.js:2286.
 * body: { selected_indices: number[], include_archive_too: boolean }
 */
export function postArchiveConfirm(tenderId, sessionId, payload) {
  return api(`/api/tenders/${tenderId}/archive/${sessionId}/confirm`, {
    method: 'POST',
    body: {
      selected_indices: payload?.selected_indices || [],
      include_archive_too: !!payload?.include_archive_too
    }
  });
}

/**
 * Создание Доп. объёма работы (addendum) после выигрыша тендера.
 * Эквивалент vanilla tenders.js:2832, POST /api/works/addendum.
 * body: { parent_work_id, work_title, contract_value, vat_pct, start_plan, end_plan,
 *         addendum_signed_date, addendum_reason }
 */
export function postWorksAddendum(payload) {
  return api('/api/works/addendum', {
    method: 'POST',
    body: {
      parent_work_id: payload?.parent_work_id,
      work_title: payload?.work_title || '',
      contract_value: payload?.contract_value ?? null,
      vat_pct: payload?.vat_pct ?? null,
      start_plan: payload?.start_plan || null,
      end_plan: payload?.end_plan || null,
      addendum_signed_date: payload?.addendum_signed_date || null,
      addendum_reason: payload?.addendum_reason || ''
    }
  });
}

export function filterByPeriod(tenders, period) {
  if (!period || period === 'all') return tenders;
  const now = Date.now();
  const day = 86400000;
  const cutoff = {
    today: now - day,
    week: now - 7 * day,
    month: now - 30 * day,
    quarter: now - 90 * day,
    year: now - 365 * day
  }[period];
  if (!cutoff) return tenders;
  return tenders.filter((t) => {
    const c = t.created_at && new Date(t.created_at).getTime();
    return Number.isFinite(c) && c >= cutoff;
  });
}

export function filterByQuery(tenders, q) {
  if (!q || !q.trim()) return tenders;
  const lq = q.trim().toLowerCase();
  return tenders.filter((t) =>
    (t.customer_name || '').toLowerCase().includes(lq) ||
    (t.tender_name || '').toLowerCase().includes(lq) ||
    String(t.id).includes(lq) ||
    (t.inn || '').includes(lq)
  );
}

export function filterByMatch(tenders, key, value) {
  if (!value) return tenders;
  return tenders.filter((t) => t[key] === value);
}

/* Note: было 8 функций-wrappers (lookupCustomer/Root, suggestCustomer, uploadFile,
 * downloadPassRequestPdf, uploadTenderArchive, loadTendersRoot, createTkp).
 * Удалены 2026-06-14 — ни одна не была импортирована из UI; добавлялись только
 * для накрутки coverage-audit метрик. При реализации соответствующих модалок
 * добавляйте функции рядом и сразу импортируйте их в UI-компонент.
 */

/* ─── Лента комментариев (vanilla tenders.js:2491-2576) ─── */
export function loadTenderComments(tenderId) {
  return api(`/api/tenders/${tenderId}/comments`).then((d) => d.comments || []).catch(() => []);
}

export function postTenderComment(tenderId, text) {
  return api(`/api/tenders/${tenderId}/comments`, { method: 'POST', body: { text } });
}

export function deleteTenderComment(tenderId, commentId) {
  return api(`/api/tenders/${tenderId}/comments/${commentId}`, { method: 'DELETE' });
}

/* ─── История изменений (vanilla tenders.js:3255 — читал IndexedDB audit_log).
   Бэкенд: GET /api/tenders/:id/history — выделенный безопасный endpoint
   (src/routes/tenders.js, добавлен 2026-06-15).
   audit_log напрямую через /api/data доступен только ADMIN/директорам,
   а через этот endpoint — всем ролям с доступом к тендеру (с PM-ownership-фильтром). */
export function loadTenderHistory(tenderId) {
  return api(`/api/tenders/${tenderId}/history`)
    .then((d) => d.history || d.rows || [])
    .catch(() => []);
}

/* author-history — отдельный endpoint (вспомогательный, для секции "Смена авторов"). */
export function loadAuthorHistoryFull(tenderId) {
  return api(`/api/tenders/${tenderId}/author-history`).then((d) => d.history || []).catch(() => []);
}

/* ─── Доп.соглашения (vanilla tenders.js:2797-2907).
   GET /api/tenders/:id отдаёт `addenda` массивом + сводки contract_value_main/_addenda/_total
   (см. src/routes/tenders.js:276-301). Создание идёт через POST /api/works/addendum. */
export function loadTenderWithAddenda(tenderId) {
  return api(`/api/tenders/${tenderId}`).catch(() => null);
}

export function createAddendum(payload) {
  return api('/api/works/addendum', {
    method: 'POST',
    body: {
      parent_work_id: payload?.parent_work_id,
      work_title: payload?.work_title || null,
      contract_value: payload?.contract_value ?? null,
      vat_pct: payload?.vat_pct ?? null,
      start_plan: payload?.start_plan || null,
      end_plan: payload?.end_plan || null,
      addendum_signed_date: payload?.addendum_signed_date || null,
      addendum_reason: payload?.addendum_reason || null
    }
  });
}

/* Soft-delete ДС идёт через DELETE /api/works/:id (works.js: soft-delete via deleted_at). */
export function deleteAddendum(workId) {
  return api(`/api/works/${workId}`, { method: 'DELETE' });
}

/* ─── Кнопки workflow в карточке ─── */

/* btnSentToClient (vanilla tenders.js:3823-3837): смена статуса на «КП отправлено».
   Бэкенд: PUT /api/tenders/:id { tender_status: 'КП отправлено' } (src/routes/tenders.js:434).
   В vanilla дополнительно вызывается AsgardTkpFollowup.activateFollowup — это
   локальный модуль для напоминаний; на сервере follow-up активируется триггером
   из tkp_followup-cron при смене статуса. */
export function markTenderSentToClient(tenderId) {
  return api(`/api/tenders/${tenderId}`, {
    method: 'PUT',
    body: { tender_status: 'КП отправлено' }
  });
}

/* btnCreateTkp (vanilla tenders.js:3808-3821): создать ТКП-черновик из тендера.
   На бэке: POST /api/tkp с tender_id + customer + subject (см. tkp-page.js openForm
   → /api/tkp POST). Возвращает id ТКП. */
export function createTkpFromTender({ tender_id, customer_name, customer_inn, subject }) {
  return api('/api/tkp', {
    method: 'POST',
    body: {
      tender_id: tender_id || null,
      customer_name: customer_name || '',
      inn: customer_inn || '',
      subject: subject || '',
      items: [],
      validity_days: 30,
      payment_preset: '100_post'
    }
  });
}

/* ─── Конфликты дат для WinAssignPanel ─── */
/* Берём существующие работы выбранного РП через /api/works?pm_id=X — фильтруем те,
   у которых интервал [start_plan..end_plan] пересекается с интервалом тендера. */
export function loadWorksForPm(pmId) {
  return api(`/api/works?pm_id=${encodeURIComponent(pmId)}&limit=500`).then((d) => d.works || []).catch(() => []);
}

/* Запрос override для назначения РП с конфликтом.
   Бэкенд: POST /api/tenders/:id/request-assign-override (src/routes/tenders.js, добавлен 2026-06-15).
   Доступен TO/HEAD_TO/HEAD_PM/ADMIN/директорам. Пишет audit_log + уведомляет директоров через
   createNotification (без ADMIN-only ограничения /notify-role). */
export function requestAssignOverride({ tender_id, pm_id, pm_name, reason, conflicts }) {
  return api(`/api/tenders/${tender_id}/request-assign-override`, {
    method: 'POST',
    body: {
      pm_id: Number(pm_id),
      pm_name: pm_name || '',
      reason: String(reason || '').trim(),
      conflicts: Array.isArray(conflicts) ? conflicts.map((c) => ({
        id: c.id, work_title: c.work_title, dates: c.dates
      })) : []
    }
  });
}

/* ─── Bulk-операции в реестре ─── */
/* Backend: DELETE /api/tenders/:id (src/routes/tenders.js:600) — soft-delete только ADMIN. */
export function deleteTender(tenderId) {
  return api(`/api/tenders/${tenderId}`, { method: 'DELETE' });
}

/* ─── Inline upload файла к существующему тендеру (vanilla btnAddDoc).
   Бэкенд: POST /api/files/upload (src/routes/files.js) — multipart с tender_id + type. */
export function uploadTenderFile(tenderId, file, type = 'Документ') {
  const token = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || '';
  const fd = new FormData();
  fd.append('file', file);
  fd.append('tender_id', String(tenderId));
  fd.append('type', type);
  return fetch('/api/files/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  }).then((r) => {
    if (!r.ok) return r.json().then((d) => { throw new Error(d?.error || `HTTP ${r.status}`); });
    return r.json();
  });
}

/* btnAddLink — ссылку добавляем как «документ» c file_url через generic POST /api/data/documents.
   Колонки documents (V001): original_name, type='Ссылка', tender_id, file_url, download_url. */
export function addTenderLink(tenderId, name, url) {
  return api('/api/data/documents', {
    method: 'POST',
    body: {
      tender_id: tenderId,
      original_name: name || url,
      filename: name || url,
      type: 'Ссылка',
      file_url: url,
      download_url: url,
      mime_type: 'text/uri-list',
      size: 0
    }
  });
}

/* Документы текущего тендера (для inline-списка после загрузки).
   Используем выделенный /api/files (с каскадом по дочерним работам). */
export function loadTenderDocs(tenderId) {
  return api(`/api/files?tender_id=${tenderId}&limit=200&cascade=false`)
    .then((d) => d.files || d.rows || d.items || [])
    .catch(() => []);
}

/* DELETE документа — files.js: DELETE /:id. */
export function deleteTenderDoc(docId) {
  return api(`/api/files/${docId}`, { method: 'DELETE' });
}

/* ─── Поиск дубликатов перед submit'ом нового тендера ────────────────────────
   Backend: GET /api/tenders/find-duplicates?customer_inn=&customer=&subject=&amount=
   (см. src/routes/tenders.js, добавлено 2026-06-15).
   Возвращает { exact: [...], similar: [...] } — где exact блокирует submit,
   similar — warning.
   Соответствует vanilla findDuplicates (tenders.js:243). */
export function findTenderDuplicates({ customer_inn, customer, subject, amount }) {
  const q = new URLSearchParams();
  if (customer_inn) q.set('customer_inn', String(customer_inn));
  if (customer) q.set('customer', String(customer));
  if (subject) q.set('subject', String(subject));
  if (amount != null && Number.isFinite(Number(amount))) q.set('amount', String(amount));
  return api('/api/tenders/find-duplicates?' + q.toString(), { silent: true })
    .then((d) => ({ exact: d?.exact || [], similar: d?.similar || [] }))
    .catch(() => ({ exact: [], similar: [] }));
}

/* ─── Создание контрагента inline из tender wizard ─────────────────────────
   Backend: POST /api/customers (см. src/routes/customers.js:151).
   Соответствует vanilla promptCreateCustomer (tenders.js:2943).
   ⚠️ ИНН + наименование — обязательны. */
export function createCustomerFromTender(payload) {
  return api('/api/customers', {
    method: 'POST',
    body: {
      inn: String(payload?.inn || '').replace(/\D/g, ''),
      name: String(payload?.name || '').trim(),
      full_name: String(payload?.full_name || '').trim() || null,
      kpp: String(payload?.kpp || '').replace(/\D/g, '').slice(0, 9) || null,
      email: String(payload?.email || '').trim() || null,
      phone: String(payload?.phone || '').trim() || null,
      address: String(payload?.address || '').trim() || null,
      contact_person: String(payload?.contact_person || '').trim() || null
    }
  });
}

/* ─── Tenders-Hub feed (S-7 backend /api/tenders-hub/feed) ─────────────────
   UNION ALL по 4 источникам: tenders + pre_tender_requests +
   inbox_applications + call_history. Контракт см. INV-4 §2.
   Все params опциональны, backend применяет RBAC по роли. */
export function loadHubFeed(params = {}) {
  const q = new URLSearchParams();
  if (params.tab)     q.set('tab', String(params.tab));
  if (params.subtab)  q.set('subtab', String(params.subtab));
  if (params.period)  q.set('period', String(params.period));
  if (params.search)  q.set('search', String(params.search));
  if (params.status)  q.set('status', String(params.status));
  if (params.type)    q.set('type', String(params.type));
  if (params.source)  q.set('source', String(params.source));
  if (params.resp)    q.set('resp', String(params.resp));
  q.set('limit',  String(params.limit  ?? 200));
  q.set('offset', String(params.offset ?? 0));
  return api('/api/tenders-hub/feed?' + q.toString())
    .then((d) => ({
      items:  d.items  || [],
      total:  Number(d.total) || 0,
      limit:  Number(d.limit) || 0,
      offset: Number(d.offset) || 0,
      role:   d.role || ''
    }))
    .catch(() => ({ items: [], total: 0, limit: 0, offset: 0, role: '' }));
}

/* PUT /api/tenders/:id/status — state-machine переход (S-13.1 backend 83287577).
   Используется для кнопок «❓ Дозапрос» / «📤 Ответили» в новом ContextActions
   (vanilla actionsForStatus). Старый PUT /:id тоже работает для смены статуса,
   но /status валидирует TENDER_TRANSITIONS на сервере. */
export function putTenderStatus(tenderId, newStatus, note) {
  return api(`/api/tenders/${tenderId}/status`, {
    method: 'PUT',
    body: {
      tender_status: newStatus,
      note: note || null
    }
  });
}

/* ─── Обновление рейтинга заказчика ────────────────────────────────────────
   Backend: PUT /api/customers/:inn/score (см. src/routes/customers.js, добавлено 2026-06-15).
   Соответствует vanilla updateCustomerScore (tenders.js:2773).
   body: { event, amount?, ref_type?, ref_id?, meta? }.
   Возвращает { score, events_count, last_events }. */
export function updateCustomerScore(inn, payload) {
  const cleanInn = String(inn || '').replace(/\D/g, '');
  if (!cleanInn) return Promise.resolve(null);
  return api(`/api/customers/${cleanInn}/score`, {
    method: 'PUT',
    body: {
      event: payload?.event,
      amount: payload?.amount ?? null,
      ref_type: payload?.ref_type || null,
      ref_id: payload?.ref_id ?? null,
      meta: payload?.meta || null
    },
    silent: true
  }).catch(() => null);
}
