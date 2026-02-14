/**
 * Chat Groups Routes - Group chat management
 * Schema: chats(id, name, type, created_by), chat_messages(id, chat_id INT, user_id, message, is_read),
 *         chat_group_members(id, chat_id, user_id, joined_at)
 */
async function routes(fastify, options) {
  const db = fastify.db;

  // GET /api/chat-groups - Список групповых чатов пользователя
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const result = await db.query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM chat_messages cm WHERE cm.chat_id = c.id) as message_count,
        (SELECT cm.message FROM chat_messages cm WHERE cm.chat_id = c.id ORDER BY cm.created_at DESC LIMIT 1) as last_message
      FROM chats c
      WHERE c.type = 'group'
        AND (c.created_by = $1 OR EXISTS (
          SELECT 1 FROM chat_group_members gm WHERE gm.chat_id = c.id AND gm.user_id = $1
        ))
      ORDER BY c.updated_at DESC
    `, [request.user.id]);

    return { groups: result.rows };
  });

  // POST /api/chat-groups - Создать групповой чат
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { name, member_ids } = request.body;

    if (!name || !name.trim()) {
      return { error: 'Введите название группы' };
    }

    const result = await db.query(`
      INSERT INTO chats (name, type, created_by, created_at, updated_at)
      VALUES ($1, 'group', $2, NOW(), NOW())
      RETURNING *
    `, [name.trim(), request.user.id]);

    const chat = result.rows[0];

    // Добавляем создателя
    await db.query(`
      INSERT INTO chat_group_members (chat_id, user_id, joined_at)
      VALUES ($1, $2, NOW())
    `, [chat.id, request.user.id]);

    // Добавляем участников
    if (Array.isArray(member_ids)) {
      for (const uid of member_ids) {
        if (uid !== request.user.id) {
          await db.query(`
            INSERT INTO chat_group_members (chat_id, user_id, joined_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (chat_id, user_id) DO NOTHING
          `, [chat.id, uid]);
        }
      }
    }

    return { success: true, group: chat };
  });

  // GET /api/chat-groups/:id/messages
  fastify.get('/:id/messages', { preHandler: [fastify.authenticate] }, async (request) => {
    const { limit = 100, offset = 0 } = request.query;

    const result = await db.query(`
      SELECT cm.*, u.name as user_name, u.role as user_role
      FROM chat_messages cm
      LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.chat_id = $1
      ORDER BY cm.created_at ASC
      LIMIT $2 OFFSET $3
    `, [parseInt(request.params.id), parseInt(limit), parseInt(offset)]);

    return { messages: result.rows };
  });

  // POST /api/chat-groups/:id/messages - Отправить сообщение
  fastify.post('/:id/messages', { preHandler: [fastify.authenticate] }, async (request) => {
    const { text } = request.body;
    if (!text || !text.trim()) return { error: 'Пустое сообщение' };

    const result = await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, is_read, created_at)
      VALUES ($1, $2, $3, false, NOW())
      RETURNING *
    `, [parseInt(request.params.id), request.user.id, text.trim()]);

    // Обновляем время чата
    await db.query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [parseInt(request.params.id)]);

    return { success: true, message: result.rows[0] };
  });

  // POST /api/chat-groups/:id/members
  fastify.post('/:id/members', { preHandler: [fastify.authenticate] }, async (request) => {
    const { user_id } = request.body;
    await db.query(`
      INSERT INTO chat_group_members (chat_id, user_id, joined_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (chat_id, user_id) DO NOTHING
    `, [parseInt(request.params.id), user_id]);
    return { success: true };
  });

  // DELETE /api/chat-groups/:id/members/:userId
  fastify.delete('/:id/members/:userId', { preHandler: [fastify.authenticate] }, async (request) => {
    await db.query(
      'DELETE FROM chat_group_members WHERE chat_id = $1 AND user_id = $2',
      [parseInt(request.params.id), parseInt(request.params.userId)]
    );
    return { success: true };
  });
}

module.exports = routes;
