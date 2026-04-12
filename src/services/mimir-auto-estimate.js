'use strict';

/**
 * ASGARD CRM — Мимир Авто-просчёт (AP1)
 *
 * Сервис собирает ВСЕ данные нужные Мимиру для автозаполнения просчёта работы:
 *   1) work — данные работы
 *   2) tender — данные тендера (если есть)
 *   3) documents — содержимое прикреплённых файлов (PDF/DOCX/Excel)
 *   4) analogs — похожие просчёты по work_type
 *   5) customer_history — история тендеров заказчика
 *   6) warehouse — остатки оборудования (equipment)
 *   7) workers — свободные рабочие на период
 *   8) tariffs — тарифная сетка из field_tariff_grid
 *   9) settings — НДС, ФОТ и т.д. (vat_default_pct + хардкод по умолчанию)
 *
 * Каждый шаг рапортует прогресс через onProgress(step, message) — передаётся
 * в SSE handler в /api/mimir/auto-estimate.
 *
 * AP1: только сбор данных (без AI вызова, без сохранения в БД).
 * AP2: добавит вызов Claude Sonnet 4.6 + создание estimate + диалог.
 */

const { parseDocumentContent } = require('./estimateChat');

// Хардкод-фоллбэк для настроек, которых нет в settings
const DEFAULT_SETTINGS = {
  vat_pct: 22,
  fot_tax_pct: 55,
  overhead_pct: 15,
  consumables_pct: 3,
  contingency_pct: 12, // AP4: повышено с 5% → 12% по запросу руководства (буфер безопасности)
  itr_rate_per_day: 10000,
  per_diem_per_day: 1000,
  meals_per_day: 1000
};

// Лимиты для предотвращения раздувания контекста
const MAX_DOCUMENTS_PARSED = 8;
const MAX_ANALOGS = 10;
const MAX_CUSTOMER_HISTORY = 15;
const MAX_WAREHOUSE_ITEMS = 200;
// AP3.5: Снят лимит для полевых — выгружаем ВСЕХ. В prompt передаём агрегаты,
// не поимённый список (агрегация по role_tag + позициям).
const MAX_FIELD_EMPLOYEES = 2000;
const MAX_ITR_USERS = 50;

/**
 * Безопасный wrapper для onProgress callback —
 * не падает если callback не передан или бросает.
 */
function safeProgress(onProgress, step, message, data) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress({ type: 'progress', step, message, ...(data ? { data } : {}) });
  } catch (e) { /* ignore */ }
}

/**
 * Эвристика: определить категорию работ по тексту названия/описания.
 * Используется когда work_type не задан явно ни в работе, ни в тендере.
 */
function inferWorkType(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  if (/гидромеханич|\bгмо\b|hydro.?mech/i.test(t)) return 'HYDRO_MECH';
  if (/гидродинамич|\bавд\b|hydro.?dynam/i.test(t)) return 'HYDRO_DYN';
  if (/химическ|chem/i.test(t)) return 'CHEM';
  if (/hvac|вентиляц|кондицион/i.test(t)) return 'HVAC';
  if (/монтаж|демонтаж|mount/i.test(t)) return 'MOUNT';
  if (/диагност/i.test(t)) return 'DIAG';
  if (/изоляц|антикор/i.test(t)) return 'INSULATION';
  if (/чистк|очистк/i.test(t)) return 'CLEANING';
  return null;
}

/**
 * 1+2+3. Контекст работы: сама работа, тендер, документы (с парсингом).
 */
