'use strict';

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.authenticate] };

  // GET /api/app/updates — непросмотренные changelog записи для CRM-пользователей
  fastify.get('/updates', auth, async (req) => {
    const userId = req.user.id;

    const { rows: [seen] } = await db.query(`
      SELECT last_seen_version FROM app_update_seen
      WHERE user_id = $1 AND user_type = 'mobile'
    `, [userId]);

    const lastSeen = seen?.last_seen_version || '0.0.0';

    const { rows: updates } = await db.query(`
      SELECT id, version, title, changes, published_at
      FROM app_updates
      WHERE target IN ('mobile', 'all', 'both')
        AND version > $1
      ORDER BY published_at ASC
    `, [lastSeen]);

    return { updates, has_updates: updates.length > 0 };
  });

  // POST /api/app/updates/seen — отметить обновление просмотренным
  fastify.post('/updates/seen', auth, async (req, reply) => {
    const userId = req.user.id;
    const { version } = req.body || {};
    if (!version) return reply.code(400).send({ error: 'Укажи version' });

    await db.query(`
      INSERT INTO app_update_seen (user_id, user_type, last_seen_version, seen_at)
      VALUES ($1, 'mobile', $2, NOW())
      ON CONFLICT (user_id, user_type) DO UPDATE
        SET last_seen_version = $2, seen_at = NOW()
    `, [userId, version]);

    return { ok: true };
  });
}

module.exports = routes;
