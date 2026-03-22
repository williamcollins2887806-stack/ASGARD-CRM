/**
 * Worker Profiles Routes — Анкета-характеристика сотрудника
 */
async function routes(fastify, options) {
  const db = fastify.db;

  // GET / — список всех анкет
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { rows } = await db.query(`
      SELECT wp.*,
             u.name AS user_name, u.avatar_url AS user_avatar, u.role AS user_role,
             cb.name AS created_by_name,
             ub.name AS updated_by_name
      FROM worker_profiles wp
      LEFT JOIN users u ON u.id = wp.user_id
      LEFT JOIN users cb ON cb.id = wp.created_by
      LEFT JOIN users ub ON ub.id = wp.updated_by
      ORDER BY wp.updated_at DESC
    `);
    return { rows };
  });

  // GET /:id — анкета по user_id или employee_id
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!id) return reply.code(400).send({ error: 'Неверный id' });

    const lookupBy = request.query.by || 'user'; // ?by=employee

    // Ищем профиль: сначала по user_id, потом по employee_id
    let rows;
    if (lookupBy === 'employee') {
      // Запрос по employee_id: сначала пробуем найти user_id через employees
      const empRes = await db.query('SELECT user_id, fio FROM employees WHERE id = $1', [id]);
      const emp = empRes.rows[0];
      if (!emp) return reply.code(404).send({ error: 'Сотрудник не найден' });

      let result;
      // Если есть user_id — ищем по нему
      if (emp.user_id) {
        result = await db.query(`
          SELECT wp.*,
                 u.name AS user_name, u.avatar_url AS user_avatar, u.role AS user_role, u.login,
                 cb.name AS created_by_name, ub.name AS updated_by_name
          FROM worker_profiles wp
          LEFT JOIN users u ON u.id = wp.user_id
          LEFT JOIN users cb ON cb.id = wp.created_by
          LEFT JOIN users ub ON ub.id = wp.updated_by
          WHERE wp.user_id = $1
        `, [emp.user_id]);
      }

      // Если не нашли по user_id — ищем по employee_id
      if (!result || !result.rows.length) {
        result = await db.query(`
          SELECT wp.*,
                 u.name AS user_name, u.avatar_url AS user_avatar, u.role AS user_role, u.login,
                 cb.name AS created_by_name, ub.name AS updated_by_name
          FROM worker_profiles wp
          LEFT JOIN users u ON u.id = wp.user_id
          LEFT JOIN users cb ON cb.id = wp.created_by
          LEFT JOIN users ub ON ub.id = wp.updated_by
          WHERE wp.employee_id = $1
        `, [id]);
      }

      rows = result.rows;

      if (!rows.length) {
        // Профиля нет — возвращаем данные сотрудника для создания
        const user = emp.user_id
          ? (await db.query('SELECT id, name, avatar_url, role, login FROM users WHERE id = $1', [emp.user_id])).rows[0]
          : null;
        return {
          profile: null,
          user: user || { id: emp.user_id || null, name: emp.fio || null },
          employee_id: id
        };
      }

      return {
        profile: rows[0],
        user: { id: rows[0].user_id, name: rows[0].user_name, avatar_url: rows[0].user_avatar, role: rows[0].user_role },
        employee_id: id
      };

    } else {
      // Классический lookup по user_id
      const result = await db.query(`
        SELECT wp.*,
               u.name AS user_name, u.avatar_url AS user_avatar, u.role AS user_role, u.login,
               cb.name AS created_by_name, ub.name AS updated_by_name
        FROM worker_profiles wp
        JOIN users u ON u.id = wp.user_id
        LEFT JOIN users cb ON cb.id = wp.created_by
        LEFT JOIN users ub ON ub.id = wp.updated_by
        WHERE wp.user_id = $1
      `, [id]);
      rows = result.rows;

      if (!rows.length) {
        const userRes = await db.query('SELECT id, name, avatar_url, role, login FROM users WHERE id = $1', [id]);
        if (!userRes.rows.length) return reply.code(404).send({ error: 'Пользователь не найден' });
        return { profile: null, user: userRes.rows[0] };
      }

      return { profile: rows[0], user: { id: id, name: rows[0].user_name, avatar_url: rows[0].user_avatar, role: rows[0].user_role } };
    }
  });

  // PUT /:id — upsert анкеты (поддерживает user_id и employee_id)
  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!id) return reply.code(400).send({ error: 'Неверный id' });

    const { data, filled_count, total_count, overall_score, employee_id } = request.body || {};
    const photo_url = request.body && request.body.hasOwnProperty('photo_url') ? request.body.photo_url : undefined;
    const hasPhoto = request.body && request.body.hasOwnProperty('photo_url');
    const lookupBy = request.query.by || 'user';

    let userId = lookupBy === 'employee' ? null : id;
    let empId = lookupBy === 'employee' ? id : (employee_id || null);

    // Если ищем по employee — попробуем определить user_id
    if (lookupBy === 'employee' && !userId) {
      const empRes = await db.query('SELECT user_id FROM employees WHERE id = $1', [id]);
      if (empRes.rows[0] && empRes.rows[0].user_id) {
        userId = empRes.rows[0].user_id;
      }
    }

    // Проверяем существующий профиль
    let existing = null;
    if (userId) {
      const res = await db.query('SELECT id FROM worker_profiles WHERE user_id = $1', [userId]);
      existing = res.rows[0];
    }
    if (!existing && empId) {
      const res = await db.query('SELECT id FROM worker_profiles WHERE employee_id = $1', [empId]);
      existing = res.rows[0];
    }

    let result;
    if (existing) {
      // UPDATE
      result = await db.query(`
        UPDATE worker_profiles SET
          data = $1,
          filled_count = $2,
          total_count = $3,
          overall_score = $4,
          photo_url = ${hasPhoto ? '$5' : 'COALESCE($5, photo_url)'},
          employee_id = COALESCE($6, employee_id),
          user_id = COALESCE($7, user_id),
          updated_by = $8,
          updated_at = NOW()
        WHERE id = $9
        RETURNING *
      `, [JSON.stringify(data || {}), filled_count || 0, total_count || 20, overall_score || null,
          photo_url || null, empId, userId, request.user.id, existing.id]);
    } else {
      // INSERT
      result = await db.query(`
        INSERT INTO worker_profiles (user_id, employee_id, data, filled_count, total_count, overall_score, photo_url, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        RETURNING *
      `, [userId, empId, JSON.stringify(data || {}), filled_count || 0, total_count || 20,
          overall_score || null, photo_url || null, request.user.id]);
    }

    return { success: true, profile: result.rows[0] };
  });
}

module.exports = routes;
