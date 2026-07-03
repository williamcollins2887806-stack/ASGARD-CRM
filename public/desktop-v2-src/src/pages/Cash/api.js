/**
 * API-клиент страницы /cash — Казна Дружины (РП-карточка).
 * Источник: vanilla `public/assets/js/cash.js` (797 строк).
 * Backend: src/routes/cash.js (prefix /api/cash).
 *
 * Vanilla endpoint mappings:
 *   '/api/cash/' (vanilla: fetch('/api/cash/' + id)) → '/api/cash/:id' (loadRequest)
 *   '/api/cash/:id/receipt/:id' (vanilla: receipt_file URL) → receiptDownloadUrl()
 */
import { api } from '@/api/client';

export const STATUS_LABELS = {
  requested:    'Ожидает',
  approved:     'Согласовано',
  money_issued: 'Деньги выданы',
  received:     'Получено',
  reporting:    'Отчёт',
  closed:       'Закрыто',
  rejected:     'Отклонено',
  question:     'Вопрос'
};

export const STATUS_TONE = {
  requested:    'warn',
  approved:     'ok',
  money_issued: 'info',
  received:     'info',
  reporting:    'info',
  closed:       'draft',
  rejected:     'err',
  question:     'warn'
};

// Stage W — loan УБРАН. Остаётся advance + office + other.
export const TYPE_LABELS = {
  advance: 'Аванс на проект',
  office:  'Офисный расход',
  other:   'Прочее'
};

export const TYPE_OPTIONS = [
  { value: 'advance', label: 'Аванс на проект' },
  { value: 'office',  label: 'Офисный расход' },
  { value: 'other',   label: 'Прочее' }
];

/**
 * Stage W — 12 категорий расходов (CategoryGrid).
 * `code` совпадает с backend CHECK-ограничением cash_requests.category.
 * 'other' требует поля `category_other_desc` (см. CreateRequestModal).
 */
export const CASH_CATEGORIES = [
  { code: 'fuel_service',     icon: '⛽', label: 'ГСМ служ.' },
  { code: 'fuel_personal',    icon: '⛽', label: 'ГСМ личн.' },
  { code: 'taxi',             icon: '🚕', label: 'Такси' },
  { code: 'accommodation',    icon: '🏨', label: 'Проживание' },
  { code: 'food_brigade',     icon: '🍲', label: 'Продукты бригаде' },
  { code: 'materials',        icon: '🧱', label: 'Материалы' },
  { code: 'tool',             icon: '🔧', label: 'Инструмент' },
  { code: 'tech_rent',        icon: '🚛', label: 'Аренда техники' },
  { code: 'communication',    icon: '📞', label: 'Связь/интернет' },
  { code: 'representational', icon: '🥂', label: 'Представительские' },
  { code: 'urgent_repair',    icon: '🚨', label: 'Срочный ремонт' },
  { code: 'other',            icon: '📦', label: 'Другое' }
];

// Legacy-список расходов для расшифровки в DetailModal — оставляем для совместимости с старыми записями.
export const EXPENSE_CATEGORIES = [
  ...CASH_CATEGORIES.map((c) => ({ value: c.code, label: c.label, icon: c.icon })),
  // backward compat for older expenses
  { value: 'transport', label: 'Транспорт',  icon: '🚗' },
  { value: 'food',      label: 'Питание',    icon: '🍽️' },
  { value: 'housing',   label: 'Проживание', icon: '🏨' },
  { value: 'tools',     label: 'Инструмент', icon: '🔧' },
  { value: 'fuel',      label: 'Топливо',    icon: '⛽' }
];

export const CATEGORY_BY_VALUE = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, c]));

// Step order — money_issued добавлен между approved и received
export const ADVANCE_STEPS = ['requested', 'approved', 'money_issued', 'received', 'reporting', 'closed'];
export const LOAN_STEPS    = ['requested', 'approved', 'money_issued', 'received', 'closed'];
export const STEP_LABELS = {
  requested:    'Заявка',
  approved:     'Согласов.',
  money_issued: 'Выдано',
  received:     'Получено',
  reporting:    'Отчёт',
  closed:       'Закрыто'
};

// ─────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────

/** GET /api/cash/my-balance — баланс пользователя (виджет). */
export function loadMyBalance() {
  return api('/api/cash/my-balance');
}

/** GET /api/cash/my — заявки пользователя. */
export function loadMyRequests() {
  return api('/api/cash/my');
}

