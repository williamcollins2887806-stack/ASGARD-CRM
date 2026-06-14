'use strict';
/**
 * АСГАРД CRM — Вебхук от MAX мессенджера
 * POST /api/max/webhook — принимает события MAX (участник вступил в чат и т.д.)
 *
 * Регистрация вебхука делается один раз через:
 *   POST /api/max/setup-webhook (только ADMIN)
 */

const db = require('../services/db');
const crypto = require('crypto');

module.exports = async function (fastify) {

  // ── POST /webhook — события от MAX ──────────────────────────────────────
  // G-12 F1 SECURITY: HMAC/secret-token verification.
  //   Secret источник: env MAX_WEBHOOK_SECRET.
  //   Проверка: либо заголовок X-Max-Signature (HMAC-SHA256 raw body, hex),
  //   либо query ?secret=… (для конфигов MAX где подпись недоступна).
  //   Если secret не задан → 503 «не настроено». Если подпись неверна → 401.
  fastify.post('/webhook', { config: { rawBody: true } }, async (req, reply) => {
    const secret = process.env.MAX_WEBHOOK_SECRET;
    if (!secret) {
      fastify.log.warn('[MAX webhook] MAX_WEBHOOK_SECRET не задан — отказ');
      return reply.code(503).send({ error: 'MAX webhook secret не настроен' });
    }
    let verified = false;
    const sigHeader = req.headers['x-max-signature'];
    if (sigHeader) {
      try {
        const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
        const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const sigHex = String(sigHeader).replace(/^sha256=/i, '');
        if (sigHex.length === expected.length &&
            crypto.timingSafeEqual(Buffer.from(sigHex, 'hex'), Buffer.from(expected, 'hex'))) {
          verified = true;
        }
      } catch (_) { /* fallthrough → 401 */ }
    }
    if (!verified) {
      const qSecret = (req.query && req.query.secret) ? String(req.query.secret) : '';
      if (qSecret && qSecret.length === secret.length) {
        try {
          if (crypto.timingSafeEqual(Buffer.from(qSecret), Buffer.from(secret))) verified = true;
        } catch (_) { /* fallthrough */ }
      }
    }
    if (!verified) {
      return reply.code(401).send({ error: 'Invalid MAX webhook signature' });
    }
    try {
      const event = req.body || {};
      const updateType = event.update_type;

      fastify.log.info('[MAX webhook] event:', updateType, JSON.stringify(event).slice(0, 300));

      // Участник вступил в чат
      if (updateType === 'chat_member_added') {
        const chatId = String(event.chat_id || '');
        const addedUsers = event.user_ids || (event.user_id ? [event.user_id] : []);

        if (chatId && addedUsers.length > 0) {
          // Найти работу по max_chat_id
          const workRes = await db.query(
            'SELECT id FROM works WHERE max_chat_id = $1 LIMIT 1', [chatId]
          );
          if (workRes.rows[0]) {
            const workId = workRes.rows[0].id;
            for (const uid of addedUsers) {
              await db.query(`
                UPDATE employee_assignments
                SET max_user_id = $1,
                    max_joined_at = NOW(),
                    max_invite_status = 'joined'
                WHERE work_id = $2 AND (max_user_id = $1 OR max_invite_status = 'sms_sent')
              `, [String(uid), workId]);
            }
            fastify.log.info(`[MAX webhook] ${addedUsers.length} участников вступили в чат work_id=${workId}`);
          }
        }
      }

      // Участник покинул чат
      if (updateType === 'chat_member_removed') {
        const chatId = String(event.chat_id || '');
        const removedUser = event.user_id;
        if (chatId && removedUser) {
          await db.query(`
            UPDATE employee_assignments ea
            SET max_invite_status = 'sms_sent', max_joined_at = NULL
            FROM works w
            WHERE w.id = ea.work_id AND w.max_chat_id = $1 AND ea.max_user_id = $2
          `, [chatId, String(removedUser)]);
        }
      }

      return reply.send({ ok: true });
    } catch (err) {
      fastify.log.error('[MAX webhook] error:', err.message);
      return reply.code(200).send({ ok: false, error: err.message });
    }
  });

  // ── POST /setup-webhook — регистрация вебхука (только ADMIN) ────────────
  fastify.post('/setup-webhook', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (req, reply) => {
    try {
      const max = require('../services/max-messenger');
      if (!max.isEnabled()) {
        return reply.code(400).send({ error: 'MAX_BOT_TOKEN не задан в .env. Добавьте токен бота MAX.' });
      }

      const baseUrl = process.env.CORS_ORIGIN || 'https://asgard-crm.ru';
      const secret = process.env.MAX_WEBHOOK_SECRET;
      if (!secret) {
        return reply.code(503).send({ error: 'MAX_WEBHOOK_SECRET не задан в .env. Без него вебхук не пройдёт HMAC-проверку.' });
      }
      const webhookUrl = `${baseUrl}/api/max/webhook?secret=${encodeURIComponent(secret)}`;

      await max.subscribeWebhook(webhookUrl);
      return reply.send({ ok: true, webhook_url: webhookUrl.replace(secret, '***') });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── GET /status — статус MAX бота ───────────────────────────────────────
  fastify.get('/status', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (req, reply) => {
    try {
      const max = require('../services/max-messenger');
      if (!max.isEnabled()) {
        return reply.send({ enabled: false, message: 'MAX_BOT_TOKEN не задан' });
      }
      const me = await max.getMe();
      return reply.send({ enabled: true, bot: me });
    } catch (err) {
      return reply.send({ enabled: false, error: err.message });
    }
  });

  // ── GET /work/:work_id/members — статус участников для работы ───────────
  fastify.get('/work/:work_id/members', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const { rows } = await db.query(`
        SELECT ea.employee_id, e.fio, e.phone,
               ea.max_invite_status, ea.max_invite_sent_at, ea.max_joined_at, ea.max_user_id,
               w.max_chat_id, w.max_invite_link
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        JOIN works w ON w.id = ea.work_id
        WHERE ea.work_id = $1 AND ea.is_active = true
        ORDER BY e.fio
      `, [workId]);
      return reply.send({ members: rows });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
};
