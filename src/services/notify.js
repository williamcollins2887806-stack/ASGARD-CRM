'use strict';

/**
 * Notification helper — creates DB notification + sends Telegram
 * Used across all business event routes.
 */

async function createNotification(db, { user_id, title, message, type, link }) {
  try {
    await db.query(`
      INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, false, NOW())
    `, [user_id, title, message, type || 'info', link || null]);

    // Telegram
    try {
      const telegram = require('./telegram');
      if (telegram && telegram.sendNotification) {
        await telegram.sendNotification(user_id, `🔔 *${title}*\n\n${message}`);
      }
    } catch (e) {
      // Telegram may not be configured
    }
  } catch (e) {
    console.error('[notify] Error:', e.message);
  }
}

module.exports = { createNotification };
