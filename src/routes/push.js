/**
 * Push Notifications API Routes
 * POST /api/push/subscribe — save push subscription
 * POST /api/push/unsubscribe — remove subscription
 * POST /api/push/send — send push to user(s) (admin/system)
 * POST /api/push/resubscribe — auto-resubscribe on key rotation
 * GET  /api/push/vapid-key — get public VAPID key
 * GET  /api/push/badge-count — composite badge count for current user
 *
 * Session 15: added GET /badge-count
 */

async function routes(fastify) {
  var db = fastify.db;

  // ── GET /vapid-key — public VAPID key for client subscription ──
  fastify.get('/vapid-key', async function() {
    return { publicKey: process.env.VAPID_PUBLIC_KEY || '' };
  });

  // ── GET /badge-count — composite count: notifications + pending approvals (for directors) + unread chats ──
  fastify.get('/badge-count', { preHandler: [fastify.authenticate] }, async function(request) {
    var userId = request.user.id;
    var role = request.user.role || '';

    // 1. Unread notifications
    var notifRes = await db.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [userId]
    );
    var notifCount = parseInt(notifRes.rows[0].count, 10);

    // 2. Pending approvals (only for directors)
    var approvalCount = 0;
    var directorRoles = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
    if (directorRoles.indexOf(role) !== -1) {
      var approvalRes = await db.query(
        "SELECT COUNT(*) FROM estimates WHERE approval_status = 'sent'"
      );
      approvalCount = parseInt(approvalRes.rows[0].count, 10);
    }

    // 3. Unread chat messages (messages from others in chats user is a member of)
    var chatCount = 0;
    try {
      var chatRes = await db.query(
        "SELECT COUNT(*) FROM chat_messages WHERE is_read = false AND sender_id != $1 AND chat_id IN (SELECT chat_id FROM chat_members WHERE user_id = $1)",
        [userId]
      );
      chatCount = parseInt(chatRes.rows[0].count, 10);
    } catch (e) {
      // chat_members table may not exist — ignore
    }

    var count = notifCount + approvalCount + chatCount;

    return { count: count, notifications: notifCount, approvals: approvalCount, chats: chatCount };
  });

  // ── POST /subscribe — save push subscription ──
  fastify.post('/subscribe', { preHandler: [fastify.authenticate] }, async function(request, reply) {
    var body = request.body || {};
    var endpoint = body.endpoint;
    var keys = body.keys;
    var device_info = body.device_info;
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return reply.code(400).send({ error: 'Missing subscription data (endpoint, keys.p256dh, keys.auth)' });
    }

    await db.query(
      'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_info) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_id = EXCLUDED.user_id, device_info = EXCLUDED.device_info',
      [request.user.id, endpoint, keys.p256dh, keys.auth, device_info || null]
    );

    return { success: true };
  });

  // ── POST /unsubscribe — remove subscription ──
  fastify.post('/unsubscribe', { preHandler: [fastify.authenticate] }, async function(request) {
    var endpoint = (request.body || {}).endpoint;
    if (endpoint) {
      await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, request.user.id]);
    } else {
      await db.query('DELETE FROM push_subscriptions WHERE user_id = $1', [request.user.id]);
    }
    return { success: true };
  });

  // ── POST /send — send push notification (admin/system only) ──
  fastify.post('/send', { preHandler: [fastify.authenticate] }, async function(request, reply) {
    if (request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Only admin can send push notifications directly' });
    }

    var body = request.body || {};
    if (!body.title) return reply.code(400).send({ error: 'title is required' });

    var NotificationService = require('../services/NotificationService');
    var targetIds = [];

    if (body.user_id) {
      targetIds = [body.user_id];
    } else if (Array.isArray(body.user_ids)) {
      targetIds = body.user_ids;
    } else if (body.role) {
      var res = await db.query('SELECT id FROM users WHERE is_active = true AND role = ANY($1)', [Array.isArray(body.role) ? body.role : [body.role]]);
      targetIds = res.rows.map(function(r) { return r.id; });
    }

    var sent = 0;
    for (var i = 0; i < targetIds.length; i++) {
      try {
        await NotificationService.send(db, {
          user_id: targetIds[i],
          type: 'system',
          title: body.title,
          body: body.body || '',
          url: body.url || null,
          tag: body.tag
        });
        sent++;
      } catch (e) {
        fastify.log.error('Push send error for user ' + targetIds[i] + ': ' + e.message);
      }
    }

    return { sent: sent, total: targetIds.length };
  });

  // ── POST /resubscribe — auto-resubscribe (called from SW pushsubscriptionchange) ──
  fastify.post('/resubscribe', async function(request) {
    var body = request.body || {};
    if (!body.old_endpoint || !body.new_subscription || !body.new_subscription.endpoint) {
      return { success: false, error: 'Missing data' };
    }

    var old = await db.query('SELECT user_id FROM push_subscriptions WHERE endpoint = $1', [body.old_endpoint]);
    if (old.rows.length === 0) return { success: false };

    var userId = old.rows[0].user_id;
    var keys = body.new_subscription.keys || {};

    await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [body.old_endpoint]);
    await db.query(
      'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4) ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth',
      [userId, body.new_subscription.endpoint, keys.p256dh || '', keys.auth || '']
    );

    return { success: true };
  });
}

module.exports = routes;
