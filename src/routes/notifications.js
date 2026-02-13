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

  // Создать уведомление (внутренний API)
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { user_id, title, message, type, link, link_hash } = request.body;

    // Сохраняем в БД
    const result = await db.query(`
      INSERT INTO notifications (user_id, title, message, type, link, link_hash, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
      RETURNING *
    `, [user_id, title, message, type || 'info', link || null, link_hash || null]);
    
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
  fastify.post('/telegram', { preHandler: [fastify.authenticate] }, async (request) => {
    const { userId, message } = request.body;
    
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
  fastify.post('/approval', { preHandler: [fastify.authenticate] }, async (request) => {
    const { type, action, entityId, toUserId, details } = request.body;
    
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
