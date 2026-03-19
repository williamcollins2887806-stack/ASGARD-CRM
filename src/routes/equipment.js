/**
 * ASGARD CRM - Equipment Routes (FaceKit Premium)
 * Учёт ТМЦ и оборудования + Комплекты + Привязка к работам
 */

async function equipmentRoutes(fastify, options) {
  const db = fastify.db;
  const path = require('path');
  const fsp = require('fs').promises;
  const { randomUUID } = require('crypto');

  // Роли с полным доступом к складу (M15: добавлен CHIEF_ENGINEER)
  const WAREHOUSE_ADMINS = ['ADMIN', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const PM_ROLES = ['PM', 'HEAD_PM', 'MANAGER', 'DIRECTOR_DEV', 'DIRECTOR_GEN', 'CHIEF_ENGINEER'];

  function canManageEquipment(role) {
    return WAREHOUSE_ADMINS.includes(role) || PM_ROLES.includes(role);
  }

  function isWarehouseAdmin(role) {
    return WAREHOUSE_ADMINS.includes(role);
  }

  function hasFullAccess(role) {
    return ['ADMIN', 'CHIEF_ENGINEER', 'DIRECTOR', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role);
  }

  // ============================================
  // 1. GET /categories
  // ============================================
  fastify.get('/categories', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const result = await db.query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM equipment e WHERE e.category_id = c.id AND e.status != 'written_off') as equipment_count
      FROM equipment_categories c
      ORDER BY c.sort_order, c.name
    `);
    return { success: true, categories: result.rows };
  });

  // ============================================
  // 2. GET /objects
  // ============================================
  fastify.get('/objects', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const result = await db.query(`
      SELECT * FROM objects WHERE is_active = true ORDER BY name
    `);
    return { success: true, objects: result.rows };
  });

  // ============================================
  // 3. GET /warehouses
  // ============================================
  fastify.get('/warehouses', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const result = await db.query(`
      SELECT w.*, u.name as responsible_name
      FROM warehouses w
      LEFT JOIN users u ON w.responsible_id = u.id
      WHERE w.is_active = true
      ORDER BY w.is_main DESC, w.name
    `);
    return { success: true, warehouses: result.rows };
  });

  // ============================================
  // 4. GET /balance-value
  // ============================================
  fastify.get('/balance-value', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    if (!hasFullAccess(user.role) && !isWarehouseAdmin(user.role)) {
      return { success: true, message: 'Нет доступа к финансовым данным' };
    }

    const result = await db.query(`
      SELECT 
        COALESCE(SUM(purchase_price), 0) as total_purchase_value,
        COALESCE(SUM(book_value), 0) as total_book_value,
        COALESCE(SUM(accumulated_depreciation), 0) as total_depreciation,
        COUNT(*) as total_items,
        COUNT(*) FILTER (WHERE status = 'on_warehouse') as on_warehouse,
        COUNT(*) FILTER (WHERE status = 'issued') as issued,
        COUNT(*) FILTER (WHERE status = 'written_off') as written_off
      FROM equipment
    `);

    return { success: true, ...result.rows[0] };
  });

  // ============================================
  // 5. GET /by-qr/:uuid
  // ============================================
  fastify.get('/by-qr/:uuid', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { uuid } = request.params;

    const result = await db.query(`
      SELECT e.*, 
        c.name as category_name, c.icon as category_icon,
        w.name as warehouse_name,
        h.name as holder_name,
        o.name as object_name
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN warehouses w ON e.warehouse_id = w.id
      LEFT JOIN users h ON e.current_holder_id = h.id
      LEFT JOIN objects o ON e.current_object_id = o.id
      WHERE e.qr_uuid = $1
    `, [uuid]);

    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено по QR' });
    }

    return { success: true, equipment: result.rows[0] };
  });

  // ============================================
  // 6. GET /requests
  // ============================================
  fastify.get('/requests', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    const { status } = request.query;

    let sql = `
      SELECT r.*,
        e.name as equipment_name, e.inventory_number,
        req.name as requester_name,
        th.name as target_holder_name,
        p.name as processed_by_name
      FROM equipment_requests r
      LEFT JOIN equipment e ON r.equipment_id = e.id
      LEFT JOIN users req ON r.requester_id = req.id
      LEFT JOIN users th ON r.target_holder_id = th.id
      LEFT JOIN users p ON r.processed_by = p.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      sql += ` AND r.status = $` + params.length;
    }

    if (!isWarehouseAdmin(user.role) && !hasFullAccess(user.role)) {
      params.push(user.id);
      sql += ` AND r.requester_id = $` + params.length;
    }

    sql += ` ORDER BY r.created_at DESC`;
    const result = await db.query(sql, params);

    return { success: true, requests: result.rows };
  });

  // ============================================
  // 7. GET /by-holder/:holderId
  // ============================================
  fastify.get('/by-holder/:holderId', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { holderId } = request.params;

    const result = await db.query(`
      SELECT e.*,
        c.name as category_name, c.icon as category_icon,
        w.name as warehouse_name,
        o.name as object_name
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN warehouses w ON e.warehouse_id = w.id
      LEFT JOIN objects o ON e.current_object_id = o.id
      WHERE e.current_holder_id = $1 AND e.status != 'written_off'
      ORDER BY e.name
    `, [holderId]);

    return { success: true, equipment: result.rows };
  });

  // ============================================
  // 8. GET /maintenance/upcoming
  // ============================================
  fastify.get('/maintenance/upcoming', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { days } = request.query;
    const lookAhead = parseInt(days) || 30;

    const result = await db.query(`
      SELECT e.id, e.name, e.inventory_number, e.serial_number,
        e.next_maintenance, e.next_calibration, e.status, e.condition,
        c.name as category_name, c.icon as category_icon,
        h.name as holder_name,
        w.name as warehouse_name
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN users h ON e.current_holder_id = h.id
      LEFT JOIN warehouses w ON e.warehouse_id = w.id
      WHERE e.status != 'written_off'
        AND (
          (e.next_maintenance IS NOT NULL AND e.next_maintenance <= CURRENT_DATE + $1 * INTERVAL '1 day')
          OR (e.next_calibration IS NOT NULL AND e.next_calibration <= CURRENT_DATE + $1 * INTERVAL '1 day')
        )
      ORDER BY LEAST(COALESCE(e.next_maintenance, '9999-12-31'), COALESCE(e.next_calibration, '9999-12-31'))
    `, [lookAhead]);

    return { success: true, upcoming: result.rows };
  });

  // ============================================
  // 9. GET /available
  // ============================================
  fastify.get('/available', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { category_id, warehouse_id } = request.query;

    let sql = `
      SELECT e.*,
        c.name as category_name, c.icon as category_icon,
        w.name as warehouse_name
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN warehouses w ON e.warehouse_id = w.id
      WHERE e.status = 'on_warehouse'
    `;
    const params = [];

    if (category_id) {
      params.push(category_id);
      sql += ` AND e.category_id = $` + params.length;
    }
    if (warehouse_id) {
      params.push(warehouse_id);
      sql += ` AND e.warehouse_id = $` + params.length;
    }

    sql += ` ORDER BY c.name, e.name`;
    const result = await db.query(sql, params);

    return { success: true, equipment: result.rows };
  });

  // ============================================
  // 10. GET /stats/summary
  // ============================================
  fastify.get('/stats/summary', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'on_warehouse') as on_warehouse,
        COUNT(*) FILTER (WHERE status = 'issued') as issued,
        COUNT(*) FILTER (WHERE status = 'repair') as in_repair,
        COUNT(*) FILTER (WHERE status = 'broken') as broken,
        COUNT(*) FILTER (WHERE status = 'written_off') as written_off,
        COALESCE(SUM(purchase_price) FILTER (WHERE status != 'written_off'), 0) as total_value
      FROM equipment
    `);

    const s = stats.rows[0];
    return {
      success: true,
      total: parseInt(s.total),
      on_warehouse: parseInt(s.on_warehouse),
      issued: parseInt(s.issued),
      in_repair: parseInt(s.in_repair),
      broken: parseInt(s.broken),
      written_off: parseInt(s.written_off),
      total_value: parseFloat(s.total_value)
    };
  });

  // ============================================
  // 11. GET /analytics/by-pm
  // ============================================
  fastify.get('/analytics/by-pm', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    if (!hasFullAccess(user.role) && !isWarehouseAdmin(user.role)) {
      return { success: true, analytics: [] };
    }

    const result = await db.query(`
      SELECT 
        u.id as pm_id, u.name as pm_name,
        COUNT(DISTINCT e.id) as equipment_count,
        COALESCE(SUM(e.purchase_price), 0) as total_value,
        COUNT(DISTINCT m.id) FILTER (WHERE m.movement_type = 'issue' AND m.created_at >= NOW() - INTERVAL '30 days') as issues_30d,
        COUNT(DISTINCT m.id) FILTER (WHERE m.movement_type = 'return' AND m.created_at >= NOW() - INTERVAL '30 days') as returns_30d
      FROM users u
      LEFT JOIN equipment e ON e.current_holder_id = u.id AND e.status = 'issued'
      LEFT JOIN equipment_movements m ON m.to_holder_id = u.id OR m.from_holder_id = u.id
      WHERE u.role IN ('PM', 'HEAD_PM', 'MANAGER', 'DIRECTOR_DEV', 'DIRECTOR_GEN', 'CHIEF_ENGINEER', 'HR')
      GROUP BY u.id, u.name
      ORDER BY equipment_count DESC
    `);

    return { success: true, analytics: result.rows };
  });

  // ============================================
  // 12. GET / — Список оборудования с фильтрами + статистика
  // ============================================
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { status, category_id, warehouse_id, holder_id, search, page, limit, sort, order, offset: offsetParam } = request.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 50, 200);
    const offset = offsetParam != null ? parseInt(offsetParam) || 0 : (pageNum - 1) * pageSize;

    let sql = `
      SELECT e.*,
        c.name as category_name, c.icon as category_icon,
        w.name as warehouse_name,
        h.name as holder_name,
        o.name as object_name
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN warehouses w ON e.warehouse_id = w.id
      LEFT JOIN users h ON e.current_holder_id = h.id
      LEFT JOIN objects o ON e.current_object_id = o.id
      WHERE 1=1
    `;

    let countSql = `SELECT COUNT(*) FROM equipment e WHERE 1=1`;
    const params = [];
    const countParams = [];

    if (status) {
      params.push(status);
      countParams.push(status);
      sql += ` AND e.status = $${params.length}`;
      countSql += ` AND e.status = $${countParams.length}`;
    }
    if (category_id) {
      params.push(category_id);
      countParams.push(category_id);
      sql += ` AND e.category_id = $${params.length}`;
      countSql += ` AND e.category_id = $${countParams.length}`;
    }
    if (warehouse_id) {
      params.push(warehouse_id);
      countParams.push(warehouse_id);
      sql += ` AND e.warehouse_id = $${params.length}`;
      countSql += ` AND e.warehouse_id = $${countParams.length}`;
    }
    if (holder_id) {
      params.push(holder_id);
      countParams.push(holder_id);
      sql += ` AND e.current_holder_id = $${params.length}`;
      countSql += ` AND e.current_holder_id = $${countParams.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      countParams.push(`%${search}%`);
      sql += ` AND (e.name ILIKE $${params.length} OR e.inventory_number ILIKE $${params.length} OR e.serial_number ILIKE $${params.length})`;
      countSql += ` AND (e.name ILIKE $${countParams.length} OR e.inventory_number ILIKE $${countParams.length} OR e.serial_number ILIKE $${countParams.length})`;
    }

    // Sorting
    const allowedSorts = ['name', 'inventory_number', 'status', 'purchase_price', 'created_at', 'updated_at'];
    const sortField = allowedSorts.includes(sort) ? `e.${sort}` : 'e.id';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortField} ${sortOrder}`;

    params.push(pageSize, offset);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const [items, countResult] = await Promise.all([
      db.query(sql, params),
      db.query(countSql, countParams)
    ]);

    const total = parseInt(countResult.rows[0].count);

    // Stats
    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'on_warehouse') as on_warehouse,
        COUNT(*) FILTER (WHERE status = 'issued') as issued,
        COUNT(*) FILTER (WHERE status = 'repair') as in_repair,
        COUNT(*) FILTER (WHERE status = 'broken') as broken,
        COUNT(*) FILTER (WHERE status = 'written_off') as written_off
      FROM equipment
    `);

    return {
      success: true,
      equipment: items.rows,
      total,
      page: pageNum,
      limit: pageSize,
      pages: Math.ceil(total / pageSize),
      stats: statsResult.rows[0]
    };
  });

  // ============================================
  // 12a. POST /from-procurement — Создание из закупки
  // ============================================
  fastify.post('/from-procurement', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { procurement_item_id, warehouse_id } = req.body;
    if (!procurement_item_id) return reply.code(400).send({ success: false, error: 'procurement_item_id required' });

    // Найти позицию закупки
    const pic = await db.query(
      `SELECT pi.*, pi.equipment_id, pr.work_id, pr.pm_id, pr.id as proc_id
       FROM procurement_items pi
       JOIN procurement_requests pr ON pr.id = pi.procurement_id
       WHERE pi.id = $1`, [procurement_item_id]);
    if (!pic.rows.length) return reply.code(404).send({ success: false, error: 'Позиция не найдена' });
    const item = pic.rows[0];

    // Дубль — уже привязано оборудование
    if (item.equipment_id) return reply.code(409).send({ success: false, error: 'Оборудование уже создано', equipment_id: item.equipment_id });

    const whId = warehouse_id || (await db.query("SELECT id FROM warehouses WHERE is_main=true LIMIT 1")).rows[0]?.id || null;
    const qrUuid = randomUUID();
    const user = req.user;
    const client = await db.connect();

    try {
      await client.query('BEGIN');
      const eq = await client.query(
        `INSERT INTO equipment(name, quantity, unit, purchase_price, status, warehouse_id, qr_uuid, qr_code, condition, notes, created_by)
         VALUES($1,$2,$3,$4,'on_warehouse',$5,$6,$6,'new',$7,$8) RETURNING *`,
        [item.name, item.quantity || 1, item.unit || 'шт', item.unit_price, whId, qrUuid, 'Из закупки #' + item.proc_id, user.id]);
      const eqId = eq.rows[0].id;

      // Линк обратно в procurement_items
      await client.query('UPDATE procurement_items SET equipment_id=$1,updated_at=NOW() WHERE id=$2', [eqId, procurement_item_id]);

      // Movement
      await client.query(
        `INSERT INTO equipment_movements(equipment_id, movement_type, to_warehouse_id, notes, created_by)
         VALUES($1,'procurement_receipt',$2,$3,$4)`,
        [eqId, whId, 'Приёмка из закупки #' + item.proc_id, user.id]);

      // Авто-бронирование если есть work_id
      if (item.work_id) {
        await client.query(
          `INSERT INTO equipment_reservations(equipment_id,work_id,reserved_by,reserved_from,reserved_to,status,notes)
           VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+INTERVAL '30 days','active',$4)`,
          [eqId, item.work_id, item.pm_id || user.id, 'Автобронь из закупки #' + item.proc_id]);
      }

      await client.query('COMMIT');
      return { success: true, equipment: eq.rows[0] };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================
  // 12b. GET /available — Доступное оборудование
  // ============================================
  fastify.get('/available', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const r = await db.query(
      `SELECT e.* FROM equipment e WHERE e.status='on_warehouse'
       AND NOT EXISTS(SELECT 1 FROM equipment_reservations er WHERE er.equipment_id=e.id AND er.status='active')
       ORDER BY e.name`);
    reply.send({ ok: true, items: r.rows });
  });

  // ============================================
  // 12c. POST /reserve — Бронирование
  // ============================================
  fastify.post('/reserve', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { equipment_id, work_id, reserved_from, reserved_to } = req.body;
    if (!equipment_id || !work_id) return reply.code(400).send({ error: 'equipment_id, work_id required' });
    const r = await db.query(
      `INSERT INTO equipment_reservations(equipment_id,work_id,reserved_from,reserved_to,status,reserved_by)
       VALUES($1,$2,$3,$4,'active',$5) RETURNING *`,
      [equipment_id, work_id, reserved_from||null, reserved_to||null, req.user.id]);
    reply.send({ ok: true, reservation: r.rows[0] });
  });

  // ============================================
  // 13. GET /:id — Детальная информация
  // ============================================
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const result = await db.query(`
      SELECT e.*,
        c.name as category_name, c.icon as category_icon, c.is_consumable, c.requires_calibration,
        w.name as warehouse_name,
        h.name as holder_name,
        o.name as object_name,
        cb.name as created_by_name
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN warehouses w ON e.warehouse_id = w.id
      LEFT JOIN users h ON e.current_holder_id = h.id
      LEFT JOIN objects o ON e.current_object_id = o.id
      LEFT JOIN users cb ON e.created_by = cb.id
      WHERE e.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }

    // Movements
    const movements = await db.query(`
      SELECT m.*,
        fw.name as from_warehouse_name, tw.name as to_warehouse_name,
        fh.name as from_holder_name, th.name as to_holder_name,
        fo.name as from_object_name, tobj.name as to_object_name,
        u.name as created_by_name
      FROM equipment_movements m
      LEFT JOIN warehouses fw ON m.from_warehouse_id = fw.id
      LEFT JOIN warehouses tw ON m.to_warehouse_id = tw.id
      LEFT JOIN users fh ON m.from_holder_id = fh.id
      LEFT JOIN users th ON m.to_holder_id = th.id
      LEFT JOIN objects fo ON m.from_object_id = fo.id
      LEFT JOIN objects tobj ON m.to_object_id = tobj.id
      LEFT JOIN users u ON m.created_by = u.id
      WHERE m.equipment_id = $1
      ORDER BY m.created_at DESC
      LIMIT 50
    `, [id]);

    // Maintenance history
    const maintenance = await db.query(`
      SELECT mt.*,
        u.name as created_by_name,
        mt.performed_by as performed_by_name
      FROM equipment_maintenance mt
      LEFT JOIN users u ON mt.created_by = u.id
      WHERE mt.equipment_id = $1
      ORDER BY mt.created_at DESC
    `, [id]);

    // Active reservations
    const reservations = await db.query(`
      SELECT r.*,
        u.name as reserved_by_name
      FROM equipment_reservations r
      LEFT JOIN users u ON r.reserved_by = u.id
      WHERE r.equipment_id = $1 AND r.status = 'active' AND r.reserved_to >= CURRENT_DATE
      ORDER BY r.reserved_from
    `, [id]);

    return {
      success: true,
      equipment: result.rows[0],
      movements: movements.rows,
      maintenance: maintenance.rows,
      reservations: reservations.rows
    };
  });


  // GET /:id/maintenance — Standalone maintenance history
  fastify.get('/:id/maintenance', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      const result = await db.query(`
        SELECT mt.*,
          u.name as created_by_name,
          mt.performed_by as performed_by_name
        FROM equipment_maintenance mt
        LEFT JOIN users u ON mt.created_by = u.id
        WHERE mt.equipment_id = $1
        ORDER BY mt.created_at DESC
      `, [id]);
      return { success: true, maintenance: result.rows };
    } catch(err) {
      fastify.log.error('Equipment maintenance error:', err.message);
      return reply.code(500).send({ success: false, message: 'Ошибка загрузки истории обслуживания' });
    }
  });

  // ============================================
  // 14. POST / — Создание оборудования
  // ============================================
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!isWarehouseAdmin(user.role) && !hasFullAccess(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав на создание оборудования' });
    }

    const {
      name, category_id, category, inventory_number, serial_number, barcode,
      brand, model, purchase_price, initial_value, purchase_date, invoice_id,
      quantity, unit, warranty_end, maintenance_interval_days,
      useful_life_months, salvage_value, auto_write_off,
      specifications, notes, status, warehouse_id, condition,
      next_maintenance, next_calibration, min_stock_level, reorder_point,
      custom_icon
    } = request.body;

    if (!name) {
      return reply.code(400).send({ success: false, message: 'Укажите название оборудования' });
    }

    // Input validation
    if (typeof name !== 'string' || name.length < 1 || name.length > 200) {
      return reply.code(400).send({ success: false, message: 'Название должно быть от 1 до 200 символов' });
    }
    if (quantity !== undefined && (isNaN(Number(quantity)) || Number(quantity) < 0)) {
      return reply.code(400).send({ success: false, message: 'Количество должно быть неотрицательным числом' });
    }
    const VALID_STATUSES = ['on_warehouse','issued','in_transit','repair','broken','written_off'];
    const VALID_CONDITIONS = ['new','good','satisfactory','poor','broken'];
    if (status && !VALID_STATUSES.includes(status)) {
      return reply.code(400).send({ success: false, message: 'Недопустимый статус' });
    }
    if (condition && !VALID_CONDITIONS.includes(condition)) {
      return reply.code(400).send({ success: false, message: 'Недопустимое состояние' });
    }
    if (maintenance_interval_days !== undefined && maintenance_interval_days !== null && (isNaN(Number(maintenance_interval_days)) || Number(maintenance_interval_days) < 0)) {
      return reply.code(400).send({ success: false, message: 'Интервал обслуживания должен быть неотрицательным числом' });
    }

    // Resolve category
    let catId = category_id || null;
    if (!catId && category) {
      const catResult = await db.query(
        'SELECT id FROM equipment_categories WHERE name ILIKE $1 OR code ILIKE $1 LIMIT 1',
        [category]
      );
      if (catResult.rows.length > 0) {
        catId = catResult.rows[0].id;
      }
    }

    // Generate QR UUID
    const { v4: uuidv4 } = require('uuid');
    const qrUuid = uuidv4();

    // Default warehouse
    let whId = warehouse_id || null;
    if (!whId) {
      const wh = await db.query('SELECT id FROM warehouses WHERE is_main = true LIMIT 1');
      whId = wh.rows[0]?.id || null;
    }

    const pPrice = purchase_price || initial_value || null;
    const bookVal = pPrice;
    // Auto-generate inventory_number if not provided
    const invNumber = inventory_number || ('INV-' + Date.now().toString(36).toUpperCase());
    const eqStatus = status || 'on_warehouse';

    const result = await db.query(`
      INSERT INTO equipment (
        name, category_id, inventory_number, serial_number, barcode, qr_uuid, qr_code,
        brand, model, purchase_price, book_value, purchase_date, invoice_id,
        quantity, unit, warranty_end, maintenance_interval_days,
        useful_life_months, salvage_value, auto_write_off,
        specifications, notes, status, warehouse_id, condition,
        next_maintenance, next_calibration, min_stock_level, reorder_point,
        custom_icon, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20,
        $21, $22, $23, $24, $25,
        $26, $27, $28, $29,
        $30, $31
      ) RETURNING *
    `, [
      name, catId, invNumber, serial_number || null, barcode || null, qrUuid, qrUuid,
      brand || null, model || null, pPrice, bookVal, purchase_date || null, invoice_id || null,
      quantity || 1, unit || 'шт', warranty_end || null, maintenance_interval_days || null,
      useful_life_months || null, salvage_value || null, auto_write_off || false,
      specifications ? JSON.stringify(specifications) : null, notes || null, eqStatus, whId, condition || 'new',
      next_maintenance || null, next_calibration || null, min_stock_level || 0, reorder_point || 0,
      custom_icon || null, user.id
    ]);

    return { success: true, equipment: result.rows[0] };
  });

  // ============================================
  // 15. POST /bulk-create — Массовое создание
  // ============================================
  fastify.post('/bulk-create', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав на массовое создание' });
    }

    const { items } = request.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return reply.code(400).send({ success: false, message: 'Укажите массив items' });
    }

    const { v4: uuidv4 } = require('uuid');
    const warehouseResult = await db.query('SELECT id FROM warehouses WHERE is_main = true LIMIT 1');
    const defaultWarehouseId = warehouseResult.rows[0]?.id || null;

    const client = await db.pool.connect();
    const created = [];
    const errors = [];

    try {
      await client.query('BEGIN');

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          if (!item.name) {
            errors.push({ index: i, message: 'Не указано название' });
            continue;
          }

          // Resolve category
          let catId = item.category_id || null;
          if (!catId && item.category) {
            const catResult = await client.query(
              'SELECT id FROM equipment_categories WHERE name ILIKE $1 OR code ILIKE $1 LIMIT 1',
              [item.category]
            );
            if (catResult.rows.length > 0) catId = catResult.rows[0].id;
          }

          const qrUuid = uuidv4();
          const result = await client.query(`
            INSERT INTO equipment (
              name, category_id, inventory_number, serial_number, barcode, qr_uuid,
              brand, model, purchase_price, book_value, purchase_date,
              quantity, unit, notes, status, warehouse_id, condition,
              min_stock_level, reorder_point, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            RETURNING *
          `, [
            item.name, catId, item.inventory_number || ('INV-' + Date.now().toString(36).toUpperCase() + '-' + i), item.serial_number || null, item.barcode || null, qrUuid,
            item.brand || null, item.model || null, item.purchase_price || null, item.purchase_price || null, item.purchase_date || null,
            item.quantity || 1, item.unit || 'шт', item.notes || null, 'on_warehouse', item.warehouse_id || defaultWarehouseId, item.condition || 'new',
            item.min_stock_level || 0, item.reorder_point || 0, user.id
          ]);

          created.push(result.rows[0]);
        } catch (e) {
          errors.push({ index: i, message: e.message });
        }
      }

      await client.query('COMMIT');
      return { success: true, created: created.length, errors, items: created };
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error('Bulk create error:', e.message);
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });

  // ============================================
  // 16. PUT /:id — Обновление оборудования
  // ============================================
  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const { id } = request.params;
    const {
      name, category_id, inventory_number, serial_number, barcode,
      brand, model, purchase_price, purchase_date, invoice_id,
      quantity, unit, warranty_end, maintenance_interval_days,
      useful_life_months, salvage_value, auto_write_off,
      specifications, notes, status, warehouse_id, condition,
      next_maintenance, next_calibration, min_stock_level, reorder_point,
      custom_icon
    } = request.body;

    // Input validation
    if (name !== undefined && name !== null) {
      if (typeof name !== 'string' || name.length < 1 || name.length > 200) {
        return reply.code(400).send({ success: false, message: 'Название должно быть от 1 до 200 символов' });
      }
    }
    if (quantity !== undefined && quantity !== null && (isNaN(Number(quantity)) || Number(quantity) < 0)) {
      return reply.code(400).send({ success: false, message: 'Количество должно быть неотрицательным числом' });
    }
    const VALID_STATUSES_UPD = ['on_warehouse','issued','in_transit','repair','broken','written_off'];
    const VALID_CONDITIONS_UPD = ['new','good','satisfactory','poor','broken'];
    if (status && !VALID_STATUSES_UPD.includes(status)) {
      return reply.code(400).send({ success: false, message: 'Недопустимый статус' });
    }
    if (condition && !VALID_CONDITIONS_UPD.includes(condition)) {
      return reply.code(400).send({ success: false, message: 'Недопустимое состояние' });
    }
    if (maintenance_interval_days !== undefined && maintenance_interval_days !== null && (isNaN(Number(maintenance_interval_days)) || Number(maintenance_interval_days) < 0)) {
      return reply.code(400).send({ success: false, message: 'Интервал обслуживания должен быть неотрицательным числом' });
    }
    const result = await db.query(`
      UPDATE equipment SET
        name = COALESCE($1, name),
        category_id = COALESCE($2, category_id),
        inventory_number = COALESCE($3, inventory_number),
        serial_number = COALESCE($4, serial_number),
        barcode = COALESCE($5, barcode),
        brand = COALESCE($6, brand),
        model = COALESCE($7, model),
        purchase_price = COALESCE($8, purchase_price),
        purchase_date = COALESCE($9, purchase_date),
        invoice_id = COALESCE($10, invoice_id),
        quantity = COALESCE($11, quantity),
        unit = COALESCE($12, unit),
        warranty_end = COALESCE($13, warranty_end),
        maintenance_interval_days = COALESCE($14, maintenance_interval_days),
        useful_life_months = COALESCE($15, useful_life_months),
        salvage_value = COALESCE($16, salvage_value),
        auto_write_off = COALESCE($17, auto_write_off),
        specifications = COALESCE($18, specifications),
        notes = COALESCE($19, notes),
        status = COALESCE($20, status),
        warehouse_id = COALESCE($21, warehouse_id),
        condition = COALESCE($22, condition),
        next_maintenance = COALESCE($23, next_maintenance),
        next_calibration = COALESCE($24, next_calibration),
        min_stock_level = COALESCE($25, min_stock_level),
        reorder_point = COALESCE($26, reorder_point),
        custom_icon = COALESCE($27, custom_icon),
        updated_at = NOW()
      WHERE id = $28
      RETURNING *
    `, [
      name, category_id, inventory_number, serial_number, barcode,
      brand, model, purchase_price, purchase_date, invoice_id,
      quantity, unit, warranty_end, maintenance_interval_days,
      useful_life_months, salvage_value, auto_write_off,
      specifications ? JSON.stringify(specifications) : null, notes, status, warehouse_id, condition,
      next_maintenance, next_calibration, min_stock_level, reorder_point,
      custom_icon || null, id
    ]);

    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }

    return { success: true, equipment: result.rows[0] };
  });

  // ============================================
  // 17. POST /issue — Выдача оборудования
  // ============================================
  fastify.post('/issue', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав на выдачу' });
    }

    const { equipment_id, holder_id, object_id, work_id, issue_reason, issue_date, condition, notes } = request.body;

    if (!equipment_id || !holder_id) {
      return reply.code(400).send({ success: false, message: 'Укажите equipment_id и holder_id' });
    }

    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [equipment_id]);
    if (equip.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }

    const eq = equip.rows[0];
    if (eq.status !== 'on_warehouse') {
      return reply.code(400).send({ success: false, message: `Оборудование не на складе (статус: ${eq.status})` });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Create movement
      await client.query(`
        INSERT INTO equipment_movements (
          equipment_id, movement_type, from_warehouse_id, to_holder_id, to_object_id,
          work_id, condition_before, condition_after, notes, confirmed, confirmed_at, created_by
        ) VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7, $8, true, NOW(), $9)
      `, [equipment_id, eq.warehouse_id, holder_id, object_id || null, work_id || null,
          eq.condition, condition || eq.condition, notes || issue_reason || 'Выдача', user.id]);

      // Update equipment
      await client.query(`
        UPDATE equipment SET
          status = 'issued', current_holder_id = $1, current_object_id = $2,
          warehouse_id = NULL, work_id = $3, condition = COALESCE($4, condition), updated_at = NOW()
        WHERE id = $5
      `, [holder_id, object_id || null, work_id || null, condition, equipment_id]);

      await client.query('COMMIT');
      return { success: true, message: 'Оборудование выдано' };
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error('Issue error:', e.message);
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });

  // ============================================
  // 18. POST /return — Возврат оборудования
  // ============================================
  fastify.post('/return', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав на возврат' });
    }

    const { equipment_id, warehouse_id, return_reason, return_date, condition, notes } = request.body;

    if (!equipment_id) {
      return reply.code(400).send({ success: false, message: 'Укажите equipment_id' });
    }

    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [equipment_id]);
    if (equip.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }

    const eq = equip.rows[0];
    if (eq.status !== 'issued') {
      return reply.code(400).send({ success: false, message: `Оборудование не в выдаче (статус: ${eq.status})` });
    }

    // Default warehouse
    let whId = warehouse_id || null;
    if (!whId) {
      const wh = await db.query('SELECT id FROM warehouses WHERE is_main = true LIMIT 1');
      whId = wh.rows[0]?.id || 1;
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Create movement
      await client.query(`
        INSERT INTO equipment_movements (
          equipment_id, movement_type, from_holder_id, from_object_id, to_warehouse_id,
          work_id, condition_before, condition_after, notes, confirmed, confirmed_at, created_by
        ) VALUES ($1, 'return', $2, $3, $4, $5, $6, $7, $8, true, NOW(), $9)
      `, [equipment_id, eq.current_holder_id, eq.current_object_id, whId,
          eq.work_id, eq.condition, condition || eq.condition, notes || return_reason || 'Возврат', user.id]);

      // Update equipment
      const newStatus = (condition === 'broken') ? 'broken' : 'on_warehouse';
      await client.query(`
        UPDATE equipment SET
          status = $1, current_holder_id = NULL, current_object_id = NULL,
          warehouse_id = $2, work_id = NULL, condition = COALESCE($3, condition), updated_at = NOW()
        WHERE id = $4
      `, [newStatus, whId, condition, equipment_id]);

      await client.query('COMMIT');
      return { success: true, message: 'Оборудование возвращено' };
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error('Return error:', e.message);
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });

  // ============================================
  // 19. POST /transfer-request — Заявка на перемещение
  // ============================================
  fastify.post('/transfer-request', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;

    const { equipment_id, to_user_id, to_warehouse_id, object_id, work_id, reason, notes } = request.body;

    if (!equipment_id) {
      return reply.code(400).send({ success: false, message: 'Укажите equipment_id' });
    }

    const result = await db.query(`
      INSERT INTO equipment_requests (
        request_type, requester_id, equipment_id, work_id, object_id, target_holder_id, notes, status
      ) VALUES ('transfer', $1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
    `, [user.id, equipment_id, work_id || null, object_id || null, to_user_id || null, notes || reason || null]);

    return { success: true, request: result.rows[0] };
  });

  // ============================================
  // 20. POST /transfer-execute — Выполнение перемещения
  // ============================================
  fastify.post('/transfer-execute', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Только кладовщик может выполнить перемещение' });
    }

    const { request_id, equipment_id, to_holder_id, to_warehouse_id, to_object_id, condition, notes } = request.body;

    if (!equipment_id) {
      return reply.code(400).send({ success: false, message: 'Укажите equipment_id' });
    }

    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [equipment_id]);
    if (equip.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }

    const eq = equip.rows[0];

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Create movement record
      await client.query(`
        INSERT INTO equipment_movements (
          equipment_id, movement_type, 
          from_warehouse_id, from_holder_id, from_object_id,
          to_warehouse_id, to_holder_id, to_object_id,
          condition_before, condition_after, notes, confirmed, confirmed_at, created_by
        ) VALUES ($1, 'transfer', $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW(), $11)
      `, [equipment_id, eq.warehouse_id, eq.current_holder_id, eq.current_object_id,
          to_warehouse_id || null, to_holder_id || null, to_object_id || null,
          eq.condition, condition || eq.condition, notes || 'Перемещение', user.id]);

      // Update equipment
      let newStatus = eq.status;
      if (to_holder_id) newStatus = 'issued';
      else if (to_warehouse_id) newStatus = 'on_warehouse';

      await client.query(`
        UPDATE equipment SET
          status = $1,
          current_holder_id = $2, current_object_id = $3, warehouse_id = $4,
          condition = COALESCE($5, condition), updated_at = NOW()
        WHERE id = $6
      `, [newStatus, to_holder_id || null, to_object_id || null, to_warehouse_id || eq.warehouse_id, condition, equipment_id]);

      // Update request if provided
      if (request_id) {
        await client.query(`
          UPDATE equipment_requests SET status = 'approved', processed_by = $1, processed_at = NOW() WHERE id = $2
        `, [user.id, request_id]);
      }

      await client.query('COMMIT');
      return { success: true, message: 'Перемещение выполнено' };
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });

  // ============================================
  // 21. POST /write-off — Списание оборудования
  // ============================================
  fastify.post('/write-off', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!isWarehouseAdmin(user.role) && !hasFullAccess(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав на списание' });
    }

    const { equipment_id, reason, notes } = request.body;

    if (!equipment_id) {
      return reply.code(400).send({ success: false, message: 'Укажите equipment_id' });
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return reply.code(400).send({ success: false, message: 'Укажите причину списания (минимум 5 символов)' });
    }

    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [equipment_id]);
    if (equip.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }

    const eq = equip.rows[0];
    if (eq.status === 'written_off') {
      return reply.code(400).send({ success: false, message: 'Оборудование уже списано' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Create movement
      await client.query(`
        INSERT INTO equipment_movements (
          equipment_id, movement_type, from_warehouse_id, from_holder_id,
          condition_before, notes, confirmed, confirmed_at, created_by
        ) VALUES ($1, 'write_off', $2, $3, $4, $5, true, NOW(), $6)
      `, [equipment_id, eq.warehouse_id, eq.current_holder_id, eq.condition, notes || reason || 'Списание', user.id]);

      // Update equipment
      await client.query(`
        UPDATE equipment SET
          status = 'written_off', written_off_date = CURRENT_DATE,
          written_off_reason = $1, written_off_by = $2,
          current_holder_id = NULL, current_object_id = NULL, warehouse_id = NULL, work_id = NULL,
          updated_at = NOW()
        WHERE id = $3
      `, [reason || notes || 'Списание', user.id, equipment_id]);

      await client.query('COMMIT');
      return { success: true, message: 'Оборудование списано' };
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });

  // ============================================
  // 22. POST /recalculate-depreciation — Пересчёт амортизации
  // ============================================
  fastify.post('/recalculate-depreciation', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!hasFullAccess(user.role) && user.role !== 'WAREHOUSE') {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(`
        SELECT id, purchase_price, salvage_value, useful_life_months, purchase_date, book_value
        FROM equipment
        WHERE status != 'written_off' AND useful_life_months IS NOT NULL AND useful_life_months > 0
          AND purchase_price IS NOT NULL AND purchase_date IS NOT NULL
      `);

      let updated = 0;
      for (const eq of result.rows) {
        const monthsElapsed = Math.floor(
          (new Date() - new Date(eq.purchase_date)) / (1000 * 60 * 60 * 24 * 30.44)
        );
        const salvage = parseFloat(eq.salvage_value) || 0;
        const purchasePrice = parseFloat(eq.purchase_price);
        const depreciable = purchasePrice - salvage;
        const monthlyDep = depreciable / eq.useful_life_months;
        const accumulated = Math.min(monthlyDep * monthsElapsed, depreciable);
        const bookValue = Math.max(purchasePrice - accumulated, salvage);

        await client.query(`
          UPDATE equipment SET book_value = $1, accumulated_depreciation = $2, updated_at = NOW() WHERE id = $3
        `, [bookValue, accumulated, eq.id]);
        updated++;
      }

      await client.query('COMMIT');
      return { success: true, updated, message: `Пересчитано: ${updated} единиц` };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================
  // 23. POST /qr-print-data — Данные для печати QR
  // ============================================
  fastify.post('/qr-print-data', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { ids } = request.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return { success: true, items: [] };
    }

    const result = await db.query(`
      SELECT e.id, e.name, e.inventory_number, e.serial_number, e.qr_uuid, e.qr_code,
        c.name as category_name, c.icon as category_icon
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      WHERE e.id = ANY($1)
    `, [ids]);

    return { success: true, items: result.rows };
  });

  // ============================================
  // 24. POST /reserve — Бронирование оборудования
  // ============================================
  fastify.post('/reserve', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const { equipment_id, work_id, reserved_from, reserved_to, notes } = request.body;

    if (!equipment_id || !reserved_from || !reserved_to) {
      return reply.code(400).send({ success: false, message: 'Укажите equipment_id, reserved_from, reserved_to' });
    }

    // Check for conflicts + INSERT in transaction
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const conflicts = await client.query(`
        SELECT id FROM equipment_reservations
        WHERE equipment_id = $1 AND status = 'active'
          AND reserved_from <= $3 AND reserved_to >= $2
        FOR UPDATE
      `, [equipment_id, reserved_from, reserved_to]);

      if (conflicts.rows.length > 0) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ success: false, message: 'Конфликт бронирования на эти даты' });
      }

      const result = await client.query(`
        INSERT INTO equipment_reservations (equipment_id, work_id, reserved_by, reserved_from, reserved_to, notes)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
      `, [equipment_id, work_id || null, user.id, reserved_from, reserved_to, notes || null]);

      await client.query('COMMIT');
      return { success: true, reservation: result.rows[0] };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================
  // 25. POST /:id/maintenance — Создание записи ТО
  // ============================================
  fastify.post('/:id/maintenance', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const { id } = request.params;
    const {
      maintenance_type, description, cost, spare_parts,
      performed_by, contractor, started_at, completed_at, next_date, invoice_id, notes
    } = request.body;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(`
        INSERT INTO equipment_maintenance (
          equipment_id, maintenance_type, description, cost, spare_parts,
          performed_by, contractor, started_at, completed_at, next_date, invoice_id, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `, [id, maintenance_type || 'scheduled', description || null, cost || null, spare_parts || null,
          performed_by || null, contractor || null, started_at || null, completed_at || null, next_date || null,
          invoice_id || null, notes || null, user.id]);

      // Update next_maintenance on equipment if next_date provided
      if (next_date) {
        await client.query('UPDATE equipment SET next_maintenance = $1, updated_at = NOW() WHERE id = $2', [next_date, id]);
      }

      await client.query('COMMIT');
      return { success: true, maintenance: result.rows[0] };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================
  // 26. POST /requests/:id/reject — Отклонение заявки
  // ============================================
  fastify.post('/requests/:id/reject', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!isWarehouseAdmin(user.role) && !hasFullAccess(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const { id } = request.params;
    const { reason } = request.body;

    const result = await db.query(`
      UPDATE equipment_requests SET
        status = 'rejected', reject_reason = $1, processed_by = $2, processed_at = NOW()
      WHERE id = $3 AND status = 'pending'
      RETURNING *
    `, [reason || 'Отклонено', user.id, id]);

    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Заявка не найдена или уже обработана' });
    }

    return { success: true, request: result.rows[0] };
  });

  // ============================================
  // 27. POST /request-issue — Заявка на выдачу от РП
  // ============================================
  fastify.post('/request-issue', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;

    const { equipment_id, work_id, object_id, notes } = request.body;

    if (!equipment_id) {
      return reply.code(400).send({ success: false, message: 'Укажите equipment_id' });
    }

    const result = await db.query(`
      INSERT INTO equipment_requests (
        request_type, requester_id, equipment_id, work_id, object_id, target_holder_id, notes, status
      ) VALUES ('issue', $1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
    `, [user.id, equipment_id, work_id || null, object_id || null, user.id, notes || null]);

    return { success: true, request: result.rows[0] };
  });

  // ============================================
  // 28. POST /repair — Отправка в ремонт
  // ============================================
  fastify.post('/repair', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const { equipment_id, description, contractor, notes } = request.body;

    if (!equipment_id) {
      return reply.code(400).send({ success: false, message: 'Укажите equipment_id' });
    }

    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [equipment_id]);
    if (equip.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }

    const eq = equip.rows[0];

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Create maintenance record
      await client.query(`
        INSERT INTO equipment_maintenance (
          equipment_id, maintenance_type, description, contractor, started_at, notes, created_by
        ) VALUES ($1, 'repair', $2, $3, NOW(), $4, $5)
      `, [equipment_id, description || 'Ремонт', contractor || null, notes || null, user.id]);

      // Create movement
      await client.query(`
        INSERT INTO equipment_movements (
          equipment_id, movement_type, from_warehouse_id, from_holder_id,
          condition_before, notes, confirmed, confirmed_at, created_by
        ) VALUES ($1, 'repair', $2, $3, $4, $5, true, NOW(), $6)
      `, [equipment_id, eq.warehouse_id, eq.current_holder_id, eq.condition, notes || 'Отправлено в ремонт', user.id]);

      // Update status
      await client.query(`
        UPDATE equipment SET status = 'repair', condition = 'broken', updated_at = NOW() WHERE id = $1
      `, [equipment_id]);

      await client.query('COMMIT');
      return { success: true, message: 'Оборудование отправлено в ремонт' };
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });

  // ============================================
  // 29. POST /repair-complete — Завершение ремонта
  // ============================================
  fastify.post('/repair-complete', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const { equipment_id, cost, condition, next_maintenance, notes } = request.body;

    if (!equipment_id) {
      return reply.code(400).send({ success: false, message: 'Укажите equipment_id' });
    }

    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [equipment_id]);
    if (equip.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }

    const eq = equip.rows[0];
    if (eq.status !== 'repair') {
      return reply.code(400).send({ success: false, message: 'Оборудование не в ремонте' });
    }

    const warehouseResult = await db.query('SELECT id FROM warehouses WHERE is_main = true LIMIT 1');
    const warehouseId = warehouseResult.rows[0]?.id || 1;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Complete maintenance record
      await client.query(`
        UPDATE equipment_maintenance SET
          completed_at = NOW(), cost = COALESCE($1, cost), next_date = $2,
          notes = COALESCE($3, notes)
        WHERE equipment_id = $4 AND maintenance_type = 'repair' AND completed_at IS NULL
      `, [cost, next_maintenance || null, notes, equipment_id]);

      // Create return movement
      await client.query(`
        INSERT INTO equipment_movements (
          equipment_id, movement_type, to_warehouse_id,
          condition_before, condition_after, notes, confirmed, confirmed_at, created_by
        ) VALUES ($1, 'return', $2, $3, $4, $5, true, NOW(), $6)
      `, [equipment_id, warehouseId, eq.condition, condition || 'good', notes || 'Возврат из ремонта', user.id]);

      // Update equipment
      await client.query(`
        UPDATE equipment SET
          status = 'on_warehouse', warehouse_id = $1,
          condition = $2, next_maintenance = COALESCE($3, next_maintenance),
          updated_at = NOW()
        WHERE id = $4
      `, [warehouseId, condition || 'good', next_maintenance, equipment_id]);

      await client.query('COMMIT');
      return { success: true, message: 'Ремонт завершён, оборудование на складе' };
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });


  // ============================================
  // FACEKIT PREMIUM: КОМПЛЕКТЫ ОБОРУДОВАНИЯ
  // ============================================

  fastify.get('/kits', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { work_type, is_template } = request.query;

    let sql = `
      SELECT k.*,
        (SELECT COUNT(*) FROM equipment_kit_items WHERE kit_id = k.id) as items_count,
        (SELECT COUNT(*) FROM equipment_kit_items WHERE kit_id = k.id AND is_required = true) as required_count,
        (SELECT COUNT(*) FROM equipment_kit_items WHERE kit_id = k.id AND equipment_id IS NOT NULL) as assigned_count
      FROM equipment_kits k
      WHERE k.is_active = true
    `;
    const params = [];

    if (work_type) {
      params.push(work_type);
      sql += ` AND k.work_type = $` + params.length;
    }
    if (is_template !== undefined) {
      params.push(is_template === 'true');
      sql += ` AND k.is_template = $` + params.length;
    }

    sql += ` ORDER BY k.name`;
    const result = await db.query(sql, params);

    // Calculate completeness
    const kits = result.rows.map(k => ({
      ...k,
      completeness_pct: k.items_count > 0 ? Math.round((k.assigned_count / k.items_count) * 100) : 0
    }));

    return { success: true, kits };
  });

  fastify.get('/kits/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const kitResult = await db.query(`
      SELECT k.* FROM equipment_kits k WHERE k.id = $1 AND k.is_active = true
    `, [id]);

    if (kitResult.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Комплект не найден' });
    }

    const kitItems = await db.query(`
      SELECT ki.*,
        e.name as equipment_name, e.inventory_number, e.status as equipment_status,
        e.condition as equipment_condition, e.photo_url as equipment_photo,
        c.name as category_name, c.icon as category_icon
      FROM equipment_kit_items ki
      LEFT JOIN equipment e ON ki.equipment_id = e.id
      LEFT JOIN equipment_categories c ON ki.category_id = c.id
      WHERE ki.kit_id = $1
      ORDER BY ki.sort_order, ki.id
    `, [id]);

    return { 
      success: true, 
      kit: kitResult.rows[0],
      items: kitItems.rows
    };
  });

  fastify.post('/kits', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!isWarehouseAdmin(user.role) && !hasFullAccess(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const { name, code, work_type, icon, description, is_template, items } = request.body;
    if (!name) {
      return reply.code(400).send({ success: false, message: 'Укажите название комплекта' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const kitResult = await client.query(`
        INSERT INTO equipment_kits (name, code, work_type, icon, description, is_template, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
      `, [name, code || null, work_type || null, icon || '\ud83e\uddf0', description || null, is_template !== false, user.id]);

      const kit = kitResult.rows[0];

      if (items && Array.isArray(items)) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          await client.query(`
            INSERT INTO equipment_kit_items (kit_id, equipment_id, category_id, item_name, quantity, is_required, sort_order, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [kit.id, item.equipment_id || null, item.category_id || null, item.item_name || null, item.quantity || 1, item.is_required !== false, i + 1, item.notes || null]);
        }
      }

      await client.query('COMMIT');
      return { success: true, kit };
    } catch(e) {
      await client.query('ROLLBACK');
      fastify.log.error('Kit create error:', e.message);
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });

  fastify.put('/kits/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!isWarehouseAdmin(user.role) && !hasFullAccess(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const { id } = request.params;
    const { name, code, work_type, icon, description, items } = request.body;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        UPDATE equipment_kits SET
          name = COALESCE($1, name),
          code = COALESCE($2, code),
          work_type = COALESCE($3, work_type),
          icon = COALESCE($4, icon),
          description = COALESCE($5, description),
          updated_at = NOW()
        WHERE id = $6
      `, [name, code, work_type, icon, description, id]);

      if (items && Array.isArray(items)) {
        // Clear old equipment references
        await client.query(`
          UPDATE equipment SET kit_id = NULL WHERE kit_id = (SELECT id FROM equipment_kits WHERE id = $1)
        `, [id]);
        await client.query('DELETE FROM equipment_kit_items WHERE kit_id = $1', [id]);

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          await client.query(`
            INSERT INTO equipment_kit_items (kit_id, equipment_id, category_id, item_name, quantity, is_required, sort_order, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [id, item.equipment_id || null, item.category_id || null, item.item_name || null, item.quantity || 1, item.is_required !== false, i + 1, item.notes || null]);
        }
      }

      await client.query('COMMIT');

      const kit = await db.query('SELECT * FROM equipment_kits WHERE id = $1', [id]);
      return { success: true, kit: kit.rows[0] };
    } catch(e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });

  fastify.delete('/kits/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!isWarehouseAdmin(user.role) && !hasFullAccess(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const { id } = request.params;
    await db.query('UPDATE equipment_kits SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);
    return { success: true, message: 'Комплект деактивирован' };
  });

  fastify.post('/kits/:id/assemble', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Только кладовщик может собрать комплект' });
    }

    const { id } = request.params;
    const { assignments } = request.body; // [{kit_item_id, equipment_id}]

    if (!assignments || !Array.isArray(assignments)) {
      return reply.code(400).send({ success: false, message: 'Укажите массив assignments' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      for (const a of assignments) {
        if (!a.kit_item_id || !a.equipment_id) continue;

        // Verify equipment exists and is available
        const eq = await client.query('SELECT id, status FROM equipment WHERE id = $1', [a.equipment_id]);
        if (eq.rows.length === 0) continue;

        await client.query(
          'UPDATE equipment_kit_items SET equipment_id = $1 WHERE id = $2 AND kit_id = $3',
          [a.equipment_id, a.kit_item_id, id]
        );

        await client.query(
          'UPDATE equipment SET kit_id = $1 WHERE id = $2',
          [id, a.equipment_id]
        );
      }

      await client.query('COMMIT');
      return { success: true, message: 'Комплект собран' };
    } catch(e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });

  // ============================================
  // FACEKIT PREMIUM: ОБОРУДОВАНИЕ НА РАБОТАХ
  // ============================================

  fastify.get('/work/:workId/equipment', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { workId } = request.params;

    const result = await db.query(`
      SELECT ewa.*, 
        e.name, e.inventory_number, e.serial_number, e.photo_url, e.custom_icon,
        e.status as equipment_status, e.condition as equipment_condition,
        c.name as category_name, c.icon as category_icon,
        u.name as assigned_by_name
      FROM equipment_work_assignments ewa
      JOIN equipment e ON ewa.equipment_id = e.id
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN users u ON ewa.assigned_by = u.id
      WHERE ewa.work_id = $1
      ORDER BY ewa.status = 'active' DESC, ewa.assigned_at DESC
    `, [workId]);

    return { success: true, assignments: result.rows };
  });

  fastify.post('/work/:workId/assign', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const { workId } = request.params;
    const { equipment_ids, holder_id, object_id, condition, notes } = request.body;

    if (!equipment_ids || !Array.isArray(equipment_ids) || equipment_ids.length === 0) {
      return reply.code(400).send({ success: false, message: 'Укажите equipment_ids' });
    }

    const targetHolder = holder_id || user.id;
    const warehouseResult = await db.query('SELECT id FROM warehouses WHERE is_main = true LIMIT 1');
    const warehouseId = warehouseResult.rows[0]?.id || 1;

    const client = await db.pool.connect();
    const assigned = [];
    const errors = [];

    try {
      await client.query('BEGIN');

      for (const eqId of equipment_ids) {
        const equip = await client.query('SELECT * FROM equipment WHERE id = $1', [eqId]);
        if (equip.rows.length === 0) { errors.push(`ID ${eqId}: не найдено`); continue; }

        const eq = equip.rows[0];
        if (eq.status !== 'on_warehouse') { errors.push(`${eq.name}: не на складе (${eq.status})`); continue; }

        // Create work assignment
        await client.query(`
          INSERT INTO equipment_work_assignments (equipment_id, work_id, assigned_by, condition_on_assign, notes)
          VALUES ($1, $2, $3, $4, $5)
        `, [eqId, workId, user.id, condition || eq.condition, notes || null]);

        // Create movement record
        await client.query(`
          INSERT INTO equipment_movements (
            equipment_id, movement_type, from_warehouse_id, to_holder_id, to_object_id,
            work_id, condition_before, condition_after, notes, confirmed, confirmed_at, created_by
          ) VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7, $8, true, NOW(), $9)
        `, [eqId, eq.warehouse_id || warehouseId, targetHolder, object_id || null, workId, eq.condition, condition || eq.condition, notes || 'Назначено на работу', user.id]);

        // Update equipment status
        await client.query(`
          UPDATE equipment SET
            status = 'issued', current_holder_id = $1, current_object_id = $2,
            warehouse_id = NULL, work_id = $3, updated_at = NOW()
          WHERE id = $4
        `, [targetHolder, object_id || null, workId, eqId]);

        assigned.push(eqId);
      }

      await client.query('COMMIT');
      return { success: true, assigned, errors, message: `Назначено: ${assigned.length}` };
    } catch(e) {
      await client.query('ROLLBACK');
      fastify.log.error('Work assign error:', e.message);
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });

  fastify.post('/work/:workId/unassign', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }

    const { workId } = request.params;
    const { equipment_ids, condition_on_return, notes } = request.body;

    if (!equipment_ids || !Array.isArray(equipment_ids) || equipment_ids.length === 0) {
      return reply.code(400).send({ success: false, message: 'Укажите equipment_ids' });
    }

    const warehouseResult = await db.query('SELECT id FROM warehouses WHERE is_main = true LIMIT 1');
    const warehouseId = warehouseResult.rows[0]?.id || 1;

    const client = await db.pool.connect();
    const returned = [];

    try {
      await client.query('BEGIN');

      for (const eqId of equipment_ids) {
        const equip = await client.query('SELECT * FROM equipment WHERE id = $1', [eqId]);
        if (equip.rows.length === 0) continue;
        const eq = equip.rows[0];

        // Close the assignment
        await client.query(`
          UPDATE equipment_work_assignments SET
            returned_at = NOW(), condition_on_return = $1, status = 'returned', notes = COALESCE($2, notes)
          WHERE equipment_id = $3 AND work_id = $4 AND status = 'active'
        `, [condition_on_return || eq.condition, notes, eqId, workId]);

        // Create return movement
        await client.query(`
          INSERT INTO equipment_movements (
            equipment_id, movement_type, from_holder_id, from_object_id, to_warehouse_id,
            work_id, condition_before, condition_after, notes, confirmed, confirmed_at, created_by
          ) VALUES ($1, 'return', $2, $3, $4, $5, $6, $7, $8, true, NOW(), $9)
        `, [eqId, eq.current_holder_id, eq.current_object_id, warehouseId, workId, eq.condition, condition_on_return || eq.condition, notes || 'Возврат с работы', user.id]);

        // Update equipment
        const newStatus = (condition_on_return === 'broken') ? 'broken' : 'on_warehouse';
        await client.query(`
          UPDATE equipment SET
            status = $1, current_holder_id = NULL, current_object_id = NULL,
            warehouse_id = $2, work_id = NULL, condition = COALESCE($3, condition), updated_at = NOW()
          WHERE id = $4
        `, [newStatus, warehouseId, condition_on_return, eqId]);

        returned.push(eqId);
      }

      await client.query('COMMIT');
      return { success: true, returned, message: `Возвращено: ${returned.length}` };
    } catch(e) {
      await client.query('ROLLBACK');
      fastify.log.error(e);
      return reply.code(500).send({ success: false, message: 'Внутренняя ошибка сервера' });
    } finally {
      client.release();
    }
  });

  fastify.get('/recommend', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { work_type } = request.query;

    if (!work_type) {
      return { success: true, kits: [], equipment: [] };
    }

    // Find matching kits
    const kits = await db.query(`
      SELECT k.*,
        (SELECT COUNT(*) FROM equipment_kit_items WHERE kit_id = k.id) as items_count
      FROM equipment_kits k
      WHERE k.is_active = true AND k.work_type = $1
      ORDER BY k.name
    `, [work_type]);

    // Get kit items with available equipment
    const kitItems = [];
    for (const kit of kits.rows) {
      const items = await db.query(`
        SELECT ki.*, c.name as category_name, c.icon as category_icon,
          (SELECT json_agg(json_build_object('id', e2.id, 'name', e2.name, 'inventory_number', e2.inventory_number, 'status', e2.status, 'condition', e2.condition))
           FROM equipment e2 
           WHERE e2.category_id = ki.category_id AND e2.status = 'on_warehouse'
          ) as available_equipment
        FROM equipment_kit_items ki
        LEFT JOIN equipment_categories c ON ki.category_id = c.id
        WHERE ki.kit_id = $1
        ORDER BY ki.sort_order
      `, [kit.id]);

      kitItems.push({ kit, items: items.rows });
    }

    return { success: true, recommendations: kitItems };
  });



  // ============================================
  // EXPORT EXCEL
  // ============================================
  fastify.get("/export/excel", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const ExcelJS = require("exceljs");
    const { category_id, status, warehouse_id, search } = request.query;
    let where = "WHERE 1=1"; const params = []; let idx = 1;
    if (category_id) { where += ` AND e.category_id = ${idx++}`; params.push(category_id); }
    if (status) { where += ` AND e.status = ${idx++}`; params.push(status); }
    if (warehouse_id) { where += ` AND e.warehouse_id = ${idx++}`; params.push(warehouse_id); }
    if (search) { where += ` AND (e.name ILIKE ${idx} OR e.inventory_number ILIKE ${idx})`; params.push("%" + search + "%"); idx++; }

    const result = await db.query(`
      SELECT e.*, c.name as category_name, w.name as warehouse_name,
        h.name as holder_name, o.name as object_name
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN warehouses w ON e.warehouse_id = w.id
      LEFT JOIN users h ON e.current_holder_id = h.id
      LEFT JOIN objects o ON e.current_object_id = o.id
      ${where} ORDER BY e.name
    `, params);

    const wb = new ExcelJS.Workbook();
    wb.creator = "ASGARD CRM";
    const ws = wb.addWorksheet("Оборудование");
    ws.columns = [
      { header: "Инв.№", key: "inv", width: 18 },
      { header: "Наименование", key: "name", width: 35 },
      { header: "Категория", key: "cat", width: 20 },
      { header: "Статус", key: "status", width: 14 },
      { header: "Состояние", key: "condition", width: 14 },
      { header: "Склад", key: "warehouse", width: 22 },
      { header: "Ответственный", key: "holder", width: 22 },
      { header: "Объект", key: "object", width: 22 },
      { header: "Бренд", key: "brand", width: 16 },
      { header: "Модель", key: "model", width: 16 },
      { header: "Стоимость", key: "price", width: 14 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    headerRow.alignment = { horizontal: "center" };

    const statusMap = { on_warehouse: "На складе", issued: "Выдано", in_transit: "В пути", repair: "Ремонт", broken: "Сломано", written_off: "Списано" };
    const condMap = { new: "Новое", good: "Хорошее", satisfactory: "Удовл.", poor: "Плохое", broken: "Неисправно" };

    for (const r of result.rows) {
      const row = ws.addRow({
        inv: r.inventory_number || "",
        name: r.name || "",
        cat: r.category_name || "",
        status: statusMap[r.status] || r.status || "",
        condition: condMap[r.condition] || r.condition || "",
        warehouse: r.warehouse_name || "",
        holder: r.holder_name || "",
        object: r.object_name || "",
        brand: r.brand || "",
        model: r.model || "",
        price: r.purchase_price ? Number(r.purchase_price) : ""
      });
      if (r.purchase_price) row.getCell(11).numFmt = "#,##0.00";
    }

    ws.autoFilter = { from: "A1", to: "K1" };

    const buffer = await wb.xlsx.writeBuffer();
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("Content-Disposition", "attachment; filename=equipment_" + new Date().toISOString().slice(0,10) + ".xlsx");
    return reply.send(Buffer.from(buffer));
  });

  // ============================================
  // DELETE /:id (soft delete)
  // ============================================
  fastify.delete("/:id", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    if (!hasFullAccess(user.role)) {
      return reply.code(403).send({ success: false, message: "Нет прав на удаление" });
    }
    const { id } = request.params;
    const result = await db.query(
      "UPDATE equipment SET status = $1, written_off_date = NOW(), written_off_by = $2, updated_at = NOW() WHERE id = $3 AND status != $1 RETURNING id",
      ["written_off", user.id, id]
    );
    if (!result.rows.length) {
      return reply.code(404).send({ success: false, message: "Оборудование не найдено или уже списано" });
    }
    return { success: true, message: "Оборудование списано" };
  });


  // ============================================
  // FACEKIT PREMIUM: ФОТО (multipart upload + icon)
  // ============================================

  // ── Upload фото оборудования ──
  fastify.post('/:id/photo', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const contentType = request.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      const data = await request.file();
      if (!data) return reply.code(400).send({ success: false, message: 'Загрузите фото' });

      const allowedExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const ext = path.extname(data.filename || '').toLowerCase() || '.jpg';
      if (!allowedExt.includes(ext)) {
        return reply.code(400).send({ success: false, message: 'Допустимые форматы: jpg, png, gif, webp' });
      }

      const uploadDir = process.env.UPLOAD_DIR || './uploads';
      const eqDir = path.join(uploadDir, 'equipment');
      await fsp.mkdir(eqDir, { recursive: true });

      const filename = `eq_${id}_${randomUUID()}${ext}`;
      const filepath = path.join(eqDir, filename);
      const buffer = await data.toBuffer();
      await fsp.writeFile(filepath, buffer);

      const photo_url = '/uploads/equipment/' + filename;
      await db.query('UPDATE equipment SET photo_url = $1, updated_at = NOW() WHERE id = $2', [photo_url, id]);
      return { success: true, photo_url };
    } else {
      const { photo_url, custom_icon } = request.body || {};
      if (custom_icon) {
        await db.query('UPDATE equipment SET custom_icon = $1, photo_url = NULL, updated_at = NOW() WHERE id = $2', [custom_icon, id]);
        return { success: true, custom_icon };
      }
      if (photo_url) {
        if (!isValidPhotoUrl(photo_url)) {
          return reply.code(400).send({ success: false, message: 'Некорректный URL фото' });
        }
        await db.query('UPDATE equipment SET photo_url = $1, updated_at = NOW() WHERE id = $2', [photo_url, id]);
        return { success: true, photo_url };
      }
      return reply.code(400).send({ success: false, message: 'Загрузите фото, укажите URL или выберите иконку' });
    }
  });

  // ── Удалить фото/иконку ──
  fastify.delete('/:id/photo', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    await db.query('UPDATE equipment SET photo_url = NULL, custom_icon = NULL, updated_at = NOW() WHERE id = $1', [id]);
    return { success: true, message: 'Фото/иконка удалены' };
  });

  // ── Раздача фото оборудования ──
  fastify.get('/photo/:filename', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { filename } = request.params;
    const safeName = path.basename(filename);
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const filepath = path.join(uploadDir, 'equipment', safeName);
    try {
      const stat = await fsp.stat(filepath);
      const file = await fsp.readFile(filepath);
      const mimeMap = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.gif':'image/gif', '.webp':'image/webp' };
      const ext = path.extname(safeName).toLowerCase();
      reply.header('Content-Type', mimeMap[ext] || 'application/octet-stream');
      reply.header('Content-Length', stat.size);
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(file);
    } catch(e) {
      return reply.code(404).send({ success: false, message: 'Фото не найдено' });
    }
  });

  fastify.post('/movement/:id/photos', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { photos } = request.body; // array of URLs

    if (!photos || !Array.isArray(photos)) {
      return reply.code(400).send({ success: false, message: 'Укажите массив photos' });
    }

    await db.query(`
      UPDATE equipment_movements 
      SET verification_photos = COALESCE(verification_photos, ARRAY[]::text[]) || $1::text[]
      WHERE id = $2
    `, [photos, id]);

    return { success: true, message: 'Фото добавлены' };
  });

  // GET /my — my equipment (issued to current user)
  fastify.get('/my', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const result = await db.query(
      `SELECT e.*, c.name as category_name, w.name as warehouse_name
       FROM equipment e
       LEFT JOIN equipment_categories c ON c.id = e.category_id
       LEFT JOIN warehouses w ON w.id = e.warehouse_id
       WHERE e.current_holder_id = $1 AND e.status = 'issued'
       ORDER BY e.updated_at DESC`,
      [user.id]
    );
    return { success: true, equipment: result.rows };
  });

  // GET /movements — global movements history
  fastify.get('/movements', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const limit = parseInt(request.query.limit) || 50;
    const offset = parseInt(request.query.offset) || 0;
    const result = await db.query(
      `SELECT m.*, e.name as equipment_name,
              u1.name as from_user, u2.name as to_user,
              w1.name as from_warehouse, w2.name as to_warehouse
       FROM equipment_movements m
       LEFT JOIN equipment e ON e.id = m.equipment_id
       LEFT JOIN users u1 ON u1.id = m.from_holder_id
       LEFT JOIN users u2 ON u2.id = m.to_holder_id
       LEFT JOIN warehouses w1 ON w1.id = m.from_warehouse_id
       LEFT JOIN warehouses w2 ON w2.id = m.to_warehouse_id
       ORDER BY m.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return { success: true, movements: result.rows };
  });

    fastify.get('/stats/dashboard', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;

    const stats = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'on_warehouse') as on_warehouse,
        COUNT(*) FILTER (WHERE status = 'issued') as issued,
        COUNT(*) FILTER (WHERE status = 'repair') as in_repair,
        COUNT(*) FILTER (WHERE status = 'broken') as broken,
        COUNT(*) FILTER (WHERE status = 'written_off') as written_off,
        COALESCE(SUM(purchase_price) FILTER (WHERE status != 'written_off'), 0) as total_value,
        COALESCE(SUM(book_value) FILTER (WHERE status != 'written_off'), 0) as book_value
      FROM equipment
    `);

    // Active reservations
    const reservations = await db.query(`
      SELECT COUNT(*) as count FROM equipment_reservations WHERE status = 'active' AND reserved_to >= CURRENT_DATE
    `);

    // Alerts
    const alerts = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE next_maintenance IS NOT NULL AND next_maintenance < CURRENT_DATE) as maintenance_overdue,
        COUNT(*) FILTER (WHERE next_calibration IS NOT NULL AND next_calibration < CURRENT_DATE) as calibration_overdue,
        COUNT(*) FILTER (WHERE min_stock_level > 0 AND quantity <= min_stock_level) as low_stock
      FROM equipment WHERE status != 'written_off'
    `);

    // By category
    const byCategory = await db.query(`
      SELECT c.id, c.name, c.icon, COUNT(e.id) as count
      FROM equipment_categories c
      LEFT JOIN equipment e ON e.category_id = c.id AND e.status != 'written_off'
      GROUP BY c.id, c.name, c.icon
      ORDER BY count DESC
    `);

    // Recent movements (last 10)
    const recent = await db.query(`
      SELECT m.id, m.movement_type, m.created_at,
        e.name as equipment_name, e.inventory_number,
        u.name as created_by_name
      FROM equipment_movements m
      JOIN equipment e ON m.equipment_id = e.id
      LEFT JOIN users u ON m.created_by = u.id
      ORDER BY m.created_at DESC LIMIT 10
    `);

    const s = stats.rows[0];
    const a = alerts.rows[0];

    const result = {
      success: true,
      total: parseInt(s.total),
      on_warehouse: parseInt(s.on_warehouse),
      issued: parseInt(s.issued),
      in_repair: parseInt(s.in_repair),
      broken: parseInt(s.broken),
      written_off: parseInt(s.written_off),
      reserved: parseInt(reservations.rows[0].count),
      alerts: {
        maintenance_overdue: parseInt(a.maintenance_overdue || 0),
        calibration_overdue: parseInt(a.calibration_overdue || 0),
        low_stock: parseInt(a.low_stock || 0)
      },
      by_category: byCategory.rows,
      recent_movements: recent.rows
    };

    if (hasFullAccess(user.role)) {
      result.total_value = parseFloat(s.total_value);
      result.book_value = parseFloat(s.book_value);
    }

    return result;
  });

  // ============================================
  // POST /:id/return — Возврат на склад
  // ============================================
  fastify.post('/:id/return', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const { work_id, notes } = req.body || {};
    const eq = await db.query('SELECT * FROM equipment WHERE id=$1', [id]);
    if (!eq.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    const wh = (await db.query("SELECT id FROM warehouses WHERE is_main=true LIMIT 1")).rows[0]?.id;
    await db.query("UPDATE equipment SET status='on_warehouse', warehouse_id=$2 WHERE id=$1", [id, wh]);
    await db.query(`INSERT INTO equipment_movements(equipment_id,movement_type,to_warehouse_id,performed_by,notes)
       VALUES($1,'return',$2,$3,$4)`, [id, wh, req.user.id, notes || `Возврат${work_id ? ' с работы #'+work_id : ''}`]);
    reply.send({ ok: true });
  });

  // ============================================
  // POST /:id/write-off — Списание
  // ============================================
  fastify.post('/:id/write-off', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const { reason } = req.body || {};
    if (!reason) return reply.code(400).send({ error: 'reason required' });
    await db.query("UPDATE equipment SET status='written_off' WHERE id=$1", [id]);
    await db.query(`INSERT INTO equipment_movements(equipment_id,movement_type,performed_by,notes)
       VALUES($1,'write_off',$2,$3)`, [id, req.user.id, reason]);
    reply.send({ ok: true });
  });

}

module.exports = equipmentRoutes;
