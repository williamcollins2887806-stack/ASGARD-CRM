/**
 * ASGARD CRM - Universal Data API v2.2
 * Единый CRUD endpoint для всех таблиц
 * ИСПРАВЛЕНО: добавлен employee_plan
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
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:table', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table } = request.params;
    const { limit = 10000, offset = 0, orderBy, desc, where } = request.query;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    try {
      let query = `SELECT * FROM ${table}`;
      const params = [];

      // WHERE условие (простое)
      if (where) {
        try {
          const conditions = JSON.parse(where);
          const whereParts = [];
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
      params.push(parseInt(limit), parseInt(offset));

      const result = await db.query(query, params);

      // Считаем общее количество
      let countQuery = `SELECT COUNT(*) as total FROM ${table}`;
      const countResult = await db.query(countQuery);

      return {
        [table]: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset)
      };
    } catch(err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/data/:table/:id - Получить одну запись
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:table/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table, id } = request.params;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    const pk = getPrimaryKey(table);

    try {
      const result = await db.query(`SELECT * FROM ${table} WHERE ${pk} = $1`, [id]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Запись не найдена' });
      }

      return { item: result.rows[0] };
    } catch(err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/data/:table - Создать запись
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:table', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table } = request.params;
    const data = request.body;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    const pk = getPrimaryKey(table);

    try {
      // Добавляем метаданные
      data.created_at = data.created_at || new Date().toISOString();
      data.updated_at = new Date().toISOString();

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
      fastify.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PUT /api/data/:table/:id - Обновить запись
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.put('/:table/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table, id } = request.params;
    const data = request.body;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    const pk = getPrimaryKey(table);

    try {
      data.updated_at = new Date().toISOString();
      delete data[pk]; // Не обновляем первичный ключ
      delete data.id;  // И id тоже

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
      fastify.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE /api/data/:table/:id - Удалить запись
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.delete('/:table/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table, id } = request.params;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    const pk = getPrimaryKey(table);

    try {
      const result = await db.query(`DELETE FROM ${table} WHERE ${pk} = $1 RETURNING *`, [id]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Запись не найдена' });
      }

      return { success: true, deleted: true };
    } catch(err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/data/:table/by-index - Поиск по индексу
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:table/by-index', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table } = request.params;
    const { index, value } = request.body;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
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
      fastify.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/data/:table/count - Количество записей
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:table/count', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { table } = request.params;

    if (!isAllowed(table)) {
      return reply.code(400).send({ error: 'Недопустимая таблица' });
    }

    try {
      const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
      return { count: parseInt(result.rows[0].count) };
    } catch(err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });
}

module.exports = dataRoutes;
