/**
 * Notifications Routes + Telegram Integration
 */
async function routes(fastify, options) {
  const db = fastify.db;

  // Получить уведомления пользователя
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { is_read, limit = 50, offset = 0 } = request.query;
    let sql = 'SELECT * FROM notifications WHERE user_id = $1';
    const params = [request.user.id];
    let idx = 2;
    if (is_read !== undefined) { 
      sql += ` AND is_read = $${idx}`; 
      params.push(is_read === 'true'); 
      idx++; 
    }
    sql += ` ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    
    const countResult = await db.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [request.user.id]
    );
    
    return { 
      notifications: result.rows,
      unread_count: parseInt(countResult.rows[0].count, 10)
    };
  });

  // GET /api/notifications/unread-count — Количество непрочитанных уведомлений
  fastify.get('/unread-count', { preHandler: [fastify.authenticate] }, async (request) => {
    const { rows } = await db.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [request.user.id]
    );
    return { unread_count: parseInt(rows[0].count, 10) };
  });

  // Создать уведомление (внутренний API)
  // SECURITY: Проверка прав на создание уведомления (HIGH-10)
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = request.body || {};
    if (!body.user_id || !body.title || !body.message) {
      return reply.code(400).send({ error: 'Обязательные поля: user_id, title, message' });
    }
    const { user_id, title, message, type, link } = body;

    // SECURITY: Можно создавать уведомления только для себя, если не админ/директор
    const privilegedRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];
    const isPrivileged = privilegedRoles.includes(request.user.role);

    if (!isPrivileged && user_id !== request.user.id) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Нельзя создавать уведомления для других пользователей'
      });
    }

    // Сохраняем в БД
    const result = await db.query(`
      INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, false, NOW())
      RETURNING *
    `, [user_id, title, message, type || 'info', link || null]);
    
    // Отправляем в Telegram
    try {
      const telegram = require('../services/telegram');
      const tgMessage = `🔔 *${title}*\n\n${message}${link ? '\n\n🔗 Открыть в CRM' : ''}`;
      await telegram.sendNotification(user_id, tgMessage);
    } catch (e) {
      fastify.log.error('Telegram notification error:', e.message);
    }
    
    return { notification: result.rows[0] };
  });

  // Отправить уведомление в Telegram напрямую
  // SECURITY: Ограничено для админов/директоров (HIGH-10)
  fastify.post('/telegram', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { userId, message } = request.body;

    // SECURITY: Только привилегированные роли могут отправлять Telegram-уведомления другим
    const privilegedRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];
    const isPrivileged = privilegedRoles.includes(request.user.role);

    if (!isPrivileged && userId !== request.user.id) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Нельзя отправлять уведомления другим пользователям'
      });
    }

    try {
      const telegram = require('../services/telegram');
      const sent = await telegram.sendNotification(userId, message);
      return { success: sent, message: sent ? 'Отправлено' : 'Не удалось отправить' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Массовое уведомление для роли
  fastify.post('/notify-role', { preHandler: [fastify.authenticate] }, async (request) => {
    const { role, title, message, link } = request.body;
    
    // Только админы могут массово уведомлять
    if (request.user.role !== 'ADMIN') {
      return { error: 'Недостаточно прав' };
    }
    
    const users = await db.query(
      'SELECT id FROM users WHERE is_active = true AND role = ANY($1)',
      [Array.isArray(role) ? role : [role]]
    );
    
    let sent = 0;
    for (const user of users.rows) {
      // Сайт
      await db.query(`
        INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
        VALUES ($1, $2, $3, 'system', $4, false, NOW())
      `, [user.id, title, message, link]);
      
      // Telegram
      try {
        const telegram = require('../services/telegram');
        await telegram.sendNotification(user.id, `🔔 *${title}*\n\n${message}`);
      } catch(e) {}
      
      sent++;
    }
    
    return { sent };
  });

  // Уведомление о согласовании (премии, заявки и т.д.)
  // SECURITY: Только привилегированные роли могут отправлять approval-уведомления (HIGH-10)
  fastify.post('/approval', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { type, action, entityId, toUserId, details } = request.body;

    // SECURITY: Только привилегированные роли могут отправлять уведомления о согласовании
    const privilegedRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH'];
    if (!privilegedRoles.includes(request.user.role)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Недостаточно прав для отправки уведомлений о согласовании'
      });
    }
    
    const titles = {
      bonus_created: '💰 Запрос на премии',
      bonus_approved: '✅ Премии одобрены',
      bonus_rejected: '❌ Премии отклонены',
      staff_created: '👥 Заявка на персонал',
      staff_approved: '✅ Заявка одобрена',
      staff_rejected: '❌ Заявка отклонена',
      purchase_created: '🛒 Заявка на закупку',
      purchase_approved: '✅ Закупка одобрена',
      tender_handoff: '📋 Тендер на просчёт',
      chat_message: '💬 Новое сообщение'
    };
    
    const title = titles[`${type}_${action}`] || titles[type] || '🔔 Уведомление';
    
    // Сохраняем в БД
    await db.query(`
      INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, false, NOW())
    `, [toUserId, title, details || '', type, `#/${type}s/${entityId}`]);
    
    // Telegram
    try {
      const telegram = require('../services/telegram');
      await telegram.sendNotification(toUserId, `🔔 *${title}*\n\n${details || ''}`);
    } catch(e) {}
    
    return { success: true };
  });

  fastify.put('/:id/read', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query(`
      UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *
    `, [request.params.id, request.user.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { notification: result.rows[0] };
  });

  fastify.put('/read-all', { preHandler: [fastify.authenticate] }, async (request) => {
    await db.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [request.user.id]);
    return { message: 'Все отмечены как прочитанные' };
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id',
      [request.params.id, request.user.id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { message: 'Удалено' };
  });

  // Broadcast (admin only)
  fastify.post('/broadcast', { preHandler: [fastify.authenticate] }, async (request) => {
    if (request.user.role !== 'ADMIN') {
      return { error: 'Недостаточно прав' };
    }
    
    const { title, message, role } = request.body;
    
    let usersSql = 'SELECT id FROM users WHERE is_active = true';
    const params = [];
    if (role) {
      usersSql += ' AND role = $1';
      params.push(role);
    }
    
    const users = await db.query(usersSql, params);
    let sent = 0;
    
    for (const user of users.rows) {
      await db.query(`
        INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
        VALUES ($1, $2, $3, 'broadcast', false, NOW())
      `, [user.id, title, message]);
      
      // Telegram
      try {
        const telegram = require('../services/telegram');
        await telegram.sendNotification(user.id, `📢 *${title}*\n\n${message}`);
      } catch(e) {}
      
      sent++;
    }
    
    return { message: `Отправлено ${sent} уведомлений` };
  });
}

module.exports = routes;