/**
 * GET /api/handovers?year=X&month=Y — handovers от СЗ текущему РП.
 *
 * Бэкенд (src/routes/handovers.js GET /) ограничивает PM-роль своими записями
 * через `pm_user_id = req.user.id`, поэтому фронт просто получает уже отфильтрованный список.
 * year/month опциональны: без них вернутся все записи РП (limit 500).
 *
 * Используется в `Cash/index.jsx` для объединённой ленты «Касса + От СЗ».
 */
export function loadMyHandovers(year, month) {
  const q = [];
  if (year != null && year !== '')   q.push(`year=${encodeURIComponent(year)}`);
  if (month != null && month !== '') q.push(`month=${encodeURIComponent(month)}`);
  const qs = q.length ? '?' + q.join('&') : '';
  return api(`/api/handovers${qs}`)
    .then((d) => (Array.isArray(d?.handovers) ? d.handovers : []))
    .catch(() => []);
}

/**
 * POST /api/handovers/manual — РП сам зафиксировал получение нала от СЗ.
 *
 * Спека: API_SPEC_BULK_SE.md раздел 3.
 * body: { worker_id, work_id?, amount, year, month, note? }
 * response: { handover, warning? }
 *
 * silent:true — модалка отображает результат сама (включая warning о pending).
 */
export function createManualHandover(body) {
  return api('/api/handovers/manual', { method: 'POST', body, silent: true });
}

/**
 * GET /api/employees?is_self_employed=true — список СЗ для селекта в ReceiveFromSeModal.
 * Совпадает с loadSelfEmployedEmployees (расширенный объект),
 * но возвращает только {id, full_name} — для лёгкого селекта.
 */
export function loadSeWorkersLite() {
  const parse = (d) => {
    const arr = Array.isArray(d) ? d
      : Array.isArray(d?.employees) ? d.employees
      : Array.isArray(d?.items) ? d.items
      : [];
    return arr
      .filter((e) => e.is_self_employed === true || e.is_self_employed === 1)
      .map((e) => ({
        id: Number(e.id),
        full_name: e.full_name || e.fio || e.name || `СЗ #${e.id}`
      }))
      .filter((e) => Number.isFinite(e.id));
  };
  return api('/api/employees?is_self_employed=true&limit=500')
    .then(parse)
    .catch(() =>
      api('/api/staff/employees?is_self_employed=true&limit=500')
        .then(parse)
        .catch(() => [])
    );
}

/** GET /api/cash/:id — детали заявки (доступно владельцу/BUH/директору). */
export function loadRequest(id) {
  return api(`/api/cash/${id}`);
}

/** POST /api/cash — создать заявку (advance/loan). */
export function createRequest(payload) {
  return api('/api/cash', { method: 'POST', body: payload });
}

/** PUT /api/cash/:id/receive — РП подтверждает получение денег. */
export function confirmReceive(id) {
  return api(`/api/cash/${id}/receive`, { method: 'PUT' });
}

/** PUT /api/cash/:id/submit-report — РП подаёт авансовый отчёт. */
export function submitReport(id) {
  return api(`/api/cash/${id}/submit-report`, { method: 'PUT' });
}

/** POST /api/cash/:id/return — возврат остатка. */
export function returnRemainder(id, body) {
  return api(`/api/cash/${id}/return`, { method: 'POST', body });
}

/** POST /api/cash/:id/reply — ответ РП на вопрос директора. */
export function replyToQuestion(id, message) {
  return api(`/api/cash/${id}/reply`, { method: 'POST', body: { message } });
}

/** DELETE /api/cash/:id/expense/:expenseId — удалить расход. */
export function deleteExpense(id, expenseId) {
  return api(`/api/cash/${id}/expense/${expenseId}`, { method: 'DELETE' });
}

/** GET /api/works — список работ для выбора проекта. */
export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || d || [])
    .catch(() => []);
}

/**
 * Stage W — список СЗ с остатком лимита.
 * Бэк-эндпоинт по контракту STAGE_W_CONTRACT.md:
 *   GET /api/employees?is_self_employed=true
 * На текущей кодовой базе employees доступны через /api/staff/employees,
 * поэтому мы пробуем оба варианта (с дефолтом на /staff/employees) и фильтруем
 * is_self_employed на клиенте — это страховка пока бэкенд (Agent A) не доедет.
 * Возвращает массив {id, full_name, agreement_limit, agreement_used, agreement_remainder}.
 */
