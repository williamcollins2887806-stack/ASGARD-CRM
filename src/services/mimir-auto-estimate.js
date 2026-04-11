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
  contingency_pct: 5,
  itr_rate_per_day: 10000,
  per_diem_per_day: 1000,
  meals_per_day: 1000
};

// Лимиты для предотвращения раздувания контекста
const MAX_DOCUMENTS_PARSED = 8;
const MAX_ANALOGS = 10;
const MAX_CUSTOMER_HISTORY = 15;
const MAX_WAREHOUSE_ITEMS = 200;
const MAX_AVAILABLE_WORKERS = 50;

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

  return { work, tender, documents: parsed };
}

/**
 * 4. Аналогичные просчёты по work_type (одобренные и отклонённые — оба полезны).
 */
async function getAnalogs(db, workType, excludeEstimateId = null, onProgress) {
  safeProgress(onProgress, 'analogs', '📋 Анализирую аналоги похожих просчётов...');
  if (!workType) return [];

  try {
    const params = [workType];
    let whereExclude = '';
    if (excludeEstimateId) {
      params.push(excludeEstimateId);
      whereExclude = ' AND e.id != $2';
    }
    params.push(MAX_ANALOGS);
    const limitIdx = params.length;

    const result = await db.query(
      `SELECT
          e.id, e.title, e.object_city, e.object_distance_km,
          e.crew_count, e.work_days, e.markup_multiplier,
          e.approval_status, e.created_at, e.customer,
          ecd.total_cost, ecd.total_with_margin, ecd.margin_pct,
          ecd.personnel_json, ecd.contingency_pct,
          t.customer_name AS tender_customer, t.tender_status, t.estimated_sum
       FROM estimates e
       LEFT JOIN estimate_calculation_data ecd
              ON ecd.estimate_id = e.id
             AND ecd.version_no = COALESCE(e.current_version_no, 1)
       LEFT JOIN tenders t ON t.id = e.tender_id
       WHERE e.work_type = $1
         AND e.approval_status IN ('approved','rejected','sent')${whereExclude}
       ORDER BY e.created_at DESC
       LIMIT $${limitIdx}`,
      params
    );
    return result.rows;
  } catch (e) {
    console.warn('[AP1] getAnalogs:', e.message);
    return [];
  }
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
 * 7. Свободные рабочие на период работ.
 *
 * Так как нет таблицы work_assignments для людей, используем
 * упрощённую логику: исключаем рабочих, у которых уже есть
 * назначение на любую активную работу с пересекающимися датами
 * (через works.staff_ids_json или approved_staff_ids_a/b_json).
 *
 * Источник людей — таблица users с ролями WORKER, MASTER, FOREMAN, FIELD_ENGINEER.
 */
async function getAvailableWorkers(db, startDate, endDate, onProgress) {
  safeProgress(onProgress, 'workers', '👷 Проверяю свободных рабочих на период...');

  if (!startDate || !endDate) {
    // Без дат — просто список всех активных полевых рабочих
    try {
      const result = await db.query(
        `SELECT id, name, role, login
           FROM users
          WHERE is_active = true
            AND role IN ('WORKER','MASTER','FOREMAN','FIELD_ENGINEER','CHIEF_ENGINEER')
          ORDER BY role, name
          LIMIT $1`,
        [MAX_AVAILABLE_WORKERS]
      );
      return { available: result.rows, busy: [], note: 'Даты работы не указаны — показан полный список.' };
    } catch (e) {
      return { available: [], busy: [], note: e.message };
    }
  }

  try {
    // Собрать ID занятых рабочих из works с пересекающимся периодом
    const busyRes = await db.query(
      `SELECT DISTINCT
              jsonb_array_elements_text(
                COALESCE(staff_ids_json, '[]'::jsonb) ||
                COALESCE(approved_staff_ids_a_json, '[]'::jsonb) ||
                COALESCE(approved_staff_ids_b_json, '[]'::jsonb)
              )::int AS user_id
         FROM works
        WHERE work_status IN ('in_progress','planned','approved')
          AND deleted_at IS NULL
          AND COALESCE(start_plan, start_in_work_date) <= $2::date
          AND COALESCE(end_plan, end_fact) >= $1::date`,
      [startDate, endDate]
    );
    const busyIds = busyRes.rows.map(r => r.user_id).filter(id => id != null);

    // Свободные = роль WORKER/MASTER/FOREMAN, активные, НЕ в busyIds
    const params = [];
    let busyClause = '';
    if (busyIds.length > 0) {
      params.push(busyIds);
      busyClause = ' AND id != ALL($1::int[])';
    }
    params.push(MAX_AVAILABLE_WORKERS);
    const limitIdx = params.length;

    const availRes = await db.query(
      `SELECT id, name, role, login
         FROM users
        WHERE is_active = true
          AND role IN ('WORKER','MASTER','FOREMAN','FIELD_ENGINEER','CHIEF_ENGINEER')
          ${busyClause}
        ORDER BY role, name
        LIMIT $${limitIdx}`,
      params
    );

    return {
      available: availRes.rows,
      busy_count: busyIds.length,
      period: { start: startDate, end: endDate }
    };
  } catch (e) {
    console.warn('[AP1] getAvailableWorkers:', e.message);
    return { available: [], busy_count: 0, error: e.message };
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

  // Шаг 1+2+3: работа + тендер + документы (последовательно — внутри есть progress)
  const { work, tender, documents } = await getWorkContext(db, workId, onProgress);

  // Период работ для проверки рабочих
  const startDate = work.start_plan || work.start_in_work_date || null;
  const endDate = work.end_plan || work.end_fact || null;

  // Тип работ — берём из тендера если есть, иначе пытаемся определить из текста
  let workType = null;
  if (tender?.work_type) workType = tender.work_type;
  // (work_type в works нет — только в estimates и тендерах)

  // Шаги 4-9: параллельно
  const [
    analogs,
    customerHistory,
    warehouse,
    workers,
    tariffs,
    settings
  ] = await Promise.all([
    getAnalogs(db, workType, null, onProgress),
    getCustomerHistory(db, work.customer_name || tender?.customer_name, onProgress),
    getWarehouseStock(db, onProgress),
    getAvailableWorkers(db, startDate, endDate, onProgress),
    getTariffGrid(db, onProgress),
    getCalcSettings(db)
  ]);

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
    available_workers: workers.available?.length || 0,
    tariff_categories: Object.keys(tariffs.grouped || {}).length,
    work_type: workType,
    period: { start: startDate, end: endDate },
    elapsed_ms: elapsedMs
  };

  safeProgress(onProgress, 'collected', '✅ Все данные собраны', summary);

  return {
    work,
    tender,
    documents,
    analogs,
    customer_history: customerHistory,
    warehouse,
    workers,
    tariffs,
    settings,
    summary
  };
}

module.exports = {
  buildAutoEstimateContext,
  getWorkContext,
  getAnalogs,
  getCustomerHistory,
  getWarehouseStock,
  getAvailableWorkers,
  getTariffGrid,
  getCalcSettings,
  DEFAULT_SETTINGS
};
