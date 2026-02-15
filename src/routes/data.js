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
    'equipment_categories', 'warehouses', 'objects',
    'employee_rates', 'payroll_sheets', 'payroll_items',
    'payment_registry', 'self_employed', 'one_time_payments',
    'permits', 'permit_types', 'permit_applications', 'permit_application_items', 'permit_application_history',
    'email_accounts', 'emails', 'email_attachments', 'email_classification_rules', 'email_templates_v2', 'email_sync_log',
    'cash_requests', 'cash_expenses', 'cash_returns', 'cash_messages',
    'tkp', 'pass_requests', 'tmc_requests',
    'pre_tender_requests', 'saved_reports', 'tasks'
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
        'users', 'employees', 'staff', 'staff_plan', 'user_call_status',
        'tenders', 'estimates', 'works', 'work_expenses', 'work_assign_requests',
        'pm_consents', 'correspondence', 'travel_expenses', 'contracts',
        'calendar_events', 'customers', 'documents', 'chats', 'chat_messages',
        'equipment', 'equipment_movements', 'equipment_requests',
        'equipment_reservations', 'acts', 'invoices', 'notifications',
        'sync_meta', 'employee_assignments', 'employee_plan', 'reminders',
        'bonus_requests', 'doc_sets', 'qa_messages', 'user_dashboard',
        'employee_rates', 'payroll_sheets', 'payroll_items', 'one_time_payments',
        'permits'
      ],
      ops: ['read', 'create', 'update']
    },
    TO: {
      tables: [
        'users', 'employees', 'works', 'invoices', 'user_call_status',
        'tenders', 'estimates', 'customers', 'calendar_events', 'documents',
        'correspondence', 'chats', 'chat_messages', 'notifications',
        'sync_meta', 'reminders', 'doc_sets', 'user_dashboard',
        'permits'
      ],
      ops: ['read', 'create', 'update']
    },
    BUH: {
      tables: [
        'users', 'employees', 'cash_requests', 'cash_expenses', 'cash_returns', 'cash_messages', 'user_call_status',
        'tenders', 'works', 'work_expenses', 'office_expenses', 'incomes',
        'invoices', 'invoice_payments', 'acts', 'contracts', 'customers',
        'bank_rules', 'calendar_events', 'chats', 'chat_messages',
        'notifications', 'sync_meta', 'reminders', 'user_dashboard',
        'employee_rates', 'payroll_sheets', 'payroll_items',
        'payment_registry', 'self_employed', 'one_time_payments'
      ],
      ops: ['read', 'create', 'update']
    },
    HR: {
      tables: [
        'users', 'tenders', 'works', 'user_call_status',
        'employees', 'employee_reviews', 'employee_assignments', 'employee_plan',
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
        'users', 'employees', 'staff', 'staff_plan',
        'office_expenses', 'calendar_events', 'correspondence', 'documents',
        'chats', 'chat_messages', 'notifications', 'seals', 'seal_transfers',
        'purchase_requests', 'sync_meta', 'reminders', 'contracts',
        'travel_expenses', 'doc_sets', 'user_dashboard'
      ],
      ops: ['read', 'create', 'update']
    },
    WAREHOUSE: {
      tables: [
        'users',
        'equipment', 'equipment_categories', 'equipment_movements',
        'equipment_requests', 'equipment_maintenance', 'equipment_reservations',
        'warehouses', 'objects', 'chats', 'chat_messages', 'notifications',
        'sync_meta', 'reminders', 'user_dashboard'
      ],
      ops: ['read', 'create', 'update']
    },
    PROC: {
      tables: [
        'users',
        'purchase_requests', 'equipment', 'equipment_categories',
        'invoices', 'invoice_payments', 'documents', 'calendar_events',
        'chats', 'chat_messages', 'notifications', 'sync_meta', 'reminders',
        'user_dashboard'
      ],
      ops: ['read', 'create', 'update']
    },
    HEAD_PM: {
      tables: [
        'users', 'employees', 'works', 'tenders', 'estimates',
        'work_expenses', 'work_assign_requests', 'pm_consents',
        'contracts', 'customers', 'calendar_events', 'documents',
        'chats', 'chat_messages', 'notifications', 'sync_meta', 'reminders',
        'acts', 'invoices', 'user_dashboard', 'employee_assignments',
        'employee_plan', 'bonus_requests', 'doc_sets', 'qa_messages',
        'employee_rates', 'payroll_sheets', 'payroll_items', 'one_time_payments'
      ],
      ops: ['read', 'create', 'update']
    }
  };

  // Таблицы, запрещённые для записи через data API (всегда)
  const WRITE_PROTECTED_TABLES = ['audit_log', 'users'];

  // Таблицы, запрещённые для чтения через data API (кроме ADMIN/DIRECTOR)
  // users убран: HIDDEN_COLS уже скрывает password_hash/pin_hash, а ФИО нужны всем ролям
  const READ_SENSITIVE_TABLES = ['audit_log'];

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
  async function getTableColumns(table) {
    if (_columnCache[table]) return _columnCache[table];
    const result = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    const cols = new Set(result.rows.map(r => r.column_name));
    _columnCache[table] = cols;
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
    const { limit: rawLimit = 500, offset: rawOffset = 0, orderBy, desc, where } = request.query;
    const limit = Math.max(1, Math.min(parseInt(rawLimit) || 500, 500)); // B9: cap at 500, floor at 1
    const offset = Math.max(parseInt(rawOffset) || 0, 0); // Sanitize offset: NaN → 0

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    // SECURITY: Проверка ролевого доступа
    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'read')) {
      return reply.code(403).send({ error: 'Нет доступа к таблице ' + table });
    }

    try {
      // SECURITY B1: Hide sensitive columns from users table
      const HIDDEN_COLS = { users: ['password_hash', 'pin_hash', 'reset_token', 'reset_token_expires', 'temp_password_hash', 'temp_password_expires'] };
      let selectCols = '*';
      if (HIDDEN_COLS[table]) {
        const colRes = await db.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name != ALL($2::text[])`,
          [table, HIDDEN_COLS[table]]
        );
        selectCols = colRes.rows.map(r => r.column_name).join(', ');
      }
      let query = `SELECT ${selectCols} FROM ${table}`;
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
      const dataParams = [...params, limit, offset];

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

    const pk = getPrimaryKey(table);

    // Validate numeric ID for integer primary keys
    if (['id', 'user_id'].includes(pk)) {
      if (isNaN(parseInt(id)) || String(id).trim() !== String(parseInt(id))) {
        return reply.code(400).send({ error: 'ID должен быть числом' });
      }
    }

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

    // Validate body is a JSON object (not string from text/plain, not null, not array)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return reply.code(400).send({ error: 'Тело запроса должно быть JSON-объектом. Укажите Content-Type: application/json' });
    }

    // SECURITY: Проверка ролевого доступа
    const userRole = request.user.role;
    if (!checkAccess(userRole, table, 'create')) {
      return reply.code(403).send({ error: 'Нет прав на создание записей в таблице ' + table });
    }

    const pk = getPrimaryKey(table);

    try {
      // Получаем реальные колонки таблицы
      const tableCols = await getTableColumns(table);

      // Truncate overly long string fields to prevent varchar overflow
      for (const key of Object.keys(data)) {
        if (typeof data[key] === 'string' && data[key].length > 1000 && !['description', 'comment', 'notes', 'details', 'message', 'text', 'body', 'content', 'data'].includes(key)) {
          data[key] = data[key].substring(0, 1000);
        }
      }

      // Добавляем метаданные (только если колонка существует)
      if (tableCols.has('created_at')) {
        data.created_at = data.created_at || new Date().toISOString();
      }
      if (tableCols.has('updated_at')) {
        data.updated_at = new Date().toISOString();
      }
      // SECURITY: Добавляем created_by если не указан и колонка существует
      if (tableCols.has('created_by') && !data.created_by && request.user.id) {
        data.created_by = request.user.id;
      }

      // Удаляем id только если это autoincrement таблица
      if (pk === 'id') {
        delete data.id;
      }

      // Фильтруем ключи: только валидные имена И существующие колонки
      const keys = Object.keys(data).filter(k => /^[a-z_]+$/i.test(k) && tableCols.has(k));
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
      console.error(`[DATA API POST] Table: ${table}, Error: ${err.message}, Code: ${err.code}`);
      console.error(`[DATA API POST] Keys: ${Object.keys(data).join(', ')}, Values:`, Object.values(data));
      console.error(`[DATA API POST] Stack:`, err.stack);
      fastify.log.error(`Data API POST [${table}]: ${err.message}`, { stack: err.stack, code: err.code });
      // VARCHAR overflow → 400
      if (err.code === '22001') {
        return reply.code(400).send({ error: 'Значение поля слишком длинное' });
      }
      // Constraint violations → 400 instead of 500
      if (err.code === '23502') {
        return reply.code(400).send({ error: `Обязательное поле не заполнено: ${err.column || err.message}` });
      }
      if (err.code === '23503') {
        return reply.code(400).send({ error: `Ссылка на несуществующую запись: ${err.detail || err.message}` });
      }
      if (err.code === '23505') {
        return reply.code(409).send({ error: `Запись уже существует: ${err.detail || err.message}` });
      }
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

    // Validate numeric ID for integer primary keys
    if (['id', 'user_id'].includes(pk)) {
      if (isNaN(parseInt(id)) || String(id).trim() !== String(parseInt(id))) {
        return reply.code(400).send({ error: 'ID должен быть числом' });
      }
    }

    try {
      // Получаем реальные колонки таблицы
      const tableCols = await getTableColumns(table);

      if (tableCols.has('updated_at')) {
        data.updated_at = new Date().toISOString();
      }
      delete data[pk]; // Не обновляем первичный ключ
      delete data.id;  // И id тоже
      delete data.created_at; // Не меняем дату создания
      delete data.created_by; // Не меняем автора

      // Фильтруем ключи: только валидные имена И существующие колонки
      const keys = Object.keys(data).filter(k => /^[a-z_]+$/i.test(k) && tableCols.has(k));
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
      console.error(`[DATA API PUT] Table: ${table}, ID: ${id}, Error: ${err.message}, Code: ${err.code}`);
      console.error(`[DATA API PUT] Stack:`, err.stack);
      fastify.log.error(`Data API PUT [${table}]:`, err.message);
      // VARCHAR overflow → 400
      if (err.code === '22001') {
        return reply.code(400).send({ error: 'Значение поля слишком длинное' });
      }
      // Constraint violations → 400
      if (err.code === '23502') {
        return reply.code(400).send({ error: `Обязательное поле не заполнено: ${err.column || err.message}` });
      }
      if (err.code === '23503') {
        return reply.code(400).send({ error: `Ссылка на несуществующую запись: ${err.detail || err.message}` });
      }
      if (err.code === '23505') {
        return reply.code(409).send({ error: `Запись уже существует: ${err.detail || err.message}` });
      }
      return reply.code(500).send({ error: 'Ошибка обработки запроса', details: err.message });
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

    // Validate numeric ID for integer primary keys
    if (['id', 'user_id'].includes(pk)) {
      if (isNaN(parseInt(id)) || String(id).trim() !== String(parseInt(id))) {
        return reply.code(400).send({ error: 'ID должен быть числом' });
      }
    }

    try {
      const result = await db.query(`DELETE FROM ${table} WHERE ${pk} = $1 RETURNING *`, [id]);

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
