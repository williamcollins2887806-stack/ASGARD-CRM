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

    // Push notification (web-push)
    try {
      const NotificationService = require('./NotificationService');
      // Get unread count for badge
      const countRes = await db.query(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
        [user_id]
      );
      const badgeCount = parseInt(countRes.rows[0].count, 10);

      // Send push to all registered devices
      let webpush;
      try { webpush = require('web-push'); } catch (e) { webpush = null; }
      if (webpush) {
        const publicKey = process.env.VAPID_PUBLIC_KEY;
        const privateKey = process.env.VAPID_PRIVATE_KEY;
        if (publicKey && privateKey) {
          const email = process.env.VAPID_EMAIL || 'mailto:admin@asgard-crm.ru';
          webpush.setVapidDetails(email, publicKey, privateKey);

          const subs = await db.query(
            'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
            [user_id]
          );
          const payload = JSON.stringify({
            title,
            body: message || '',
            url: link || '/',
            tag: type || 'asgard-notification',
            badge_count: badgeCount,
            icon: './assets/img/icon-192.png'
          });
          for (const sub of subs.rows) {
            try {
              await webpush.sendNotification({
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth }
              }, payload);
            } catch (pushErr) {
              if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
              }
            }
          }
        }
      }
    } catch (e) {
      // Push may not be configured
    }
  } catch (e) {
    console.error('[notify] Error:', e.message);
  }
}

module.exports = { createNotification };
