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

  // POST /api/stories — создать сторис (media_url/media_type + content)
  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const body = request.body || {};
    const content = body.content != null ? String(body.content) : '';
    // Accept both the new (media_url/media_type) and the legacy (image_url) field
    // so the dock composer and any old caller agree on one row.
    const mediaUrl = body.media_url || body.image_url || null;
    const mediaType = body.media_type
      || (/\.(mp4|webm|mov)(\?|$)/i.test(String(mediaUrl || '')) ? 'video' : 'image');
    const result = await db.query(
      `INSERT INTO user_stories (user_id, content, image_url, media_url, media_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [request.user.id, content, mediaUrl, mediaUrl, mediaUrl ? mediaType : 'text']
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
