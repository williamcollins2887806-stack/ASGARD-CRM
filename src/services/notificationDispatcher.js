/**
 * Notification Dispatcher — unified push/SMS/in-app cascade
 * ═══════════════════════════════════════════════════════════
 * Priority: Push → SMS (critical only) → in-app DB record
 *
 * Usage:
 *   const dispatcher = require('./notificationDispatcher');
 *   await dispatcher.send(db, userId, 'SHIFT_URGENT', { work_name: '...' });
 */

const pushService = require('./pushService');
const MangoService = require('./mango');

// Templates that warrant SMS fallback when push fails
const CRITICAL_TEMPLATES = new Set([
  'MYTHIC_WIN',
  'LEGENDARY_WIN',
  'FULFILLMENT_READY',
  'SHIFT_URGENT',
]);

// Short SMS text generators per template
const SMS_TEXT = {
  MYTHIC_WIN: (data) => `АСГАРД: Поздравляем! Вы выиграли ${data.prize || 'джекпот'}! Подробности в приложении.`,
  LEGENDARY_WIN: (data) => `АСГАРД: Вы выиграли ${data.prize || 'легендарный приз'}! Подробности в приложении.`,
  FULFILLMENT_READY: (data) => `АСГАРД: Ваш приз "${data.item || ''}" готов к выдаче. Обратитесь к РП.`,
  SHIFT_URGENT: (data) => `АСГАРД: Срочная смена ${data.date || 'сегодня'}. Откройте приложение для деталей.`,
};

// Push payload builder
function buildPushPayload(template, data) {
  const titles = {
    MYTHIC_WIN: 'Джекпот!',
    LEGENDARY_WIN: 'Легендарный приз!',
    FULFILLMENT_READY: 'Приз готов к выдаче',
    SHIFT_URGENT: 'Срочная смена',
    WHEEL_READY: 'Колесо Норн доступно',
    QUEST_COMPLETED: 'Квест выполнен!',
    STREAK_AT_RISK: 'Стрик под угрозой',
    ACHIEVEMENT_EARNED: 'Новая ачивка!',
    PRIZE_REQUESTED: 'Новый запрос приза',
  };

  return {
    title: titles[template] || 'АСГАРД',
    body: data.message || data.body || '',
    icon: '/m/icons/icon-192.png',
    badge: '/m/icons/badge-72.png',
    tag: template,
    data: { template, ...data },
  };
}

/**
 * Send notification via priority cascade
 * @param {object} db - database pool
 * @param {number} userId - target user ID
 * @param {string} template - notification template key
 * @param {object} data - template data
 * @returns {object} { channel: 'push'|'sms'|'db', success: boolean }
 */
async function send(db, userId, template, data = {}) {
  // Priority 1: Push
  try {
    const sent = await pushService.sendPush(db, userId, buildPushPayload(template, data));
    if (sent) {
      // Also write to DB for history
      await writeToDb(db, userId, template, data);
      return { channel: 'push', success: true };
    }
  } catch (err) {
    // Push failed, try next
  }

  // Priority 2: SMS for critical templates
  if (CRITICAL_TEMPLATES.has(template)) {
    try {
      const { rows } = await db.query(
        `SELECT e.phone FROM employees e
         JOIN users u ON u.id = e.user_id
         WHERE e.user_id = $1 AND e.phone IS NOT NULL LIMIT 1`,
        [userId]
      );
      if (rows.length && rows[0].phone) {
        const mango = new MangoService();
        const smsFrom = process.env.MANGO_SMS_EXTENSION || '101';
        const textFn = SMS_TEXT[template];
        const smsText = textFn ? textFn(data) : `АСГАРД: ${data.message || 'Уведомление'}`;
        const phone = rows[0].phone.replace(/[\s\-\(\)\+]/g, '').replace(/^8/, '7');
        await mango.sendSms(smsFrom, phone, smsText);
        await writeToDb(db, userId, template, data);
        return { channel: 'sms', success: true };
      }
    } catch (err) {
      // SMS failed, fall through to DB
    }
  }

  // Priority 3: Write to notifications table for in-app display
  await writeToDb(db, userId, template, data);
  return { channel: 'db', success: true };
}

async function writeToDb(db, userId, template, data) {
  try {
    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, data, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, false, NOW())`,
      [
        userId,
        template,
        data.title || template,
        data.message || data.body || '',
        JSON.stringify(data),
      ]
    );
  } catch (err) {
    // Non-critical: don't throw if DB write fails
  }
}

module.exports = { send, CRITICAL_TEMPLATES };
