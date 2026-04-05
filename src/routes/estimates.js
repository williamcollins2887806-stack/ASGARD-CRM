'use strict';

/**
 * Estimates Routes — Просчёты (CRUD + отчёт согласования)
 * ═══════════════════════════════════════════════════════════════
 *
 * CRUD: создание, чтение, обновление обычных полей, удаление.
 * Согласование (смена approval_status) — ТОЛЬКО через /api/approval/estimates/:id/*
 * PUT с approval_status → 400.
 * version_no генерируется сервером автоматически.
 *
 * Новые эндпоинты (V058):
 *   GET  /:id/calculation — данные расчёта (6 блоков)
 *   PUT  /:id/calculation — сохранить/обновить расчёт
 *   GET  /:id/diff        — сравнение версий расчёта
 *   GET  /:id/analogs     — аналогичные просчёты
 */

const approvalService = require('../services/approvalService');

const ALLOWED_COLS = new Set([
  'tender_id', 'title', 'pm_id', 'approval_status',
  'margin', 'comment', 'amount', 'cost', 'notes', 'description',
  'customer', 'object_name', 'work_type', 'priority', 'deadline',
  'items_json', 'work_id', 'approval_comment',
  'sent_for_approval_at', 'reject_reason', 'version_no',
  'cover_letter', 'assumptions', 'price_tkp', 'cost_plan',
  'calc_v2_json', 'calc_summary_json', 'quick_calc_json',
  'probability_pct', 'payment_terms',
  'created_by', 'created_at', 'updated_at',
  // V058: новые колонки
  'current_version_no', 'last_director_comment', 'director_id', 'sla_deadline',
  'object_description', 'object_city', 'object_distance_km',
  'work_start_date', 'work_end_date', 'crew_count', 'work_days', 'road_days',
  'markup_multiplier', 'markup_reason', 'analog_projects'
]);

const APPROVAL_FIELDS = new Set([
  'is_approved', 'approved_by', 'approved_at', 'decided_at', 'decided_by_user_id'
]);

// Роли с доступом к расчётам
const CALC_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM'];

function filterData(data) {
  const filtered = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (ALLOWED_COLS.has(key) && value !== undefined) filtered[key] = value;
  }
  return filtered;
}

/**
 * Проверка доступа к просчёту: PM только свои, BUH только approved+payment
 */
async function checkEstimateAccess(db, estimateId, user, reply) {
  const result = await db.query('SELECT * FROM estimates WHERE id = $1', [estimateId]);
  if (!result.rows[0]) {
    reply.code(404).send({ error: 'Просчёт не найден' });
    return null;
  }
  const estimate = result.rows[0];
  const { role, id: userId } = user;

  const NO_ACCESS = ['HR', 'HR_MANAGER', 'WAREHOUSE', 'PROC', 'OFFICE_MANAGER', 'CHIEF_ENGINEER'];
  if (NO_ACCESS.includes(role)) {
    reply.code(403).send({ error: 'Нет доступа к просчётам' });
    return null;
  }
  if (role === 'PM' && Number(estimate.pm_id) !== Number(userId)) {
    reply.code(403).send({ error: 'Нет доступа к этому просчёту' });
    return null;
  }
  if (role === 'BUH' && !(estimate.approval_status === 'approved' && estimate.requires_payment)) {
    reply.code(403).send({ error: 'Нет доступа к этому просчёту' });
    return null;
  }
  return estimate;
}

