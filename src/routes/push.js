/**
 * Push Notifications API Routes
 * POST /api/push/subscribe — save push subscription
 * POST /api/push/unsubscribe — remove subscription
 * POST /api/push/send — send push to user(s) (admin/system)
 * POST /api/push/resubscribe — auto-resubscribe on key rotation
 * GET  /api/push/vapid-key — get public VAPID key
 * GET  /api/notifications/unread-count — unread count for current user
 */

async function routes(fastify) {
  const db = fastify.db;

  // ── GET /vapid-key — public VAPID key for client subscription ──
  fastify.get('/vapid-key', async () => {
    return { publicKey: process.env.VAPID_PUBLIC_KEY || '' };
  });

  // ── POST /subscribe — save push subscription ──
  fastify.post('/subscribe', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { endpoint, keys, device_info } = request.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return reply.code(400).send({ error: 'Missing subscription data (endpoint, keys.p256dh, keys.auth)' });
    }

    // Upsert: if endpoint already exists, update keys
    await db.query(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_info)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (endpoint) DO UPDATE SET
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_id = EXCLUDED.user_id,
        device_info = EXCLUDED.device_info
    `, [request.user.id, endpoint, keys.p256dh, keys.auth, device_info || null]);

    return { success: true };
  });

  // ── POST /unsubscribe — remove subscription ──
  fastify.post('/unsubscribe', { preHandler: [fastify.authenticate] }, async (request) => {
    const { endpoint } = request.body || {};
    if (endpoint) {
      await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, request.user.id]);
    } else {
      // Remove all subscriptions for this user
      await db.query('DELETE FROM push_subscriptions WHERE user_id = $1', [request.user.id]);
    }
    return { success: true };
  });

  // ── POST /send — send push notification (admin/system only) ──
  fastify.post('/send', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Only admin can send push notifications directly' });
    }

    const { user_id, user_ids, role, title, body, url, tag } = request.body || {};
    if (!title) return reply.code(400).send({ error: 'title is required' });

    const NotificationService = require('../services/NotificationService');
    let targetIds = [];

    if (user_id) {
      targetIds = [user_id];
    } else if (Array.isArray(user_ids)) {
      targetIds = user_ids;
    } else if (role) {
      const res = await db.query('SELECT id FROM users WHERE is_active = true AND role = ANY($1)', [Array.isArray(role) ? role : [role]]);
      targetIds = res.rows.map(r => r.id);
    }

    let sent = 0;
    for (const uid of targetIds) {
      try {
        await NotificationService.send(db, {
          user_id: uid,
          type: 'system',
          title,
          body: body || '',
          url: url || null,
          tag
        });
        sent++;
      } catch (e) {
        fastify.log.error(`Push send error for user ${uid}: ${e.message}`);
      }
    }

    return { sent, total: targetIds.length };
  });

  // ── POST /resubscribe — auto-resubscribe (called from SW pushsubscriptionchange) ──
  fastify.post('/resubscribe', async (request) => {
    const { old_endpoint, new_subscription } = request.body || {};
    if (!old_endpoint || !new_subscription?.endpoint) {
      return { success: false, error: 'Missing data' };
    }

    // Find user_id from old subscription
    const old = await db.query('SELECT user_id FROM push_subscriptions WHERE endpoint = $1', [old_endpoint]);
    if (old.rows.length === 0) return { success: false };

    const userId = old.rows[0].user_id;
    const keys = new_subscription.keys || {};

    // Delete old, insert new
    await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [old_endpoint]);
    await db.query(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
    `, [userId, new_subscription.endpoint, keys.p256dh || '', keys.auth || '']);

    return { success: true };
  });
}

module.exports = routes;
