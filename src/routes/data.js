/**
 * ASGARD CRM - Universal Data API v2.3
 * Единый CRUD endpoint для всех таблиц
 * SECURITY: Добавлена ролевая матрица доступа (CRIT-3)
 */

async function dataRoutes(fastify, options) {
  const db = fastify.db;

  // Разрешённые таблицы (защита от SQL injection)
  const ALLOWED_TABLES = [
    'users', 'settings', 'tenders', 'estimates', 'works',
    'work_assign_requests', 'pm_consents', 'work_expenses', 'office_expenses',
    'correspondence', 'travel_expenses', 'incomes', 'calendar_events',
    'contracts', 'seals', 'seal_transfers', 'employee_permits', 'bonus_requests',
    'sync_meta', 'chats', 'chat_messages', 'call_history', 'user_call_status',
    'user_dashboard', 'bank_rules', 'customers', 'staff', 'staff_plan',
    'employees', 'employee_reviews', 'customer_reviews', 'employee_assignments',
    'employee_plan', 'staff_requests', 'staff_request_messages', 'staff_replacements',
    'purchase_requests', 'qa_messages', 'doc_sets', 'documents', 'audit_log',
    'notifications', 'acts', 'invoices', 'invoice_payments', 'email_history',
    'email_queue', 'reminders', 'equipment', 'equipment_movements',
    'equipment_requests', 'equipment_maintenance', 'equipment_reservations',
    'equipment_categories', 'warehouses', 'objects'
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
        'tenders', 'estimates', 'works', 'work_expenses', 'work_assign_requests',
        'pm_consents', 'correspondence', 'travel_expenses', 'contracts',
        'calendar_events', 'customers', 'documents', 'chats', 'chat_messages',
        'equipment', 'equipment_movements', 'equipment_requests',
        'equipment_reservations', 'acts', 'invoices', 'notifications',
        'sync_meta', 'employee_assignments', 'employee_plan', 'reminders',
        'bonus_requests', 'doc_sets', 'qa_messages', 'user_dashboard'
      ],
      ops: ['read', 'create', 'update']
    },
    TO: {
      tables: [
        'tenders', 'estimates', 'customers', 'calendar_events', 'documents',
        'correspondence', 'chats', 'chat_messages', 'notifications',
        'sync_meta', 'reminders', 'doc_sets', 'user_dashboard'
      ],
      ops: ['read', 'create', 'update']
    },
    BUH: {
      tables: [
        'tenders', 'works', 'work_expenses', 'office_expenses', 'incomes',
        'invoices', 'invoice_payments', 'acts', 'contracts', 'customers',
        'bank_rules', 'calendar_events', 'chats', 'chat_messages',
        'notifications', 'sync_meta', 'reminders', 'user_dashboard'
      ],
      ops: ['read', 'create', 'update']
    },
    HR: {
      tables: [
        'employees', 'employee_reviews', 'employee_assignments', 'employee_plan',
        'staff', 'staff_plan', 'staff_requests', 'staff_request_messages',
        'staff_replacements', 'employee_permits', 'calendar_events',
        'chats', 'chat_messages', 'notifications', 'sync_meta', 'reminders',
        'travel_expenses', 'user_dashboard'
      ],
      ops: ['read', 'create', 'update']
    },
    OFFICE_MANAGER: {
      tables: [
        'office_expenses', 'calendar_events', 'correspondence', 'documents',
        'chats', 'chat_messages', 'notifications', 'seals', 'seal_transfers',
        'purchase_requests', 'sync_meta', 'reminders', 'contracts',
        'travel_expenses', 'doc_sets', 'user_dashboard'
      ],
      ops: ['read', 'create', 'update']
    },
    WAREHOUSE: {
      tables: [
        'equipment', 'equipment_categories', 'equipment_movements',
        'equipment_requests', 'equipment_maintenance', 'equipment_reservations',
        'warehouses', 'objects', 'chats', 'chat_messages', 'notifications',
        'sync_meta', 'reminders', 'user_dashboard'
      ],
      ops: ['read', 'create', 'update']
    },
    PROC: {
      tables: [
        'purchase_requests', 'equipment', 'equipment_categories',
        'invoices', 'invoice_payments', 'documents', 'calendar_events',
        'chats', 'chat_messages', 'notifications', 'sync_meta', 'reminders',
        'user_dashboard'
      ],
      ops: ['read', 'create', 'update']
    }
  };

  // Таблицы, запрещённые для записи через data API (всегда)
  const WRITE_PROTECTED_TABLES = ['audit_log', 'users'];

  // Таблицы, запрещённые для чтения через data API (кроме ADMIN/DIRECTOR)
  const READ_SENSITIVE_TABLES = ['users', 'audit_log'];

  function checkAccess(role, table, operation) {
    // ADMIN и DIRECTOR_GEN имеют полный доступ
    if (role === 'ADMIN' || role === 'DIRECTOR_GEN') {
      return true;
    }

    // Защита от записи в критичные таблицы
    if (WRITE_PROTECTED_TABLES.includes(table) && operation !== 'read') {
      return false;
    }

    // Защита чувствительных таблиц от чтения
    if (READ_SENSITIVE_TABLES.includes(table) && !['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role)) {
      return false;
    }

    const matrix = ACCESS_MATRIX[role];
    if (!matrix) return false;

    const tablesAllowed = matrix.tables === 'all' || matrix.tables.includes(table);
    const opsAllowed = matrix.ops.includes(operation);

    return tablesAllowed && opsAllowed;
  }

  // ═══════════════════════════════════════════════════════════════════════════

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
    return ALLOWED_TABLES.includes(table);
  }

  function getPrimaryKey(table) {
    return SPECIAL_KEYS[table] || 'id';
  }

  function getDefaultOrder(table) {
    if (NO_ID_TABLES.includes(table)) {
      return 'created_at DESC NULLS LAST';
    }
    return 'id DESC';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/data/:table - Получить все записи
  // SECURITY: Проверка ролевого доступа (CRIT-3)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:table', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table } = request.params;
    const { limit = 10000, offset = 0, orderBy, desc, where } = request.query;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    // SECURITY: Проверка ролевого доступа
    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'read')) {
      return reply.code(403).send({ error: 'Нет доступа к таблице ' + table });
    }

    try {
      let query = `SELECT * FROM ${table}`;
      const params = [];
      let whereParts = [];

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
          if (whereParts.length > 0) {
            query += ' WHERE ' + whereParts.join(' AND ');
          }
        } catch(e) {}
      }

      // ORDER BY
      if (orderBy && /^[a-z_]+$/i.test(orderBy)) {
        query += ` ORDER BY ${orderBy} ${desc === 'true' ? 'DESC' : 'ASC'}`;
      } else {
        query += ` ORDER BY ${getDefaultOrder(table)}`;
      }

      // LIMIT/OFFSET
      query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      const dataParams = [...params, parseInt(limit), parseInt(offset)];

      const result = await db.query(query, dataParams);

      // SECURITY FIX (MED-7): COUNT с теми же WHERE-условиями
      let countQuery = `SELECT COUNT(*) as total FROM ${table}`;
      if (whereParts.length > 0) {
        countQuery += ' WHERE ' + whereParts.join(' AND ');
      }
      const countResult = await db.query(countQuery, params);

      return {
        [table]: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset)
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

    const pk = getPrimaryKey(table);

    try {
      const result = await db.query(`SELECT * FROM ${table} WHERE ${pk} = $1`, [id]);

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

    // SECURITY: Проверка ролевого доступа
    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'create')) {
      return reply.code(403).send({ error: 'Нет прав на создание записей в таблице ' + table });
    }

    const pk = getPrimaryKey(table);

    try {
      // Добавляем метаданные
      data.created_at = data.created_at || new Date().toISOString();
      data.updated_at = new Date().toISOString();
      // SECURITY: Добавляем created_by если не указан
      if (!data.created_by && request.user.id) {
        data.created_by = request.user.id;
      }

      // Удаляем id только если это autoincrement таблица
      if (pk === 'id') {
        delete data.id;
      }

      const keys = Object.keys(data).filter(k => /^[a-z_]+$/i.test(k));
      const values = keys.map(k => data[k]);
      const placeholders = keys.map((_, i) => `$${i + 1}`);

      const query = `
        INSERT INTO ${table} (${keys.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING *
      `;

      const result = await db.query(query, values);

      return { success: true, item: result.rows[0], id: result.rows[0][pk] };
    } catch(err) {
      fastify.log.error(`Data API POST [${table}]: ${err.message}`, { stack: err.stack, code: err.code });
      return reply.code(500).send({ error: 'Ошибка обработки запроса', details: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PUT /api/data/:table/:id - Обновить запись
  // SECURITY: Проверка ролевого доступа (CRIT-3)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.put('/:table/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table, id } = request.params;
    const data = request.body;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    // SECURITY: Проверка ролевого доступа
    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'update')) {
      return reply.code(403).send({ error: 'Нет прав на обновление записей в таблице ' + table });
    }

    const pk = getPrimaryKey(table);

    try {
      data.updated_at = new Date().toISOString();
      delete data[pk]; // Не обновляем первичный ключ
      delete data.id;  // И id тоже
      delete data.created_at; // Не меняем дату создания
      delete data.created_by; // Не меняем автора

      const keys = Object.keys(data).filter(k => /^[a-z_]+$/i.test(k));
      const values = keys.map(k => data[k]);
      const setParts = keys.map((k, i) => `${k} = $${i + 1}`);

      const query = `
        UPDATE ${table}
        SET ${setParts.join(', ')}
        WHERE ${pk} = $${keys.length + 1}
        RETURNING *
      `;

      values.push(id);
      const result = await db.query(query, values);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Запись не найдена' });
      }

      return { success: true, item: result.rows[0] };
    } catch(err) {
      fastify.log.error(`Data API PUT [${table}]:`, err.message);
      return reply.code(500).send({ error: 'Ошибка обработки запроса' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE /api/data/:table/:id - Удалить запись
  // SECURITY: Проверка ролевого доступа (CRIT-3)
  // ─────────────────────────────────────────────────────────────────────────────
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

    const pk = getPrimaryKey(table);

    try {
      const result = await db.query(`DELETE FROM ${table} WHERE ${pk} = $1 RETURNING *`, [id]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Запись не найдена' });
      }

      return { success: true, deleted: true };
    } catch(err) {
      fastify.log.error(`Data API DELETE [${table}]:`, err.message);
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

    try {
      const result = await db.query(
        `SELECT * FROM ${table} WHERE ${index} = $1 ORDER BY ${getDefaultOrder(table)}`,
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

    try {
      const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
      return { count: parseInt(result.rows[0].count) };
    } catch(err) {
      fastify.log.error(`Data API count [${table}]:`, err.message);
      return reply.code(500).send({ error: 'Ошибка обработки запроса' });
    }
  });
}

module.exports = dataRoutes;
