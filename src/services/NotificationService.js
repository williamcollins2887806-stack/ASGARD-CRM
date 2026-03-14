/**
 * NotificationService — sends push notifications + creates DB records
 *
 * Usage:
 *   const NotificationService = require('./services/NotificationService');
 *   await NotificationService.send(db, {
 *     user_id: 5,
 *     type: 'task_assigned',
 *     title: 'Новая задача',
 *     body: 'Вам назначена задача #123',
 *     url: '#/tasks/123'
 *   });
 */

let webpush;
try {
  webpush = require('web-push');
} catch (e) {
  // web-push not installed — push sending will be skipped
  webpush = null;
}

// Configure VAPID once
let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured || !webpush) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL || 'mailto:admin@asgard-crm.ru';
  if (publicKey && privateKey) {
    webpush.setVapidDetails(email, publicKey, privateKey);
    vapidConfigured = true;
  }
}

/**
 * Create notification in DB + send push to all user's devices
 * @param {object} db - PostgreSQL pool
 * @param {object} opts - { user_id, type, title, body, url, tag }
 */
async function send(db, opts) {
  const { user_id, type, title, body, url, tag } = opts;
  if (!user_id || !title) return;

  // 1. Create notification record in DB
  await db.query(`
    INSERT INTO notifications (user_id, type, title, message, link, is_read, created_at)
    VALUES ($1, $2, $3, $4, $5, false, NOW())
  `, [user_id, type || 'system', title, body || '', url || null]);

  // 2. Get unread count for badge
  const countRes = await db.query(
    'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
    [user_id]
  );
  const badgeCount = parseInt(countRes.rows[0].count, 10);

  // 3. Send push to all registered devices
  ensureVapid();
  if (!webpush || !vapidConfigured) return;

  const subs = await db.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [user_id]
  );

  const payload = JSON.stringify({
    title,
    body: body || '',
    url: url || '/',
    tag: tag || type || 'asgard-notification',
    badge_count: badgeCount,
    icon: './assets/img/icon-192.png'
  });

  const staleIds = [];

  for (const sub of subs.rows) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, payload);
    } catch (err) {
      // 410 Gone or 404 — endpoint expired, remove subscription
      if (err.statusCode === 410 || err.statusCode === 404) {
        staleIds.push(sub.id);
      }
      // Other errors (e.g. network) — just log and continue
    }
  }

  // Clean up stale subscriptions
  if (staleIds.length > 0) {
    await db.query('DELETE FROM push_subscriptions WHERE id = ANY($1)', [staleIds]);
  }
}

/**
 * Send push to all users with a given role
 */
async function sendToRole(db, role, opts) {
  const roles = Array.isArray(role) ? role : [role];
  const users = await db.query(
    'SELECT id FROM users WHERE is_active = true AND role = ANY($1)',
    roles
  );
  for (const u of users.rows) {
    await send(db, { ...opts, user_id: u.id });
  }
}

/**
 * Send push to all active users
 */
async function broadcast(db, opts) {
  const users = await db.query('SELECT id FROM users WHERE is_active = true');
  for (const u of users.rows) {
    await send(db, { ...opts, user_id: u.id });
  }
}

module.exports = { send, sendToRole, broadcast };
