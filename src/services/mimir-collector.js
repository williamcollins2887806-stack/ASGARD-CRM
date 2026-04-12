'use strict';

/**
 * ASGARD CRM — Мимир Data Collector (AP5)
 *
 * Собирает ВСЕ данные из БД для Claude Sonnet 4.6.
 * 15 типов данных, ~35K токенов, запрос на текущую дату (realtime).
 *
 * Используется вместо buildAutoEstimateContext (AP4) — полнее и чище.
 * Claude получает факты, не инструкции. Сам анализирует и решает.
 */

const { parseDocumentContent } = require('./estimateChat');

/**
 * Собрать ВСЕ данные для просчёта.
 * Каждый шаг рапортует прогресс через onProgress.
 *
 * @returns {Object} — 15 блоков данных + summary
 */
async function collectAll(db, workId, onProgress) {
  const t0 = Date.now();
  const progress = (step, msg) => {
    if (typeof onProgress === 'function') {
      try { onProgress({ type: 'progress', step, message: msg }); } catch {}
    }
  };

  // ── 1. Работа ──
  progress('work', '📋 Загружаю данные работы...');
  const work = (await db.query('SELECT * FROM works WHERE id = $1', [workId])).rows[0];
  if (!work) throw new Error(`Работа #${workId} не найдена`);

  // ── 2. Тендер ──
  let tender = null;
  if (work.tender_id) {
    progress('tender', '📋 Загружаю тендер...');
    tender = (await db.query('SELECT * FROM tenders WHERE id = $1', [work.tender_id])).rows[0] || null;
  }

  // ── 3. Документы (распарсенные) ──
  progress('documents', '📄 Читаю документы (ТЗ, договор, ППР)...');
  const documents = await collectDocuments(db, workId, work.tender_id);

  // ── 4-15: Параллельно ──
  progress('parallel', '⚡ Собираю аналоги, склад, сотрудников, допуска...');

  const startDate = work.start_plan || work.start_in_work_date || tender?.work_start_plan;
  const endDate = work.end_plan || work.end_fact || tender?.work_end_plan;
  const customerName = work.customer_name || tender?.customer_name;

  const [
    tkp,              // 4
    analogs,          // 5
    customerHistory,  // 6
    completedWorks,   // 7
    marginStats,      // 8
    warehouse,        // 9
    employees,        // 10
    allPermits,       // 11
    availability,     // 12
    workHistory,      // 13
    tariffs,          // 14
    settings          // 15
  ] = await Promise.all([
    collectTKP(db, work.tender_id, customerName),
    collectAnalogs(db, work, tender),
    collectCustomerHistory(db, customerName),
    collectCompletedWorks(db),
    collectMarginStats(db),
    collectWarehouse(db),
    collectEmployees(db),
    collectAllPermits(db),
    collectAvailability(db, startDate, endDate),
    collectWorkHistory(db),
    collectTariffs(db),
    collectSettings(db)
  ]);

  progress('collected', '✅ Все данные собраны');

  return {
    work, tender, documents, tkp, analogs, customerHistory,
    completedWorks, marginStats, warehouse, employees, allPermits,
    availability, workHistory, tariffs, settings,
    _meta: {
      work_id: workId,
      collected_at: new Date().toISOString(),
      elapsed_ms: Date.now() - t0,
      period: { start: startDate, end: endDate }
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTORS
// ═══════════════════════════════════════════════════════════════════════════

async function collectDocuments(db, workId, tenderId) {
  const conditions = [];
  const params = [];
  if (workId) { params.push(workId); conditions.push(`work_id = $${params.length}`); }
  if (tenderId) { params.push(tenderId); conditions.push(`tender_id = $${params.length}`); }
  if (!conditions.length) return [];

  params.push(10);
  const res = await db.query(
    `SELECT id, original_name, mime_type, size, filename, type
     FROM documents WHERE ${conditions.join(' OR ')}
     ORDER BY created_at DESC LIMIT $${params.length}`, params);

  const docs = [];
  for (const doc of res.rows) {
    const content = await parseDocumentContent(doc);
    docs.push({
      id: doc.id,
      name: doc.original_name || doc.filename,
      type: doc.type,
      mime: doc.mime_type,
      size_kb: Math.round((doc.size || 0) / 1024),
      content: content || null
    });
  }
  return docs;
}

async function collectTKP(db, tenderId, customerName) {
  try {
    const params = [];
    const conds = [];
    if (tenderId) { params.push(tenderId); conds.push(`tender_id = $${params.length}`); }
    if (customerName) { params.push(`%${customerName}%`); conds.push(`customer_name ILIKE $${params.length}`); }
    if (!conds.length) return [];
    params.push(15);
    const res = await db.query(
      `SELECT id, title, customer_name, total_sum, status, created_at
       FROM tkp WHERE ${conds.join(' OR ')}
       ORDER BY created_at DESC LIMIT $${params.length}`, params);
    return res.rows;
  } catch { return []; }
}

async function collectAnalogs(db, work, tender) {
  try {
    // Ищем по ключевому слову из названия
    const title = tender?.tender_title || work.work_title || '';
    const words = title.toLowerCase().replace(/[«»"'()\[\],.\d№#]/g, ' ')
      .split(/\s+/).filter(w => w.length >= 5);
    const keyword = words[0] || null;

    const res = await db.query(
      `SELECT e.id, e.title, e.work_type, e.crew_count, e.work_days, e.road_days,
              e.markup_multiplier, e.approval_status, e.customer, e.object_city,
              e.cost_plan, e.price_tkp, e.margin_pct, e.created_at,
              ecd.total_cost, ecd.total_with_margin, ecd.margin_pct AS calc_margin,
              ecd.personnel_json, ecd.contingency_pct,
              t.customer_name AS tender_customer, t.tender_status, t.estimated_sum
       FROM estimates e
       LEFT JOIN estimate_calculation_data ecd ON ecd.estimate_id = e.id
              AND ecd.version_no = COALESCE(e.current_version_no, 1)
       LEFT JOIN tenders t ON t.id = e.tender_id
       WHERE e.approval_status IN ('approved','rejected','sent')
       ORDER BY e.created_at DESC LIMIT 15`);
    return res.rows;
  } catch { return []; }
}

async function collectCustomerHistory(db, customerName) {
  if (!customerName || customerName.length < 3) return [];
  try {
    const res = await db.query(
      `SELECT id, tender_title, estimated_sum, tender_price, status, tender_status,
              deadline, created_at
       FROM tenders WHERE customer_name ILIKE $1
       ORDER BY created_at DESC LIMIT 20`,
      [`%${customerName}%`]);
    return res.rows;
  } catch { return []; }
}

async function collectCompletedWorks(db) {
  try {
    const res = await db.query(
      `SELECT w.id, w.work_title, w.customer_name, w.contract_value, w.cost_plan, w.cost_fact,
              w.work_status, w.start_in_work_date, w.end_fact, w.crew_size, w.vat_pct,
              (SELECT COALESCE(SUM(amount),0) FROM work_expenses WHERE work_id = w.id) AS real_expenses
       FROM works w
       WHERE w.work_status IN ('Завершена','Работы сдали','Закрыт')
         AND w.deleted_at IS NULL
       ORDER BY w.end_fact DESC NULLS LAST LIMIT 15`);
    return res.rows;
  } catch { return []; }
}

async function collectMarginStats(db) {
  try {
    const res = await db.query(`
      SELECT
        COUNT(*) AS total_works,
        ROUND(AVG(CASE WHEN contract_value > 0 AND cost_fact > 0
          THEN ((contract_value / (1 + COALESCE(vat_pct,22)::numeric/100)) - cost_fact) / NULLIF(cost_fact,0) * 100
          END), 1) AS avg_margin_pct,
        ROUND(AVG(contract_value), 0) AS avg_contract,
        ROUND(AVG(cost_fact), 0) AS avg_cost_fact
      FROM works
      WHERE work_status IN ('Завершена','Работы сдали','Закрыт')
        AND deleted_at IS NULL AND contract_value > 0`);
    return res.rows[0] || {};
  } catch { return {}; }
}

async function collectWarehouse(db) {
  try {
    const res = await db.query(
      `SELECT e.id, e.name, e.inventory_number, e.quantity, e.unit, e.status,
              e.purchase_price, e.book_value, e.brand, e.model,
              c.name AS category_name, w.name AS warehouse_name
       FROM equipment e
       LEFT JOIN equipment_categories c ON c.id = e.category_id
       LEFT JOIN warehouses w ON w.id = e.warehouse_id
       WHERE COALESCE(e.is_active, true) = true
         AND COALESCE(e.status, 'available') NOT IN ('written_off','disposed','lost')
       ORDER BY c.name, e.name
       LIMIT 500`);
    return res.rows;
  } catch { return []; }
}

async function collectEmployees(db) {
  try {
    const res = await db.query(
      `SELECT id, COALESCE(full_name, fio) AS name, position, role_tag, grade,
              city, phone, is_active, dismissal_date
       FROM employees
       WHERE COALESCE(is_active, true) = true AND dismissal_date IS NULL
       ORDER BY role_tag NULLS LAST, full_name
       LIMIT 600`);
    return res.rows;
  } catch { return []; }
}

async function collectAllPermits(db) {
  try {
    const res = await db.query(
      `SELECT ep.employee_id, pt.name AS permit_type, ep.expiry_date, ep.status,
              COALESCE(e.full_name, e.fio) AS employee_name
       FROM employee_permits ep
       JOIN permit_types pt ON pt.id = ep.type_id
       JOIN employees e ON e.id = ep.employee_id
       WHERE COALESCE(ep.is_active, true) = true
         AND COALESCE(ep.status, 'active') = 'active'
       ORDER BY ep.employee_id, pt.name`);
    return res.rows;
  } catch { return []; }
}

async function collectAvailability(db, startDate, endDate) {
  if (!startDate || !endDate) return { busy_employee_ids: [], busy_pm_ids: [] };
  try {
    const busyEmp = await db.query(
      `SELECT DISTINCT jsonb_array_elements_text(
          COALESCE(staff_ids_json,'[]'::jsonb) ||
          COALESCE(approved_staff_ids_a_json,'[]'::jsonb) ||
          COALESCE(approved_staff_ids_b_json,'[]'::jsonb)
        )::int AS emp_id
       FROM works
       WHERE work_status NOT IN ('Завершена','Отменена','archived')
         AND deleted_at IS NULL
         AND COALESCE(start_plan, start_in_work_date) <= $2::date
         AND COALESCE(end_plan, end_fact, start_plan + INTERVAL '30 days') >= $1::date`,
      [startDate, endDate]);

    const busyPm = await db.query(
      `SELECT DISTINCT pm_id FROM works
       WHERE work_status NOT IN ('Завершена','Отменена','archived')
         AND deleted_at IS NULL AND pm_id IS NOT NULL
         AND COALESCE(start_plan, start_in_work_date) <= $2::date
         AND COALESCE(end_plan, end_fact, start_plan + INTERVAL '30 days') >= $1::date`,
      [startDate, endDate]);

    return {
      busy_employee_ids: busyEmp.rows.map(r => r.emp_id),
      busy_pm_ids: busyPm.rows.map(r => r.pm_id)
    };
  } catch { return { busy_employee_ids: [], busy_pm_ids: [] }; }
}

async function collectWorkHistory(db) {
  try {
    // Кто на каких работах работал (через staff_ids_json)
    const res = await db.query(
      `SELECT
          sid::int AS employee_id,
          w.id AS work_id, w.work_title, w.customer_name, w.work_status,
          w.start_in_work_date, w.end_fact, w.city
       FROM works w,
            jsonb_array_elements_text(COALESCE(w.staff_ids_json,'[]'::jsonb)) AS sid
       WHERE w.deleted_at IS NULL
       ORDER BY w.start_in_work_date DESC NULLS LAST
       LIMIT 2000`);
    return res.rows;
  } catch { return []; }
}

async function collectTariffs(db) {
  try {
    const res = await db.query(
      `SELECT category, position_name, points, rate_per_shift, point_value,
              is_combinable, sort_order
       FROM field_tariff_grid
       WHERE COALESCE(is_active, true) = true
       ORDER BY category, sort_order, points`);
    return res.rows;
  } catch { return []; }
}

async function collectSettings(db) {
  const defaults = {
    vat_pct: 22, fot_tax_pct: 55, overhead_pct: 15,
    consumables_pct: 3, contingency_pct: 12
  };
  try {
    const res = await db.query(
      "SELECT key, value_json FROM settings WHERE key IN ('vat_default_pct','fot_pct','overhead_pct','consumables_pct','contingency_pct')");
    for (const r of res.rows) {
      if (r.key === 'vat_default_pct') defaults.vat_pct = parseFloat(r.value_json) || defaults.vat_pct;
    }
  } catch {}
  return defaults;
}

// ═══════════════════════════════════════════════════════════════════════════

module.exports = { collectAll };
