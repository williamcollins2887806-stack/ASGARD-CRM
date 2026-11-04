/**
 * ASGARD CRM - Universal Data API v2.3
 * Единый CRUD endpoint для всех таблиц
 * SECURITY: Добавлена ролевая матрица доступа (CRIT-3)
 */

const {
  shouldHideTestUsersFromLists,
} = require('../lib/user-filters');
const { recalcAnalysisDeadlinePatch } = require('../lib/analysis-deadline');
const { syncContractContactsToSupplier } = require('../services/contract-contact-sync');

/**
 * Нормализовать дату из тела запроса в 'YYYY-MM-DD'.
 * Понимает ISO ('2026-10-29'), ISO с временем, DD.MM.YYYY и Date.
 *
 * Зачем отдельная функция (верификатор 03.11.2026, P1-2): проверка запрета
 * «оф без прохода» сравнивала `String(date).slice(0,10)` с ISO-шаблоном, а
 * generic CRUD нормализовал DD.MM.YYYY ПОЗЖЕ. В итоге дата «29.10.2026»
 * проходила мимо проверки и записывалась в БД как 2026-10-29 — запрет
 * обходился форматом даты.
 */
/** Допустимый диапазон годов для дат в CRUD. Одна граница на весь файл. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
/**
 * Проверить числовые значения на переполнение типа колонки ДО запроса.
 *
 * ЗАЧЕМ (верификатор 03.11.2026, D-1): проверка была только для `staff_plan.staff_id`.
 * Любой другой integer-ключ (`work_id`, `employee_id`, `works.pm_id`,
 * `tasks.assignee_id`) с `2147483648` или `1e20` доезжал до драйвера и давал
 * SQLSTATE 22003 → HTTP 500 вместо понятного 400.
 *
 * @param {Array<{name:string, type?:string}>} columns — реальные типы из information_schema
 * @returns {{ok:boolean, field?:string, message?:string}}
 */
function validateIntegerColumns(data, columnTypes) {
  if (!data || typeof data !== 'object') return { ok: true };
  for (const key of Object.keys(data)) {
    const t = columnTypes && columnTypes[key];
    if (!t) continue;
    if (t !== 'integer' && t !== 'bigint' && t !== 'smallint') continue;
    const v = data[key];
    if (v === null || v === undefined || v === '') continue;
    let num;
    if (typeof v === 'number') {
      num = v;
    } else if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) {
      num = Number(v.trim());
    } else {
      // boolean/object/float-string раньше доезжали до драйвера:
      // true → 500 (не 1), "12.5" → 500. Верификатор 04.11.2026, P1.
      return {
        ok: false,
        field: key,
        message: `Поле ${key} должно быть целым числом`
      };
    }
    if (!Number.isFinite(num) || !Number.isInteger(num)) {
      return { ok: false, field: key, message: `Поле ${key} должно быть целым числом` };
    }
    const limit = t === 'smallint' ? 32767 : (t === 'bigint' ? Number.MAX_SAFE_INTEGER : MAX_INT4);
    const min = t === 'smallint' ? -32768 : (t === 'bigint' ? -Number.MAX_SAFE_INTEGER : -MAX_INT4 - 1);
    if (num > limit || num < min) {
      return {
        ok: false,
        field: key,
        message: `Значение поля ${key} вне допустимого диапазона (${t})`
      };
    }
  }
  return { ok: true };
}

/** Предел колонок типа integer (int4) — чтобы не получать 22003 из драйвера. */
const MAX_INT4 = 2147483647;

/**
 * Локальная метка времени 'YYYY-MM-DD HH:mm:ss' для колонок
 * `timestamp without time zone`.
 *
 * ЗАЧЕМ (верификатор 03.11.2026, D-5): generic CRUD писал `updated_at` через
 * `toISOString()` — это UTC. Все остальные пути (daily-presence, office-hours,
 * office-attendance) пишут `NOW()`, то есть локальное время. В окне 00:00–03:00
 * МСК outметка, поставленная через «График офиса», получала `updated_at::date`
 * на день раньше, `touched_today` в `/today` давал false, и гейт «где ты»
 * спрашивал заново при уже стоящей отметке.
 */