async function getWorkContext(db, workId, onProgress) {
  // Работа
  const workRes = await db.query('SELECT * FROM works WHERE id = $1', [workId]);
  const work = workRes.rows[0];
  if (!work) throw new Error(`Работа #${workId} не найдена`);

  // Тендер
  let tender = null;
  if (work.tender_id) {
    try {
      const tRes = await db.query('SELECT * FROM tenders WHERE id = $1', [work.tender_id]);
      tender = tRes.rows[0] || null;
    } catch (e) { /* ok */ }
  }

  // Привязанный estimate (может уже существовать) — оттуда тоже можно взять work_type
  let linkedEstimate = null;
  try {
    const eRes = await db.query(
      `SELECT id, work_type, work_days, crew_count, markup_multiplier, object_city
         FROM estimates
        WHERE work_id = $1 OR (tender_id = $2 AND tender_id IS NOT NULL)
        ORDER BY created_at DESC LIMIT 1`,
      [workId, work.tender_id || null]
    );
    linkedEstimate = eRes.rows[0] || null;
  } catch (e) { /* ok */ }

  // Документы (тендер + работа)
  safeProgress(onProgress, 'documents', '📄 Читаю документы тендера и работы...');
  let documents = [];
  try {
    let dRes;
    if (work.tender_id) {
      dRes = await db.query(
        `SELECT id, original_name, mime_type, size, filename, type, work_id, tender_id
           FROM documents
          WHERE work_id = $1 OR tender_id = $2
          ORDER BY created_at DESC
          LIMIT $3`,
        [workId, work.tender_id, MAX_DOCUMENTS_PARSED]
      );
    } else {
      dRes = await db.query(
        `SELECT id, original_name, mime_type, size, filename, type, work_id, tender_id
           FROM documents
          WHERE work_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [workId, MAX_DOCUMENTS_PARSED]
      );
    }
    documents = dRes.rows;
  } catch (e) { /* ok */ }

  // Парсинг содержимого
  const parsed = [];
  for (const doc of documents) {
    const content = await parseDocumentContent(doc);
    parsed.push({
      id: doc.id,
      original_name: doc.original_name || doc.filename,
      mime_type: doc.mime_type,
      size_kb: Math.round((doc.size || 0) / 1024),
      content: content || null,
      content_chars: content ? content.length : 0
    });
  }

  // Определение work_type: явное из estimate → инференс из тендера → инференс из работы
  const workType =
    linkedEstimate?.work_type ||
    inferWorkType(tender?.tender_title) ||
    inferWorkType(tender?.group_tag) ||
    inferWorkType(work.work_title) ||
    inferWorkType(work.description);

  return { work, tender, documents: parsed, linkedEstimate, workType };
}

/**
 * 4. Аналогичные просчёты.
 *
 * Стратегия (cascade):
 *   1) По estimates.work_type если задан
 *   2) Иначе keyword-поиск по estimates.title и tenders.tender_title
 *   3) Fallback: последние approved/sent estimates с calculation_data
 */
async function getAnalogs(db, workType, excludeEstimateId = null, titleHint = null, onProgress) {
  safeProgress(onProgress, 'analogs', '📋 Анализирую аналоги похожих просчётов...');

  const baseSelect = `
    SELECT
       e.id, e.title, e.object_city, e.object_distance_km,
       e.crew_count, e.work_days, e.markup_multiplier,
       e.approval_status, e.created_at, e.customer, e.work_type,
       ecd.total_cost, ecd.total_with_margin, ecd.margin_pct,
       ecd.personnel_json, ecd.contingency_pct,
       t.customer_name AS tender_customer, t.tender_status, t.estimated_sum, t.tender_title
     FROM estimates e
     LEFT JOIN estimate_calculation_data ecd
            ON ecd.estimate_id = e.id
           AND ecd.version_no = COALESCE(e.current_version_no, 1)
     LEFT JOIN tenders t ON t.id = e.tender_id`;

  // 1. Точный work_type
  if (workType) {
    try {
      const params = [workType];
      let where = `WHERE e.work_type = $1 AND e.approval_status IN ('approved','rejected','sent')`;
      if (excludeEstimateId) { params.push(excludeEstimateId); where += ` AND e.id != $${params.length}`; }
      params.push(MAX_ANALOGS);
      const result = await db.query(`${baseSelect} ${where} ORDER BY e.created_at DESC LIMIT $${params.length}`, params);
      if (result.rows.length > 0) return result.rows;
    } catch (e) { console.warn('[AP2] getAnalogs work_type:', e.message); }
  }

  // 2. Keyword по title/tender_title — выделяем 1-2 значимых слова из titleHint
  if (titleHint) {
    const keyword = extractKeyword(titleHint);
    if (keyword) {
      try {
        const params = [`%${keyword}%`];
        let where = `WHERE (e.title ILIKE $1 OR t.tender_title ILIKE $1) AND e.approval_status IN ('approved','rejected','sent')`;
        if (excludeEstimateId) { params.push(excludeEstimateId); where += ` AND e.id != $${params.length}`; }
        params.push(MAX_ANALOGS);
        const result = await db.query(`${baseSelect} ${where} ORDER BY e.created_at DESC LIMIT $${params.length}`, params);
        if (result.rows.length > 0) return result.rows;
      } catch (e) { console.warn('[AP2] getAnalogs keyword:', e.message); }
    }
  }

  // 3. Fallback: любые approved с calc_data
  try {
    const result = await db.query(
      `${baseSelect} WHERE ecd.id IS NOT NULL AND e.approval_status IN ('approved','sent') ORDER BY e.created_at DESC LIMIT $1`,
      [MAX_ANALOGS]
    );
    return result.rows;
  } catch (e) {
    console.warn('[AP2] getAnalogs fallback:', e.message);
    return [];
  }
}

/**
 * Извлечь самое значимое слово из названия (для keyword-поиска аналогов).
 * Игнорирует короткие/служебные слова.
 */
function extractKeyword(text) {
  if (!text) return null;
  const STOP = new Set(['работ','работа','объект','цех','очистка','для','без','при','согласно','название']);
  const words = String(text).toLowerCase()
    .replace(/[«»"'\(\)\[\],.\d№#]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 5 && !STOP.has(w));
  // Возвращаем первое значимое слово (≥5 букв)
  return words[0] || null;
}

/**
 * 5. История тендеров заказчика (выиграли/проиграли).
 */
async function getCustomerHistory(db, customerName, onProgress) {
  safeProgress(onProgress, 'customer_history', '🏢 Смотрю историю работы с заказчиком...');
  if (!customerName || customerName.trim().length < 3) return [];
  try {
    const result = await db.query(
      `SELECT
          t.id, t.tender_title, t.estimated_sum, t.status, t.tender_status,
          t.deadline, t.created_at,
          e.markup_multiplier
        FROM tenders t
        LEFT JOIN estimates e
               ON e.tender_id = t.id
              AND e.id = (SELECT id FROM estimates WHERE tender_id = t.id ORDER BY id DESC LIMIT 1)
        WHERE t.customer_name ILIKE $1
        ORDER BY t.created_at DESC
        LIMIT $2`,
      [`%${customerName.trim()}%`, MAX_CUSTOMER_HISTORY]
    );
    return result.rows;
  } catch (e) {
    console.warn('[AP1] getCustomerHistory:', e.message);
    return [];
  }
}

/**
 * 6. Складские остатки — таблица equipment (chemicals/equipment/tools/PPE).
 *    Категории определяются через equipment_categories.
 */
async function getWarehouseStock(db, onProgress) {
  safeProgress(onProgress, 'warehouse', '🏭 Проверяю складские остатки...');
  try {
    const result = await db.query(
      `SELECT
          e.id, e.name, e.inventory_number, e.quantity, e.unit, e.status,
          e.category_id, e.brand, e.model, e.min_stock_level,
          c.name AS category_name,
          w.name AS warehouse_name
        FROM equipment e
        LEFT JOIN equipment_categories c ON c.id = e.category_id
        LEFT JOIN warehouses w ON w.id = e.warehouse_id
        WHERE COALESCE(e.is_active, true) = true
          AND COALESCE(e.status, 'available') NOT IN ('written_off','disposed','lost')
          AND COALESCE(e.quantity, 0) > 0
        ORDER BY c.name, e.name
        LIMIT $1`,
      [MAX_WAREHOUSE_ITEMS]
    );
    return result.rows;
  } catch (e) {
    console.warn('[AP1] getWarehouseStock:', e.message);
    return [];
  }
}

/**
 * 7. Свободные люди на период работ — раздельно ИТР (users) и полевые (employees).
 *
 * Архитектура:
 *   - ИТР (РП, главный инженер, начальник отдела РП) → таблица USERS, роли:
 *     PM, HEAD_PM, CHIEF_ENGINEER, FIELD_ENGINEER. Это тот кто отвечает за объект.
 *   - Полевые рабочие/мастера/жестянщики/монтажники → таблица EMPLOYEES (521 запись).
 *   - works.staff_ids_json содержит EMPLOYEES.id (не users.id!)
 *
 * Логика занятости:
 *   - Полевой занят, если его employees.id есть в staff_ids_json /
 *     approved_staff_ids_a/b_json у активной работы с пересекающимся периодом.
 *   - ИТР занят, если он pm_id у активной работы с пересекающимся периодом
 *     ИЛИ его user_id у employees есть в занятых.
 *
 * Возвращает:
 *   {
 *     itr_available:    [{id, name, role, login}],   // ИТР из users
 *     field_available:  [{id, full_name, position, employees_id}], // полевые из employees
 *     itr_busy_count, field_busy_count,
 *     period: {start, end}
 *   }
 */
async function getAvailableWorkers(db, startDate, endDate, onProgress) {
  safeProgress(onProgress, 'workers', '👷 Проверяю свободных рабочих на период...');

  const ITR_ROLES = "('PM','HEAD_PM','CHIEF_ENGINEER','FIELD_ENGINEER','FOREMAN','MASTER')";

  async function fetchItr(busyItrIds = []) {
    const itrParams = [];
    let itrBusyClause = '';
    if (busyItrIds.length > 0) {
      itrParams.push(busyItrIds);
      itrBusyClause = ` AND id != ALL($${itrParams.length}::int[])`;
    }
    itrParams.push(MAX_ITR_USERS);
    const limitIdx = itrParams.length;
    const res = await db.query(
      `SELECT id, name, role, login FROM users
        WHERE is_active = true AND role IN ${ITR_ROLES}${itrBusyClause}
        ORDER BY role, name LIMIT $${limitIdx}`,
      itrParams
    );
    return res.rows;
  }

  async function fetchField(busyEmpIds = []) {
    const fieldParams = [];
    let fieldBusyClause = '';
    if (busyEmpIds.length > 0) {
      fieldParams.push(busyEmpIds);
      fieldBusyClause = ` AND id != ALL($${fieldParams.length}::int[])`;
    }
    fieldParams.push(MAX_FIELD_EMPLOYEES);
    const limitIdx = fieldParams.length;
    // ВАЖНО: тянем role_tag (это правильное поле — Слесарь/Сварщик/РП), а не position (мусорное)
    const res = await db.query(
      `SELECT id, COALESCE(full_name, fio) AS full_name, position, role_tag, grade
         FROM employees
        WHERE COALESCE(is_active, true) = true
          AND dismissal_date IS NULL${fieldBusyClause}
        ORDER BY role_tag NULLS LAST, full_name
        LIMIT $${limitIdx}`,
      fieldParams
    );
    return res.rows;
  }

  // Без дат — все активные
  if (!startDate || !endDate) {
    try {
      const [itr, field] = await Promise.all([fetchItr([]), fetchField([])]);
      return {
        itr_available: itr,
        field_available: field,
        itr_busy_count: 0,
        field_busy_count: 0,
        buckets: bucketEmployees(field),
        note: 'Даты работы не указаны — показан полный список.'
      };
    } catch (e) {
      console.warn('[AP3.5] getAvailableWorkers (no dates):', e.message);
      return { itr_available: [], field_available: [], itr_busy_count: 0, field_busy_count: 0, buckets: emptyBuckets(), error: e.message };
    }
  }

  try {
    // 1. employee_ids которые заняты на пересекающихся работах
    const busyEmployeesRes = await db.query(
      `SELECT DISTINCT
              jsonb_array_elements_text(
                COALESCE(staff_ids_json, '[]'::jsonb) ||
                COALESCE(approved_staff_ids_a_json, '[]'::jsonb) ||
                COALESCE(approved_staff_ids_b_json, '[]'::jsonb)
              )::int AS emp_id
         FROM works
        WHERE work_status NOT IN ('Завершена','Отменена','archived')
          AND deleted_at IS NULL
          AND COALESCE(start_plan, start_in_work_date) <= $2::date
          AND COALESCE(end_plan, end_fact, start_plan + INTERVAL '30 days') >= $1::date`,
      [startDate, endDate]
    );
    const busyEmpIds = busyEmployeesRes.rows.map(r => r.emp_id).filter(id => id != null);

    // 2. pm_id занятых ИТР
    const busyItrRes = await db.query(
      `SELECT DISTINCT pm_id FROM works
        WHERE work_status NOT IN ('Завершена','Отменена','archived')
          AND deleted_at IS NULL
          AND pm_id IS NOT NULL
          AND COALESCE(start_plan, start_in_work_date) <= $2::date
          AND COALESCE(end_plan, end_fact, start_plan + INTERVAL '30 days') >= $1::date`,
      [startDate, endDate]
    );
    const busyItrIds = busyItrRes.rows.map(r => r.pm_id).filter(id => id != null);

    // 3. Параллельно тянем ИТР и полевых
    const [itr, field] = await Promise.all([fetchItr(busyItrIds), fetchField(busyEmpIds)]);

    return {
      itr_available: itr,
      field_available: field,
      itr_busy_count: busyItrIds.length,
      field_busy_count: busyEmpIds.length,
      buckets: bucketEmployees(field),
      period: { start: startDate, end: endDate }
    };
  } catch (e) {
    console.warn('[AP3.5] getAvailableWorkers:', e.message);
    return { itr_available: [], field_available: [], itr_busy_count: 0, field_busy_count: 0, buckets: emptyBuckets(), error: e.message };
  }
}

/**
 * Распределить employees по bucket-категориям для prompt-агрегации.
 *
 * Логика: основная классификация по role_tag (правильное поле в БД),
 * с уточнением через position (Бригадир, Изолировщик, Жестянщик и т.д.).
 * Position — носитель ДОПОЛНИТЕЛЬНОЙ специализации, НЕ ограничения!
 * Слесарь-монтажник + изолировщик может работать и слесарем, и изолировщиком.
 */
function bucketEmployees(employees) {
  const buckets = emptyBuckets();
  if (!employees || employees.length === 0) return buckets;

  for (const e of employees) {
    const tag = String(e.role_tag || '').toLowerCase().trim();
    const pos = String(e.position || '').toLowerCase();
    buckets.total++;

    // Главная классификация по role_tag
    if (tag === 'сварщик' || /\bсварщик\b/.test(pos)) {
      buckets.welders++;
      // Бригадиры
      if (/бригадир/.test(pos)) buckets.foremen++;
    } else if (tag === 'слесарь' || tag === '' || tag === null || tag === 'без тега') {
      // role_tag "Слесарь" = универсал. Также NULL/пустой → считаем универсалом.
      buckets.universals++;
      if (/бригадир/.test(pos)) buckets.foremen++;
    } else if (tag === 'рп') {
      // РП-сотрудники в employees — это руководители проектов/бригадиры,
      // НЕ ИТР из users. Считаем как foremen.
      buckets.foremen++;
    } else {
      buckets.other++;
    }

    // Уточнения по position (могут пересекаться с основной категорией)
    if (/изолировщик/.test(pos)) buckets.insulators++;
    if (/жестянщик/.test(pos)) buckets.tinsmiths++;
    if (/монтажник/.test(pos)) buckets.assemblers++;
    if (/мастер/.test(pos) && !/менеджер|тендер|закупок|бухгалтер|директор/.test(pos)) buckets.masters++;
    if (/водитель/.test(pos)) buckets.drivers++;
    if (/химик/.test(pos)) buckets.chemists++;
  }
  return buckets;
}

function emptyBuckets() {
  return {
    total: 0,
    universals: 0,    // Слесари-универсалы (role_tag=Слесарь)
    welders: 0,       // Сварщики (role_tag=Сварщик) — требуют НАКС
    foremen: 0,       // Бригадиры
    insulators: 0,    // Изолировщики
    tinsmiths: 0,     // Жестянщики
    assemblers: 0,    // Монтажники
    masters: 0,       // Мастера (полевые, не менеджеры)
    drivers: 0,       // Водители
    chemists: 0,      // Химики
    other: 0
  };
}

/**
 * 7b. Сводка допусков для списка employees.
 *
 * Возвращает:
 *   {
 *     by_type:    { 'НАКС': 23, 'ОТЗП (1 группа)': 11, ... },
 *     by_employee: { 567: ['НАКС','Высота 2'], ... },     // top-N
 *     total_active: <число допусков>,
 *     expiring_soon: [{employee_id, full_name, type, expiry_date}, ... ]  // < 30 дней
 *   }
 *
 * Используется для:
 *   - передачи в AI prompt сводки "у нас X с допуском НАКС, Y с ОТЗП"
 *   - предупреждения о допусках которые скоро истекают
 */
async function getEmployeePermitsSummary(db, employeeIds, onProgress) {
  safeProgress(onProgress, 'permits', '🛡 Проверяю допуска свободных сотрудников...');

  if (!employeeIds || employeeIds.length === 0) {
    return { by_type: {}, by_employee: {}, total_active: 0, expiring_soon: [] };
  }

  try {
    const result = await db.query(
      `SELECT
          ep.employee_id, ep.permit_type, ep.expiry_date, ep.status,
          pt.name AS type_name,
          e.full_name, e.fio, e.position
       FROM employee_permits ep
       LEFT JOIN permit_types pt ON pt.id = ep.type_id
       LEFT JOIN employees e ON e.id = ep.employee_id
       WHERE ep.employee_id = ANY($1::int[])
         AND COALESCE(ep.is_active, true) = true
         AND (ep.expiry_date IS NULL OR ep.expiry_date >= CURRENT_DATE)
         AND COALESCE(ep.status, 'active') = 'active'`,
      [employeeIds]
    );

    const by_type = {};
    const by_employee = {};
    const expiring_soon = [];
    const SOON_DAYS = 30;
    const now = Date.now();

    for (const row of result.rows) {
      const typeName = row.type_name || row.permit_type || 'Прочее';
      by_type[typeName] = (by_type[typeName] || 0) + 1;

      if (!by_employee[row.employee_id]) by_employee[row.employee_id] = [];
      by_employee[row.employee_id].push(typeName);

      if (row.expiry_date) {
        const exp = new Date(row.expiry_date).getTime();
        const daysLeft = Math.round((exp - now) / 86400000);
        if (daysLeft <= SOON_DAYS && daysLeft >= 0) {
          expiring_soon.push({
            employee_id: row.employee_id,
            full_name: row.full_name || row.fio || `#${row.employee_id}`,
            position: row.position || null,
            type: typeName,
            expiry_date: row.expiry_date,
            days_left: daysLeft
          });
        }
      }
    }

    return {
      by_type,
      by_employee,
      total_active: result.rows.length,
      employees_with_permits: Object.keys(by_employee).length,
      expiring_soon: expiring_soon.sort((a, b) => a.days_left - b.days_left).slice(0, 20)
    };
  } catch (e) {
    console.warn('[AP3] getEmployeePermitsSummary:', e.message);
    return { by_type: {}, by_employee: {}, total_active: 0, expiring_soon: [], error: e.message };
  }
}

/**
 * 8. Тарифная сетка из field_tariff_grid, сгруппированная по категории.
 *    Категории: mlsp, ground, ground_heavy, warehouse (+ возможны другие).
 */