export function loadSelfEmployedEmployees() {
  const parse = (d) => {
    const arr = Array.isArray(d) ? d
      : Array.isArray(d?.employees) ? d.employees
      : Array.isArray(d?.items) ? d.items
      : [];
    return arr
      .filter((e) => e.is_self_employed === true || e.is_self_employed === 1)
      .map((e) => {
        const limit = Number(e.agreement_limit ?? e.se_limit ?? 0) || 0;
        const used  = Number(e.agreement_used  ?? e.se_used  ?? 0) || 0;
        const remainder = e.agreement_remainder != null
          ? Number(e.agreement_remainder)
          : Math.max(0, limit - used);
        return {
          id: e.id,
          full_name: e.full_name || e.fio || e.name || `СЗ #${e.id}`,
          agreement_limit: limit,
          agreement_used: used,
          agreement_remainder: remainder
        };
      });
  };
  return api('/api/employees?is_self_employed=true&limit=500')
    .then(parse)
    .catch(() =>
      api('/api/staff/employees?is_self_employed=true&limit=500')
        .then(parse)
        .catch(() => [])
    );
}

/** Stage W — GET /api/cash/balance — для preview «сейчас → после». */
export function loadCashBalance() {
  return api('/api/cash/balance').catch(() => null);
}

/**
 * GET /api/cash/statement — банковская выписка РП.
 *
 * Контракт: API_SPEC_PM_STATEMENT.md раздел 1.
 * Возвращает { pm, period, summary, operations[] }.
 *
 *   • PM/HEAD_PM   — pm_id игнорируется бекендом, выписка только своя.
 *   • ADMIN / DIRECTOR / BUH — обязан передать pm_id (иначе backend вернёт ошибку).
 *
 * Опции from/to: ISO YYYY-MM-DD. Если не передать — backend подставит
 * первое число текущего месяца и сегодня.
 *
 * Ошибки 403/404/500 — пробрасываются, страница покажет toast + empty.
 */
export function loadStatement({ pm_id, from, to } = {}) {
  const q = new URLSearchParams();
  if (pm_id != null && pm_id !== '') q.set('pm_id', String(pm_id));
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const qs = q.toString();
  return api(`/api/cash/statement${qs ? '?' + qs : ''}`);
}

/**
 * Сформировать URL для скачивания XLSX-выписки.
 *
 * Использовать ТОЛЬКО через fetch+Authorization (см. StatementTable.jsx):
 * window.open() не передаст JWT и backend вернёт 401.
 */
export function getStatementXlsxUrl({ pm_id, from, to } = {}) {
  const q = new URLSearchParams({ format: 'xlsx' });
  if (pm_id != null && pm_id !== '') q.set('pm_id', String(pm_id));
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  return `/api/cash/statement?${q.toString()}`;
}

/**
 * GET /api/users?role=PM — список РП для селектора (ADMIN/DIR/BUH).
 *
 * Возвращает [{id, full_name}], сортировка по full_name (бэкенд).
 * Используется в StatementTable когда showPmSelector=true.
 */
export function loadPmsList() {
  return api('/api/users?role=PM&is_active=true&limit=500')
    .then((d) => {
      const arr = Array.isArray(d) ? d : (d?.users || d?.items || []);
      return arr.map((u) => ({
        id: Number(u.id),
        full_name: u.full_name || u.fio || u.name || `PM #${u.id}`
      })).filter((u) => Number.isFinite(u.id));
    })
    .catch(() => []);
}

/** POST /api/cash/:id/expense — добавить расход (multipart). */
export async function addExpense(id, formData) {
  let token = '';
  try { token = localStorage.getItem('asgard_token') || ''; } catch { /* noop */ }
  const r = await fetch(`/api/cash/${id}/expense`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: formData
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let err = '';
    try { err = JSON.parse(t).error || t; } catch { err = t; }
    throw new Error(err || `HTTP ${r.status}`);
  }
  return r.json();
}

/** Открыть чек в новой вкладке БЕЗ токена в URL (blob через Authorization header). */
export async function openReceipt(requestId, filename) {
  const { openProtected } = await import('@/api/download');
  return openProtected(`/api/cash/${requestId}/receipt/${encodeURIComponent(filename)}`, filename);
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

export function fmtMoney(val) {
  const n = Math.round(Number(val || 0));
  return new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
}

export function fmtDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function fmtDateTime(val) {
  if (!val) return '—';
  const d = new Date(val);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '—';
}

/** Подсчёт дедлайна — { hours, mins, isOverdue, color }. */
export function deadlineMeta(deadline, isOverdueFlag) {
  if (!deadline) return null;
  const deadDate = new Date(deadline);
  if (isOverdueFlag || deadDate < new Date()) {
    return { isOverdue: true, hours: 0, mins: 0, tone: 'err' };
  }
  const diff = deadDate - new Date();
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return {
    isOverdue: false,
    hours,
    mins,
    tone: hours < 2 ? 'err' : 'warn'
  };
}
