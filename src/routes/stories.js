'use strict';

module.exports = async function (fastify) {
  const db = fastify.db;

  // GET /api/stories — все активные (не истёкшие)
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const result = await db.query(
      `SELECT s.*, u.name as user_name, u.avatar_url
       FROM user_stories s
       JOIN users u ON s.user_id = u.id
       WHERE s.expires_at > NOW()
       ORDER BY s.created_at DESC`
    );
    return { stories: result.rows };
  });

  // POST /api/stories — создать сторис
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { content, image_url } = request.body || {};
    const result = await db.query(
      'INSERT INTO user_stories (user_id, content, image_url) VALUES ($1, $2, $3) RETURNING *',
      [request.user.id, content || '', image_url || null]
    );
    return { success: true, story: result.rows[0] };
  });

  // DELETE /api/stories/:id — удалить свою сторис
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const storyId = parseInt(request.params.id);
    const result = await db.query(
      'DELETE FROM user_stories WHERE id = $1 AND user_id = $2 RETURNING id',
      [storyId, request.user.id]
    );
    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Сторис не найдена' });
    }
    return { success: true };
  });
};