async function getTariffGrid(db, onProgress) {
  safeProgress(onProgress, 'tariffs', '💰 Загружаю тарифную сетку...');
  try {
    const result = await db.query(
      `SELECT category, position_name, points, rate_per_shift, point_value,
              is_combinable, requires_approval, sort_order
         FROM field_tariff_grid
        WHERE COALESCE(is_active, true) = true
        ORDER BY category, sort_order, points`
    );
    // Группировка по category
    const grouped = {};
    for (const row of result.rows) {
      const cat = row.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(row);
    }
    return { rows: result.rows, grouped };
  } catch (e) {
    console.warn('[AP1] getTariffGrid:', e.message);
    return { rows: [], grouped: {} };
  }
}

/**
 * 9. Настройки расчёта (НДС из БД, остальное — DEFAULT_SETTINGS).
 */
async function getCalcSettings(db) {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    const result = await db.query(
      "SELECT key, value_json FROM settings WHERE key IN ('vat_default_pct','fot_pct','overhead_pct','consumables_pct','contingency_pct')"
    );
    for (const row of result.rows) {
      const v = row.value_json;
      if (row.key === 'vat_default_pct') settings.vat_pct = parseFloat(v) || settings.vat_pct;
      if (row.key === 'fot_pct') settings.fot_tax_pct = parseFloat(v) || settings.fot_tax_pct;
      if (row.key === 'overhead_pct') settings.overhead_pct = parseFloat(v) || settings.overhead_pct;
      if (row.key === 'consumables_pct') settings.consumables_pct = parseFloat(v) || settings.consumables_pct;
      if (row.key === 'contingency_pct') settings.contingency_pct = parseFloat(v) || settings.contingency_pct;
    }
  } catch (e) { /* fallback to defaults */ }
  return settings;
}

/**
 * MAIN: Собирает ВЕСЬ контекст для авто-просчёта работы.
 *
 * @param {Object} db — Postgres client с .query()
 * @param {number} workId
 * @param {Object} user — текущий пользователь (для логирования)
 * @param {Function} onProgress — колбек прогресса (event) => void
 * @returns {Promise<Object>} полный контекст
 */
