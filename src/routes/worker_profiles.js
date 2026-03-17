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
      JOIN users u ON u.id = wp.user_id
      LEFT JOIN users cb ON cb.id = wp.created_by
      LEFT JOIN users ub ON ub.id = wp.updated_by
      ORDER BY wp.updated_at DESC
    `);
    return { rows };
  });

  // GET /:userId — одна анкета
  fastify.get('/:userId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = parseInt(request.params.userId, 10);
    if (!userId) return reply.code(400).send({ error: 'Неверный userId' });

    const { rows } = await db.query(`
      SELECT wp.*,
             u.name AS user_name, u.avatar_url AS user_avatar, u.role AS user_role, u.login,
             cb.name AS created_by_name,
             ub.name AS updated_by_name
      FROM worker_profiles wp
      JOIN users u ON u.id = wp.user_id
      LEFT JOIN users cb ON cb.id = wp.created_by
      LEFT JOIN users ub ON ub.id = wp.updated_by
      WHERE wp.user_id = $1
    `, [userId]);

    if (!rows.length) {
      // Вернуть базовую информацию о пользователе даже если анкеты нет
      const userRes = await db.query('SELECT id, name, avatar_url, role, login FROM users WHERE id = $1', [userId]);
      if (!userRes.rows.length) return reply.code(404).send({ error: 'Пользователь не найден' });
      return { profile: null, user: userRes.rows[0] };
    }

    return { profile: rows[0], user: { id: userId, name: rows[0].user_name, avatar_url: rows[0].user_avatar, role: rows[0].user_role } };
  });

  // PUT /:userId — upsert анкеты
  fastify.put('/:userId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = parseInt(request.params.userId, 10);
    if (!userId) return reply.code(400).send({ error: 'Неверный userId' });

    const { data, filled_count, total_count, overall_score } = request.body || {};
    const photo_url = request.body && request.body.hasOwnProperty('photo_url') ? request.body.photo_url : undefined;

    // Если photo_url передан явно (даже null) — перезаписываем; если не передан — оставляем старое
    const hasPhoto = request.body && request.body.hasOwnProperty('photo_url');

    const { rows } = await db.query(`
      INSERT INTO worker_profiles (user_id, data, filled_count, total_count, overall_score, photo_url, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      ON CONFLICT (user_id) DO UPDATE SET
        data = $2,
        filled_count = $3,
        total_count = $4,
        overall_score = $5,
        photo_url = ${hasPhoto ? '$6' : 'worker_profiles.photo_url'},
        updated_by = $7,
        updated_at = NOW()
      RETURNING *
    `, [userId, JSON.stringify(data || {}), filled_count || 0, total_count || 20, overall_score || null, photo_url || null, request.user.id]);

    return { success: true, profile: rows[0] };
  });
}

module.exports = routes;
