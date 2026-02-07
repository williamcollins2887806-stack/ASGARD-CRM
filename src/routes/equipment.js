/**
 * ASGARD CRM - Equipment Routes
 * Учёт ТМЦ и оборудования
 */

async function equipmentRoutes(fastify, options) {
  const db = fastify.db;
  
  // Роли с полным доступом к складу (M15: добавлен CHIEF_ENGINEER)
  const WAREHOUSE_ADMINS = ['ADMIN', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const PM_ROLES = ['PM', 'MANAGER'];
  
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
  // КАТЕГОРИИ
  // SECURITY: Добавлен auth (HIGH-1)
  // ============================================

  fastify.get('/categories', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const result = await db.query(`
      SELECT * FROM equipment_categories ORDER BY sort_order, name
    `);
    return { success: true, categories: result.rows };
  });

  // ============================================
  // ОБЪЕКТЫ
  // SECURITY: Добавлен auth (HIGH-1)
  // ============================================

  fastify.get('/objects', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const result = await db.query(`
      SELECT * FROM objects WHERE is_active = true ORDER BY name
    `);
    return { success: true, objects: result.rows };
  });

  // ============================================
  // СКЛАДЫ
  // SECURITY: Добавлен auth (HIGH-1)
  // ============================================

  fastify.get('/warehouses', {
    preHandler: [fastify.authenticate]
  }, async () => {
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
  // ОБОРУДОВАНИЕ - СПИСОК
  // ============================================
  
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { 
      status, category_id, holder_id, warehouse_id, object_id,
      search, limit = 100, offset = 0 
    } = request.query;
    
    let sql = `
      SELECT e.*, 
        c.name as category_name, c.icon as category_icon, c.is_consumable,
        w.name as warehouse_name,
        u.name as holder_name,
        o.name as object_name,
        inv.invoice_number
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN warehouses w ON e.warehouse_id = w.id
      LEFT JOIN users u ON e.current_holder_id = u.id
      LEFT JOIN objects o ON e.current_object_id = o.id
      LEFT JOIN invoices inv ON e.invoice_id = inv.id
      WHERE e.status != 'written_off'
    `;
    const params = [];
    
    if (status) {
      params.push(status);
      sql += ` AND e.status = $${params.length}`;
    }
    
    if (category_id) {
      params.push(category_id);
      sql += ` AND e.category_id = $${params.length}`;
    }
    
    if (holder_id) {
      params.push(holder_id);
      sql += ` AND e.current_holder_id = $${params.length}`;
    }
    
    if (warehouse_id) {
      params.push(warehouse_id);
      sql += ` AND e.warehouse_id = $${params.length}`;
    }
    
    if (object_id) {
      params.push(object_id);
      sql += ` AND e.current_object_id = $${params.length}`;
    }
    
    if (search) {
      params.push('%' + search + '%');
      sql += ` AND (e.name ILIKE $${params.length} OR e.inventory_number ILIKE $${params.length} OR e.serial_number ILIKE $${params.length})`;
    }
    
    sql += ` ORDER BY e.created_at DESC`;
    
    params.push(parseInt(limit));
    sql += ` LIMIT $${params.length}`;
    
    params.push(parseInt(offset));
    sql += ` OFFSET $${params.length}`;
    
    const result = await db.query(sql, params);
    
    // Статистика
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'on_warehouse') as on_warehouse,
        COUNT(*) FILTER (WHERE status = 'issued') as issued,
        COUNT(*) FILTER (WHERE status = 'repair') as in_repair,
        COUNT(*) FILTER (WHERE status = 'broken') as broken
      FROM equipment WHERE status != 'written_off'
    `);
    
    return { 
      success: true, 
      equipment: result.rows,
      stats: stats.rows[0]
    };
  });
  
  // ============================================
  // ОБОРУДОВАНИЕ - КАРТОЧКА
  // ============================================
  
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    
    const result = await db.query(`
      SELECT e.*, 
        c.name as category_name, c.icon as category_icon, c.is_consumable, c.requires_calibration,
        w.name as warehouse_name,
        u.name as holder_name, u.phone as holder_phone,
        o.name as object_name,
        inv.invoice_number, inv.invoice_date,
        creator.name as created_by_name
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN warehouses w ON e.warehouse_id = w.id
      LEFT JOIN users u ON e.current_holder_id = u.id
      LEFT JOIN objects o ON e.current_object_id = o.id
      LEFT JOIN invoices inv ON e.invoice_id = inv.id
      LEFT JOIN users creator ON e.created_by = creator.id
      WHERE e.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }
    
    // История перемещений
    const movements = await db.query(`
      SELECT m.*,
        fw.name as from_warehouse_name,
        tw.name as to_warehouse_name,
        fu.name as from_holder_name,
        tu.name as to_holder_name,
        fo.name as from_object_name,
        tobj.name as to_object_name,
        w.work_title, w.work_number,
        creator.name as created_by_name
      FROM equipment_movements m
      LEFT JOIN warehouses fw ON m.from_warehouse_id = fw.id
      LEFT JOIN warehouses tw ON m.to_warehouse_id = tw.id
      LEFT JOIN users fu ON m.from_holder_id = fu.id
      LEFT JOIN users tu ON m.to_holder_id = tu.id
      LEFT JOIN objects fo ON m.from_object_id = fo.id
      LEFT JOIN objects tobj ON m.to_object_id = tobj.id
      LEFT JOIN works w ON m.work_id = w.id
      LEFT JOIN users creator ON m.created_by = creator.id
      WHERE m.equipment_id = $1
      ORDER BY m.created_at DESC
      LIMIT 50
    `, [id]);
    
    // ТО и ремонт
    const maintenance = await db.query(`
      SELECT * FROM equipment_maintenance 
      WHERE equipment_id = $1 
      ORDER BY created_at DESC LIMIT 20
    `, [id]);
    
    // Бронирования
    const reservations = await db.query(`
      SELECT r.*, w.work_title, w.work_number, u.name as reserved_by_name
      FROM equipment_reservations r
      LEFT JOIN works w ON r.work_id = w.id
      LEFT JOIN users u ON r.reserved_by = u.id
      WHERE r.equipment_id = $1 AND r.status = 'active'
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
  
  // ============================================
  // СОЗДАНИЕ ОБОРУДОВАНИЯ
  // ============================================
  
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав на создание оборудования' });
    }
    
    const {
      name, category_id, serial_number, barcode,
      purchase_price, purchase_date, invoice_id,
      quantity = 1, unit = 'шт',
      warranty_end, maintenance_interval_days,
      useful_life_months = 60, salvage_value = 0, auto_write_off = true,
      brand, model, specifications, notes
    } = request.body;
    
    // Генерируем инвентарный номер
    let inventoryNumber;
    try {
      const catResult = await db.query('SELECT code FROM equipment_categories WHERE id = $1', [category_id]);
      const catCode = catResult.rows[0]?.code || 'MISC';
      
      const invResult = await db.query('SELECT generate_inventory_number($1) as inv_num', [catCode]);
      inventoryNumber = invResult.rows[0].inv_num;
    } catch(e) {
      inventoryNumber = 'INV-' + Date.now();
    }
    
    // Получаем главный склад
    const warehouseResult = await db.query('SELECT id FROM warehouses WHERE is_main = true LIMIT 1');
    const warehouseId = warehouseResult.rows[0]?.id || 1;
    
    // Генерируем UUID для QR-кода
    const qrUuid = require('crypto').randomUUID();
    
    // Генерируем QR-код данные
    const qrData = JSON.stringify({
      type: 'ASGARD_EQUIPMENT',
      uuid: qrUuid,
      inv: inventoryNumber
    });
    
    // Рассчитываем начальную балансовую стоимость
    const bookValue = purchase_price || 0;
    
    const result = await db.query(`
      INSERT INTO equipment (
        inventory_number, name, category_id, serial_number, barcode, qr_code, qr_uuid,
        purchase_price, purchase_date, invoice_id,
        quantity, unit,
        warranty_end, maintenance_interval_days,
        useful_life_months, salvage_value, auto_write_off, book_value,
        brand, model, specifications, notes,
        status, warehouse_id, balance_status, balance_date,
        created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 'on_warehouse', $23, 'on_balance', CURRENT_DATE, $24, NOW())
      RETURNING *
    `, [
      inventoryNumber, name, category_id, serial_number, barcode, qrData, qrUuid,
      purchase_price, purchase_date, invoice_id,
      quantity, unit,
      warranty_end, maintenance_interval_days,
      useful_life_months, salvage_value, auto_write_off, bookValue,
      brand, model, specifications ? JSON.stringify(specifications) : null, notes,
      warehouseId, user.id
    ]);
    
    return { success: true, equipment: result.rows[0], qr_uuid: qrUuid };
  });
  
  // ============================================
  // МАССОВОЕ СОЗДАНИЕ ОБОРУДОВАНИЯ
  // ============================================
  
  fastify.post('/bulk-create', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }
    
    const { items } = request.body; // массив объектов
    if (!items || !Array.isArray(items)) {
      return reply.code(400).send({ success: false, message: 'Укажите массив items' });
    }
    
    const warehouseResult = await db.query('SELECT id FROM warehouses WHERE is_main = true LIMIT 1');
    const warehouseId = warehouseResult.rows[0]?.id || 1;
    
    const created = [];
    
    for (const item of items) {
      try {
        // Генерируем инвентарный номер
        const catResult = await db.query('SELECT code FROM equipment_categories WHERE id = $1', [item.category_id]);
        const catCode = catResult.rows[0]?.code || 'MISC';
        const invResult = await db.query('SELECT generate_inventory_number($1) as inv_num', [catCode]);
        const inventoryNumber = invResult.rows[0].inv_num;
        
        const qrUuid = require('crypto').randomUUID();
        const qrData = JSON.stringify({ type: 'ASGARD_EQUIPMENT', uuid: qrUuid, inv: inventoryNumber });
        
        const result = await db.query(`
          INSERT INTO equipment (
            inventory_number, name, category_id, serial_number,
            purchase_price, purchase_date, invoice_id,
            quantity, unit, qr_code, qr_uuid,
            useful_life_months, salvage_value, auto_write_off, book_value,
            status, warehouse_id, balance_status, balance_date, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'on_warehouse', $16, 'on_balance', CURRENT_DATE, $17)
          RETURNING id, inventory_number, name, qr_uuid
        `, [
          inventoryNumber, item.name, item.category_id, item.serial_number,
          item.purchase_price, item.purchase_date, item.invoice_id,
          item.quantity || 1, item.unit || 'шт', qrData, qrUuid,
          item.useful_life_months || 60, item.salvage_value || 0, item.auto_write_off !== false, item.purchase_price || 0,
          warehouseId, user.id
        ]);
        
        created.push(result.rows[0]);
      } catch(e) {
        fastify.log.error('Bulk create error:', e.message);
      }
    }
    
    return { success: true, created, count: created.length };
  });
  
  // ============================================
  // РЕДАКТИРОВАНИЕ
  // ============================================
  
  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;
    
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав на редактирование' });
    }
    
    const {
      name, category_id, serial_number, barcode,
      purchase_price, purchase_date, invoice_id,
      quantity, unit, condition,
      warranty_end, next_maintenance, next_calibration, maintenance_interval_days,
      brand, model, specifications, notes
    } = request.body;
    
    const result = await db.query(`
      UPDATE equipment SET
        name = COALESCE($1, name),
        category_id = COALESCE($2, category_id),
        serial_number = COALESCE($3, serial_number),
        barcode = COALESCE($4, barcode),
        purchase_price = COALESCE($5, purchase_price),
        purchase_date = COALESCE($6, purchase_date),
        invoice_id = COALESCE($7, invoice_id),
        quantity = COALESCE($8, quantity),
        unit = COALESCE($9, unit),
        condition = COALESCE($10, condition),
        warranty_end = $11,
        next_maintenance = $12,
        next_calibration = $13,
        maintenance_interval_days = COALESCE($14, maintenance_interval_days),
        brand = COALESCE($15, brand),
        model = COALESCE($16, model),
        specifications = COALESCE($17, specifications),
        notes = COALESCE($18, notes),
        updated_at = NOW()
      WHERE id = $19
      RETURNING *
    `, [
      name, category_id, serial_number, barcode,
      purchase_price, purchase_date, invoice_id,
      quantity, unit, condition,
      warranty_end, next_maintenance, next_calibration, maintenance_interval_days,
      brand, model, specifications ? JSON.stringify(specifications) : null, notes,
      id
    ]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }
    
    return { success: true, equipment: result.rows[0] };
  });
  
  // ============================================
  // ВЫДАЧА СО СКЛАДА
  // ============================================
  
  fastify.post('/issue', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Только кладовщик может выдавать оборудование' });
    }
    
    const { equipment_id, holder_id, work_id, object_id, quantity, condition_after, notes } = request.body;
    
    if (!work_id) {
      return reply.code(400).send({ success: false, message: 'Укажите работу для привязки' });
    }
    
    // Проверяем оборудование
    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [equipment_id]);
    if (equip.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }
    
    const eq = equip.rows[0];
    if (eq.status !== 'on_warehouse') {
      return reply.code(400).send({ success: false, message: 'Оборудование не на складе' });
    }
    
    // Создаём перемещение
    await db.query(`
      INSERT INTO equipment_movements (
        equipment_id, movement_type,
        from_warehouse_id, to_holder_id, to_object_id,
        work_id, quantity, condition_before, condition_after, notes,
        confirmed, confirmed_at, created_by
      ) VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), $10)
    `, [
      equipment_id, eq.warehouse_id, holder_id, object_id,
      work_id, quantity || eq.quantity, eq.condition, condition_after || eq.condition, notes,
      user.id
    ]);
    
    // Обновляем оборудование
    await db.query(`
      UPDATE equipment SET
        status = 'issued',
        current_holder_id = $1,
        current_object_id = $2,
        warehouse_id = NULL,
        condition = COALESCE($3, condition),
        updated_at = NOW()
      WHERE id = $4
    `, [holder_id, object_id, condition_after, equipment_id]);
    
    return { success: true, message: 'Оборудование выдано' };
  });
  
  // ============================================
  // ВОЗВРАТ НА СКЛАД
  // ============================================
  
  fastify.post('/return', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }
    
    const { equipment_id, condition_after, notes } = request.body;
    
    // Проверяем оборудование
    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [equipment_id]);
    if (equip.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }
    
    const eq = equip.rows[0];
    
    // РП может вернуть только своё оборудование
    if (PM_ROLES.includes(user.role) && eq.current_holder_id !== user.id) {
      return reply.code(403).send({ success: false, message: 'Это не ваше оборудование' });
    }
    
    // Получаем главный склад
    const warehouseResult = await db.query('SELECT id FROM warehouses WHERE is_main = true LIMIT 1');
    const warehouseId = warehouseResult.rows[0]?.id || 1;
    
    // Создаём перемещение
    await db.query(`
      INSERT INTO equipment_movements (
        equipment_id, movement_type,
        from_holder_id, from_object_id, to_warehouse_id,
        quantity, condition_before, condition_after, notes,
        confirmed, confirmed_at, created_by
      ) VALUES ($1, 'return', $2, $3, $4, $5, $6, $7, $8, true, NOW(), $9)
    `, [
      equipment_id, eq.current_holder_id, eq.current_object_id, warehouseId,
      eq.quantity, eq.condition, condition_after || eq.condition, notes,
      user.id
    ]);
    
    // Обновляем статус
    const newStatus = (condition_after === 'broken') ? 'broken' : 'on_warehouse';
    
    await db.query(`
      UPDATE equipment SET
        status = $1,
        current_holder_id = NULL,
        current_object_id = NULL,
        warehouse_id = $2,
        condition = COALESCE($3, condition),
        updated_at = NOW()
      WHERE id = $4
    `, [newStatus, warehouseId, condition_after, equipment_id]);
    
    return { success: true, message: 'Оборудование возвращено на склад' };
  });
  
  // ============================================
  // ЗАПРОС НА ПЕРЕДАЧУ ДРУГОМУ РП
  // ============================================
  
  fastify.post('/transfer-request', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }
    
    const { equipment_id, target_holder_id, work_id, object_id, notes } = request.body;
    
    if (!work_id) {
      return reply.code(400).send({ success: false, message: 'Укажите работу' });
    }
    
    // Проверяем оборудование
    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [equipment_id]);
    if (equip.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }
    
    const eq = equip.rows[0];
    
    // РП может передать только своё
    if (PM_ROLES.includes(user.role) && eq.current_holder_id !== user.id) {
      return reply.code(403).send({ success: false, message: 'Это не ваше оборудование' });
    }
    
    // Создаём запрос на передачу
    const result = await db.query(`
      INSERT INTO equipment_requests (
        request_type, requester_id, equipment_id,
        work_id, object_id, target_holder_id, notes
      ) VALUES ('transfer', $1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [user.id, equipment_id, work_id, object_id, target_holder_id, notes]);
    
    return { success: true, request: result.rows[0], message: 'Запрос на передачу создан' };
  });
  
  // ============================================
  // ВЫПОЛНЕНИЕ ПЕРЕДАЧИ (ЧЕРЕЗ СКЛАД)
  // ============================================
  
  fastify.post('/transfer-execute', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Только кладовщик может выполнить передачу' });
    }
    
    const { request_id, condition_after, notes } = request.body;
    
    // Получаем запрос
    const reqResult = await db.query('SELECT * FROM equipment_requests WHERE id = $1', [request_id]);
    if (reqResult.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Запрос не найден' });
    }
    
    const req = reqResult.rows[0];
    if (req.status !== 'pending') {
      return reply.code(400).send({ success: false, message: 'Запрос уже обработан' });
    }
    
    // Получаем оборудование
    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [req.equipment_id]);
    const eq = equip.rows[0];
    
    // Получаем главный склад
    const warehouseResult = await db.query('SELECT id FROM warehouses WHERE is_main = true LIMIT 1');
    const warehouseId = warehouseResult.rows[0]?.id || 1;
    
    // 1. Возврат на склад от первого РП
    await db.query(`
      INSERT INTO equipment_movements (
        equipment_id, movement_type,
        from_holder_id, from_object_id, to_warehouse_id,
        condition_before, notes, confirmed, confirmed_at, created_by
      ) VALUES ($1, 'transfer_out', $2, $3, $4, $5, $6, true, NOW(), $7)
    `, [eq.id, eq.current_holder_id, eq.current_object_id, warehouseId, eq.condition, 'Передача через склад', user.id]);
    
    // 2. Выдача второму РП
    await db.query(`
      INSERT INTO equipment_movements (
        equipment_id, movement_type,
        from_warehouse_id, to_holder_id, to_object_id,
        work_id, condition_after, notes, confirmed, confirmed_at, created_by
      ) VALUES ($1, 'transfer_in', $2, $3, $4, $5, $6, $7, true, NOW(), $8)
    `, [eq.id, warehouseId, req.target_holder_id, req.object_id, req.work_id, condition_after || eq.condition, notes, user.id]);
    
    // Обновляем оборудование
    await db.query(`
      UPDATE equipment SET
        status = 'issued',
        current_holder_id = $1,
        current_object_id = $2,
        warehouse_id = NULL,
        condition = COALESCE($3, condition),
        updated_at = NOW()
      WHERE id = $4
    `, [req.target_holder_id, req.object_id, condition_after, eq.id]);
    
    // Закрываем запрос
    await db.query(`
      UPDATE equipment_requests SET 
        status = 'completed', 
        processed_by = $1, 
        processed_at = NOW() 
      WHERE id = $2
    `, [user.id, request_id]);
    
    return { success: true, message: 'Передача выполнена' };
  });
  
  // ============================================
  // СПИСАНИЕ (с обязательным комментарием)
  // ============================================
  
  fastify.post('/write-off', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    
    // Списывать могут только директора
    const CAN_WRITE_OFF = ['ADMIN', 'DIRECTOR', 'DIRECTOR_GEN'];
    if (!CAN_WRITE_OFF.includes(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав на списание' });
    }
    
    const { equipment_id, reason } = request.body;
    
    // Обязательный комментарий
    if (!reason || reason.trim().length < 5) {
      return reply.code(400).send({ success: false, message: 'Укажите причину списания (мин. 5 символов)' });
    }
    
    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [equipment_id]);
    if (equip.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }
    
    const eq = equip.rows[0];
    
    // Создаём перемещение списания
    await db.query(`
      INSERT INTO equipment_movements (
        equipment_id, movement_type,
        from_warehouse_id, from_holder_id,
        notes, confirmed, confirmed_at, created_by
      ) VALUES ($1, 'write_off', $2, $3, $4, true, NOW(), $5)
    `, [equipment_id, eq.warehouse_id, eq.current_holder_id, reason, user.id]);
    
    // Обновляем статус
    await db.query(`
      UPDATE equipment SET
        status = 'written_off',
        balance_status = 'written_off',
        current_holder_id = NULL,
        current_object_id = NULL,
        warehouse_id = NULL,
        written_off_date = CURRENT_DATE,
        written_off_reason = $1,
        written_off_by = $2,
        book_value = COALESCE(salvage_value, 0),
        updated_at = NOW()
      WHERE id = $3
    `, [reason, user.id, equipment_id]);
    
    return { success: true, message: 'Оборудование списано' };
  });
  
  // ============================================
  // ПОИСК ПО QR-КОДУ (UUID)
  // ============================================
  
  fastify.get('/by-qr/:uuid', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { uuid } = request.params;
    
    const result = await db.query(`
      SELECT e.*, 
        c.name as category_name, c.icon as category_icon,
        w.name as warehouse_name,
        u.name as holder_name, u.phone as holder_phone,
        o.name as object_name
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN warehouses w ON e.warehouse_id = w.id
      LEFT JOIN users u ON e.current_holder_id = u.id
      LEFT JOIN objects o ON e.current_object_id = o.id
      WHERE e.qr_uuid = $1 OR e.inventory_number = $1
    `, [uuid]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }
    
    return { success: true, equipment: result.rows[0] };
  });
  
  // ============================================
  // БАЛАНСОВАЯ СТОИМОСТЬ (для дашборда)
  // ============================================
  
  fastify.get('/balance-value', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    
    // Только директора видят балансовую стоимость
    if (!hasFullAccess(user.role)) {
      return { success: false, message: 'Нет доступа' };
    }
    
    try {
      // Пересчитываем амортизацию
      await db.query('SELECT recalculate_all_depreciation()');
      
      // Проверяем автосписание
      const writeOffResult = await db.query('SELECT auto_write_off_expired() as count');
      const autoWrittenOff = writeOffResult.rows[0].count || 0;
      
      // Получаем итоги
      const result = await db.query('SELECT * FROM get_total_book_value()');
      const stats = result.rows[0] || {};
      
      // Детализация по категориям
      const byCategory = await db.query(`
        SELECT c.name, c.icon, 
          COUNT(e.id) as count,
          COALESCE(SUM(e.purchase_price), 0) as purchase_total,
          COALESCE(SUM(e.book_value), 0) as book_total
        FROM equipment_categories c
        LEFT JOIN equipment e ON e.category_id = c.id 
          AND e.balance_status = 'on_balance' AND e.status != 'written_off'
        GROUP BY c.id, c.name, c.icon
        ORDER BY book_total DESC
      `);
      
      // Скоро истекает срок (в ближайшие 90 дней)
      const expiringSoon = await db.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(book_value), 0) as value
        FROM equipment 
        WHERE balance_status = 'on_balance' 
          AND status != 'written_off'
          AND useful_life_months IS NOT NULL
          AND balance_date IS NOT NULL
          AND (balance_date + (useful_life_months || ' months')::INTERVAL) <= CURRENT_DATE + INTERVAL '90 days'
      `);
      
      return { 
        success: true,
        total_purchase_price: parseFloat(stats.total_purchase_price || 0),
        total_book_value: parseFloat(stats.total_book_value || 0),
        total_depreciation: parseFloat(stats.total_depreciation || 0),
        equipment_count: parseInt(stats.equipment_count || 0),
        auto_written_off: autoWrittenOff,
        by_category: byCategory.rows,
        expiring_soon: {
          count: parseInt(expiringSoon.rows[0].count || 0),
          value: parseFloat(expiringSoon.rows[0].value || 0)
        }
      };
    } catch(e) {
      fastify.log.error('Balance value error:', e.message);
      return { success: false, message: e.message };
    }
  });
  
  // ============================================
  // ПЕРЕСЧЁТ АМОРТИЗАЦИИ (ручной)
  // ============================================
  
  fastify.post('/recalculate-depreciation', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    
    if (!hasFullAccess(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }
    
    try {
      const result = await db.query('SELECT recalculate_all_depreciation() as count');
      return { success: true, updated: result.rows[0].count };
    } catch(e) {
      return reply.code(500).send({ success: false, message: e.message });
    }
  });
  
  // ============================================
  // ДАННЫЕ ДЛЯ ПЕЧАТИ QR-КОДОВ
  // ============================================
  
  fastify.post('/qr-print-data', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { equipment_ids } = request.body;
    
    if (!equipment_ids || !equipment_ids.length) {
      return { success: false, items: [] };
    }
    
    const result = await db.query(`
      SELECT id, inventory_number, name, qr_uuid, serial_number, 
        c.name as category_name, c.icon as category_icon
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      WHERE e.id = ANY($1)
      ORDER BY e.inventory_number
    `, [equipment_ids]);
    
    return { success: true, items: result.rows };
  });
  
  // ============================================
  // ЗАПРОСЫ НА ОБРАБОТКУ
  // ============================================
  
  fastify.get('/requests', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    const { status = 'pending' } = request.query;
    
    let sql = `
      SELECT r.*, 
        e.name as equipment_name, e.inventory_number,
        req.name as requester_name,
        target.name as target_holder_name,
        w.work_title, w.work_number,
        o.name as object_name
      FROM equipment_requests r
      LEFT JOIN equipment e ON r.equipment_id = e.id
      LEFT JOIN users req ON r.requester_id = req.id
      LEFT JOIN users target ON r.target_holder_id = target.id
      LEFT JOIN works w ON r.work_id = w.id
      LEFT JOIN objects o ON r.object_id = o.id
      WHERE r.status = $1
    `;
    const params = [status];
    
    // РП видит только свои запросы
    if (PM_ROLES.includes(user.role)) {
      sql += ` AND (r.requester_id = $2 OR r.target_holder_id = $2)`;
      params.push(user.id);
    }
    
    sql += ` ORDER BY r.created_at DESC`;
    
    const result = await db.query(sql, params);
    return { success: true, requests: result.rows };
  });
  
  // ============================================
  // БРОНИРОВАНИЕ
  // ============================================
  
  fastify.post('/reserve', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    
    if (!canManageEquipment(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }
    
    const { equipment_id, work_id, reserved_from, reserved_to, notes } = request.body;
    
    // Проверяем конфликты бронирования
    const conflicts = await db.query(`
      SELECT * FROM equipment_reservations 
      WHERE equipment_id = $1 
        AND status = 'active'
        AND (reserved_from, reserved_to) OVERLAPS ($2::date, $3::date)
    `, [equipment_id, reserved_from, reserved_to]);
    
    if (conflicts.rows.length > 0) {
      return reply.code(400).send({ success: false, message: 'Оборудование уже забронировано на эти даты' });
    }
    
    const result = await db.query(`
      INSERT INTO equipment_reservations (equipment_id, work_id, reserved_by, reserved_from, reserved_to, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [equipment_id, work_id, user.id, reserved_from, reserved_to, notes]);
    
    return { success: true, reservation: result.rows[0] };
  });
  
  // ============================================
  // ТО И РЕМОНТ
  // ============================================
  
  fastify.post('/:id/maintenance', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;
    
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }
    
    const { maintenance_type, description, cost, spare_parts, performed_by, contractor, started_at, completed_at, next_date, invoice_id, notes } = request.body;
    
    const result = await db.query(`
      INSERT INTO equipment_maintenance (
        equipment_id, maintenance_type, description, cost, spare_parts,
        performed_by, contractor, started_at, completed_at, next_date,
        invoice_id, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      id, maintenance_type, description, cost, spare_parts ? JSON.stringify(spare_parts) : null,
      performed_by, contractor, started_at, completed_at, next_date,
      invoice_id, notes, user.id
    ]);
    
    // Обновляем дату следующего ТО
    if (next_date) {
      await db.query('UPDATE equipment SET next_maintenance = $1 WHERE id = $2', [next_date, id]);
    }
    
    // Если это ремонт — меняем статус
    if (maintenance_type === 'repair' && !completed_at) {
      await db.query('UPDATE equipment SET status = $1 WHERE id = $2', ['repair', id]);
    } else if (maintenance_type === 'repair' && completed_at) {
      await db.query('UPDATE equipment SET status = $1 WHERE id = $2', ['on_warehouse', id]);
    }
    
    return { success: true, maintenance: result.rows[0] };
  });
  
  // ============================================
  // ОБОРУДОВАНИЕ СОТРУДНИКА
  // ============================================
  
  fastify.get('/by-holder/:holderId', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { holderId } = request.params;
    
    const result = await db.query(`
      SELECT e.*, 
        c.name as category_name, c.icon as category_icon,
        o.name as object_name,
        w.work_title, w.work_number
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN objects o ON e.current_object_id = o.id
      LEFT JOIN equipment_movements m ON m.equipment_id = e.id AND m.movement_type = 'issue'
      LEFT JOIN works w ON m.work_id = w.id
      WHERE e.current_holder_id = $1 AND e.status = 'issued'
      ORDER BY e.name
    `, [holderId]);
    
    return { success: true, equipment: result.rows };
  });
  
  // ============================================
  // ПРЕДСТОЯЩЕЕ ТО / ПОВЕРКИ
  // ============================================
  
  fastify.get('/maintenance/upcoming', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const result = await db.query(`
      SELECT e.*, c.name as category_name, c.icon as category_icon,
        u.name as holder_name
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      LEFT JOIN users u ON e.current_holder_id = u.id
      WHERE e.status != 'written_off'
        AND (
          e.next_maintenance <= CURRENT_DATE + INTERVAL '14 days'
          OR e.next_calibration <= CURRENT_DATE + INTERVAL '14 days'
          OR e.warranty_end <= CURRENT_DATE + INTERVAL '30 days'
        )
      ORDER BY COALESCE(e.next_maintenance, e.next_calibration, e.warranty_end)
    `);
    
    return { success: true, equipment: result.rows };
  });
  
  // ============================================
  // ДОСТУПНОЕ ДЛЯ БРОНИРОВАНИЯ
  // ============================================
  
  fastify.get('/available', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { from, to, category_id } = request.query;
    
    let sql = `
      SELECT e.*, c.name as category_name, c.icon as category_icon
      FROM equipment e
      LEFT JOIN equipment_categories c ON e.category_id = c.id
      WHERE e.status = 'on_warehouse'
    `;
    const params = [];
    
    if (category_id) {
      params.push(category_id);
      sql += ` AND e.category_id = $${params.length}`;
    }
    
    // Исключаем забронированные на эти даты
    if (from && to) {
      params.push(from, to);
      sql += ` AND e.id NOT IN (
        SELECT equipment_id FROM equipment_reservations
        WHERE status = 'active'
          AND (reserved_from, reserved_to) OVERLAPS ($${params.length-1}::date, $${params.length}::date)
      )`;
    }
    
    sql += ' ORDER BY e.name';
    
    const result = await db.query(sql, params);
    return { success: true, equipment: result.rows };
  });
  
  // ============================================
  // СТАТИСТИКА СКЛАДА (с балансовой стоимостью)
  // ============================================
  
  fastify.get('/stats/summary', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    
    // Пересчитываем амортизацию для актуальных данных
    try {
      await db.query('SELECT recalculate_all_depreciation()');
    } catch(e) {}
    
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'on_warehouse') as on_warehouse,
        COUNT(*) FILTER (WHERE status = 'issued') as issued,
        COUNT(*) FILTER (WHERE status = 'repair') as in_repair,
        COUNT(*) FILTER (WHERE status = 'broken') as broken,
        COALESCE(SUM(purchase_price), 0) as total_purchase_value,
        COALESCE(SUM(book_value), 0) as total_book_value,
        COALESCE(SUM(accumulated_depreciation), 0) as total_depreciation,
        COALESCE(SUM(book_value) FILTER (WHERE status = 'issued'), 0) as issued_value
      FROM equipment WHERE status != 'written_off'
    `);
    
    const byCategory = await db.query(`
      SELECT c.name, c.icon, 
        COUNT(e.id) as count,
        COALESCE(SUM(e.book_value), 0) as book_value
      FROM equipment_categories c
      LEFT JOIN equipment e ON e.category_id = c.id AND e.status != 'written_off'
      GROUP BY c.id, c.name, c.icon
      ORDER BY count DESC
    `);
    
    const byHolder = await db.query(`
      SELECT u.name, COUNT(e.id) as count, COALESCE(SUM(e.book_value), 0) as value
      FROM users u
      INNER JOIN equipment e ON e.current_holder_id = u.id AND e.status = 'issued'
      GROUP BY u.id, u.name
      ORDER BY value DESC
      LIMIT 10
    `);
    
    // Для директоров показываем полную информацию
    const showFinancials = hasFullAccess(user.role);
    
    const result = {
      success: true, 
      stats: {
        total: parseInt(stats.rows[0].total || 0),
        on_warehouse: parseInt(stats.rows[0].on_warehouse || 0),
        issued: parseInt(stats.rows[0].issued || 0),
        in_repair: parseInt(stats.rows[0].in_repair || 0),
        broken: parseInt(stats.rows[0].broken || 0)
      },
      byCategory: byCategory.rows,
      byHolder: byHolder.rows
    };
    
    if (showFinancials) {
      result.stats.total_purchase_value = parseFloat(stats.rows[0].total_purchase_value || 0);
      result.stats.total_book_value = parseFloat(stats.rows[0].total_book_value || 0);
      result.stats.total_depreciation = parseFloat(stats.rows[0].total_depreciation || 0);
      result.stats.issued_value = parseFloat(stats.rows[0].issued_value || 0);
    }
    
    return result;
  });
  
  // ============================================
  // ОТКЛОНЕНИЕ ЗАПРОСА
  // ============================================
  
  fastify.post('/requests/:id/reject', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { reason } = request.body;
    const user = request.user;
    
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }
    
    await db.query(`
      UPDATE equipment_requests SET 
        status = 'rejected', 
        reject_reason = $1,
        processed_by = $2, 
        processed_at = NOW() 
      WHERE id = $3
    `, [reason, user.id, id]);
    
    return { success: true, message: 'Запрос отклонён' };
  });
  
  // ============================================
  // ЗАПРОС НА ВЫДАЧУ (ОТ РП)
  // ============================================
  
  fastify.post('/request-issue', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const { equipment_id, work_id, object_id, quantity, notes } = request.body;
    
    if (!work_id) {
      return reply.code(400).send({ success: false, message: 'Укажите работу' });
    }
    
    const result = await db.query(`
      INSERT INTO equipment_requests (
        equipment_id, requester_id, work_id, object_id, quantity, notes
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [equipment_id, user.id, work_id, object_id, quantity || 1, notes]);
    
    return { success: true, request: result.rows[0], message: 'Запрос создан' };
  });
  
  // ============================================
  // ОТПРАВКА В РЕМОНТ
  // ============================================
  
  fastify.post('/repair', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const { equipment_id, notes } = request.body;
    
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }
    
    const equip = await db.query('SELECT * FROM equipment WHERE id = $1', [equipment_id]);
    if (equip.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Оборудование не найдено' });
    }
    
    const eq = equip.rows[0];
    
    // Создаём перемещение
    await db.query(`
      INSERT INTO equipment_movements (
        equipment_id, movement_type,
        from_warehouse_id, from_holder_id,
        notes, created_by
      ) VALUES ($1, 'repair_start', $2, $3, $4, $5)
    `, [equipment_id, eq.warehouse_id, eq.current_holder_id, notes, user.id]);
    
    // Обновляем статус
    await db.query(`
      UPDATE equipment SET
        status = 'repair',
        updated_at = NOW()
      WHERE id = $1
    `, [equipment_id]);
    
    return { success: true, message: 'Оборудование отправлено в ремонт' };
  });
  
  // ============================================
  // ЗАВЕРШЕНИЕ РЕМОНТА
  // ============================================
  
  fastify.post('/repair-complete', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const { equipment_id, condition_after, notes } = request.body;
    
    if (!isWarehouseAdmin(user.role)) {
      return reply.code(403).send({ success: false, message: 'Нет прав' });
    }
    
    // Получаем главный склад
    const warehouseResult = await db.query('SELECT id FROM warehouses WHERE is_main = true LIMIT 1');
    const warehouseId = warehouseResult.rows[0]?.id || 1;
    
    // Создаём перемещение
    await db.query(`
      INSERT INTO equipment_movements (
        equipment_id, movement_type,
        to_warehouse_id, condition_after,
        notes, created_by
      ) VALUES ($1, 'repair_end', $2, $3, $4, $5)
    `, [equipment_id, warehouseId, condition_after || 'good', notes, user.id]);
    
    // Обновляем статус
    await db.query(`
      UPDATE equipment SET
        status = 'on_warehouse',
        warehouse_id = $1,
        condition = COALESCE($2, 'good'),
        current_holder_id = NULL,
        current_object_id = NULL,
        updated_at = NOW()
      WHERE id = $3
    `, [warehouseId, condition_after, equipment_id]);
    
    return { success: true, message: 'Ремонт завершён, оборудование на складе' };
  });
}

  // ═══════════════════════════════════════════════════════════════
  // M15: Аналитика склада для главного инженера
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/analytics/by-pm', {
    preHandler: [fastify.requireRoles(['CHIEF_ENGINEER', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    // Оборудование по каждому РП (current_holder_id)
    const byPm = await db.query(`
      SELECT
        u.id as pm_id,
        u.name as pm_name,
        COUNT(e.id) as equipment_count,
        COALESCE(SUM(e.book_value), 0) as total_value,
        COUNT(e.id) FILTER (WHERE e.status = 'issued') as issued,
        COUNT(e.id) FILTER (WHERE e.status = 'repair') as in_repair,
        json_agg(json_build_object(
          'id', e.id,
          'name', e.name,
          'inventory_number', e.inventory_number,
          'category_id', e.category_id,
          'status', e.status,
          'book_value', e.book_value,
          'serial_number', e.serial_number
        ) ORDER BY e.name) FILTER (WHERE e.id IS NOT NULL) as equipment_list
      FROM users u
      LEFT JOIN equipment e ON e.current_holder_id = u.id AND e.status IN ('issued', 'repair')
      WHERE u.role IN ('PM', 'HEAD_PM') AND u.is_active = true
      GROUP BY u.id, u.name
      HAVING COUNT(e.id) > 0
      ORDER BY total_value DESC
    `);

    // Движение за последние 30 дней
    const movements = await db.query(`
      SELECT
        em.movement_type,
        COUNT(*) as count,
        TO_CHAR(em.created_at, 'YYYY-MM-DD') as date
      FROM equipment_movements em
      WHERE em.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY em.movement_type, TO_CHAR(em.created_at, 'YYYY-MM-DD')
      ORDER BY date
    `);

    // Оборудование требующее ТО
    const needsMaintenance = await db.query(`
      SELECT e.id, e.name, e.inventory_number, e.next_maintenance_date,
        u.name as holder_name
      FROM equipment e
      LEFT JOIN users u ON e.current_holder_id = u.id
      WHERE e.next_maintenance IS NOT NULL
        AND e.next_maintenance <= NOW() + INTERVAL '30 days'
        AND e.status != 'written_off'
      ORDER BY e.next_maintenance
      LIMIT 50
    `);

    return {
      byPm: byPm.rows,
      movements: movements.rows,
      needsMaintenance: needsMaintenance.rows
    };
  });
}

module.exports = equipmentRoutes;