async function buildAutoEstimateContext(db, workId, user, onProgress) {
  const t0 = Date.now();

  safeProgress(onProgress, 'start', '🚀 Начинаю собирать данные для просчёта...');

  // Шаг 1+2+3: работа + тендер + документы + work_type (последовательно — внутри есть progress)
  const { work, tender, documents, linkedEstimate, workType } = await getWorkContext(db, workId, onProgress);

  // Период работ для проверки рабочих
  const startDate = work.start_plan || work.start_in_work_date || null;
  const endDate = work.end_plan || work.end_fact || null;

  // titleHint для keyword-поиска аналогов (если work_type не нашёлся)
  const titleHint = tender?.tender_title || work.work_title || null;

  // Шаги 4-9: параллельно
  const [
    analogs,
    customerHistory,
    warehouse,
    workers,
    tariffs,
    settings
  ] = await Promise.all([
    getAnalogs(db, workType, linkedEstimate?.id || null, titleHint, onProgress),
    getCustomerHistory(db, work.customer_name || tender?.customer_name, onProgress),
    getWarehouseStock(db, onProgress),
    getAvailableWorkers(db, startDate, endDate, onProgress),
    getTariffGrid(db, onProgress),
    getCalcSettings(db)
  ]);

  // Шаг 7b: Допуска для свободных полевых сотрудников
  // (запускается ПОСЛЕ workers — нужны их id'шники)
  const fieldEmpIds = (workers.field_available || []).map(e => e.id);
  const permits = await getEmployeePermitsSummary(db, fieldEmpIds, onProgress);

  const elapsedMs = Date.now() - t0;

  const summary = {
    work_id: workId,
    work_title: work.work_title || work.work_number || `Работа #${workId}`,
    customer_name: work.customer_name || tender?.customer_name || null,
    object_name: work.object_name || null,
    has_tender: !!tender,
    tender_id: tender?.id || null,
    documents_count: documents.length,
    documents_parsed: documents.filter(d => d.content_chars > 0).length,
    analogs_count: analogs.length,
    customer_history_count: customerHistory.length,
    warehouse_items: warehouse.length,
    itr_available: workers.itr_available?.length || 0,
    field_available: workers.field_available?.length || 0,
    field_universals: workers.buckets?.universals || 0,
    field_welders: workers.buckets?.welders || 0,
    permits_total: permits.total_active,
    permits_employees: permits.employees_with_permits,
    tariff_categories: Object.keys(tariffs.grouped || {}).length,
    work_type: workType,
    period: { start: startDate, end: endDate },
    elapsed_ms: elapsedMs,
    // Edge-case флаги для UI
    flags: {
      no_tender: !tender,
      no_documents: documents.length === 0,
      no_parsed_documents: documents.filter(d => d.content_chars > 0).length === 0,
      no_field_workers: (workers.field_available?.length || 0) === 0,
      no_itr: (workers.itr_available?.length || 0) === 0,
      no_analogs: analogs.length === 0,
      expired_permits_soon: permits.expiring_soon.length > 0
    }
  };

  safeProgress(onProgress, 'collected', '✅ Все данные собраны', summary);

  return {
    work,
    tender,
    documents,
    linkedEstimate,
    workType,
    analogs,
    customer_history: customerHistory,
    warehouse,
    workers,
    permits,
    tariffs,
    settings,
    summary
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AP2: AI PIPELINE — Claude Sonnet 4.6 → JSON → валидация → INSERT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Округлить число до 2 знаков (как «деньги»).
 */
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/**
 * Сериализатор тарифной сетки для prompt — компактный текст.
 */
function tariffsToPrompt(tariffs) {
  const lines = [];
  for (const cat of Object.keys(tariffs.grouped || {})) {
    lines.push(`[${cat}]`);
    for (const row of tariffs.grouped[cat]) {
      lines.push(`  ${row.position_name}: ${row.points} б × ${Number(row.point_value)}₽ = ${Number(row.rate_per_shift)}₽/смену`);
    }
  }
  return lines.join('\n') || '(тарифная сетка пуста)';
}

/**
 * Сериализатор аналогов для prompt — основные метрики каждого.
 */
function analogsToPrompt(analogs) {
  if (!analogs || analogs.length === 0) return '(аналогов не найдено)';
  return analogs.map(a => {
    const parts = [
      `#${a.id}`,
      a.title || a.tender_title || '?',
      a.tender_customer ? `заказчик: ${a.tender_customer}` : null,
      a.crew_count ? `${a.crew_count}ч` : null,
      a.work_days ? `${a.work_days}дн` : null,
      a.total_cost ? `себес ${Math.round(Number(a.total_cost)).toLocaleString('ru-RU')}₽` : null,
      a.total_with_margin ? `клиенту ${Math.round(Number(a.total_with_margin)).toLocaleString('ru-RU')}₽` : null,
      a.markup_multiplier ? `×${a.markup_multiplier}` : null,
      a.margin_pct ? `маржа ${a.margin_pct}%` : null,
      a.approval_status,
    ].filter(Boolean);
    return '  - ' + parts.join(' | ');
  }).join('\n');
}

/**
 * Сериализатор истории заказчика.
 */
function customerHistoryToPrompt(rows) {
  if (!rows || rows.length === 0) return '(нет тендеров с этим заказчиком)';
  return rows.map(t => {
    const status = t.status || t.tender_status || '?';
    const result = /won|выиграли|подписан/i.test(status) ? 'ВЫИГРАЛИ'
                 : /lost|reject|проигр|отказ/i.test(status) ? 'ПРОИГРАЛИ' : status;
    return `  - #${t.id} ${t.tender_title || ''} | ${result} | ${t.estimated_sum ? Math.round(Number(t.estimated_sum)).toLocaleString('ru-RU') + '₽' : '—'} | наценка ×${t.markup_multiplier || '?'}`;
  }).join('\n');
}

/**
 * Сериализатор склада — группируем по категориям.
 */
function warehouseToPrompt(items) {
  if (!items || items.length === 0) return '(склад пуст)';
  const byCat = {};
  for (const it of items) {
    const cat = it.category_name || 'Прочее';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(`${it.name}: ${it.quantity || 1}${it.unit ? ' ' + it.unit : ''}`);
  }
  return Object.entries(byCat).map(([cat, list]) =>
    `[${cat}] ${list.slice(0, 15).join(', ')}${list.length > 15 ? ` … и ещё ${list.length - 15}` : ''}`
  ).join('\n');
}

/**
 * Сериализатор допусков для prompt с группировкой по СЕМЕЙСТВАМ:
 *  ОТЗП (1+2+3+замкнутые) → одна строка-итого + детализация
 *  Работы на высоте (1+2+3) → одна строка-итого + детализация
 *  Электробезопасность (II-V) → одна строка-итого + детализация
 *  Мед.осмотры всех видов → одна строка-итого
 *  Остальное — как есть
 */
function permitsToPrompt(permits) {
  if (!permits || !permits.by_type || Object.keys(permits.by_type).length === 0) {
    return '(допуска не загружены или их нет)';
  }

  // Группируем по семействам
  const FAMILIES = {
    otzp: { label: 'ОТЗП (любая группа)', match: /отзп|замкнут/i, types: [] },
    height: { label: 'Работы на высоте (любая группа)', match: /высот/i, types: [] },
    elec: { label: 'Электробезопасность (II-V)', match: /электробезоп/i, types: [] },
    med: { label: 'Мед.осмотры', match: /мед\.?осмотр|медицинский/i, types: [] }
  };
  const others = [];

  for (const [type, count] of Object.entries(permits.by_type)) {
    let matched = false;
    for (const fam of Object.values(FAMILIES)) {
      if (fam.match.test(type)) {
        fam.types.push({ type, count });
        matched = true;
        break;
      }
    }
    if (!matched) others.push({ type, count });
  }

  const lines = ['Сводка по типам допусков (сколько свободных сотрудников имеют):'];

  // Семьи (с агрегатом + детализацией)
  for (const fam of Object.values(FAMILIES)) {
    if (fam.types.length === 0) continue;
    const total = fam.types.reduce((s, t) => s + t.count, 0);
    // Детализация: вытаскиваем "1 группа", "II группа" и т.п. — обычно в скобках
    const detail = fam.types.map(t => {
      const m = t.type.match(/\(([^)]+)\)/);
      const sub = m ? m[1] : t.type;
      return `${sub}: ${t.count}`;
    }).join(', ');
    lines.push(`  - ${fam.label}: ${total} чел  [${detail}]`);
  }

  // Остальные допуски — отсортированы по убыванию
  others.sort((a, b) => b.count - a.count);
  for (const { type, count } of others) {
    lines.push(`  - ${type}: ${count} чел`);
  }

  if (permits.expiring_soon && permits.expiring_soon.length > 0) {
    lines.push('');
    lines.push(`⚠️ Истекают в течение 30 дней (${permits.expiring_soon.length}):`);
    for (const ex of permits.expiring_soon.slice(0, 10)) {
      lines.push(`  - ${ex.full_name} / ${ex.type} → ${ex.expiry_date} (${ex.days_left} дн)`);
    }
  }
  return lines.join('\n');
}

/**
 * Сериализатор bucket'ов сотрудников для prompt.
 */
function workersBucketsToPrompt(workers) {
  const b = workers.buckets || {};
  const lines = [];
  lines.push(`ИТОГО свободных полевых: ${b.total || 0}`);
  lines.push(`Из них:`);
  lines.push(`  - Слесари-универсалы (role_tag=Слесарь): ${b.universals || 0}`);
  lines.push(`    ↳ выполняют ЛЮБЫЕ полевые работы: монтаж, демонтаж, чистка, изоляция, промывка, такелаж`);
  lines.push(`  - Сварщики (role_tag=Сварщик, требуют НАКС): ${b.welders || 0}`);
  lines.push(`    ↳ привлекаются ТОЛЬКО для сварочных работ`);
  if (b.foremen) lines.push(`  - Бригадиры (среди слесарей/сварщиков): ${b.foremen}`);
  if (b.masters) lines.push(`  - Мастера (полевые): ${b.masters}`);
  lines.push('');
  lines.push(`Дополнительные специализации (могут совмещать с основной ролью):`);
  if (b.insulators) lines.push(`  - Изолировщики: ${b.insulators}`);
  if (b.tinsmiths) lines.push(`  - Жестянщики: ${b.tinsmiths}`);
  if (b.assemblers) lines.push(`  - Монтажники ТТ (трубопроводов): ${b.assemblers}`);
  if (b.drivers) lines.push(`  - Водители: ${b.drivers}`);
  if (b.chemists) lines.push(`  - Химики: ${b.chemists}`);
  return lines.join('\n');
}

/**
 * Сериализатор документов.
 */
function documentsToPrompt(docs) {
  if (!docs || docs.length === 0) return '(нет приложенных документов)';
  return docs.map(d => {
    const head = `  📄 ${d.original_name} (${d.size_kb}KB)`;
    if (!d.content) return head;
    const sample = d.content.replace(/\s+/g, ' ').substring(0, 4000);
    return `${head}\n  Содержимое:\n${sample}`;
  }).join('\n\n');
}

/**
 * Построить полный system prompt для Claude.
 */
function buildAutoEstimatePrompt(ctx) {
  const work = ctx.work;
  const tender = ctx.tender;
  const settings = ctx.settings;

  const startDate = work.start_plan || work.start_in_work_date || tender?.work_start_plan;
  const endDate = work.end_plan || work.end_fact || tender?.work_end_plan;

  // ВАЖНО: вычисляем размер ОКНА ПО ДАТАМ — это ВЕРХНЯЯ граница для work_days+road_days+mobilization
  let dateWindowDays = null;
  if (startDate && endDate) {
    const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
    dateWindowDays = Math.max(1, Math.round(ms / 86400000) + 1); // включительно
  }

  // Edge flags для AI — что отсутствует в данных
  const flagWarnings = [];
  if (!tender) flagWarnings.push('⚠️ РАБОТА БЕЗ ТЕНДЕРА — описание объекта неполное, делай предположения консервативно');
  if (ctx.documents.length === 0) flagWarnings.push('⚠️ НЕТ ПРИЛОЖЕННЫХ ДОКУМЕНТОВ — ТЗ недоступно, расчёт по шаблону');
  if ((ctx.workers.field_available?.length || 0) === 0) flagWarnings.push('⚠️ НЕТ СВОБОДНЫХ ПОЛЕВЫХ — все заняты, нужно привлечение со стороны (+доплата 30%)');
  if ((ctx.workers.itr_available?.length || 0) === 0) flagWarnings.push('⚠️ НЕТ СВОБОДНОГО ИТР — потребуется внештатный РП или совмещение');
  if (ctx.analogs.length === 0) flagWarnings.push('ℹ️ Аналогов нет — наценку выбирай консервативно (×2.0-2.3)');

  return `Ты Мимир — ИИ-ассистент ООО «Асгард Сервис». Задача: заполнить просчёт для работы.

${flagWarnings.length > 0 ? '═══ EDGE-ФЛАГИ ═══\n' + flagWarnings.join('\n') + '\n' : ''}
═══ ДАННЫЕ РАБОТЫ ═══
ID работы: ${work.id}
Название: ${work.work_title || '—'}
Заказчик: ${work.customer_name || tender?.customer_name || '—'}
Объект: ${work.object_name || '—'}
Город: ${work.city || tender?.tender_region || '—'}
Адрес: ${work.address || work.object_address || '—'}
Период: ${startDate || '?'} — ${endDate || '?'}${dateWindowDays ? ` (ОКНО = ${dateWindowDays} календарных дней)` : ''}
Контракт: ${work.contract_value ? Math.round(Number(work.contract_value)).toLocaleString('ru-RU') + '₽' : 'не задан'}
Бригада в работе: ${work.crew_size || '—'}
Тип работ (определён эвристикой): ${ctx.workType || '—'}

⛔⛔⛔ АБСОЛЮТНОЕ ОГРАНИЧЕНИЕ ПО СРОКАМ ⛔⛔⛔
${dateWindowDays
  ? `Окно работ = ${dateWindowDays} календарных дней (${startDate} → ${endDate}).
   ЭТО ЖЁСТКАЯ ГРАНИЦА — ЗАКАЗЧИК НЕ ДАСТ БОЛЬШЕ ВРЕМЕНИ. Не приходи к выводу
   "в окно не помещается" — заказчик уже подписал договор на эти даты.

   В окно ${dateWindowDays} дней ОБЯЗАТЕЛЬНО ВХОДИТ:
   - дорога туда (road_days)
   - 1-2 дня мобилизации на объекте
   - work_days (чистые рабочие смены)
   - 1-2 дня демобилизации
   - дорога обратно (road_days)

   ФОРМУЛА: work_days = ${dateWindowDays} − road_days*2 − 4 (моб+демоб)
   Например: при road_days=2 → work_days = ${Math.max(1, dateWindowDays - 8)}.
   При road_days=3 → work_days = ${Math.max(1, dateWindowDays - 10)}.

   ЕСЛИ ОБЪЁМ НЕ ПОМЕЩАЕТСЯ В work_days — УВЕЛИЧИВАЙ БРИГАДУ, А НЕ ДНИ.
   Например, если 1 бригада 8 чел сделает за 30 дней — поставь 2 бригады
   12 чел и сделай за 15 дней. Заказчик платит за объём, а не за время.

   КАТЕГОРИЧЕСКИ: work_days + road_days*2 + 4 ≤ ${dateWindowDays} ВСЕГДА.
   Если ты вернёшь work_days больше этой формулы — ответ будет ОТБРОШЕН
   и пересчитан вручную.`
  : 'Срок не задан в работе. Считай по объёму работ × производительность бригады.'}

═══ ТЕНДЕР ═══
${tender ? `ID: #${tender.id}
Название: ${tender.tender_title || '—'}
Описание: ${tender.tender_description || '—'}
Регион: ${tender.tender_region || '—'}
Сумма: ${tender.estimated_sum ? Math.round(Number(tender.estimated_sum)).toLocaleString('ru-RU') + '₽' : '—'}
Статус: ${tender.tender_status || tender.status || '—'}
Категория: ${tender.group_tag || '—'}
Дедлайн: ${tender.deadline || tender.docs_deadline || '—'}
Комментарий: ${tender.tender_comment_to || tender.comment_to || '—'}` : '(работа не привязана к тендеру)'}

═══ ДОКУМЕНТЫ (${ctx.documents.length}, ${ctx.documents.filter(d => d.content_chars > 0).length} распарсено) ═══
${documentsToPrompt(ctx.documents)}

═══ АНАЛОГИ (${ctx.analogs.length}) ═══
${analogsToPrompt(ctx.analogs)}

═══ ИСТОРИЯ ТЕНДЕРОВ ЗАКАЗЧИКА (${ctx.customer_history.length}) ═══
${customerHistoryToPrompt(ctx.customer_history)}

═══ СКЛАД (${ctx.warehouse.length} позиций) ═══
${warehouseToPrompt(ctx.warehouse)}

═══ СВОБОДНЫЕ ИТР / РП (${ctx.workers.itr_available?.length || 0}) ═══
Занято на других работах: ${ctx.workers.itr_busy_count || 0}
${(ctx.workers.itr_available || []).slice(0, 30).map(w => `  - #${w.id} ${w.name} (${w.role})`).join('\n') || '(нет свободных ИТР)'}

═══ СВОБОДНЫЕ ПОЛЕВЫЕ — АГРЕГАТЫ ═══
Занято на других работах: ${ctx.workers.field_busy_count || 0}
${workersBucketsToPrompt(ctx.workers)}

ВАЖНО О СПЕЦИАЛИЗАЦИИ:
- В компании ~500 полевых сотрудников, из них ~90% — слесари-универсалы.
- "Слесарь-универсал" в Асгард = монтажник + слесарь + промывщик + такелажник
  + демонтажник одновременно. ОДИН сотрудник делает любую работу: чистка,
  монтаж, демонтаж, изоляция, промывка, обслуживание. НЕ нужно искать
  "промывщика" или "монтажника" отдельно — это всё универсалы.
- ТОЛЬКО сварочные работы требуют отдельного сварщика с допуском НАКС.
- Изолировщик/жестянщик/химик — это уточнение специализации, такие сотрудники
  МОГУТ ДЕЛАТЬ И ОБЩИЕ работы (они тоже слесари-универсалы внутри роли).

═══ ДОПУСКА СВОБОДНЫХ СОТРУДНИКОВ (${ctx.permits?.total_active || 0} активных, у ${ctx.permits?.employees_with_permits || 0} человек) ═══
${permitsToPrompt(ctx.permits)}

═══ ТАРИФНАЯ СЕТКА ═══
${tariffsToPrompt(ctx.tariffs)}

═══ НАСТРОЙКИ РАСЧЁТА ═══
- НДС: ${settings.vat_pct}%
- Налог на ФОТ: ${settings.fot_tax_pct}%
- Накладные: ${settings.overhead_pct}%
- Расходные: ${settings.consumables_pct}%
- Непредвиденные: ${settings.contingency_pct}% (МИНИМУМ — лучше 12-15%, не занижай!)
- ИТР: ${settings.itr_rate_per_day}₽/смена (фиксированная)

ПРИНЦИП: лучше НЕМНОГО ЗАВЫСИТЬ цену, чем занизить. Заказчик всегда торгуется
вниз, но НИКОГДА вверх. Буфер безопасности = непредвиденные ${settings.contingency_pct}%.

═══ ОБЯЗАТЕЛЬНЫЕ СТАТЬИ РАСХОДОВ (ЧЕКЛИСТ — НЕ ПРОПУСКАЙ!) ═══

📌 Блок "personnel" — персонал:
  - Рабочие/слесари: count × rate_per_day × work_days
  - Мастера: count × rate_per_day × work_days (ставка из тарифной сетки, НЕ 10000)
  - ИТР (РП): 1 × 10000₽ × (work_days + road_days*2 + 2 дня моб/демоб)
  - ⚡ ПОДГОТОВКА НА СКЛАДЕ: 2-3 дня перед выездом (погрузка, комплектация оборудования).
    count = 3-4 рабочих × ставка × 2 дня. Добавь отдельной строкой "Подготовка на складе".
  - ⚡ ОПЛАТА ДНЕЙ ДОРОГИ: road_days × 3 000₽/чел/день × кол-во людей.
    Добавь строкой "Дни дороги". Ставка 3000₽ (6 баллов × 500₽) — фиксированная.

📌 Блок "current_costs" — текущие расходы:
  НА КАЖДОГО работника:
  - СИЗ: минимум 15 000₽/чел (каска, ботинки, комбинезон, перчатки, очки, респиратор, страховочная привязь)
  - Спецодежда: минимум 10 000₽/чел (зимняя/летняя роба, жилет сигнальный, термобельё)
  ⚠️ СИЗ + спецодежда = 25 000₽/чел МИНИМУМ. Это КРУПНАЯ статья, НЕ ЗАНИЖАЙ.
  - ⚠️ Страхование: НЕ ВКЛЮЧАЙ — Асгард не закладывает это в просчёт.
  - ⚠️ "Пропуска": такой статьи НЕТ. Вместо неё:
    ОБУЧЕНИЕ И ДОПУСКИ: Посмотри раздел "ДОПУСКА СВОБОДНЫХ СОТРУДНИКОВ" —
    если у свободных рабочих УЖЕ ЕСТЬ нужные корочки (ОТЗП, Высота и т.д.) → 0₽.
    Если НЕТ (не хватает людей с нужным допуском) → заложи обучение:
    ~15 000-30 000₽/чел (курс ОТЗП ~20т, Высота ~15т, НАКС ~40т).
    Добавь в current_costs ТОЛЬКО если людей с допуском НЕ ХВАТАЕТ.
  НА БРИГАДУ:
  - Оборудование: СМОТРИ ДАННЫЕ СКЛАДА.
    Если на складе ЕСТЬ нужное оборудование → амортизация 0.5%/день × work_days
    Если на складе НЕТ нужного оборудования → НЕ ПИШИ амортизацию!
    → вместо этого добавь в purchases_needed (аренда или покупка).
    ⚠️ НЕ ВЫДУМЫВАЙ что оборудование есть если его нет на складе.
  - Расходники: насадки, щётки, прокладки, шланги, ленты — 30-80 тыс₽ на проект

📌 Блок "travel" — командировочные (рассчитывай НА КАЖДОГО × ВСЕ ДНИ):
  - Пайковые: 1 000₽/чел/день × total_days (work_days + road_days*2 + моб/демоб).
    ⚠️ В Асгарде НЕТ СУТОЧНЫХ — только пайковые. НЕ добавляй строку "Суточные"!
  - Проживание: 1 500₽/чел/ночь МАКСИМУМ (арендуем квартиры, не гостиницы). На все ночи.
  - Билеты — расписывай КАЖДЫЙ СЕГМЕНТ ОТДЕЛЬНО:
    Маршрут: Саратов → Москва → город объекта (туда), обратно аналогично.
    Каждый сегмент — отдельная строка в JSON travel:
      1) Саратов → Москва (поезд, ~12-16 часов)
      2) Москва → город объекта (поезд или самолёт — в зависимости от расстояния)
      3) Обратно: город → Москва
      4) Обратно: Москва → Саратов
    ⚠️ Авиарейсов из Саратова почти нет. Считай ПОЕЗД для Саратов↔Москва.
    ⚠️ НЕ ХАРДКОДЬ цены — ставь ориентировочные, пиши вид транспорта (поезд/самолёт).
    Примерные ориентиры: плацкарт ~3000₽, купе ~5000-8000₽, СВ ~10000₽, самолёт ~8000-15000₽.