function localStamp(d) {
  const x = d instanceof Date ? d : new Date();
  if (Number.isNaN(x.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} `
    + `${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
}

/**
 * Метка времени ИЗ БД: 'YYYY-MM-DD HH:mm:ss' по часовому поясу сессии PostgreSQL.
 *
 * ЗАЧЕМ (верификатор 03.11.2026, D-5): `localStamp()` собирает компоненты
 * `new Date()` процесса Node. Если TZ Node и TZ сессии PG расходятся (на клоне
 * PG был Europe/Kiev, Node — Europe/Moscow), `updated_at` уезжал на час, а
 * `touched_today` в `/today` считал отметку «не сегодняшней» и гейт «где ты»
 * спрашивал повторно. Брать время надо у того, кто его потом читает — у БД.
 */
async function dbStamp(db) {
  try {
    const { rows } = await db.query(`SELECT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') AS ts`);
    if (rows[0] && rows[0].ts) return rows[0].ts;
  } catch (_) { /* ниже фолбэк */ }
  return localStamp();
}

/**
 * Существует ли такая календарная дата.
 * Общая проверка для валидации staff_plan и для санитайзера ниже, чтобы они
 * не жили по разным границам (верификатор 03.11.2026, P0: normalizeDateOnly
 * разрешал до 2999, а санитайзер рубил после 2100 и молча ставил date=NULL
 * с кодом 200 — ровно тот дефект, который объявили закрытым).
 */
function isValidCalendarDate(y, mo, d) {
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
  if (y < MIN_YEAR || y > MAX_YEAR) return false;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y
    && probe.getUTCMonth() === mo - 1
    && probe.getUTCDate() === d;
}

function normalizeDateOnly(value) {
  if (value == null || value === '') return null;
  let y; let mo; let d;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    y = value.getUTCFullYear();
    mo = value.getUTCMonth() + 1;
    d = value.getUTCDate();
  } else {
    const s = String(value).trim();
    // `$` обязателен: без него "2026-10-31junk" молча обрезался до даты.
    let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
    if (m) {
      y = +m[1]; mo = +m[2]; d = +m[3];
    } else {
      m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
      if (!m) return null;
      y = +m[3]; mo = +m[2]; d = +m[1];
    }
  }
  // ВАЛИДАЦИЯ КАЛЕНДАРЯ, а не только шаблона (верификатор 03.11.2026):
  // `"2026-13-45"` проходила regex, а общий санитайзер молча ставил date=NULL,
  // и запись сохранялась с 200.
  if (!isValidCalendarDate(y, mo, d)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Известные коды графика офиса — для нормализации регистра и пробелов. */
const OFFICE_STATUS_CODES = new Set([
  'оф', 'уд', 'об', 'км', 'пг', 'уч', 'ск', 'бн', 'сс', 'вх', 'отп', 'нп'
]);

/**
 * Привести код статуса к канону: убрать невидимые символы, обрезать пробелы,
 * опустить регистр.
 *
 * ЗАЧЕМ (верификатор 03.11.2026): `"оф\u200B"` (zero-width space) проходил
 * запрет — `String.trim()` не убирает U+200B, код не совпадал с 「оф」,
 * `isOfficeCode` возвращал false, а детектор (`lower(btrim())='оф'`) такую
 * строку не видел. В итоге «оф» без прохода СКУД записывался, день оставался
 * в норме с нулевым зачётом — ложная недоработка.
 */
function normalizeStatusCode(value) {
  if (value == null) return value;
  // Все невидимые: ZWSP, ZWNJ, ZWJ, BOM, word-joiner, мягкий перенос,
  // zero-width no-break, Mongolian vowel separator.
  const cleaned = String(value).replace(/[\u200B-\u200D\u2060\uFEFF\u00AD\u180E]/g, '');
  const trimmed = cleaned.trim();
  if (!trimmed) return trimmed;
  const lowered = trimmed.toLowerCase();
  return OFFICE_STATUS_CODES.has(lowered) ? lowered : trimmed;
}

/** Это код «в офисе» (с учётом регистра и пробелов)? */
function isOfficeCode(value) {
  return normalizeStatusCode(value) === 'оф';
}

/**
 * Итоговое состояние строки staff_plan после записи: сотрудник, дата, статус.
 * Нужно, чтобы проверять запрет «оф» при ЛЮБОМ изменении, а не только когда
 * в теле пришёл status_code='оф' (верификатор 03.11.2026, P1-3: обход был
 * двухшаговым — POST без даты, затем PUT только с датой).
 */
function resolvePlanState(data, current) {
  const src = data || {};
  const cur = current || {};
  // `staff_id: null` и мусор вроде "abc" не должны ни обнулять сотрудника,
  // ни доезжать до драйвера (верификатор 03.11.2026: PUT {staff_id:null} → 200
  // и строка теряла владельца; PUT {staff_id:"abc"} → 500).
  //
  // ВАЖНО: принимаем ТОЛЬКО целое число или числовую строку без хвоста.
  // `parseInt("123abc")` вернул бы 123 и молча подменил сотрудника, а в UPDATE
  // уехала бы исходная строка → 500 (верификатор 03.11.2026, P1).
  let staffId = cur.staff_id;
  let staffInvalid = false;
  if (Object.prototype.hasOwnProperty.call(src, 'staff_id')) {
    const raw = src.staff_id;
    if (raw === null || raw === '') {
      staffId = null;
    } else if (typeof raw === 'number') {
      staffId = Number.isInteger(raw) ? raw : NaN;
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      staffId = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
    } else {
      staffId = NaN;
    }
    // Колонка staff_id — integer (int4). Значение вне диапазона драйвер
    // отвергает с SQLSTATE 22003, и это выходило как 500 (верификатор
    // 03.11.2026, D-1): `2147483648`, `1e20`, длинная строка.
    // Валидируем диапазон здесь, чтобы получить понятный 400.
    if (Number.isFinite(staffId) && (staffId <= 0 || staffId > MAX_INT4)) {
      staffId = NaN;
    }
    staffInvalid = !Number.isFinite(staffId) || staffId <= 0;
  }
  // Канон — status_code. Legacy-колонка `status` тоже жива в схеме
  // (верификатор 04.11.2026, P2): POST/PUT {status:'оф'} и даже
  // {status:'оф', status_code:null} обходили гейт, пока смотрели только
  // status_code. Правило:
  //   • для ЗАПИСИ — непустой status_code, иначе непустой status, иначе null
  //     при явной очистке, иначе текущее;
  //   • для ГЕЙТА — officeAttempt, если ЛЮБОЕ непустое поле в теле = «оф»
  //     или итоговое значение = «оф».
  const hasCode = Object.prototype.hasOwnProperty.call(src, 'status_code');
  const hasLegacy = Object.prototype.hasOwnProperty.call(src, 'status');
  const normNonEmpty = (v) => {
    if (v == null) return null;
    const n = normalizeStatusCode(v);
    return (n == null || n === '') ? null : n;
  };
  const codeN = hasCode ? normNonEmpty(src.status_code) : undefined;
  const legN = hasLegacy ? normNonEmpty(src.status) : undefined;

  let status;
  if (hasCode && codeN != null) {
    status = codeN;
  } else if (hasLegacy && legN != null) {
    status = legN;
  } else if (hasCode || hasLegacy) {
    status = null; // явная очистка одного/обоих полей без непустого значения
  } else if (cur.status_code != null && String(cur.status_code).trim() !== '') {
    status = normalizeStatusCode(cur.status_code);
  } else {
    status = normNonEmpty(cur.status);
  }

  const officeAttempt = isOfficeCode(status)
    || (codeN != null && isOfficeCode(codeN))
    || (legN != null && isOfficeCode(legN));

  const rawDate = Object.prototype.hasOwnProperty.call(src, 'date') ? src.date : cur.date;
  // Различаем «дата не передана» и «передана невалидная»: в первом случае
  // берём текущую, во втором возвращаем invalid, чтобы отдать 400.
  const dateGiven = Object.prototype.hasOwnProperty.call(src, 'date');
  const date = normalizeDateOnly(rawDate);
  return {
    status,
    officeAttempt,
    staffId,
    staffInvalid,
    date,
    dateGiven,
    dateInvalid: dateGiven && rawDate != null && rawDate !== '' && date === null
  };
}

/**
 * Можно ли поставить «оф» этому сотруднику на эту дату.
 * Правило заказчика: если отчёт СКУД покрывает день и проходов нет — нельзя.
 * Если дня нет в импортах — данных ещё нет, не мешаем.
 *
 * @returns {{ok:boolean, reason?:string, skipped?:string}}
 */
async function assertOfficeConfirmed(db, staffIdRaw, dateRaw) {
  const staffId = parseInt(staffIdRaw, 10);
  const iso = normalizeDateOnly(dateRaw);
  if (!Number.isFinite(staffId) || !iso) {
    // Без даты или сотрудника судить не по чему — не блокируем, но и не
    // притворяемся, что проверили: вернём причину для логов.
    return { ok: true, skipped: 'no_staff_or_date' };
  }
  try {
    const { rows: hr } = await db.query(
      `SELECT office_minutes, manual_minutes
         FROM office_hours_daily WHERE staff_id = $1 AND date = $2::date`,
      [staffId, iso]
    );
    if (hr.length) {
      // Ручную правку офис-менеджера уважаем: он подтвердил часы вручную
      // (верификатор 03.11.2026, P2-1).
      const minutes = hr[0].manual_minutes != null
        ? Number(hr[0].manual_minutes)
        : Number(hr[0].office_minutes);
      if (minutes > 0) return { ok: true };
      return { ok: false, reason: 'office_not_confirmed' };
    }
    const { rows: cov } = await db.query(
      `SELECT 1 FROM skud_imports
        WHERE deleted_at IS NULL AND period_from <= $1::date AND period_to >= $1::date LIMIT 1`,
      [iso]
    );
    if (cov.length) return { ok: false, reason: 'office_not_confirmed' };
    return { ok: true, skipped: 'no_import_for_day' };
  } catch (e) {
    // Таблиц V453 может не быть до миграции — не ломаем график.
    if (e && e.code === '42P01') return { ok: true, skipped: 'no_table' };
    throw e;
  }
}

async function dataRoutes(fastify, options) {
  const db = fastify.db;

  // Поля согласования — только через /api/approval маршруты
  const APPROVAL_FIELDS = new Set(['approval_status','approval_comment','reject_reason','is_approved','approved_by','approved_at','sent_for_approval_at','decided_at','decided_by_user_id']);

  // SECURITY: Reject raw URLs containing injection characters (;, ..)
  // Fastify strips matrix parameters (;) and normalizes .., so we must check raw URL
  fastify.addHook('onRequest', async (request, reply) => {
    const rawUrl = request.raw.url || '';
    const rawPath = rawUrl.split('?')[0];
    // Decode URL-encoded characters to catch %2e%2e, %2f etc.
    let decoded;
    try { decoded = decodeURIComponent(rawPath); } catch(e) { decoded = rawPath; }
    if (decoded.includes('..') || decoded.includes(';') || rawPath.includes('..') || rawPath.includes(';')) {
      return reply.code(400).send({ error: 'Недопустимый запрос' });
    }
  });

  // Разрешённые таблицы (защита от SQL injection)
  const ALLOWED_TABLES = [
    'users', 'settings', 'tenders', 'estimates', 'works',
    'work_assign_requests', 'pm_consents', 'work_expenses', 'office_expenses',
    'correspondence', 'travel_expenses', 'incomes', 'calendar_events',
    'contracts', 'seals', 'seal_transfers', 'employee_permits', 'bonus_requests',
    'sync_meta', 'chats', 'chat_messages', 'call_history', 'user_call_status',
    'user_dashboard', 'bank_rules', 'customers', 'staff', 'staff_plan',
    'employees', 'employee_reviews', 'customer_reviews', 'employee_assignments', 'field_project_settings', 'field_project_settings',
    'employee_plan', 'staff_requests', 'staff_request_messages', 'staff_replacements',
    'purchase_requests', 'qa_messages', 'doc_sets', 'documents', 'audit_log',
    'notifications', 'acts', 'invoices', 'invoice_payments', 'email_history',
    'email_queue', 'reminders', 'equipment', 'equipment_movements',
    'equipment_requests', 'equipment_maintenance', 'equipment_reservations',
    'equipment_categories', 'warehouses', 'objects',
    'employee_rates', 'payroll_sheets', 'payroll_items',
    'payment_registry', 'self_employed', 'one_time_payments',
    'permits', 'permit_types', 'permit_applications', 'permit_application_items', 'permit_application_history',
    'email_accounts', 'emails', 'email_attachments', 'email_classification_rules', 'email_templates_v2', 'email_sync_log',
    'cash_requests', 'cash_expenses', 'cash_returns', 'cash_messages',
    'tkp', 'pass_requests', 'tmc_requests',
    'pre_tender_requests', 'saved_reports', 'tasks',
    'proxies',
    'hr_requests', 'meetings', 'meeting_participants', 'meeting_minutes',
    'inbox_applications', 'user_requests', 'training_applications', 'call_history',
    'worker_payments'
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY: Ролевая матрица доступа (CRIT-3)
  // ═══════════════════════════════════════════════════════════════════════════
  const ACCESS_MATRIX = {
    ADMIN: { tables: 'all', ops: ['read', 'create', 'update', 'delete'] },
    DIRECTOR_GEN: { tables: 'all', ops: ['read', 'create', 'update', 'delete'] },
    DIRECTOR_COMM: { tables: 'all', ops: ['read', 'create', 'update'] },
    DIRECTOR_DEV: { tables: 'all', ops: ['read', 'create', 'update'] },
    PM: {
      tables: [
        'users', 'employees', 'employee_reviews', 'staff', 'staff_plan', 'user_call_status',
        'tenders', 'estimates', 'works', 'work_expenses', 'work_assign_requests',
        'pm_consents', 'correspondence', 'travel_expenses', 'contracts',
        'calendar_events', 'customers', 'documents', 'chats', 'chat_messages',
        'equipment', 'equipment_movements', 'equipment_requests',
        'equipment_reservations', 'acts', 'invoices', 'notifications',
        'sync_meta', 'employee_assignments', 'field_project_settings', 'employee_plan', 'reminders',
        'bonus_requests', 'doc_sets', 'qa_messages', 'user_dashboard',
        'employee_rates', 'payroll_sheets', 'payroll_items', 'one_time_payments',
        'permits', 'tasks',
        'staff_requests', 'staff_request_messages', 'staff_replacements',
        'worker_payments'
      ],
      ops: ['read', 'create', 'update']
    },
    TO: {
      tables: [
        'users', 'employees', 'staff', 'staff_plan', 'works', 'invoices', 'user_call_status',
        'tenders', 'estimates', 'customers', 'calendar_events', 'documents',
        'correspondence', 'chats', 'chat_messages', 'notifications',
        'sync_meta', 'reminders', 'doc_sets', 'user_dashboard',
        'permits', 'tasks', 'pre_tender_requests', 'contracts'
      ],
      ops: ['read', 'create', 'update']
    },
    BUH: {
      tables: [
        'users', 'employees', 'staff', 'staff_plan', 'cash_requests', 'cash_expenses', 'cash_returns', 'cash_messages', 'user_call_status',
        'tenders', 'estimates', 'works', 'work_expenses', 'office_expenses', 'incomes',
        'invoices', 'invoice_payments', 'acts', 'contracts', 'customers',
        'bank_rules', 'calendar_events', 'chats', 'chat_messages',
        'notifications', 'sync_meta', 'reminders', 'user_dashboard',
        'employee_rates', 'payroll_sheets', 'payroll_items',
        'payment_registry', 'self_employed', 'one_time_payments',
        'worker_payments'
      ],
      ops: ['read', 'create', 'update']
    },
    HR: {
      tables: [
        'users', 'tenders', 'works', 'user_call_status',
        'employees', 'employee_reviews', 'employee_assignments', 'field_project_settings', 'employee_plan',
        'staff', 'staff_plan', 'staff_requests', 'staff_request_messages',
        'staff_replacements', 'employee_permits', 'calendar_events',
        'chats', 'chat_messages', 'notifications', 'sync_meta', 'reminders',
        'travel_expenses', 'invoices', 'user_dashboard',
        'employee_rates', 'payroll_sheets', 'payroll_items',
        'permits'
      ],
      ops: ['read', 'create', 'update']
    },
    OFFICE_MANAGER: {
      tables: [
        'users', 'employees', 'staff', 'staff_plan', 'user_call_status',
        'office_expenses', 'calendar_events', 'correspondence', 'documents',
        'chats', 'chat_messages', 'notifications', 'seals', 'seal_transfers',
        'purchase_requests', 'sync_meta', 'reminders', 'contracts',
        'travel_expenses', 'doc_sets', 'user_dashboard', 'customers', 'works', 'proxies',
    'hr_requests', 'meetings', 'meeting_participants', 'meeting_minutes',
    'inbox_applications', 'user_requests', 'training_applications', 'call_history'
      ],
      ops: ['read', 'create', 'update']
    },
    WAREHOUSE: {
      tables: [
        'users', 'employees', 'staff', 'staff_plan', 'user_call_status',
        'equipment', 'equipment_categories', 'equipment_movements',
        'equipment_requests', 'equipment_maintenance', 'equipment_reservations',
        'warehouses', 'objects', 'chats', 'chat_messages', 'notifications',
        'sync_meta', 'reminders', 'user_dashboard', 'calendar_events',
        'works', 'products', 'product_categories', 'stock', 'stock_movements'
      ],
      ops: ['read', 'create', 'update']
    },
    PROC: {
      tables: [
        'users', 'employees', 'staff', 'staff_plan', 'user_call_status', 'tenders',
        'purchase_requests', 'equipment', 'equipment_categories',
        'invoices', 'invoice_payments', 'documents', 'calendar_events',
        'chats', 'chat_messages', 'notifications', 'sync_meta', 'reminders',
        'user_dashboard', 'works', 'contracts'
      ],
      ops: ['read', 'create', 'update']
    },
    HEAD_PM: {
      tables: [
        'users', 'employees', 'staff', 'staff_plan', 'user_call_status', 'works', 'tenders', 'estimates',
        'cash_requests', 'cash_expenses', 'cash_returns', 'cash_messages',
        'work_expenses', 'work_assign_requests', 'pm_consents',
        'contracts', 'customers', 'calendar_events', 'documents',
        'chats', 'chat_messages', 'notifications', 'sync_meta', 'reminders',
        'acts', 'invoices', 'user_dashboard', 'employee_assignments', 'field_project_settings',
        'employee_plan', 'bonus_requests', 'doc_sets', 'qa_messages',
        'employee_rates', 'payroll_sheets', 'payroll_items', 'one_time_payments',
        'permits', 'permit_types',
        'staff_requests', 'staff_request_messages', 'staff_replacements',
        'worker_payments'
      ],
      ops: ['read', 'create', 'update']
    },
    HEAD_TO: {
      tables: [
        'users', 'employees', 'staff', 'staff_plan', 'works', 'invoices', 'user_call_status',
        'tenders', 'estimates', 'customers', 'calendar_events', 'documents',
        'cash_requests', 'cash_expenses', 'cash_returns', 'cash_messages',
        'correspondence', 'chats', 'chat_messages', 'notifications',
        'sync_meta', 'reminders', 'doc_sets', 'user_dashboard',
        'permits', 'tasks', 'pre_tender_requests', 'contracts'
      ],
      ops: ['read', 'create', 'update']
    },
    HR_MANAGER: {
      tables: [
        'users', 'tenders', 'works', 'user_call_status',
        'employees', 'employee_reviews', 'employee_assignments', 'field_project_settings', 'employee_plan',
        'staff', 'staff_plan', 'staff_requests', 'staff_request_messages',
        'staff_replacements', 'employee_permits', 'calendar_events',
        'chats', 'chat_messages', 'notifications', 'sync_meta', 'reminders',
        'travel_expenses', 'invoices', 'user_dashboard',
        'employee_rates', 'payroll_sheets', 'payroll_items',
        'permits'
      ],
      ops: ['read', 'create', 'update']
    },
    CHIEF_ENGINEER: {
      tables: [
        'users', 'staff', 'staff_plan', 'user_call_status',
        'equipment', 'equipment_categories', 'equipment_movements',
        'equipment_requests', 'equipment_maintenance', 'equipment_reservations',
        'warehouses', 'objects', 'chats', 'chat_messages', 'notifications',
        'sync_meta', 'reminders', 'user_dashboard', 'works', 'tenders',
        'employees', 'calendar_events'
      ],
      ops: ['read', 'create', 'update']
    }
  };

  // Таблицы, запрещённые для записи через data API (всегда)
  const WRITE_PROTECTED_TABLES = ['audit_log', 'users', 'user_call_status', 'call_history', 'pbx_operators', 'pbx_call_legs'];

  // Таблицы, запрещённые для чтения через data API (кроме ADMIN/DIRECTOR)
  // users убран: HIDDEN_COLS уже скрывает password_hash/pin_hash, а ФИО нужны всем ролям
  const READ_SENSITIVE_TABLES = ['audit_log'];

  function checkAccess(role, table, operation) {
    // Защита от записи в критичные таблицы — применяется ко ВСЕМ ролям, включая ADMIN
    if (WRITE_PROTECTED_TABLES.includes(table) && operation !== 'read') {
      return false;
    }

    // Корреспонденция создаётся и обновляется только через выделенный backend contract.
    if (table === 'correspondence' && ['create', 'update'].includes(operation)) {
      return false;
    }

    // Уведомления: все роли могут обновлять и удалять свои уведомления
    if (table === 'notifications' && ['update', 'delete'].includes(operation)) {
      return true;
    }

    // ADMIN и DIRECTOR_GEN имеют полный доступ (для незащищённых таблиц)
    if (role === 'ADMIN' || role === 'DIRECTOR_GEN') {
      return true;
    }

    // Защита чувствительных таблиц от чтения
    if (READ_SENSITIVE_TABLES.includes(table) && !['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role)) {
      return false;
    }

    // Только прямое совпадение роли — без наследования
    const matrix = ACCESS_MATRIX[role];
    if (!matrix) return false;

    const resolved = TABLE_ALIASES[table] || table; const tablesAllowed = matrix.tables === 'all' || matrix.tables.includes(table) || matrix.tables.includes(resolved);
    const opsAllowed = matrix.ops.includes(operation);

    return tablesAllowed && opsAllowed;
  }

  // ═══════════════════════════════════════════════════════════════════════════

  // Алиасы таблиц: если клиент запрашивает "permits", реально в БД таблица "employee_permits"
  const TABLE_ALIASES = {
    'calls': 'call_history',
    'cash_transactions': 'cash_requests',
    'payroll': 'payroll_sheets',
    'pre_tenders': 'pre_tender_requests',
    'training': 'training_applications',
    'travel': 'travel_expenses',
    'warehouse': 'warehouses',
    'proc_requests': 'procurement_requests',
    'purchase_requests': 'procurement_requests',
    'buh_registry': 'office_expenses',
    'permits': 'employee_permits'
  };

  function resolveTable(table) {
    return TABLE_ALIASES[table] || table;
  }

  // Таблицы с особыми первичными ключами
  const SPECIAL_KEYS = {
    'customers': 'inn',
    'settings': 'key',
    'user_call_status': 'user_id',
    'sync_meta': 'table_name',
    'user_dashboard': 'user_id'
  };

  // Таблицы без колонки id (для ORDER BY)
  const NO_ID_TABLES = ['customers', 'call_history', 'settings', 'user_call_status', 'sync_meta', 'user_dashboard'];

  function isAllowed(table) {
    // SECURITY: Strict validation — only alphanumeric and underscore, must be in allowlist
    if (!table || !/^[a-z][a-z0-9_]*$/i.test(table)) return false;
    if (table.includes('..') || table.includes(';') || table.includes('/')) return false;
    // Check both original name and resolved alias
    var resolved = TABLE_ALIASES[table] || table;
    return ALLOWED_TABLES.includes(table) || ALLOWED_TABLES.includes(resolved);
  }

  function getPrimaryKey(table) {
    return SPECIAL_KEYS[table] || 'id';
  }

  // Таблицы без created_at — особый порядок
  const SPECIAL_ORDER = {
    'user_call_status': 'user_id ASC',
    'user_dashboard': 'user_id ASC',
    'settings': '"key" ASC',
    'sync_meta': 'table_name ASC'
  };

  function getDefaultOrder(table) {
    if (SPECIAL_ORDER[table]) {
      return SPECIAL_ORDER[table];
    }
    if (NO_ID_TABLES.includes(table)) {
      return 'created_at DESC NULLS LAST';
    }
    return 'id DESC';
  }

  // Кэш колонок таблиц — защита от INSERT в несуществующие колонки
  const _columnCache = {};
  const _columnTypeCache = {};

  async function getTableColumns(table) {
    if (_columnCache[table]) return _columnCache[table];
    const result = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    const cols = new Set(result.rows.map(r => r.column_name));
    const types = {};
    result.rows.forEach(r => { types[r.column_name] = r.data_type; });
    _columnCache[table] = cols;
    _columnTypeCache[table] = types;
    return cols;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/data/:table - Получить все записи
  // SECURITY: Проверка ролевого доступа (CRIT-3)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:table', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table } = request.params;
    const { limit: rawLimit = 5000, offset: rawOffset = 0, orderBy, desc, where } = request.query;
    const parsedLimit = parseInt(rawLimit);
    if (parsedLimit === 0) {
      // limit=0 means "no items"
      return { [table]: [], total: 0, limit: 0, offset: 0 };
    }
    const limit = Math.max(1, Math.min(parsedLimit || 5000, 10000)); // raised from 500
    const offset = Math.max(parseInt(rawOffset) || 0, 0); // Sanitize offset: NaN → 0

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    // SECURITY: Проверка ролевого доступа
    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'read')) {
      return reply.code(403).send({ error: 'Нет доступа к таблице ' + table });
    }

    // Resolve table alias (e.g. "permits" → "employee_permits")
    const dbTable = resolveTable(table);

    try {
      // SECURITY B1: Hide sensitive columns from users table
      const HIDDEN_COLS = { users: ['password_hash', 'pin_hash', 'reset_token', 'reset_token_expires', 'temp_password_hash', 'temp_password_expires'] };
      let selectCols = '*';
      if (HIDDEN_COLS[table]) {
        const colRes = await db.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name != ALL($2::text[])`,
          [dbTable, HIDDEN_COLS[table]]
        );
        selectCols = colRes.rows.map(r => r.column_name).join(', ');
      }
      let query = `SELECT ${selectCols} FROM ${dbTable}`;
      const params = [];
      let whereParts = [];

      // SOFT-DELETE: если у таблицы есть колонка deleted_at — НЕ отдаём удалённые записи.
      // Это чинит «призраков» (удалённые тендеры/др. остаются у пользователей в локальном кэше,
      // потому что API их всё ещё возвращал). Теперь удалённое исчезает у всех автоматически.
      try {
        const _cols = await getTableColumns(dbTable);
        if (_cols && _cols.has('deleted_at')) {
          whereParts.push('deleted_at IS NULL');
        }
      } catch (_) {}

      // Фоновый OCR: ocr-extract не отдаём в sync/IndexedDB/UI
      if (table === 'documents' || dbTable === 'documents') {
        whereParts.push(`COALESCE(type,'') NOT IN ('ocr-extract')`);
      }

      // WHERE условие (простое)
      if (where) {
        try {
          const conditions = JSON.parse(where);
          Object.entries(conditions).forEach(([key, value], i) => {
            if (/^[a-z_]+$/i.test(key)) {
              whereParts.push(`${key} = $${params.length + 1}`);
              params.push(value);
            }
          });
        } catch(e) {}
      }

      // Применяем WHERE (включая soft-delete deleted_at IS NULL + пользовательские условия)
      const hideTest = shouldHideTestUsersFromLists(request);
      if (hideTest && table === 'users') {
        whereParts.push("(login IS NULL OR (login !~ '^test_' AND login <> 'mimir_bot'))");
      }
      if (hideTest && table === 'staff') {
        whereParts.push(`(user_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM users u WHERE u.id = ${dbTable}.user_id
            AND (u.login ~ '^test_' OR u.login = 'mimir_bot')
        ))`);
      }

      if (whereParts.length > 0) {
        query += ' WHERE ' + whereParts.join(' AND ');
      }

      // ORDER BY
      if (orderBy && /^[a-z_]+$/i.test(orderBy)) {
        query += ` ORDER BY ${orderBy} ${desc === 'true' ? 'DESC' : 'ASC'}`;
      } else {
        query += ` ORDER BY ${getDefaultOrder(table)}`;
      }

      // LIMIT/OFFSET
      query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      const dataParams = [...params, limit, offset];

      const result = await db.query(query, dataParams);

      // SECURITY FIX (MED-7): COUNT с теми же WHERE-условиями
      let countQuery = `SELECT COUNT(*) as total FROM ${dbTable}`;
      if (whereParts.length > 0) {
        countQuery += ' WHERE ' + whereParts.join(' AND ');
      }
      const countResult = await db.query(countQuery, params);

      return {
        [table]: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit,
        offset
      };
    } catch(err) {
      // SECURITY FIX (HIGH-4): Не утекает err.message
      fastify.log.error(`Data API GET [${table}]:`, err.message);
      return reply.code(500).send({ error: 'Ошибка обработки запроса' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/data/:table/:id - Получить одну запись
  // SECURITY: Проверка ролевого доступа (CRIT-3)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:table/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table, id } = request.params;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    // SECURITY: Проверка ролевого доступа
    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'read')) {
      return reply.code(403).send({ error: 'Нет доступа к таблице ' + table });
    }

    const dbTable = resolveTable(table);
    const pk = getPrimaryKey(table);

    // Validate numeric ID for integer primary keys
    if (['id', 'user_id'].includes(pk)) {
      if (isNaN(parseInt(id)) || String(id).trim() !== String(parseInt(id))) {
        return reply.code(400).send({ error: 'ID должен быть числом' });
      }
    }

    try {
      const result = await db.query(`SELECT * FROM ${dbTable} WHERE ${pk} = $1`, [id]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Запись не найдена' });
      }

      return { item: result.rows[0] };
    } catch(err) {
      fastify.log.error(`Data API GET/:id [${table}]:`, err.message);
      return reply.code(500).send({ error: 'Ошибка обработки запроса' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/data/:table - Создать запись
  // SECURITY: Проверка ролевого доступа (CRIT-3)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:table', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table } = request.params;
    const data = request.body;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return reply.code(400).send({ error: 'Тело запроса должно быть JSON-объектом. Укажите Content-Type: application/json' });
    }

    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'create')) {
      return reply.code(403).send({ error: 'Нет прав на создание записей в таблице ' + table });
    }

    const dbTable = resolveTable(table);
    const pk = getPrimaryKey(table);

    try {
      const tableCols = await getTableColumns(dbTable);

      const requestedEstimateApprovalStatus = (table === 'estimates')
        ? String(data.approval_status || '').trim().toLowerCase()
        : '';

      // Просчёт: стрипаем все approval-поля, кроме тех что контролируем сами
      if (table === 'estimates') {
        // Удаляем поля, которые управляются только через /api/approval
        delete data.reject_reason;
        delete data.decided_at;
        delete data.decided_by_user_id;
        delete data.approval_comment;
      }

      // Просчёт: если отправляют на согласование — ставим 'sent'
      if (table === 'estimates' && ['sent', 'pending'].includes(requestedEstimateApprovalStatus)) {
        data.approval_status = 'sent';
        data.sent_for_approval_at = new Date().toISOString();
        data.is_approved = false;
        data.approved_by = null;
        data.approved_at = null;
      } else if (table === 'estimates') {
        data.approval_status = requestedEstimateApprovalStatus || 'draft';
        // Стрипаем оставшиеся approval-поля для неотправленных просчётов
        delete data.is_approved;
        delete data.approved_by;
        delete data.approved_at;
        delete data.sent_for_approval_at;
      }

    // ─── Системные типы документов через generic CRUD запрещены ─────────────
    // ДЫРА (найдена верификатором 03.11.2026): POST/PUT /api/data/documents
    // писал type='tkp' напрямую (HTTP 200, в БД ровно 'tkp'), минуя гейт
    // роутов ТКП (решение директора, арифметика позиций, сверка с просчётом,
    // линт готового PDF). Подделка попадала в карточку тендера как системный
    // ТКП и позволяла подменить download_url настоящего файла.
    //
    // Почему не блокируем таблицу целиком: фронт реально создаёт через
    // generic CRUD документы-ссылки (type='Ссылка' — InlineDocsBar.jsx:8,
    // Tenders/api.js:397) и файлы комплекта (docs_pack.js, tenders.js:4118).
    // Поэтому запрещаем только СИСТЕМНЫЕ типы — их ставят профильные роуты
    // после своего гейта.
    if (table === 'documents' && data && typeof data === 'object') {
      const SYSTEM_TYPES = new Set(['tkp', 'rp_tkp', 'rp_estimate', 'rp_report', 'ocr-extract', 'rp_thread_file']);
      const rawType = String(data.type == null ? '' : data.type)
        .replace(/[\s\u00a0\u2007\u2009\u202f\u200b\ufeff]+/g, ' ')
        .trim();
      const lower = rawType.toLowerCase();
      const isLatinOnly = /^[a-zA-Z0-9_.\-\s]+$/.test(rawType);
      const candidate = isLatinOnly ? lower.replace(/[^a-z0-9_.-]/g, '') : '';
      if (candidate && SYSTEM_TYPES.has(candidate)) {
        return reply.code(403).send({
          error: 'system_doc_type',
          message: 'Тип документа «' + rawType + '» выставляется системой. Используйте профильный роут модуля.',
        });
      }
    }

    // ─── V391: worker_payments — ЗАПИСЬ ЧЕРЕЗ GENERIC CRUD ЗАПРЕЩЕНА ────────
    // Почему целиком, а не стрипом полей: верификаторы четыре раза подряд
    // находили обходы (status, amount, период, сотрудник, тип). Пока таблица
    // пишется через generic CRUD, каждое новое поле = новый обход.
    // Проверено: НИ ОДИН фронтенд-файл не пишет в /api/data/worker_payments
    // (начисления идут через профильные ручки). Чтение остаётся открытым.
    if (table === 'worker_payments') {
      return reply.code(409).send({
        error: 'payout_requires_approval',
        message: 'Выплаты нельзя создавать или менять через общий API. Используйте контур выплат (корзина → согласование) или профильные ручки.',
        requires_approval: true,
      });
    }

    // ─── V453: staff_plan — «в офисе» только с подтверждением СКУД ──────────
    // Почему здесь. График офиса пишет статусы через generic CRUD /api/data,
    // минуя daily-presence. Без этой проверки запрет «оф без прохода» обходится
    // первым же POST в /api/data/staff_plan.
    //
    // История правок (верификаторы 03.11.2026):
    //  • P1-2 — дата в формате DD.MM.YYYY проходила мимо проверки на ISO;
    //  • P1-3 — двухшаговый обход: POST без даты, затем PUT только с датой;
    //  • новое — «ОФ»/« оф» проходили из-за строгого сравнения.
    // Поэтому проверяем ИТОГОВОЕ состояние записи (сотрудник + дата + статус),
    // нормализуя и дату, и код статуса.
    if (table === 'staff_plan') {
      const state = resolvePlanState(data, null);
      if (state.dateInvalid) {
        return reply.code(400).send({
          error: 'bad_date',
          message: 'Дата отметки не распознана или не существует в календаре.'
        });
      }
      // Отметка без сотрудника или без даты бессмысленна: она не привязана
      // к дню/человеку, ломает выборки и служит сырьём для двухшагового
      // обхода (верификатор 03.11.2026).
      if (state.staffInvalid || !Number.isFinite(state.staffId) || state.staffId <= 0) {
        return reply.code(400).send({
          error: 'staff_id_required',
          message: 'Для отметки в графике офиса нужен сотрудник.'
        });
      }
      if (!state.date) {
        return reply.code(400).send({
          error: 'date_required',
          message: 'Для отметки в графике офиса нужна дата.'
        });
      }
      if (state.officeAttempt) {
        const guard = await assertOfficeConfirmed(db, state.staffId, state.date);
        if (!guard.ok) {
          return reply.code(409).send({
            error: 'office_not_confirmed',
            message: 'В этот день СКУД не зафиксировал вход — статус «В офисе» поставить нельзя.'
          });
        }
      }
      // Пишем канонические значения: «ОФ»/« оф »/ZWSP не должны попадать в БД.
      // Legacy `status` зеркалим в status_code и пишем оба одинаково — иначе
      // клиент с {status:'оф'} оставлял status_code=null (верификатор 04.11.2026).
      if (state.status !== undefined) {
        data.status_code = state.status;
        data.status = state.status;
      }
      data.date = state.date;
      data.staff_id = state.staffId;
    }

    // Переполнение integer-колонок -> 400, а не 500 от драйвера (D-1).
    {
      const colTypes = _columnTypeCache[dbTable] || {};
      const intChk = validateIntegerColumns(data, colTypes);
      if (!intChk.ok) {
        return reply.code(400).send({ error: 'bad_integer', field: intChk.field, message: intChk.message });
      }
    }

      const TEXT_FIELDS = ['description', 'comment', 'notes', 'details', 'message', 'text', 'body', 'content', 'data'];
      for (const key of Object.keys(data)) {
        if (typeof data[key] === 'string' && data[key].length > 1000 && !TEXT_FIELDS.includes(key)) {
          return reply.code(400).send({ error: 'Значение поля слишком длинное', field: key });
        }
      }

      if (tableCols.has('created_at')) {
        // Всегда серверное время. Клиентский ISO (UTC) обходил dbStamp через
        // `||` и давал Δ≈TZ-offset (верификатор 04.11.2026, P2, Δ=7200с).
        data.created_at = await dbStamp(db);
      }
      if (tableCols.has('updated_at')) {
        data.updated_at = await dbStamp(db);
      }
      if (tableCols.has('created_by') && !data.created_by && request.user.id) {
        data.created_by = request.user.id;
      }

      if (pk === 'id') {
        delete data.id;
      }

      // Санитизация: пустые строки → null для date/numeric/integer/boolean полей
      // + конвертация DD.MM.YYYY → YYYY-MM-DD для date полей
      const colTypesPost = _columnTypeCache[dbTable] || {};
      for (const key of Object.keys(data)) {
        const dt = colTypesPost[key];
        if (!dt) continue;
        if (data[key] === '') {
          if (dt === 'date' || dt.startsWith('timestamp') || dt === 'integer' || dt === 'bigint'
            || dt === 'smallint' || dt === 'numeric' || dt === 'real' || dt === 'double precision'
            || dt === 'boolean' || dt === 'jsonb' || dt === 'json') {
            data[key] = null;
          }
        } else if (data[key] != null && (dt === 'jsonb' || dt === 'json')) {
          if (typeof data[key] === 'object') {
            data[key] = JSON.stringify(data[key]);
          } else if (typeof data[key] === 'string') {
            try { JSON.parse(data[key]); } catch (_) { data[key] = null; }
          }
        } else if (data[key] && (dt === 'date' || dt.startsWith('timestamp')) && typeof data[key] === 'string') {
          // DD.MM.YYYY → YYYY-MM-DD
          const m = data[key].match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
          if (m) data[key] = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
          // Валидация YYYY-MM-DD части (работает и для date, и для timestamp)
          const dateStr = data[key].substring(0, 10);
          const parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!parts) {
            console.warn(`[DATA] Invalid date nullified: table=${dbTable}, key=${key}, value=${JSON.stringify(data[key])}`);
            data[key] = null;
          } else {
            const y = parseInt(parts[1], 10), mo = parseInt(parts[2], 10), dd = parseInt(parts[3], 10);
            if (!isValidCalendarDate(y, mo, dd)) {
              console.warn(`[DATA] Invalid date nullified: table=${dbTable}, key=${key}, value=${JSON.stringify(data[key])}`);
              data[key] = null;
            }
          }
        }
      }

      const keys = Object.keys(data).filter(k => /^[a-z_]+$/i.test(k) && tableCols.has(k));
      const values = keys.map(k => data[k]);
      const placeholders = keys.map((_, i) => `$${i + 1}`);

      let query;
      if (pk !== 'id' && keys.includes(pk)) {
        const updateCols = keys.filter(k => k !== pk).map((k) => k + ' = EXCLUDED.' + k).join(', ');
        const conflictClause = dbTable === 'customers'
          ? `ON CONFLICT (${pk}) WHERE ${pk} IS NOT NULL AND ${pk}::text <> ''::text`
          : `ON CONFLICT (${pk})`;
        query = `
          INSERT INTO ${dbTable} (${keys.join(', ')})
          VALUES (${placeholders.join(', ')})
          ${conflictClause} DO UPDATE SET ${updateCols || 'updated_at = NOW()'}
          RETURNING *
        `;
      } else {
        query = `
          INSERT INTO ${dbTable} (${keys.join(', ')})
          VALUES (${placeholders.join(', ')})
          RETURNING *
        `;
      }

      const result = await db.query(query, values);

      // Контакты договора → карточка контрагента (fill-only, не ломает сохранение).
      if (table === 'contracts' && result.rows[0]) {
        try {
          await syncContractContactsToSupplier(db, result.rows[0], fastify.log);
        } catch (e) {
          fastify.log.warn('[DATA API POST] contract contact sync failed: ' + e.message);
        }
      }

      return { success: true, item: result.rows[0], id: result.rows[0][pk] };
    } catch (err) {
      console.error(`[DATA API POST] Table: ${table}, Error: ${err.message}, Code: ${err.code}`);
      console.error(`[DATA API POST] Keys: ${Object.keys(data).join(', ')}, Values:`, Object.values(data));
      console.error(`[DATA API POST] Stack:`, err.stack);
      fastify.log.error(`Data API POST [${table}]: ${err.message}`, { stack: err.stack, code: err.code });
      if (err.statusCode) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      if (err.code === '22001') {
        return reply.code(400).send({ error: 'Значение поля слишком длинное' });
      }
      if (err.code === '23502') {
        return reply.code(400).send({ error: `Обязательное поле не заполнено: ${err.column || err.message}` });
      }
      if (err.code === '23503') {
        return reply.code(400).send({ error: `Ссылка на несуществующую запись: ${err.detail || err.message}` });
      }
      if (err.code === '23505') {
        return reply.code(409).send({ error: `Запись уже существует: ${err.detail || err.message}` });
      }
      if (err.code === '22008' || err.code === '22007') {
        return reply.code(400).send({ error: `Некорректное значение даты: ${err.message}` });
      }
      return reply.code(500).send({ error: 'Ошибка обработки запроса' });
    }
  });

  // B5 (19.06.2026): Закрываем RBAC-дыру когда vanilla фронт через AsgardDB.put
  // шлёт в /api/data вместо /api/staff. Финансовые поля employees доступны
  // только ADMIN/DIRECTOR_GEN/BUH. Список синхронизирован с staff.js
  // FIN_RESTRICTED_FIELDS — если меняешь здесь, поправь и там.
  const FIN_FIELDS = [
    'is_self_employed', 'is_officially_employed', 'can_exceed_limit',
    'official_salary', 'official_non_burnable', 'official_hire_date',
    'official_status', 'official_leave_from', 'official_leave_to',
    'se_yearly_used_initial', 'se_monthly_used_initial',
    // V240 (19.06.2026): привязка к СЗ-получателю — только FIN_ROLES.
    'se_payee_id',
  ];
  const FIN_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

  fastify.put('/:table/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table, id } = request.params;
    const data = request.body;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'update')) {
      return reply.code(403).send({ error: 'Нет прав на обновление записей в таблице ' + table });
    }

    // B5: финансовые поля employees — тихо отрезаем у не-финансовых ролей.
    // Срабатывает на /api/data/employees/:id (vanilla AsgardDB.put),
    // основной путь /api/staff/employees/:id уже защищён через FIN_RESTRICTED.
    if (table === 'employees' && data && typeof data === 'object') {
      const isFinUser = FIN_ROLES.includes(userRole);
      if (!isFinUser) {
        for (const f of FIN_FIELDS) {
          if (f in data) delete data[f];
        }
      }
    }

    // ─── Системные типы документов через generic CRUD (PUT) ─────────────────
    // ДЫРА (найдена верификатором 03.11.2026): PUT /api/data/documents/:id
    // менял type на 'tkp' и download_url, подменяя настоящий файл ТКП в карточке.
    // Запрещаем и установку системного типа, и правку строк, которые уже системные.
    if (table === 'documents' && data && typeof data === 'object') {
      const SYSTEM_TYPES = new Set(['tkp', 'rp_tkp', 'rp_estimate', 'rp_report', 'ocr-extract', 'rp_thread_file']);

      const isSystemType = (raw) => {
        const s = String(raw == null ? '' : raw)
          .replace(/[\s\u00a0\u2007\u2009\u202f\u200b\ufeff]+/g, ' ')
          .trim();
        if (!s) return false;
        const isLatinOnly = /^[a-zA-Z0-9_.\-\s]+$/.test(s);
        if (!isLatinOnly) return false;
        return SYSTEM_TYPES.has(s.toLowerCase().replace(/[^a-z0-9_.-]/g, ''));
      };

      if (data.type != null && isSystemType(data.type)) {
        return reply.code(403).send({
          error: 'system_doc_type',
          message: 'Тип документа «' + data.type + '» выставляется системой. Используйте профильный роут модуля.',
        });
      }

      // Существующая запись уже системная → менять её через generic CRUD нельзя
      try {
        const cur = await db.query('SELECT type FROM documents WHERE id = $1', [id]);
        if (cur.rows[0] && isSystemType(cur.rows[0].type)) {
          return reply.code(403).send({
            error: 'system_doc_locked',
            message: 'Системный документ (' + cur.rows[0].type + ') меняется только через профильный роут модуля.',
          });
        }
      } catch (_) { /* если id не число — обычная обработка ниже */ }
    }

    // ─── V391: worker_payments через generic CRUD (PUT) ────────────────
    // ДЫРА (найдена верификатором 16.10.2026): PUT /api/data/worker_payments/:id
    // с {"status":"paid"} переводил pending→paid в обход гейта согласования.
    // Запрещаем установку paid/confirmed и правку денежных полей — выплата и
    // изменение факта перевода только через профильные ручки с гейтом.
    // ─── V391: worker_payments — ЗАПИСЬ ЧЕРЕЗ GENERIC CRUD ЗАПРЕЩЕНА ────────
    // Верификаторы 4 раза находили обходы через эту ручку (status, amount,
    // период, сотрудник, тип): пока таблица пишется generic-CRUD, каждое новое
    // поле = новый обход. Проверено: фронт сюда не пишет (только читает),
    // поэтому закрываем запись целиком. Чтение (GET) остаётся открытым.
    if (table === 'worker_payments') {
      return reply.code(409).send({
        error: 'payout_requires_approval',
        message: 'Выплаты нельзя менять через общий API. Используйте контур выплат (корзина → согласование) или профильные ручки.',
        requires_approval: true,
      });
    }

    // ─── V453: staff_plan (PUT) — «в офисе» только с подтверждением СКУД ────
    // ДЫРА, которую закрываем: PUT /api/data/staff_plan/:id с
    // {"status_code":"оф"} ставил «в офисе» в обход проверки POST-ручки.
    //
    // История правок (верификаторы 03.11.2026):
    //  • P1-3 — проверялась дата ТЕКУЩЕЙ строки, хотя в теле можно прислать
    //    другую дату: проверка шла по дню с проходами, запись — по дню без них;
    //  • новое — двухшаговый обход: POST без даты создаёт строку date=NULL,
    //    затем PUT только с датой переносит её. Теперь проверяется ИТОГОВОЕ
    //    состояние (сотрудник + дата + статус), а не то, что пришло в теле.
    if (table === 'staff_plan') {
      const { rows: cur } = await db.query(
        `SELECT staff_id, date::text AS date, status_code, status FROM staff_plan WHERE id = $1`, [id]
      );
      if (!cur.length) {
        return reply.code(404).send({ error: 'Отметка не найдена' });
      }
      const state = resolvePlanState(data, cur[0]);

      // Невалидная дата в теле — 400, а не молчаливое обнуление
      // (верификатор 03.11.2026: PUT {date:"2026-14-99"} давал 200 и date=NULL).
      if (state.dateInvalid) {
        return reply.code(400).send({
          error: 'bad_date',
          message: 'Дата отметки не распознана или не существует в календаре.'
        });
      }
      // Сотрудник обязателен: `staff_id: null` раньше обнулял владельца с 200,
      // а `"abc"` доезжал до драйвера и давал 500.
      if (state.staffInvalid || !Number.isFinite(state.staffId) || state.staffId <= 0) {
        return reply.code(400).send({
          error: 'staff_id_required',
          message: 'У отметки в графике офиса должен быть сотрудник.'
        });
      }
      if (!state.date) {
        return reply.code(400).send({
          error: 'date_required',
          message: 'У отметки в графике офиса должна быть дата.'
        });
      }
      if (state.officeAttempt) {
        const guard = await assertOfficeConfirmed(db, state.staffId, state.date);
        if (!guard.ok) {
          return reply.code(409).send({
            error: 'office_not_confirmed',
            message: 'В этот день СКУД не зафиксировал вход — статус «В офисе» поставить нельзя.'
          });
        }
      }
      // Канон + зеркало legacy status (верификатор 04.11.2026).
      if (data.status_code !== undefined || data.status !== undefined) {
        data.status_code = state.status;
        data.status = state.status;
      }
      if (data.date !== undefined) data.date = state.date;
      if (data.staff_id !== undefined) data.staff_id = state.staffId;
    }


    const dbTable = resolveTable(table);
    const pk = getPrimaryKey(table);

    if (['id', 'user_id'].includes(pk)) {
      if (isNaN(parseInt(id)) || String(id).trim() !== String(parseInt(id))) {
        return reply.code(400).send({ error: 'ID должен быть числом' });
      }
    }

    try {
      const tableCols = await getTableColumns(dbTable);

      let approvalRequest = null;
      if (table === 'estimates') {
        // Поля согласования нельзя менять через generic CRUD — используйте /api/approval
        for (const field of APPROVAL_FIELDS) {
          delete data[field];
        }
      }

      if (tableCols.has('updated_at')) {
        data.updated_at = await dbStamp(db);
      }
      delete data[pk];
      delete data.id;
      delete data.created_at;
      delete data.created_by;

      const TEXT_FIELDS = ['description', 'comment', 'notes', 'details', 'message', 'text', 'body', 'content', 'data'];
      for (const key of Object.keys(data)) {
        if (typeof data[key] === 'string' && data[key].length > 1000 && !TEXT_FIELDS.includes(key)) {
          return reply.code(400).send({ error: 'Значение поля слишком длинное', field: key });
        }
      }

      if (table === 'estimates') {
        for (const field of APPROVAL_FIELDS) {
          delete data[field];
        }
      }

      // Санитизация: пустые строки → null для date/numeric/integer/boolean полей
      // + конвертация DD.MM.YYYY → YYYY-MM-DD для date полей
      const colTypes = _columnTypeCache[dbTable] || {};

      // Переполнение integer-колонок -> 400, а не 500 от драйвера (D-1).
      {
        const intChk = validateIntegerColumns(data, colTypes);
        if (!intChk.ok) {
          return reply.code(400).send({ error: 'bad_integer', field: intChk.field, message: intChk.message });
        }
      }

      for (const key of Object.keys(data)) {
        const dt = colTypes[key];
        if (!dt) continue;
        if (data[key] === '') {
          if (dt === 'date' || dt.startsWith('timestamp') || dt === 'integer' || dt === 'bigint'
            || dt === 'smallint' || dt === 'numeric' || dt === 'real' || dt === 'double precision'
            || dt === 'boolean' || dt === 'jsonb' || dt === 'json') {
            data[key] = null;
          }
        } else if (data[key] != null && (dt === 'jsonb' || dt === 'json')) {
          if (typeof data[key] === 'object') {
            data[key] = JSON.stringify(data[key]);
          } else if (typeof data[key] === 'string') {
            try { JSON.parse(data[key]); } catch (_) { data[key] = null; }
          }
        } else if (data[key] && (dt === 'date' || dt.startsWith('timestamp')) && typeof data[key] === 'string') {
          // DD.MM.YYYY → YYYY-MM-DD
          const m = data[key].match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
          if (m) data[key] = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
          // Валидация YYYY-MM-DD части (работает и для date, и для timestamp)
          const dateStr = data[key].substring(0, 10);
          const parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!parts) {
            console.warn(`[DATA] Invalid date nullified: table=${dbTable}, key=${key}, value=${JSON.stringify(data[key])}`);
            data[key] = null;
          } else {
            const y = parseInt(parts[1], 10), mo = parseInt(parts[2], 10), dd = parseInt(parts[3], 10);
            if (!isValidCalendarDate(y, mo, dd)) {
              console.warn(`[DATA] Invalid date nullified: table=${dbTable}, key=${key}, value=${JSON.stringify(data[key])}`);
              data[key] = null;
            }
          }
        }
      }

      const keys = Object.keys(data).filter(k => /^[a-z_]+$/i.test(k) && tableCols.has(k));
      if (keys.length === 0) {
        return reply.code(400).send({ error: 'Нет валидных полей для обновления' });
      }

      // D-237: ванила пишет тендер через AsgardDB.put → generic /api/data/tenders/:id.
      // Этот путь не знал про внутренний срок анализа, поэтому пересчитываем его здесь
      // тем же каноном, что и реестр (docs_deadline − 3/5 раб. дней).
      let recalcDeadline;
      if (table === 'tenders') {
        const p = {};
        for (const f of ['docs_deadline', 'participation_paid', 'participation_fee']) {
          if (data[f] !== undefined) p[f] = data[f];
        }
        if (Object.keys(p).length) {
          const prev = await db.query('SELECT docs_deadline, participation_paid, created_at FROM tenders WHERE id = $1', [id]);
          if (prev.rows[0]) recalcDeadline = recalcAnalysisDeadlinePatch(p, prev.rows[0]);
        }
      }
      if (recalcDeadline !== undefined) {
        data.analysis_deadline = recalcDeadline;
        if (!keys.includes('analysis_deadline')) keys.push('analysis_deadline');
      }

      // Тендеры: снимок до UPDATE — для уведомления РП при переназначении на просчёт
      let oldTender = null;
      if (table === 'tenders' && (keys.includes('responsible_pm_id') || keys.includes('calculator_user_id'))) {
        const prev = await db.query(
          `SELECT id, customer_name, tender_title, tender_status, registry_status,
                  responsible_pm_id, calculator_user_id, calculator_kind, handoff_at
             FROM tenders WHERE id = $1`,
          [id]
        );
        oldTender = prev.rows[0] || null;
      }

      const values = keys.map(k => data[k]);
      const setParts = keys.map((k, i) => `${k} = $${i + 1}`);

      const query = `
        UPDATE ${dbTable}
        SET ${setParts.join(', ')}
        WHERE ${pk} = $${keys.length + 1}
        RETURNING *
      `;

      values.push(id);
      const result = await db.query(query, values);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Запись не найдена' });
      }

      // Контакты договора → карточка контрагента (fill-only, не ломает сохранение).
      if (table === 'contracts') {
        try {
          await syncContractContactsToSupplier(db, result.rows[0], fastify.log);
        } catch (e) {
          fastify.log.warn('[DATA API PUT] contract contact sync failed: ' + e.message);
        }
      }

      if (table === 'tenders' && oldTender) {
        const updated = result.rows[0];
        const newPm = updated.responsible_pm_id != null ? Number(updated.responsible_pm_id) : null;
        const oldPm = oldTender.responsible_pm_id != null ? Number(oldTender.responsible_pm_id) : null;
        const newCalc = updated.calculator_user_id != null ? Number(updated.calculator_user_id) : null;
        const oldCalc = oldTender.calculator_user_id != null ? Number(oldTender.calculator_user_id) : null;
        const actorName = request.user?.name || 'Коллега';

        try {
          const {
            afterResponsiblePmChanged,
            notifyPmCalcEvent,
            notifyPmReleasedFromCalc
          } = require('../services/tender-assign-notify');

          if (newPm && newPm !== oldPm) {
            await afterResponsiblePmChanged(db, {
              tenderId: Number(id),
              oldTender,
              newPmId: newPm,
              actorName,
              actorUserId: request.user?.id,
              log: request.log
            });
          } else if (newCalc && newCalc !== oldCalc) {
            await notifyPmCalcEvent(db, {
              userId: newCalc,
              kind: oldCalc ? 'reassign' : 'assign',
              tender: updated,
              actorName,
              log: request.log
            });
            if (oldCalc && oldCalc !== newCalc) {
              await notifyPmReleasedFromCalc(db, {
                userId: oldCalc,
                tender: updated,
                actorName,
                log: request.log
              });
            }
          }
        } catch (e) {
          fastify.log.warn(`[DATA API] tender assign notify failed: ${e.message}`);
        }
      }

      return { success: true, item: result.rows[0], approval: approvalRequest };
    } catch (err) {
      console.error(`[DATA API PUT] Table: ${table}, ID: ${id}, Error: ${err.message}, Code: ${err.code}`);
      console.error(`[DATA API PUT] Stack:`, err.stack);
      fastify.log.error(`Data API PUT [${table}]:`, err.message);
      if (err.statusCode) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      if (err.code === '22001') {
        return reply.code(400).send({ error: 'Значение поля слишком длинное' });
      }
      if (err.code === '23502') {
        return reply.code(400).send({ error: `Обязательное поле не заполнено: ${err.column || err.message}` });
      }
      if (err.code === '23503') {
        return reply.code(400).send({ error: `Ссылка на несуществующую запись: ${err.detail || err.message}` });
      }
      if (err.code === '23505') {
        return reply.code(409).send({ error: `Запись уже существует: ${err.detail || err.message}` });
      }
      if (err.code === '22008' || err.code === '22007') {
        return reply.code(400).send({ error: `Некорректное значение даты: ${err.message}` });
      }
      return reply.code(500).send({ error: 'Ошибка обработки запроса' });
    }
  });

  fastify.delete('/:table/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table, id } = request.params;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    // SECURITY: Проверка ролевого доступа (только ADMIN и DIRECTOR_GEN могут удалять)
    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'delete')) {
      return reply.code(403).send({ error: 'Нет прав на удаление записей в таблице ' + table });
    }

    // V391: удаление выплат через generic CRUD тоже закрываем — иначе можно
    // удалить запись и создать её заново в обход гейта согласования.
    if (table === 'worker_payments') {
      return reply.code(409).send({
        error: 'payout_requires_approval',
        message: 'Выплаты нельзя удалять через общий API — отмена проводится через профильные ручки.',
        requires_approval: true,
      });
    }

    const dbTable = resolveTable(table);
    const pk = getPrimaryKey(table);

    // Validate numeric ID for integer primary keys
    if (['id', 'user_id'].includes(pk)) {
      if (isNaN(parseInt(id)) || String(id).trim() !== String(parseInt(id))) {
        return reply.code(400).send({ error: 'ID должен быть числом' });
      }
    }

    try {
      const result = await db.query(`DELETE FROM ${dbTable} WHERE ${pk} = $1 RETURNING *`, [id]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Запись не найдена' });
      }

      return { success: true, deleted: true };
    } catch(err) {
      fastify.log.error(`Data API DELETE [${table}]:`, err.message);
      if (err.code === '23503') {
        return reply.code(400).send({ error: 'Невозможно удалить — есть связанные записи' });
      }
      return reply.code(500).send({ error: 'Ошибка обработки запроса' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/data/:table/by-index - Поиск по индексу
  // SECURITY: Проверка ролевого доступа (CRIT-3)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:table/by-index', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table } = request.params;
    const { index, value } = request.body;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    // SECURITY: Проверка ролевого доступа
    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'read')) {
      return reply.code(403).send({ error: 'Нет доступа к таблице ' + table });
    }

    if (!index || !/^[a-z_]+$/i.test(index)) {
      return reply.code(400).send({ error: 'Недопустимый индекс' });
    }

    const dbTable = resolveTable(table);

    try {
      // soft-delete: не отдаём удалённые записи (если у таблицы есть deleted_at)
      let softDel = '';
      try { const _c = await getTableColumns(dbTable); if (_c && _c.has('deleted_at')) softDel = ' AND deleted_at IS NULL'; } catch (_) {}
      let ocrHide = '';
      if (table === 'documents' || dbTable === 'documents') {
        ocrHide = ` AND COALESCE(type,'') NOT IN ('ocr-extract')`;
      }
      const result = await db.query(
        `SELECT * FROM ${dbTable} WHERE ${index} = $1${softDel}${ocrHide} ORDER BY ${getDefaultOrder(table)}`,
        [value]
      );

      return { items: result.rows };
    } catch(err) {
      fastify.log.error(`Data API by-index [${table}]:`, err.message);
      return reply.code(500).send({ error: 'Ошибка обработки запроса' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/data/:table/count - Количество записей
  // SECURITY: Проверка ролевого доступа (CRIT-3)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:table/count', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table } = request.params;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    // SECURITY: Проверка ролевого доступа
    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'read')) {
      return reply.code(403).send({ error: 'Нет доступа к таблице ' + table });
    }

    const dbTable = resolveTable(table);

    try {
      const result = await db.query(`SELECT COUNT(*) as count FROM ${dbTable}`);
      return { count: parseInt(result.rows[0].count) };
    } catch(err) {
      fastify.log.error(`Data API count [${table}]:`, err.message);
      return reply.code(500).send({ error: 'Ошибка обработки запроса' });
    }
  });
}

module.exports = dataRoutes;