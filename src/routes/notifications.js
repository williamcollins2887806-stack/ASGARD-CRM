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
    const { user_id, title, message, type, link } = request.body;
    
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
      } catch(e) { fastify.log.error('Telegram send error:', e.message); }
      
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
    } catch(e) { fastify.log.error('Telegram send error:', e.message); }
    
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
      } catch(e) { fastify.log.error('Telegram send error:', e.message); }
      
      sent++;
    }
    
    return { message: `Отправлено ${sent} уведомлений` };
  });

  // ─── Flush: отправить ВСЕ непрочитанные в Telegram ───────────────────────
  fastify.post('/flush-telegram', { preHandler: [fastify.authenticate] }, async (request) => {
    if (!['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(request.user.role)) {
      return { error: 'Недостаточно прав' };
    }

    const telegram = require('../services/telegram');
    const bot = telegram.getBot();
    if (!bot) {
      return { error: 'Telegram бот не настроен. Установите TELEGRAM_BOT_TOKEN в .env' };
    }

    // Найти всех пользователей с привязанным Telegram
    const linkedUsers = await db.query(
      'SELECT id, name, telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL AND is_active = true'
    );

    if (linkedUsers.rows.length === 0) {
      return { error: 'Нет пользователей с привязанным Telegram. Каждый пользователь должен написать боту /link свой_email' };
    }

    let totalSent = 0;
    let totalFailed = 0;
    const errors = [];

    for (const user of linkedUsers.rows) {
      // Получить непрочитанные уведомления этого пользователя
      const unread = await db.query(
        'SELECT id, title, message FROM notifications WHERE user_id = $1 AND is_read = false ORDER BY created_at DESC LIMIT 50',
        [user.id]
      );

      if (unread.rows.length === 0) continue;

      // Отправить сводку вместо каждого по отдельности
      let summary = `📬 *У вас ${unread.rows.length} непрочитанных уведомлений:*\n\n`;
      unread.rows.slice(0, 20).forEach((n, i) => {
        summary += `${i + 1}. *${n.title || 'Уведомление'}*\n   ${(n.message || '').slice(0, 100)}\n\n`;
      });
      if (unread.rows.length > 20) {
        summary += `...и ещё ${unread.rows.length - 20}\n`;
      }
      summary += '\n🔗 Откройте CRM для подробностей';

      try {
        await telegram.sendNotification(user.id, summary);
        totalSent++;
      } catch (e) {
        totalFailed++;
        errors.push(`${user.name}: ${e.message}`);
      }
    }

    return {
      success: true,
      linked_users: linkedUsers.rows.length,
      sent: totalSent,
      failed: totalFailed,
      errors: errors.length > 0 ? errors : undefined
    };
  });

  // ─── Диагностика Telegram ───────────────────────────────────────────────
  fastify.get('/telegram-status', { preHandler: [fastify.authenticate] }, async (request) => {
    const telegram = require('../services/telegram');
    const bot = telegram.getBot();

    const linkedUsers = await db.query(
      'SELECT id, name, telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL AND is_active = true'
    );

    const unreadCount = await db.query(
      'SELECT COUNT(*) FROM notifications WHERE is_read = false'
    );

    return {
      bot_active: !!bot,
      bot_token_set: !!process.env.TELEGRAM_BOT_TOKEN,
      linked_users: linkedUsers.rows.map(u => ({ id: u.id, name: u.name, chat_id: u.telegram_chat_id })),
      linked_count: linkedUsers.rows.length,
      total_unread: parseInt(unreadCount.rows[0].count, 10)
    };
  });
}

module.exports = routes;