📌 Блок "transport" — логистика оборудования:
  - Доставка оборудования со склада на объект:
    Считай по расстоянию: ~18-20₽/км для Газели, ~25-30₽/км для КамАЗа.
    МИНИМУМ 70-80 тыс₽ в одну сторону для дальних объектов (>2000 км).
    Обратно — тоже! ИТОГО = цена × 2.
    Примеры: Саратов→Москва(800км): ~25-30т Газель. Саратов→Кемерово(4000км): ~80-100т КамАЗ.
  - Манипулятор на объекте: 5 000₽/день (если тяжёлое оборудование)
  - Такси/служебный транспорт по городу: 1 500₽/день на бригаду

📌 Блок "chemistry" — химия/материалы:
  - Только если тип работ CHEM. При HYDRO_MECH химия не нужна.
  - Расходники: насадки, щётки, прокладки — 30-50 тыс₽ комплект

📌 Оборудование (ОБЯЗАТЕЛЬНО УЧТИ — ЭТО КРУПНАЯ СТАТЬЯ):
  ⚡ АЛГОРИТМ:
  1. Определи какое оборудование НУЖНО для этого типа работ (см. таблицу ниже)
  2. Посмотри раздел "СКЛАД" — есть ли оно? Ищи по ключевым словам (АВД, насос, шланг, и т.д.)
  3. Если ЕСТЬ на складе → current_costs: амортизация 0.5%/день × стоимость × work_days
  4. Если НЕТ на складе → purchases_needed с ценой аренды или покупки

  ОБЯЗАТЕЛЬНОЕ ОБОРУДОВАНИЕ ПО ТИПАМ РАБОТ (цены ориентировочные, уточняй у поставщиков):
  - HYDRO_MECH/HYDRO_DYN: Установка гидромеханической очистки (Вулкан, Тайфун, Посейдон),
    шланги ВД, насадки/сопла под диаметр труб, запасные головки, фильтры.
    Российские производители: ООО «Тайфун», ООО «Практик». Покупка 1 установки ~150-300 тыс₽.
  - CHEM: Насосы перекачки, ёмкости для растворов, фитинги, обвязка, КИП (pH-метр, термометр).
  - HVAC: Подъёмники/леса, инструмент монтажа, средства диагностики.
  - MOUNT: Леса/подмости, сварочные аппараты, грузоподъёмное оборудование.
  - INSULATION: Леса/подмости, газовые горелки, прокатные станки.

  ДОПОЛНИТЕЛЬНО (при любом типе):
  - Газоопасные работы → драгеры/газоанализаторы: ~5 000₽/день аренда или ~80 000₽/шт покупка
  - Связь → рации: ~3 000₽/шт × кол-во мастеров и ИТР
  - Освещение (если ночные смены) → прожекторы: ~10-20 тыс₽

  ⚠️ ВАЖНО:
  - Закладывай ПОКУПКУ оборудования (не аренду) — компания наращивает свой парк.
  - Если нужного оборудования НЕТ на складе → ОБЯЗАТЕЛЬНО добавь в purchases_needed
    с конкретной ценой. НЕ просто пиши в комментарии "требуется арендовать" —
    ДОБАВЬ СТРОКУ в JSON purchases_needed.
  - Работа БЕЗ оборудования НЕ БЫВАЕТ. Если ты не добавил оборудование ни в
    current_costs (амортизация) ни в purchases_needed (закупка) — ЭТО ОШИБКА.

ИТОГО: если ты НЕ включил хотя бы одну статью из чеклиста — пересмотри расчёт.
Типичная себестоимость бригады 15 чел на 20 дней (далёкий объект): 7-10 млн₽.

═══ ПРАВИЛА БРИГАДЫ (НОРМАТИВНЫЕ + ПРАКТИКА АСГАРДА) ═══

📋 НОРМАТИВНАЯ БАЗА:
- Приказ Минтруда №902н — работа в ОЗП (ограниченных и замкнутых пространствах):
  на каждого ИСПОЛНИТЕЛЯ в ОЗП минимум 1 НАБЛЮДАЮЩИЙ снаружи (п.17-19).
  Обязательно: ответственный за проведение работ (мастер), наряд-допуск.
- Приказ Минтруда №782н — работы на высоте:
  1 группа (до 5м), 2 группа (мастера), 3 группа (ИТР).
  Бригада не менее 2 человек.
- ФНП промышленной безопасности (газоопасные среды, ПБ-12-609-03):
  Наряд-допуск, постоянный контроль газовой обстановки (драгеры),
  дежурный дублёр снаружи. Все работники — с ОТЗП.
- ПОТРМ (тепломеханическое оборудование):
  В ёмкости минимум 2 человека, 1 снаружи контролирует.
- Для МЛСП (морские платформы): минимум 4 человека на участок,
  огневые работы: 2 сварщика + 2 наблюдающих + 1 допускающий.

⚡ РЕЖИМ 24/7 (круглосуточный — если указано в ТЗ или «круглосуточно»):
Две смены по 12 часов (день + ночь), в КАЖДОЙ смене:
  - 1 мастер/прораб (ответственный за проведение работ по наряду-допуску, 2 группа ОВ)
  - X исполнителей (рабочие непосредственно на оборудовании/в ёмкости)
  - X наблюдающих (контроль безопасности, связь, эвакуация)
Итого на 24/7 режим: 2 мастера + 2×X исполнителей + 2×X наблюдающих + 1 ИТР (РП)
Пример при 3 исполнителях/смену: 2 + 6 + 6 + 1 = 15 человек МИНИМУМ

⚡ РАБОТА В ЁМКОСТЯХ / ОЗП (замкнутые пространства):
- На 1 исполнителя = 1 наблюдающий (Приказ №902н) — ОБЯЗАТЕЛЬНО
- Мастер не считается наблюдающим (он руководит)
- Типичная смена при ОЗП: 3 исполнителя + 3 наблюдающих + 1 мастер = 7 чел
- Все исполнители и наблюдающие — с допуском ОТЗП
- Драгеры/газоанализаторы обязательны

⚡ ГАЗООПАСНЫЕ РАБОТЫ:
- Все участники — с ОТЗП (замкнутые пространства, газоопасные работы)
- Наряд-допуск от ответственного руководителя (мастер 2 группы)
- Контроль газовой обстановки каждые 30 мин (драгер)
- Дежурный дублёр снаружи (НЕ наблюдающий, а дополнительный человек)

⚡ ОБЫЧНЫЙ РЕЖИМ (1 смена, дневная, без ОЗП):
1 мастер + N рабочих + 1 ИТР. Наблюдающие не требуются.
Минимальная бригада: 1 мастер + 4 рабочих + 1 ИТР = 6 чел.

⚡ ОГНЕВЫЕ РАБОТЫ (сварка):
Дополнительно к бригаде: сварщик с НАКС + 1 наблюдающий за огневыми.
Минимум 2 сварщика если работа ведётся >8 часов (сменность).

⚡ КАК ОПРЕДЕЛИТЬ КОЛИЧЕСТВО ИСПОЛНИТЕЛЕЙ В СМЕНЕ:
1. Если в ТЗ указан размер бригады — используй его
2. Если объём работ: кол-во единиц оборудования × время обработки
   - Гидромеханическая очистка: ~80-120 труб/человеко-день
   - Химическая чистка: зависит от объёма ёмкости (~1 ёмкость/смена на 3 чел)
   - Изоляция: ~30-50 м²/человеко-день
   - Монтаж/демонтаж: ~5-10 единиц фланцев/день на 2 чел
3. Если ничего нет — минимум 3 исполнителя + 3 наблюдающих в смене

⚡ ВАЖНО:
- НЕ ЗАНИЖАЙ бригаду. Лучше 15 чем 10 — переплата за людей ~200 тыс.,
  а срыв сроков = штрафы ~1-5 млн.
- ИТР (РП) ВСЕГДА 1 человек, ставка 10 000₽/день фиксированная.
- Мастера — тариф из сетки (ground/mlsp), НЕ как ИТР.
- Слесари-универсалы = и исполнители, и наблюдающие. Позиция одна, роль в бригаде
  назначается мастером на месте.

═══ ТВОЯ ЗАДАЧА ═══
1) Определи БРИГАДУ по правилам из блока "ПРАВИЛА БРИГАДЫ" выше:
   - Если 24/7 + ёмкости → 2 мастера + 2×(исполнители + наблюдающие) + 1 ИТР
   - На 1 исполнителя В ЁМКОСТИ = 1 наблюдающий (ОБЯЗАТЕЛЬНО)
   - Определи сколько исполнителей в смене исходя из объёма и производительности
   - Смена 12 часов. Каждый слесарь-универсал может быть и исполнителем и наблюдающим.
   - НЕ ЗАНИЖАЙ бригаду. Лучше 15 чем 8 — переплата за людей минимальна, а срыв = катастрофа.
   ⚠️ ОБЪЁМ РАБОТ: Считай ПОЛНЫЙ объём — если в ТЗ написано "2 аппарата по 1718 труб"
   значит ОБЩИЙ объём = 3436 труб (а не 1718!). Если "3 теплообменника" — считай ВСЕ 3.
   Всегда умножай на количество единиц оборудования!