async function routes(fastify) {
  const db = fastify.db;

  // ─── LIST ───
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tender_id, pm_id, status, limit = 100, offset = 0 } = request.query;
    const role = request.user.role;
    const userId = request.user.id;

    const NO_ACCESS = ['HR', 'HR_MANAGER', 'WAREHOUSE', 'PROC', 'OFFICE_MANAGER', 'CHIEF_ENGINEER'];
    if (NO_ACCESS.includes(role)) return { estimates: [] };

    let sql = `SELECT e.*, t.customer_name as customer, u.name as pm_name,
               (SELECT COUNT(*) FROM approval_comments ac WHERE ac.entity_type = 'estimates' AND ac.entity_id = e.id) as comments_count
               FROM estimates e
               LEFT JOIN tenders t ON e.tender_id = t.id
               LEFT JOIN users u ON e.pm_id = u.id WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (role === 'PM') {
      sql += ` AND e.pm_id = $${idx}`;
      params.push(userId);
      idx++;
    }

    if (role === 'BUH') {
      sql += ` AND e.approval_status = 'approved' AND e.requires_payment = true`;
    }

    if (tender_id) { sql += ` AND e.tender_id = $${idx}`; params.push(tender_id); idx++; }
    if (pm_id) { sql += ` AND e.pm_id = $${idx}`; params.push(pm_id); idx++; }
    if (status) { sql += ` AND e.approval_status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY e.id DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { estimates: result.rows };
  });

  // ─── GET (с calculation data + comments count + director name) ───
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const estimate = await checkEstimateAccess(db, request.params.id, request.user, reply);
    if (!estimate) return;

    // Подтянуть calculation data для текущей версии
    const calcResult = await db.query(
      `SELECT * FROM estimate_calculation_data WHERE estimate_id = $1 AND version_no = $2`,
      [estimate.id, estimate.current_version_no || 1]
    );
    estimate.calculation = calcResult.rows[0] || null;

    // Количество комментариев
    const commentsResult = await db.query(
      `SELECT COUNT(*) as count FROM approval_comments WHERE entity_type = 'estimates' AND entity_id = $1`,
      [estimate.id]
    );
    estimate.comments_count = parseInt(commentsResult.rows[0].count);

    // Имя директора
    if (estimate.director_id) {
      const dirResult = await db.query('SELECT name FROM users WHERE id = $1', [estimate.director_id]);
      estimate.director_name = dirResult.rows[0]?.name || null;
    }

    // Документы: через tender_id + напрямую через estimate_id
    const docConditions = [];
    const docParams = [];
    if (estimate.tender_id) {
      docParams.push(estimate.tender_id);
      docConditions.push(`tender_id = $${docParams.length}`);
    }
    docParams.push(estimate.id);
    docConditions.push(`estimate_id = $${docParams.length}`);

    const docsResult = await db.query(
      `SELECT id, filename, original_name, mime_type, size, type, created_at
       FROM documents WHERE ${docConditions.join(' OR ')} ORDER BY created_at ASC`,
      docParams
    );
    estimate.documents = docsResult.rows;

    return { estimate };
  });

  // ─── GET CALCULATION ───
  fastify.get('/:id/calculation', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const role = request.user.role;
    if (!CALC_ROLES.includes(role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const estimate = await checkEstimateAccess(db, request.params.id, request.user, reply);
    if (!estimate) return;

    const versionNo = estimate.current_version_no || 1;
    const result = await db.query(
      `SELECT * FROM estimate_calculation_data WHERE estimate_id = $1 AND version_no = $2`,
      [estimate.id, versionNo]
    );

    return { calculation: result.rows[0] || null, version_no: versionNo };
  });

  // ─── PUT CALCULATION (UPSERT) ───
  fastify.put('/:id/calculation', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const role = request.user.role;
    if (!CALC_ROLES.includes(role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const estimate = await checkEstimateAccess(db, request.params.id, request.user, reply);
    if (!estimate) return;

    const body = request.body || {};
    const versionNo = estimate.current_version_no || 1;

    // Извлекаем 6 блоков
    const personnel = body.personnel_json || [];
    const currentCosts = body.current_costs_json || [];
    const travel = body.travel_json || [];
    const transport = body.transport_json || [];
    const chemistry = body.chemistry_json || [];
    const contingencyPct = parseFloat(body.contingency_pct) || 5;
    const marginPct = parseFloat(body.margin_pct) || 0;
    const notes = body.notes || null;

    // Пересчёт итогов
    const sumBlock = (arr) => (arr || []).reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
    const subtotal = sumBlock(personnel) + sumBlock(currentCosts) + sumBlock(travel) + sumBlock(transport) + sumBlock(chemistry);
    const contingencyAmount = subtotal * (contingencyPct / 100);
    const totalCost = subtotal + contingencyAmount;
    const totalWithMargin = marginPct > 0 ? totalCost * (1 + marginPct / 100) : totalCost;

    const result = await db.query(
      `INSERT INTO estimate_calculation_data
       (estimate_id, version_no, personnel_json, current_costs_json, travel_json, transport_json,
        chemistry_json, contingency_pct, subtotal, contingency_amount, total_cost, margin_pct,
        total_with_margin, notes, created_by, mimir_suggestions, warehouse_check, files_parsed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (estimate_id, version_no) DO UPDATE SET
         personnel_json = EXCLUDED.personnel_json,
         current_costs_json = EXCLUDED.current_costs_json,
         travel_json = EXCLUDED.travel_json,
         transport_json = EXCLUDED.transport_json,
         chemistry_json = EXCLUDED.chemistry_json,
         contingency_pct = EXCLUDED.contingency_pct,
         subtotal = EXCLUDED.subtotal,
         contingency_amount = EXCLUDED.contingency_amount,
         total_cost = EXCLUDED.total_cost,
         margin_pct = EXCLUDED.margin_pct,
         total_with_margin = EXCLUDED.total_with_margin,
         notes = EXCLUDED.notes,
         mimir_suggestions = EXCLUDED.mimir_suggestions,
         warehouse_check = EXCLUDED.warehouse_check,
         files_parsed = EXCLUDED.files_parsed,
         updated_at = NOW()
       RETURNING *`,
      [
        estimate.id, versionNo,
        JSON.stringify(personnel), JSON.stringify(currentCosts),
        JSON.stringify(travel), JSON.stringify(transport),
        JSON.stringify(chemistry), contingencyPct,
        subtotal.toFixed(2), contingencyAmount.toFixed(2), totalCost.toFixed(2),
        marginPct, totalWithMargin.toFixed(2), notes, request.user.id,
        body.mimir_suggestions ? JSON.stringify(body.mimir_suggestions) : null,
        body.warehouse_check ? JSON.stringify(body.warehouse_check) : null,
        body.files_parsed ? JSON.stringify(body.files_parsed) : null
      ]
    );

    return { calculation: result.rows[0] };
  });

  // ─── GET DIFF (сравнение версий) ───
  fastify.get('/:id/diff', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const role = request.user.role;
    if (!CALC_ROLES.includes(role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const estimate = await checkEstimateAccess(db, request.params.id, request.user, reply);
    if (!estimate) return;

    let v1 = parseInt(request.query.v1) || 1;
    let v2 = parseInt(request.query.v2) || (estimate.current_version_no || 1);
    if (!request.query.v1 && v2 > 1) v1 = v2 - 1;

    const result = await db.query(
      `SELECT * FROM estimate_calculation_data WHERE estimate_id = $1 AND version_no IN ($2, $3) ORDER BY version_no`,
      [estimate.id, v1, v2]
    );

    const versions = {};
    for (const row of result.rows) {
      versions[`v${row.version_no}`] = row;
    }

    return { diff: versions, v1, v2 };
  });

  // ─── GET ANALOGS (похожие просчёты) ───
  fastify.get('/:id/analogs', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const role = request.user.role;
    if (!CALC_ROLES.includes(role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const estimate = await checkEstimateAccess(db, request.params.id, request.user, reply);
    if (!estimate) return;

    // Ищем по work_type или object_name
    const conditions = [];
    const params = [estimate.id]; // $1 = текущий id (исключаем)
    let idx = 2;

    if (estimate.work_type) {
      conditions.push(`e.work_type = $${idx}`);
      params.push(estimate.work_type);
      idx++;
    }
    if (estimate.object_name) {
      conditions.push(`e.object_name = $${idx}`);
      params.push(estimate.object_name);
      idx++;
    }

    if (!conditions.length) {
      return { analogs: [] };
    }

    const result = await db.query(
      `SELECT e.id, e.title, e.work_type, e.object_name, e.approval_status,
              e.amount, e.cost, e.created_at, u.name as pm_name,
              ecd.total_cost, ecd.total_with_margin
       FROM estimates e
       LEFT JOIN users u ON e.pm_id = u.id
       LEFT JOIN estimate_calculation_data ecd ON ecd.estimate_id = e.id AND ecd.version_no = COALESCE(e.current_version_no, 1)
       WHERE e.id != $1 AND e.approval_status = 'approved' AND (${conditions.join(' OR ')})
       ORDER BY e.created_at DESC
       LIMIT 5`,
      params
    );

    return { analogs: result.rows };
  });

  // ─── CREATE ───
  fastify.post('/', {
    preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'])]
  }, async (request, reply) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const body = request.body || {};
      if (body.name && !body.title) { body.title = body.name; delete body.name; }
      if (!body.pm_id) body.pm_id = request.user.id;
      if (!body.title && !body.tender_id) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Укажите название или тендер' });
      }

      const data = filterData({ ...body, created_by: request.user.id, created_at: new Date().toISOString() });
      const sendForApproval = ['sent', 'pending'].includes(String(data.approval_status || '').toLowerCase());
      if (sendForApproval) {
        data.approval_status = 'sent';
        data.sent_for_approval_at = new Date().toISOString();
      } else {
        data.approval_status = data.approval_status || 'draft';
      }

      // version_no — генерируется сервером, клиентское значение игнорируется
      delete data.version_no;
      if (data.tender_id && data.pm_id) {
        const vResult = await client.query(
          'SELECT COALESCE(MAX(version_no), 0) + 1 AS next_ver FROM estimates WHERE tender_id = $1 AND pm_id = $2',
          [data.tender_id, data.pm_id]
        );
        data.version_no = vResult.rows[0].next_ver;
      } else {
        data.version_no = 1;
      }

      const keys = Object.keys(data);
      if (!keys.length) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Нет данных' }); }
      const values = Object.values(data);
      const sql = `INSERT INTO estimates (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await client.query(sql, values);
      const estimate = result.rows[0];

      if (sendForApproval) {
        await approvalService.notifyDirectorsForApproval(client, {
          entityType: 'estimates', entityId: estimate.id,
          actorName: request.user.name,
          title: '📋 Просчёт на согласование',
          message: `${request.user.name || 'РП'} отправил просчёт #${estimate.id}`,
          requiresPayment: false
        });

        // H1: Создать чат Huginn при отправке на согласование (как в approval.js)
        const estimateChat = require('../services/estimateChat');
        setImmediate(async () => {
          try {
            await estimateChat.createEstimateChat(db, estimate.id, request.user);
          } catch (err) {
            console.error('[QC→H1] Chat creation error:', err.message);
          }
        });
      }

      await client.query('COMMIT');
      return { estimate };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '22003') return reply.code(400).send({ error: 'Число вне диапазона' });
      if (err.code === '23503') return reply.code(400).send({ error: 'Связанная запись не найдена' });
      return reply.code(500).send({ error: 'Ошибка создания просчёта' });
    } finally {
      client.release();
    }
  });

  // ─── UPDATE ───
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body || {};

    if (body.approval_status) {
      return reply.code(400).send({
        error: 'Используйте /api/approval/estimates/:id/* для смены статуса'
      });
    }

    const currentResult = await db.query('SELECT * FROM estimates WHERE id = $1', [id]);
    const current = currentResult.rows[0];
    if (!current) return reply.code(404).send({ error: 'Просчёт не найден' });

    const data = filterData(body);

    for (const field of APPROVAL_FIELDS) delete data[field];
    delete data.reject_reason;
    delete data.approval_comment;
    delete data.sent_for_approval_at;

    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      updates.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    updates.push('updated_at = NOW()');
    values.push(id);
    const sql = `UPDATE estimates SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    return { estimate: result.rows[0] };
  });

  // ─── AUTO-CALCULATE (Mimir engine) ───
  fastify.post('/:id/auto-calculate', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const role = request.user.role;
    if (!CALC_ROLES.includes(role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const estimate = await checkEstimateAccess(db, request.params.id, request.user, reply);
    if (!estimate) return;

    // ── Tariff tables from MIMIR_CALCULATION_ENGINE_v2.md ──
    const TARIFF_GROUND_NORMAL = { worker: 5500, master: 7000, shift_master: 6000 };
    const TARIFF_GROUND_HEAVY  = { worker: 6500, master: 8000, shift_master: 7000 };
    const TARIFF_WAREHOUSE     = { worker: 5000, master: 6000 };
    const ROAD_RATE = 3000; // 6 баллов × 500₽
    const TAX_PCT = 55; // % налог на ФОТ
    const PASS_COST = 3000; // ₽/чел пропуска
    const DAILY_ALLOWANCE = 1000; // суточные ₽/чел/день
    const RATION = 1000; // пайковые ₽/чел/день
    const PPE_WORKER = 5000; // СИЗ рабочий
    const PPE_ITR = 7000; // СИЗ ИТР
    const OVERHEAD_PCT = 15;
    const CONSUMABLES_PCT = 3;
    const CONTINGENCY_PCT = 5;
    const HOTEL_MOSCOW = 3500; // ₽/чел/день
    const TICKET_SARATOV_MOSCOW = 12000; // ₽/чел
    const INSURANCE = 2000; // ₽/чел
    const TAXI_PER_DAY = 1500;
    const MANIPULATOR = 5000; // ₽/день
    const TRANSPORT_RATES = { corporate: 50, gazelle: 70, truck10: 95, truck20: 100 };

    // ── Extract params ──
    const crewCount = parseInt(estimate.crew_count) || 4;
    const workDays = parseInt(estimate.work_days) || 10;
    const roadDays = parseInt(estimate.road_days) || 2;
    const totalDays = workDays + roadDays;
    const distanceKm = parseInt(estimate.object_distance_km) || 500;
    const workType = estimate.work_type || 'CHEM';

    // Crew breakdown: workers + ITR + master
    const masters = 1;
    const itrCount = 1; // ИТР (инженер/РП на объекте)
    const ITR_RATE = 10000; // фиксированная ставка ₽/смена
    const workers = Math.max(crewCount - masters - itrCount, 1);
    const totalFieldCrew = workers + itrCount + masters; // все на объекте
    const warehouseStaff = Math.min(crewCount, 3);
    const warehouseDays = 2;

    // ── BLOCK 1: Personnel ──
    const personnelRows = [];
    const tariff = TARIFF_GROUND_NORMAL;

    // Workers
    const fotWorkers = workers * tariff.worker * totalDays;
    personnelRows.push({
      item: 'Рабочие (слесари)', qty: workers, rate: tariff.worker, days: totalDays,
      total: fotWorkers, source: 'tariff', editable: ['qty', 'rate', 'days']
    });
    // ITR (engineer/PM on-site) — NOT from tariff grid, fixed rate
    const fotITR = itrCount * ITR_RATE * totalDays;
    personnelRows.push({
      item: 'ИТР (инженер/РП)', qty: itrCount, rate: ITR_RATE, days: totalDays,
      total: fotITR, source: 'fixed', editable: ['qty', 'rate', 'days']
    });
    // Master
    const fotMaster = masters * tariff.master * totalDays;
    personnelRows.push({
      item: 'Мастер ответственный', qty: masters, rate: tariff.master, days: totalDays,
      total: fotMaster, source: 'tariff', editable: ['qty', 'rate', 'days']
    });
    // Warehouse
    const fotWarehouse = warehouseStaff * TARIFF_WAREHOUSE.worker * warehouseDays;
    personnelRows.push({
      item: 'Подготовка на складе', qty: warehouseStaff, rate: TARIFF_WAREHOUSE.worker, days: warehouseDays,
      total: fotWarehouse, source: 'tariff', editable: ['qty', 'rate', 'days']
    });
    // Road days surcharge (all field crew)
    const roadPay = totalFieldCrew * ROAD_RATE * roadDays;
    personnelRows.push({
      item: 'Дни дороги (6 баллов)', qty: totalFieldCrew, rate: ROAD_RATE, days: roadDays,
      total: roadPay, source: 'tariff', editable: ['qty', 'days']
    });
    // Tax on ALL FOT (workers + ITR + master + warehouse + road)
    const totalFOT = fotWorkers + fotITR + fotMaster + fotWarehouse + roadPay;
    const tax = totalFOT * TAX_PCT / 100;
    personnelRows.push({
      item: 'Налоги на ФОТ (55%)', percent: TAX_PCT, base: totalFOT,
      total: tax, source: 'config', editable: []
    });
    // Passes (all field crew)
    const passes = totalFieldCrew * PASS_COST;
    personnelRows.push({
      item: 'Пропуска и инструктаж', qty: totalFieldCrew, rate: PASS_COST,
      total: passes, source: 'config', editable: ['qty', 'rate']
    });

    // ── BLOCK 2: Current costs ──
    const currentRows = [];
    // PPE: workers × 5000, ITR × 7000, master × 7000
    const ppe = workers * PPE_WORKER + itrCount * PPE_ITR + masters * PPE_ITR;
    currentRows.push({
      item: 'СИЗ бригады', qty: totalFieldCrew, rate: PPE_WORKER,
      total: ppe, source: 'config', editable: ['total']
    });
    // Depreciation (default equipment cost 500k)
    const depreciation = 500000 * 0.005 * totalDays;
    currentRows.push({
      item: 'Амортизация оборудования', total: depreciation,
      source: 'estimate', editable: ['total']
    });
    // Insurance
    const insurance = totalFieldCrew * INSURANCE;
    currentRows.push({
      item: 'Страховка бригады', qty: totalFieldCrew, rate: INSURANCE,
      total: insurance, source: 'config', editable: ['qty', 'rate']
    });
    // Taxi or car rental
    if (totalFieldCrew <= 5) {
      currentRows.push({
        item: 'Такси (объект)', rate: TAXI_PER_DAY, days: workDays,
        total: TAXI_PER_DAY * workDays, source: 'config', editable: ['rate', 'days']
      });
    } else {
      currentRows.push({
        item: 'Аренда авто', rate: 4000, days: workDays,
        total: 4000 * workDays, source: 'estimate', editable: ['rate', 'days']
      });
    }
    // Moscow hotel for warehouse prep
    const moscowHotel = warehouseStaff * HOTEL_MOSCOW * warehouseDays;
    currentRows.push({
      item: 'Проживание Москва (склад)', qty: warehouseStaff, rate: HOTEL_MOSCOW, days: warehouseDays,
      total: moscowHotel, source: 'config', editable: ['qty', 'rate', 'days']
    });
    // Block1 subtotal for overhead/consumables calc
    const block1Sub = personnelRows.reduce((s, r) => s + (r.total || 0), 0);
    const currentSub = currentRows.reduce((s, r) => s + (r.total || 0), 0);
    const overheadBase = block1Sub + currentSub;
    // Overhead 15%
    currentRows.push({
      item: 'Накладные расходы (15%)', percent: OVERHEAD_PCT, base: overheadBase,
      total: overheadBase * OVERHEAD_PCT / 100, source: 'config', editable: []
    });
    // Consumables 3%
    currentRows.push({
      item: 'Расходные материалы (3%)', percent: CONSUMABLES_PCT, base: overheadBase,
      total: overheadBase * CONSUMABLES_PCT / 100, source: 'config', editable: []
    });

    // ── BLOCK 3: Travel ──
    const travelRows = [];
    // Tickets Saratov-Moscow
    const ticketSarMsk = totalFieldCrew * TICKET_SARATOV_MOSCOW;
    travelRows.push({
      item: 'Билеты Саратов↔Москва', qty: totalFieldCrew, rate: TICKET_SARATOV_MOSCOW,
      total: ticketSarMsk, source: 'estimate', editable: ['qty', 'rate']
    });
    // Tickets Moscow-Object (estimate based on distance)
    const ticketMskObj = distanceKm > 1000 ? 15000 : distanceKm > 500 ? 8000 : 5000;
    travelRows.push({
      item: 'Билеты Москва↔Объект', qty: totalFieldCrew, rate: ticketMskObj,
      total: totalFieldCrew * ticketMskObj, source: 'estimate', editable: ['qty', 'rate']
    });
    // Hotel on-site
    const hotelRate = 1500;
    travelRows.push({
      item: 'Проживание на объекте', qty: totalFieldCrew, rate: hotelRate, days: totalDays,
      total: totalFieldCrew * hotelRate * totalDays, source: 'estimate', editable: ['qty', 'rate', 'days']
    });
    // Daily allowance
    travelRows.push({
      item: 'Суточные', qty: totalFieldCrew, rate: DAILY_ALLOWANCE, days: totalDays,
      total: totalFieldCrew * DAILY_ALLOWANCE * totalDays, source: 'config', editable: ['qty', 'days']
    });
    // Rations
    travelRows.push({
      item: 'Пайковые', qty: totalFieldCrew, rate: RATION, days: totalDays,
      total: totalFieldCrew * RATION * totalDays, source: 'config', editable: ['qty', 'days']
    });

    // ── BLOCK 4: Transport ──
    const transportRows = [];
    // Choose transport type based on crew size
    const tType = crewCount > 8 ? 'truck10' : crewCount > 5 ? 'gazelle' : 'corporate';
    const tRate = TRANSPORT_RATES[tType];
    const tName = tType === 'truck10' ? 'Фура 10т' : tType === 'gazelle' ? 'Газель 5т' : 'Корпоративный';
    const tCost = distanceKm * 2 * tRate;
    transportRows.push({
      item: `Доставка оборудования (${tName})`, distance_km: distanceKm, rate_km: tRate,
      total: tCost, source: 'config', editable: ['distance_km', 'rate_km']
    });
    // DOPOG for CHEM
    if (workType === 'CHEM') {
      transportRows.push({
        item: 'Надбавка ДОПОГ (+70%)', percent: 70, base: tCost,
        total: tCost * 0.7, source: 'config', editable: []
      });
    }
    // Manipulator
    transportRows.push({
      item: 'Манипулятор (склад)', rate: MANIPULATOR, days: 2,
      total: MANIPULATOR * 2, source: 'config', editable: ['rate', 'days']
    });

    // ── BLOCK 5: Chemistry (only for CHEM) ──
    const chemistryRows = [];
    if (workType === 'CHEM') {
      const body = request.body || {};
      const volumeM3 = parseFloat(body.volume_m3) || parseFloat(estimate.volume_m3) || 8;
      // Acid
      chemistryRows.push({
        item: 'Соляная кислота 35%', volume_m3: volumeM3 * 0.10, rate_m3: 58000,
        total: volumeM3 * 0.10 * 58000, source: 'reference', editable: ['volume_m3', 'rate_m3']
      });
      // Alkali neutralization
      chemistryRows.push({
        item: 'Кальцинированная сода', volume_m3: volumeM3 * 0.10 * 0.40, rate_m3: 103251,
        total: volumeM3 * 0.10 * 0.40 * 103251, source: 'reference', editable: ['volume_m3', 'rate_m3']
      });
      // Passivation
      chemistryRows.push({
        item: 'Пассивация (лимонная к-та)', volume_m3: volumeM3 * 0.01, rate_m3: 240000,
        total: volumeM3 * 0.01 * 240000, source: 'reference', editable: ['volume_m3', 'rate_m3']
      });
      // Inhibitor
      chemistryRows.push({
        item: 'Ингибитор Друг СГ', qty: 7, rate: 3700,
        total: 7 * 3700, source: 'reference', editable: ['qty', 'rate']
      });
      // Disposal
      chemistryRows.push({
        item: 'Утилизация отходов', volume_m3: volumeM3, rate_m3: 10000,
        total: volumeM3 * 10000, source: 'reference', editable: ['volume_m3', 'rate_m3']
      });
      // Water supply
      chemistryRows.push({
        item: 'Водоснабжение (водовоз)', total: 15000,
        source: 'estimate', editable: ['total']
      });
    }

    // ── BLOCK 6: Contingency ──
    const block1Total = personnelRows.reduce((s, r) => s + (r.total || 0), 0);
    const block2Total = currentRows.reduce((s, r) => s + (r.total || 0), 0);
    const block3Total = travelRows.reduce((s, r) => s + (r.total || 0), 0);
    const block4Total = transportRows.reduce((s, r) => s + (r.total || 0), 0);
    const block5Total = chemistryRows.reduce((s, r) => s + (r.total || 0), 0);
    const subtotalAll = block1Total + block2Total + block3Total + block4Total + block5Total;
    const contingencyAmount = subtotalAll * CONTINGENCY_PCT / 100;
    const totalCost = subtotalAll + contingencyAmount;

    // Default markup ×2.0
    const markup = parseFloat(estimate.markup_multiplier) || 2.0;
    const marginPct = (markup - 1) * 100;
    const totalWithMargin = totalCost * markup;

    const versionNo = estimate.current_version_no || 1;

    // UPSERT calculation data
    const result = await db.query(
      `INSERT INTO estimate_calculation_data
       (estimate_id, version_no, personnel_json, current_costs_json, travel_json, transport_json,
        chemistry_json, contingency_pct, subtotal, contingency_amount, total_cost, margin_pct,
        total_with_margin, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (estimate_id, version_no) DO UPDATE SET
         personnel_json = EXCLUDED.personnel_json,
         current_costs_json = EXCLUDED.current_costs_json,
         travel_json = EXCLUDED.travel_json,
         transport_json = EXCLUDED.transport_json,
         chemistry_json = EXCLUDED.chemistry_json,
         contingency_pct = EXCLUDED.contingency_pct,
         subtotal = EXCLUDED.subtotal,
         contingency_amount = EXCLUDED.contingency_amount,
         total_cost = EXCLUDED.total_cost,
         margin_pct = EXCLUDED.margin_pct,
         total_with_margin = EXCLUDED.total_with_margin,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`,
      [
        estimate.id, versionNo,
        JSON.stringify(personnelRows), JSON.stringify(currentRows),
        JSON.stringify(travelRows), JSON.stringify(transportRows),
        JSON.stringify(chemistryRows), CONTINGENCY_PCT,
        subtotalAll.toFixed(2), contingencyAmount.toFixed(2), totalCost.toFixed(2),
        marginPct, totalWithMargin.toFixed(2),
        'Авторасчёт Мимира', request.user.id
      ]
    );

    return { success: true, calculation: result.rows[0] };
  });

  // ─── DELETE ───
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const result = await db.query('DELETE FROM estimates WHERE id = $1 RETURNING id', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { message: 'Удалено' };
  });
}

module.exports = routes;
