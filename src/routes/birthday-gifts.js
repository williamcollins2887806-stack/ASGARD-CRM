'use strict';

/**
 * /api/birthday-gifts — подарки коллег + inbox именинника.
 */

const { kickFulfill } = require('../services/birthday-wish');
const { calcAge } = require('../services/birthday-persona');

async function routes(fastify) {
  const db = fastify.db;

  function currentBirthdayYear() {
    return new Date().getFullYear();
  }

  /** Сегодняшние именинники + already_sent / is_me / sent_count */
  fastify.get('/today', { preHandler: [fastify.authenticate] }, async (request) => {
    const me = request.user.id;
    const year = currentBirthdayYear();
    const { rows } = await db.query(`
      SELECT
        u.id,
        COALESCE(NULLIF(u.name, ''), u.login) AS name,
        u.role,
        u.birth_date,
        u.avatar_url,
        (u.id = $1) AS is_me,
        EXISTS (
          SELECT 1 FROM birthday_gifts g
          WHERE g.from_user_id = $1 AND g.to_user_id = u.id AND g.birthday_year = $2
        ) AS already_sent,
        (
          SELECT COUNT(*)::int FROM birthday_gifts g2
          WHERE g2.to_user_id = u.id AND g2.birthday_year = $2
        ) AS sent_count
      FROM users u
      WHERE u.is_active = true
        AND u.birth_date IS NOT NULL
        AND to_char(u.birth_date, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD')
      ORDER BY name ASC
    `, [me, year]);

    const items = rows.map((r) => ({
      ...r,
      age: calcAge(r.birth_date),
      already_sent: !!r.already_sent,
      is_me: !!r.is_me,
      sent_count: Number(r.sent_count || 0),
    }));
    return { items, year };
  });

  /** Отправить дар */
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const fromId = request.user.id;
    const body = request.body || {};
    const toId = Number(body.to_user_id);
    const giftType = String(body.gift_type || '');
    const tone = String(body.tone || 'warm');
    const year = currentBirthdayYear();

    if (!toId || !Number.isFinite(toId)) {
      return reply.code(400).send({ error: 'to_user_id required' });
    }
    if (toId === fromId) {
      return reply.code(400).send({ error: 'cannot_gift_self' });
    }
    if (!['flowers', 'fireworks', 'toy'].includes(giftType)) {
      return reply.code(400).send({ error: 'invalid_gift_type' });
    }
    if (!['warm', 'saga', 'light'].includes(tone)) {
      return reply.code(400).send({ error: 'invalid_tone' });
    }

    const target = await db.query(`
      SELECT id, COALESCE(NULLIF(name, ''), login) AS name, birth_date
      FROM users
      WHERE id = $1 AND is_active = true AND birth_date IS NOT NULL
        AND to_char(birth_date, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD')
    `, [toId]);
    if (!target.rows[0]) {
      return reply.code(404).send({ error: 'not_birthday_today' });
    }

    let gift;
    try {
      const ins = await db.query(`
        INSERT INTO birthday_gifts
          (from_user_id, to_user_id, gift_type, tone, birthday_year, message_status)
        VALUES ($1, $2, $3, $4, $5, 'pending')
        RETURNING *
      `, [fromId, toId, giftType, tone, year]);
      gift = ins.rows[0];
    } catch (err) {
      if (err && err.code === '23505') {
        return reply.code(409).send({ error: 'already_sent', message: 'Ты уже поздравил в этом году' });
      }
      throw err;
    }

    kickFulfill(db, gift.id, fastify.log);

    const fromName = request.user.name || request.user.login || 'Коллега';
    await db.query(`
      INSERT INTO notifications (user_id, type, title, message, link, created_at)
      VALUES ($1, 'birthday_gift', $2, $3, $4, NOW())
    `, [
      toId,
      'Тебе оставили дар',
      `${fromName} оставил${/а$/i.test(String(fromName).trim()) ? 'а' : ''} тебе подарок — откроется при входе в CRM.`,
      '/#/home?bd_reveal=1'
    ]);

    return { ok: true, gift: { id: gift.id, gift_type: gift.gift_type, tone: gift.tone, message_status: gift.message_status } };
  });

  /** Inbox именинника */
  fastify.get('/inbox', { preHandler: [fastify.authenticate] }, async (request) => {
    const me = request.user.id;
    const year = Number(request.query.year) || currentBirthdayYear();
    const unreadOnly = String(request.query.unread || '') === '1';

    const { rows } = await db.query(`
      SELECT g.id, g.gift_type, g.tone, g.message_text, g.message_status,
             g.birthday_year, g.opened_at, g.created_at,
             g.from_user_id,
             COALESCE(NULLIF(u.name, ''), u.login) AS from_name,
             u.avatar_url AS from_avatar
      FROM birthday_gifts g
      JOIN users u ON u.id = g.from_user_id
      WHERE g.to_user_id = $1 AND g.birthday_year = $2
        ${unreadOnly ? 'AND g.opened_at IS NULL' : ''}
      ORDER BY g.created_at ASC
    `, [me, year]);

    let asgard = null;
    try {
      const w = await db.query(`
        SELECT id, message_email, message_sms, facts_json, sent_at
        FROM birthday_asgard_wishes
        WHERE user_id = $1 AND birthday_year = $2
        LIMIT 1
      `, [me, year]);
      asgard = w.rows[0] || null;
    } catch (_) { asgard = null; }

    return {
      items: rows,
      asgard,
      unread: rows.filter((r) => !r.opened_at).length,
      year,
    };
  });

  /** Отметить дар просмотренным */
  fastify.post('/:id/open', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const me = request.user.id;
    const id = Number(request.params.id);
    if (!id) return reply.code(400).send({ error: 'bad_id' });

    const { rows } = await db.query(`
      UPDATE birthday_gifts
      SET opened_at = COALESCE(opened_at, NOW())
      WHERE id = $1 AND to_user_id = $2
      RETURNING id, opened_at, message_text, message_status, gift_type, from_user_id
    `, [id, me]);
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, gift: rows[0] };
  });

  /** Пометить все непрочитанные открытыми (после reveal) */
  fastify.post('/inbox/open-all', { preHandler: [fastify.authenticate] }, async (request) => {
    const me = request.user.id;
    const year = currentBirthdayYear();
    const { rowCount } = await db.query(`
      UPDATE birthday_gifts
      SET opened_at = NOW()
      WHERE to_user_id = $1 AND birthday_year = $2 AND opened_at IS NULL
    `, [me, year]);
    return { ok: true, opened: rowCount || 0 };
  });
}

module.exports = routes;