2) Определи WORK_DAYS — это ЧИСТЫЕ РАБОЧИЕ СМЕНЫ на объекте, БЕЗ дороги и БЕЗ моб./демоб.
   КРИТИЧНО — три источника верхней границы (бери САМУЮ ЖЁСТКУЮ):
   а) ОКНО ПО ДАТАМ из блока "ОГРАНИЧЕНИЕ ПО СРОКАМ" выше — ЖЁСТКАЯ граница
      (work_days ≤ окно − дорога*2 − 2 (моб./демоб.))
   б) Срок из ТЗ/тендера, если есть формулировки типа "выполнить за X дней",
      "срок X дней", "X календарных дней"
   в) Здравый смысл по объёму: чем больше единиц оборудования / труб / тонн,
      тем больше work_days

3) Определи ROAD_DAYS — дни ДОРОГИ (отдельно от work_days). Считается по
   расстоянию: 1 день в одну сторону на ~1500 км. Для большинства работ
   road_days = 1-3 (одно направление; в окно входит туда И обратно).
   НЕ ВКЛЮЧАЙ дорогу в work_days.

4) Выбери ставки из тарифной сетки (категория зависит от типа работ:
   МЛСП → mlsp, обычные → ground, тяжёлые → ground_hard, склад → warehouse)

5) Посчитай командировочные (билеты, суточные, пайковые, гостиница)

6) Определи нужные химию/материалы из контекста ТЗ (если есть)

7) Выбери НАЦЕНКУ (markup_multiplier) ОБОСНОВАННО:
   Сервер автоматически подстроит наценку под бюджет тендера (estimated_sum),
   поэтому НЕ ПЫТАЙСЯ считать max_markup сам — ставь markup по аналогам
   и истории заказчика, а сервер скорректирует при необходимости.

   Рекомендации:
   - Если выигрывали с ×2.0-2.5 у этого клиента → ставь в этом диапазоне
   - Если проигрывали с ×3.0 → НЕ ставь ×3.0
   - Для нового клиента → ×2.0-2.3 (чтобы зайти)
   - Для постоянного → ×2.3-2.8
   - По умолчанию (нет данных) → ×2.2

8) Проверь СКЛАД: чего не хватает — добавь в purchases_needed с ценой

9) Проверь свободных рабочих:
   - Помни: ~90% всех полевых = слесари-универсалы. ОДИН слесарь делает
     ВСЁ кроме сварки. НЕ проси отдельных монтажников/промывщиков/такелажников —
     это всё та же роль "Слесарь-универсал".
   - Сварщики (с НАКС) нужны ТОЛЬКО для сварочных работ.
   - Если работа НЕ требует сварки — можешь использовать только слесарей.
   - Если универсалов меньше чем нужно → warning, иначе всё ОК.

10) ПРОВЕРЬ ДОПУСКА (КРИТИЧНО):
    - Проанализируй текст ТЗ/тендера/договора — какие допуска НУЖНЫ для этой работы?
      (Газоопасные → ОТЗП, Высота → Работы на высоте 1-3, Сварка → НАКС, МЛСП → ВИК+БМПВО,
       Электрика → ЭБ II-V, замкнутые пространства → ОТЗП)
    - Допуска агрегированы по семействам: "ОТЗП (любая группа)" — суммарное число
      сотрудников с любым из 3 уровней ОТЗП. Используй именно эту суммарную цифру.
    - Сверь требования с доступными: нужно X с ОТЗП, доступно Y. Если Y >= X — OK,
      если Y < X — warning level="critical" с числами.
    - Если у нужных людей допуск ИСТЕКАЕТ в течение 30 дней → warning level="warning"

ВЕРНИ СТРОГО JSON в формате (без markdown-обёртки, без пояснений вокруг):

{
  "estimate": {
    "title": "Краткое название просчёта",
    "work_type": "${ctx.workType || 'CLEANING'}",
    "crew_count": <число>,
    "work_days": <число>,
    "road_days": <число (1-3)>,
    "object_city": "<город>",
    "object_distance_km": <число от Москвы или Саратова>,
    "site_category": "MLSP|LAND|LAND_HEAVY|WAREHOUSE",
    "markup_multiplier": <число, например 2.2>,
    "comment": "Обоснование от лица РП (3-4 предложения)"
  },
  "calculation": {
    "personnel": [
      {"role": "ИТР (РП)", "count": 1, "rate_per_day": 10000, "days": <work+road*2+4>, "total": <итого>},
      {"role": "Мастер", "count": <2 при 24/7, иначе 1>, "rate_per_day": <из тарифной сетки>, "days": <work_days>, "total": <итого>},
      {"role": "Рабочий (исполнитель+наблюдающий)", "count": <N>, "rate_per_day": <из тарифной сетки>, "days": <work_days>, "total": <итого>},
      {"role": "Подготовка на складе", "count": <3-4 чел>, "rate_per_day": <ставка>, "days": 2, "total": <итого>},
      {"role": "Дни дороги", "count": <кол-во людей>, "rate_per_day": 3000, "days": <road_days*2>, "total": <итого>}
    ],
    "current_costs": [
      {"description": "СИЗ комплект (15000₽×кол-во)", "amount": <15000 × crew>},
      {"description": "Спецодежда (10000₽×кол-во)", "amount": <10000 × crew>},
      {"description": "Обучение/допуски (ТОЛЬКО если не хватает людей с корочками)", "amount": <0 или 15000-40000 × кол-во людей без корочек>},
      {"description": "Расходники: насадки, щётки, прокладки, шланги", "amount": <30000-80000>}
    ],
    "travel": [
      {"description": "Пайковые (1000₽/чел/день × все дни)", "count": <crew>, "price": <total_days × 1000>, "total": <итого>},
      {"description": "Проживание (1500₽/чел/ночь, аренда квартиры)", "count": <crew>, "price": <nights × 1500>, "total": <итого>},
      {"description": "Билет Саратов → Москва (поезд)", "count": <crew>, "price": <ориент. цена за 1 чел>, "total": <итого>},
      {"description": "Билет Москва → <город объекта> (поезд/самолёт)", "count": <crew>, "price": <ориент. цена за 1 чел>, "total": <итого>},
      {"description": "Билет <город объекта> → Москва (обратно)", "count": <crew>, "price": <ориент. цена>, "total": <итого>},
      {"description": "Билет Москва → Саратов (обратно, поезд)", "count": <crew>, "price": <ориент. цена>, "total": <итого>}
    ],
    "transport": [
      {"description": "Доставка оборудования (КамАЗ/Газель туда-обратно, ~20-30₽/км)", "count": 1, "price": <цена туда-обратно>, "total": <итого>},
      {"description": "Такси/транспорт на объекте", "count": <work_days>, "price": 1500, "total": <итого>}
    ],
    "chemistry": [
      {"name": "<если нужно>", "volume_liters": <N>, "price_per_liter": <цена>, "total": <итого>}
    ]
  },
  "equipment_needed": [
    {"item": "<что нужно для этой работы>", "quantity": <N>, "purpose": "зачем нужно"}
  ],
  "permits_status": {
    "required_permits": ["ОТЗП", "Работы на высоте", "...список нужных допусков"],
    "available_crew": [
      {"permit": "ОТЗП", "needed": <сколько нужно>, "available": <сколько свободных с этим допуском>, "enough": true/false}
    ],
    "training_needed": [
      {"permit": "<какой допуск>", "people_count": <сколько обучить>, "cost_per_person": <стоимость курса>, "total": <итого>}
    ],
    "summary": "Краткое: X чел свободны с нужными допусками / Y нужно обучить"
  },
  "route_plan": {
    "legs": [
      {"from": "Саратов (офис)", "to": "Москва (склад)", "transport": "ж/д", "duration_days": <N>, "cost_per_person": <₽>},
      {"from": "Москва (склад)", "to": "<город объекта>", "transport": "ж/д/авто", "duration_days": <N>, "cost_per_person": <₽>}
    ],
    "warehouse_stop": {
      "location": "Москва, склад Асгард",
      "days": <2-3>,
      "activities": "Комплектация оборудования, погрузка, проверка СИЗ, инструктаж"
    },
    "total_road_days": <суммарно дней дороги в одну сторону>,
    "summary": "Маршрут: Саратов → Москва (склад, X дн) → Город (ж/д, Y дн). Обратно аналогично."
  },
  "analysis": {
    "markup_reasoning": "Почему именно эта наценка — со ссылками на аналоги",
    "warnings": [
      {"level": "warning", "title": "Краткий заголовок", "text": "Что именно за риск/предупреждение"}
    ],
    "purchases_needed": [
      {"item": "<позиция>", "quantity": <N>, "price": <за единицу>, "total": <итого>, "reason": "нет на складе"}
    ]
  }
}

11) Заполни блок EQUIPMENT_NEEDED — список ВСЕГО оборудования что НУЖНО для работы:
    - Каждая позиция: item (название), quantity (количество), purpose (зачем).
    - НЕ РЕШАЙ сам что есть на складе и что нет — это сделает СЕРВЕР.
    - Просто перечисли ВСЁ что потребуется: установки, шланги, насадки, драгеры, рации, прожекторы.
    - Количество — АДЕКВАТНОЕ объёму. Если 2 аппарата → нужно минимум 2 установки (+ запас).
    - НЕ ВЫДУМЫВАЙ наличие на складе. Пиши ТОЛЬКО что нужно.

12) Заполни блок PERMITS_STATUS:
    - required_permits: какие допуска НУЖНЫ для этой работы (определи из ТЗ)
    - available_crew: по каждому допуску — сколько нужно vs сколько доступно
    - training_needed: если людей с допуском НЕ ХВАТАЕТ — сколько обучить и за сколько
    - Если всех хватает → training_needed = [], summary = "Все X чел имеют допуска"

13) Заполни блок ROUTE_PLAN:
    - legs: каждый этап маршрута (Саратов→Москва, Москва→объект)
    - warehouse_stop: ОБЯЗАТЕЛЬНО есть (все бригады проходят через склад Москва)
      - days: 2-3 дня (комплектация, погрузка, проверка СИЗ, инструктаж)
      - activities: что конкретно делают на складе
    - Маршрут ВСЕГДА: Саратов → Москва (склад) → город объекта

ВАЖНО:
- Возвращай ТОЛЬКО валидный JSON, без \`\`\`json блока, без текста до/после
- Все суммы в рублях (число, не строка)
- В personnel total = count × rate_per_day × days
- В travel total = count × price
- ИТР всегда rate_per_day=10000 (не из тарифной сетки)
- НЕ добавляй в purchases_needed то что есть на складе
- warnings: до 4 штук, level: "warning"|"info"|"critical"`;
}

/**
 * Извлечь JSON из текста ответа AI (поддерживает ```json блоки и raw JSON).
 */
function parseAIResponse(text) {
  if (!text) throw new Error('AI вернул пустой ответ');

  // Сначала пробуем найти ```json … ``` блок
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = codeMatch ? codeMatch[1] : text;

  // Найти первый { и последний } — отрежем "обрамление"
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) {
    throw new Error('В ответе AI не найден JSON-объект');
  }
  raw = raw.substring(first, last + 1);

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('AI вернул невалидный JSON: ' + e.message);
  }
}

/**
 * Пересчитать математику расчёта на сервере по формулам.
 *
 * 1. Пересчитывает total в каждой строке (чтобы AI не наврал в умножении)
 * 2. Считает subtotal по блокам
 * 3. Применяет ФОТ tax (только к personnel), накладные, расходные, непредвиденные
 * 4. Считает total_with_margin = total_cost × markup_multiplier
 *
 * Возвращает { calculation, totals, drift } где drift — отклонение от того что прислал AI.
 */
function validateAndRecomputeMath(ai, settings, ctx = null) {
  const calc = JSON.parse(JSON.stringify(ai.calculation || {}));
  const est = ai.estimate || {};

  // AP3.5b: ЖЁСТКАЯ серверная проверка work_days по окну дат
  // Если AI вернул больше — обрезаем и расширяем бригаду компенсирующе
  let timeOverflowFix = null;
  if (ctx) {
    const startDate = ctx.work?.start_plan || ctx.work?.start_in_work_date || ctx.tender?.work_start_plan;
    const endDate = ctx.work?.end_plan || ctx.work?.end_fact || ctx.tender?.work_end_plan;
    if (startDate && endDate) {
      const dateWindow = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
      const roadDays = Number(est.road_days) || 2;
      const mobDays = 4; // 2 моб + 2 демоб
      const maxWorkDays = Math.max(1, dateWindow - roadDays * 2 - mobDays);
      const aiWorkDays = Number(est.work_days) || 0;
      if (aiWorkDays > maxWorkDays) {
        // Расширяем бригаду пропорционально — сохраняем человеко-смены
        const aiCrew = Number(est.crew_count) || 1;
        const totalManDays = aiCrew * aiWorkDays;
        const newCrew = Math.ceil(totalManDays / maxWorkDays);
        timeOverflowFix = {
          ai_work_days: aiWorkDays,
          ai_crew: aiCrew,
          fixed_work_days: maxWorkDays,
          fixed_crew: newCrew,
          window: dateWindow,
          road_days: roadDays
        };
        // Применяем фикс к estimate (сохранится в БД)
        est.work_days = maxWorkDays;
        est.crew_count = newCrew;
        // Пересчитываем personnel: меняем days на maxWorkDays и count пропорционально
        const ratio = newCrew / aiCrew;
        (calc.personnel || []).forEach(p => {
          p.days = maxWorkDays;
          p.count = Math.ceil((Number(p.count) || 0) * ratio);
        });
      }
    }
  }

  // 1. Пересчёт total в строках
  (calc.personnel || []).forEach(p => {
    p.count = Number(p.count) || 0;
    p.rate_per_day = Number(p.rate_per_day) || 0;
    p.days = Number(p.days) || 0;
    p.total = r2(p.count * p.rate_per_day * p.days);
  });
  (calc.current_costs || []).forEach(r => { r.amount = r2(r.amount); r.total = r.amount; });
  (calc.travel || []).forEach(r => {
    r.count = Number(r.count) || 1;
    r.price = Number(r.price) || 0;
    r.total = r2(r.count * r.price);
  });
  (calc.transport || []).forEach(r => {
    r.count = Number(r.count) || 1;
    r.price = Number(r.price) || 0;
    r.total = r2(r.count * r.price);
  });
  (calc.chemistry || []).forEach(r => {
    r.volume_liters = Number(r.volume_liters) || 0;
    r.price_per_liter = Number(r.price_per_liter) || 0;
    r.total = r.total != null ? r2(r.total) : r2(r.volume_liters * r.price_per_liter);
  });

  // 2. Suby по блокам
  const sumBlock = (arr) => (arr || []).reduce((s, r) => s + (Number(r.total) || 0), 0);
  const personnelSubtotal = sumBlock(calc.personnel);
  const currentSubtotal = sumBlock(calc.current_costs);
  const travelSubtotal = sumBlock(calc.travel);
  const transportSubtotal = sumBlock(calc.transport);
  const chemistrySubtotal = sumBlock(calc.chemistry);

  // 3. ФОТ tax — только на personnel
  const fotTax = personnelSubtotal * (Number(settings.fot_tax_pct) / 100);
  const personnelWithTax = personnelSubtotal + fotTax;

  // Промежуточная (всё кроме непредвиденных)
  const subtotal = personnelWithTax + currentSubtotal + travelSubtotal + transportSubtotal + chemistrySubtotal;

  // Накладные (на весь subtotal без химии — упрощённо берём от subtotal)
  const overhead = subtotal * (Number(settings.overhead_pct) / 100);
  const consumables = subtotal * (Number(settings.consumables_pct) / 100);

  // Промежуточная себестоимость с накладными
  const subtotalWithOverhead = subtotal + overhead + consumables;

  // Непредвиденные
  const contingencyAmount = subtotalWithOverhead * (Number(settings.contingency_pct) / 100);
  const totalCost = r2(subtotalWithOverhead + contingencyAmount);

  // Наценка → клиенту (let — может быть скорректирована серверным enforcement)
  let markup = Number(est.markup_multiplier) || 2.0;
  let totalWithMargin = r2(totalCost * markup);
  let marginPct = totalCost > 0 ? r2(((totalWithMargin - totalCost) / totalCost) * 100) : 0;

  // AP4: Серверный двусторонний enforcement по estimated_sum тендера
  // Цена с НДС должна быть в диапазоне [90%..98%] от estimated_sum
  let markupOverflowFix = null;
  const estimatedSum = Number(ctx?.tender?.estimated_sum || ctx?.tender?.tender_price || 0);
  if (estimatedSum > 0 && totalCost > 0) {
    const vatMul = 1 + Number(settings.vat_pct) / 100;
    const checkVat = r2(totalWithMargin * vatMul);

    // Целевой диапазон: [90%..98%] от estimated_sum
    const upperLimit = estimatedSum * 0.98;
    const lowerLimit = estimatedSum * 0.90;
    // Целевой markup чтобы попасть в ~95% estimated_sum (золотая середина)
    const targetMarkup = r2(estimatedSum * 0.95 / vatMul / totalCost);

    if (checkVat > upperLimit || checkVat < lowerLimit) {
      markupOverflowFix = {
        ai_markup: markup,
        ai_total_with_vat: checkVat,
        estimated_sum: estimatedSum,
        target_range: `${Math.round(lowerLimit)}–${Math.round(upperLimit)}`,
        fixed_markup: Math.max(1.1, Math.min(targetMarkup, r2(upperLimit / vatMul / totalCost)))
      };
      markup = markupOverflowFix.fixed_markup;
      est.markup_multiplier = markup;
      totalWithMargin = r2(totalCost * markup);
      marginPct = totalCost > 0 ? r2(((totalWithMargin - totalCost) / totalCost) * 100) : 0;
    }
  }

  // НДС
  const totalWithVat = r2(totalWithMargin * (1 + Number(settings.vat_pct) / 100));

  const totals = {
    personnel_subtotal: r2(personnelSubtotal),
    fot_tax: r2(fotTax),
    personnel_with_tax: r2(personnelWithTax),
    current_subtotal: r2(currentSubtotal),
    travel_subtotal: r2(travelSubtotal),
    transport_subtotal: r2(transportSubtotal),
    chemistry_subtotal: r2(chemistrySubtotal),
    overhead: r2(overhead),
    consumables: r2(consumables),
    contingency_pct: Number(settings.contingency_pct),
    contingency_amount: r2(contingencyAmount),
    subtotal: r2(subtotalWithOverhead),
    total_cost: totalCost,
    markup_multiplier: markup,
    total_with_margin: totalWithMargin,
    margin_pct: marginPct,
    vat_pct: Number(settings.vat_pct),
    total_with_vat: totalWithVat
  };

  // Сравним с тем что AI заявлял (если было) — для drift метрики
  let drift = null;
  if (ai.totals && Number(ai.totals.total_cost) > 0) {
    const aiCost = Number(ai.totals.total_cost);
    drift = r2(Math.abs(aiCost - totalCost) / aiCost * 100);
  }

  // Нормализация формата строк для совместимости с estimate_report.js
  // estimate_report ожидает: { item, qty, rate, days, total }
  // AI генерирует: { role, count, rate_per_day, description, amount, price }
  normalizeCalcRows(calc);

  return { calculation: calc, totals, drift, settings, timeOverflowFix, markupOverflowFix };
}

/**
 * Нормализовать строки расчёта в формат, понятный estimate_report.js:
 *   item — название строки (из role/description/name)
 *   qty  — количество (из count)
 *   rate — ставка (из rate_per_day/price/price_per_liter)
 *   days — дни (если есть)
 *   total — итого
 */
function normalizeCalcRows(calc) {
  (calc.personnel || []).forEach(r => {
    r.item = r.item || r.role || r.description || '—';
    r.qty = r.qty ?? r.count ?? null;
    r.rate = r.rate ?? r.rate_per_day ?? null;
    // days остаётся
  });
  (calc.current_costs || []).forEach(r => {
    r.item = r.item || r.description || '—';
    r.total = r.total ?? r.amount ?? 0;
  });
  (calc.travel || []).forEach(r => {
    r.item = r.item || r.description || '—';
    r.qty = r.qty ?? r.count ?? null;
    r.rate = r.rate ?? r.price ?? null;
  });
  (calc.transport || []).forEach(r => {
    r.item = r.item || r.description || '—';
    r.qty = r.qty ?? r.count ?? null;
    r.rate = r.rate ?? r.price ?? null;
  });
  (calc.chemistry || []).forEach(r => {
    r.item = r.item || r.name || r.description || '—';
    r.volume_m3 = r.volume_m3 ?? r.volume_liters ?? null;
    r.rate = r.rate ?? r.rate_m3 ?? r.price_per_liter ?? null;
  });
}

/**
 * Создать draft estimate + estimate_calculation_data из ответа AI.
 *
 * Возвращает { estimate_id, version_no, totals }
 */
async function createDraftEstimate(db, ctx, ai, recomputed, user) {
  const work = ctx.work;
  const est = ai.estimate || {};
  const totals = recomputed.totals;

  // 1. INSERT в estimates
  const insertEstResult = await db.query(
    `INSERT INTO estimates (
        work_id, tender_id, pm_id, created_by,
        title, work_type, approval_status, current_version_no, version_no,
        crew_count, work_days, road_days,
        object_city, object_distance_km, object_name,
        markup_multiplier, markup_reason,
        comment, customer,
        margin_pct, fot_tax_pct, overhead_pct, consumables_pct,
        cost_plan, price_tkp,
        analog_projects,
        created_at, updated_at
     ) VALUES (
        $1, $2, $3, $4,
        $5, $6, 'draft', 1, 1,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14,
        $15, $16,
        $17, $18, $19, $20,
        $21, $22,
        $23,
        NOW(), NOW()
     ) RETURNING *`,
    [
      work.id, work.tender_id || null, user.id, user.id,
      String(est.title || work.work_title || `Просчёт работы #${work.id}`).substring(0, 200),
      est.work_type || ctx.workType || null,
      Number(est.crew_count) || null, Number(est.work_days) || null, Number(est.road_days) || 2,
      est.object_city || work.city || null, Number(est.object_distance_km) || null,
      work.object_name || null,
      totals.markup_multiplier, ai.analysis?.markup_reasoning || null,
      String(est.comment || '').substring(0, 2000), work.customer_name || null,
      totals.margin_pct, recomputed.settings.fot_tax_pct, recomputed.settings.overhead_pct, recomputed.settings.consumables_pct,
      totals.total_cost, totals.total_with_margin,
      JSON.stringify((ctx.analogs || []).slice(0, 5).map(a => ({
        id: a.id, title: a.title, total_cost: a.total_cost,
        markup: a.markup_multiplier, status: a.approval_status
      })))
    ]
  );
  const estimateRow = insertEstResult.rows[0];

  // 2. INSERT в estimate_calculation_data
  const calc = recomputed.calculation;

  // mimir_suggestions = все блоки анализа + новые AP4.5 блоки
  const mimirSuggestions = {
    markup_reasoning: ai.analysis?.markup_reasoning || null,
    warnings: ai.analysis?.warnings || [],
    purchases_needed: ai.analysis?.purchases_needed || [],
    equipment_status: ai.equipment_status || null,
    permits_status: ai.permits_status || null,
    route_plan: ai.route_plan || null,
    chat_history: [],
    generated_at: new Date().toISOString(),
    ai_model: ai._meta?.model || null,
    ai_provider: ai._meta?.provider || null
  };

  // warehouse_check (для UI карточки)
  const warehouseCheck = {
    items_total: ctx.warehouse.length,
    purchases_needed: ai.analysis?.purchases_needed || []
  };

  // files_parsed
  const filesParsed = {
    count: ctx.documents.length,
    parsed: ctx.documents.filter(d => d.content_chars > 0).length,
    files: ctx.documents.map(d => ({ id: d.id, name: d.original_name, chars: d.content_chars }))
  };

  await db.query(
    `INSERT INTO estimate_calculation_data (
        estimate_id, version_no,
        personnel_json, current_costs_json, travel_json, transport_json, chemistry_json,
        contingency_pct, subtotal, contingency_amount, total_cost,
        margin_pct, total_with_margin,
        mimir_suggestions, warehouse_check, files_parsed,
        notes, created_by, created_at, updated_at
     ) VALUES (
        $1, 1,
        $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12,
        $13, $14, $15,
        $16, $17, NOW(), NOW()
     )`,
    [
      estimateRow.id,
      JSON.stringify(calc.personnel || []),
      JSON.stringify(calc.current_costs || []),
      JSON.stringify(calc.travel || []),
      JSON.stringify(calc.transport || []),
      JSON.stringify(calc.chemistry || []),
      totals.contingency_pct,
      totals.subtotal, totals.contingency_amount, totals.total_cost,
      totals.margin_pct, totals.total_with_margin,
      JSON.stringify(mimirSuggestions),
      JSON.stringify(warehouseCheck),
      JSON.stringify(filesParsed),
      ai.analysis?.markup_reasoning || null,
      user.id
    ]
  );

  return { estimate_id: estimateRow.id, version_no: 1, totals, estimate: estimateRow };
}

/**
 * Загрузить существующий draft (если есть) для work_id.
 * Возвращает { estimate, calc, chat_history } или null.
 * Используется при повторном открытии MimirAutoEstimate чтобы предложить
 * "Открыть #N или Пересчитать новый".
 */
async function loadExistingDraftForWork(db, workId) {
  try {
    const eRes = await db.query(
      `SELECT * FROM estimates
        WHERE work_id = $1 AND approval_status = 'draft'
        ORDER BY created_at DESC LIMIT 1`,
      [workId]
    );
    const estimate = eRes.rows[0];
    if (!estimate) return null;

    const cRes = await db.query(
      `SELECT * FROM estimate_calculation_data
        WHERE estimate_id = $1
        ORDER BY version_no DESC LIMIT 1`,
      [estimate.id]
    );
    const calc = cRes.rows[0] || null;

    let chat_history = [];
    if (calc?.mimir_suggestions) {
      try {
        const ms = typeof calc.mimir_suggestions === 'string'
          ? JSON.parse(calc.mimir_suggestions)
          : calc.mimir_suggestions;
        chat_history = ms.chat_history || [];
      } catch (e) { /* ok */ }
    }

    return { estimate, calc, chat_history };
  } catch (e) {
    console.warn('[AP3] loadExistingDraftForWork:', e.message);
    return null;
  }
}

/**
 * Обновить существующий draft estimate (для диалога-пересчёта).
 *
 * Перезаписывает estimate_calculation_data v1 (UPDATE), обновляет markup
 * в estimates. Не плодит новые версии — это всё ещё draft перед отправкой.
 *
 * AP3: добавляет user message + mimir response в mimir_suggestions.chat_history
 */
async function updateDraftEstimate(db, estimateId, ai, recomputed, user, chatTurn = null) {
  const est = ai.estimate || {};
  const totals = recomputed.totals;
  const calc = recomputed.calculation;

  // 1. UPDATE estimates (только мутируемые поля)
  await db.query(
    `UPDATE estimates SET
        crew_count = COALESCE($2, crew_count),
        work_days = COALESCE($3, work_days),
        markup_multiplier = $4,
        markup_reason = COALESCE($5, markup_reason),
        comment = COALESCE($6, comment),
        cost_plan = $7,
        price_tkp = $8,
        margin_pct = $9,
        updated_at = NOW()
      WHERE id = $1`,
    [
      estimateId,
      Number(est.crew_count) || null,
      Number(est.work_days) || null,
      totals.markup_multiplier,
      ai.analysis?.markup_reasoning || null,
      est.comment || null,
      totals.total_cost,
      totals.total_with_margin,
      totals.margin_pct
    ]
  );

  // 2. Загрузить старый mimir_suggestions чтобы сохранить chat_history
  let prevHistory = [];
  try {
    const prev = await db.query(
      `SELECT mimir_suggestions FROM estimate_calculation_data WHERE estimate_id = $1 AND version_no = 1`,
      [estimateId]
    );
    const prevMs = prev.rows[0]?.mimir_suggestions;
    if (prevMs) {
      const parsed = typeof prevMs === 'string' ? JSON.parse(prevMs) : prevMs;
      prevHistory = parsed.chat_history || [];
    }
  } catch (e) { /* ok */ }

  // Добавляем новый turn (user + mimir response)
  if (chatTurn && chatTurn.user_message) {
    prevHistory.push({
      role: 'user',
      text: chatTurn.user_message,
      ts: new Date().toISOString(),
      user_name: user.name || user.login
    });
  }
  if (chatTurn && chatTurn.mimir_response) {
    prevHistory.push({
      role: 'mimir',
      text: chatTurn.mimir_response,
      ts: new Date().toISOString(),
      ai_model: ai._meta?.model || null
    });
  }
  // Лимит истории — последние 50 turns
  if (prevHistory.length > 50) {
    prevHistory = prevHistory.slice(-50);
  }

  const mimirSuggestions = {
    markup_reasoning: ai.analysis?.markup_reasoning || null,
    warnings: ai.analysis?.warnings || [],
    purchases_needed: ai.analysis?.purchases_needed || [],
    workers_status: ai.analysis?.workers_status || null,
    warehouse_status: ai.analysis?.warehouse_status || null,
    chat_history: prevHistory,
    updated_at: new Date().toISOString(),
    ai_model: ai._meta?.model || null
  };

  await db.query(
    `UPDATE estimate_calculation_data SET
        personnel_json = $2,
        current_costs_json = $3,
        travel_json = $4,
        transport_json = $5,
        chemistry_json = $6,
        subtotal = $7,
        contingency_amount = $8,
        total_cost = $9,
        margin_pct = $10,
        total_with_margin = $11,
        mimir_suggestions = $12,
        notes = $13,
        updated_at = NOW()
      WHERE estimate_id = $1 AND version_no = 1`,
    [
      estimateId,
      JSON.stringify(calc.personnel || []),
      JSON.stringify(calc.current_costs || []),
      JSON.stringify(calc.travel || []),
      JSON.stringify(calc.transport || []),
      JSON.stringify(calc.chemistry || []),
      totals.subtotal, totals.contingency_amount, totals.total_cost,
      totals.margin_pct, totals.total_with_margin,
      JSON.stringify(mimirSuggestions),
      ai.analysis?.markup_reasoning || null
    ]
  );

  return { estimate_id: estimateId, version_no: 1, totals };
}

/**
 * Главная функция: вызвать AI и получить расчёт.
 *
 * @returns { ai (parsed), text (raw), recomputed (после пересчёта), tokens }
 */
async function callMimirForEstimate(aiProvider, ctx, extraUserMessage = null) {
  const systemPrompt = buildAutoEstimatePrompt(ctx);

  const messages = extraUserMessage
    ? [{ role: 'user', content: extraUserMessage }]
    : [{ role: 'user', content: 'Заполни просчёт по контексту выше. Верни строго JSON.' }];

  const aiResult = await aiProvider.complete({
    system: systemPrompt,
    messages,
    maxTokens: 8000,
    temperature: 0.2
  });

  if (!aiResult || !aiResult.text) {
    throw new Error('AI не вернул ответ');
  }

  // Парсим JSON
  const ai = parseAIResponse(aiResult.text);
  ai._meta = { model: aiResult.model, provider: aiResult.provider };

  // Пересчитываем математику
  const recomputed = validateAndRecomputeMath(ai, ctx.settings, ctx);

  // Серверный пост-процессинг: AI пишет equipment_needed (что нужно),
  // сервер сверяет с реальным складом и разделяет на from_warehouse / to_purchase
  resolveEquipmentFromWarehouse(ai, ctx);

  return {
    ai,
    text: aiResult.text,
    recomputed,
    tokens: aiResult.usage,
    model: aiResult.model,
    provider: aiResult.provider,
    duration_ms: aiResult.durationMs
  };
}

/**
 * Серверный пост-процессинг оборудования:
 * AI возвращает equipment_needed (список всего что нужно).
 * Сервер проверяет каждую позицию по РЕАЛЬНЫМ данным склада
 * и разделяет на from_warehouse (есть) / to_purchase (нет).
 *
 * Это решает проблему галлюцинаций AI: он НЕ решает что есть на складе,
 * а только говорит что нужно.
 */
function resolveEquipmentFromWarehouse(ai, ctx) {
  if (!ai.analysis) ai.analysis = {};
  if (!ai.analysis.warnings) ai.analysis.warnings = [];

  const needed = ai.equipment_needed || [];
  const warehouseItems = ctx.warehouse || [];

  // Индекс склада: name (lowercase) → item
  const whIndex = {};
  for (const w of warehouseItems) {
    const key = (w.name || '').toLowerCase();
    if (key) whIndex[key] = w;
  }

  const fromWarehouse = [];
  const toPurchase = [];

  for (const item of needed) {
    const name = (item.item || '').toLowerCase();
    // Ищем совпадение по подстроке в складских позициях
    let found = null;
    for (const wKey of Object.keys(whIndex)) {
      // Проверяем пересечение ключевых слов (3+ букв)
      const words = name.split(/[\s,/()]+/).filter(w => w.length >= 3);
      const match = words.some(w => wKey.includes(w));
      if (match) { found = whIndex[wKey]; break; }
    }

    if (found) {
      fromWarehouse.push({
        item: item.item,
        quantity: item.quantity || 1,
        condition: found.status || 'на складе',
        warehouse_item_id: found.id,
        warehouse_name: found.name
      });
    } else {
      toPurchase.push({
        item: item.item,
        quantity: item.quantity || 1,
        price_estimate: 0,
        total: 0,
        supplier_hint: 'Уточнить стоимость у поставщика',
        purpose: item.purpose || ''
      });
    }
  }

  // Формируем equipment_status из серверной проверки
  ai.equipment_status = {
    from_warehouse: fromWarehouse,
    to_purchase: toPurchase,
    summary: `${fromWarehouse.length} позиций со склада, ${toPurchase.length} нужно купить`
  };

  // Если нужно покупать — добавить warning
  if (toPurchase.length > 0) {
    const items = toPurchase.map(p => p.item).join(', ');
    ai.analysis.warnings.push({
      level: 'warning',
      title: 'Требуется закупка оборудования',
      text: `На складе нет: ${items}. Необходимо приобрести перед выездом.`
    });
  }

  // Если AI вообще не указал equipment_needed — предупредить
  if (needed.length === 0) {
    ai.equipment_status = {
      from_warehouse: [],
      to_purchase: [],
      summary: 'AI не указал необходимое оборудование'
    };
    ai.analysis.warnings.push({
      level: 'info',
      title: 'Оборудование не указано',
      text: 'Мимир не перечислил необходимое оборудование. Уточните у РП.'
    });
  }
}

module.exports = {
  // AP1
  buildAutoEstimateContext,
  getWorkContext,
  getAnalogs,
  getCustomerHistory,
  getWarehouseStock,
  getAvailableWorkers,
  getTariffGrid,
  getCalcSettings,
  inferWorkType,
  DEFAULT_SETTINGS,
  // AP2
  buildAutoEstimatePrompt,
  parseAIResponse,
  validateAndRecomputeMath,
  createDraftEstimate,
  updateDraftEstimate,
  callMimirForEstimate,
  // AP3
  getEmployeePermitsSummary,
  loadExistingDraftForWork
};
