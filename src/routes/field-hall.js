'use strict';

/**
 * Field hall — visit colleague profile (public cosmetics + stats).
 * Prefix: /api/field/hall
 */
async function routes(fastify) {
  const db = fastify.db;

  fastify.get('/:employeeId', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const hostId = parseInt(req.params.employeeId, 10);
    const visitorId = req.fieldEmployee.id;
    if (!Number.isFinite(hostId)) return reply.code(400).send({ error: 'Bad id' });

    const { rows: [host] } = await db.query(`
      SELECT e.id, e.fio, e.active_avatar, e.active_frame, e.active_theme, e.active_badge,
             e.active_helmet, e.active_weapon, e.active_armor,
             e.asset_body, e.asset_helmet, e.asset_weapon, e.asset_armor, e.asset_cape,
             e.asset_boots, e.asset_face_paint,
             COALESCE(gw_r.balance, 0)::int AS runes,
             COALESCE(gw_x.balance, 0)::int AS xp,
             GREATEST(1, FLOOR(COALESCE(gw_x.balance, 0) / 100) + 1)::int AS level
      FROM employees e
      LEFT JOIN gamification_wallets gw_r ON gw_r.employee_id = e.id AND gw_r.currency = 'runes'
      LEFT JOIN gamification_wallets gw_x ON gw_x.employee_id = e.id AND gw_x.currency = 'xp'
      WHERE e.id = $1 AND COALESCE(e.is_active, true) = true
    `, [hostId]);
    if (!host) return reply.code(404).send({ error: 'Воин не найден' });

    const { rows: academy } = await db.query(`
      SELECT count(*)::int AS lessons_passed
      FROM academy_worker_progress
      WHERE employee_id = $1 AND passed = true
    `, [hostId]).catch(() => ({ rows: [{ lessons_passed: 0 }] }));

    const { rows: [rankRow] } = await db.query(`
      WITH ranked AS (
        SELECT employee_id,
               RANK() OVER (ORDER BY balance DESC NULLS LAST) AS rnk
        FROM gamification_wallets
        WHERE currency = 'xp'
      )
      SELECT rnk FROM ranked WHERE employee_id = $1
    `, [hostId]).catch(() => ({ rows: [{}] }));

    const { rows: [praiseCount] } = await db.query(`
      SELECT count(*)::int AS n FROM field_hall_praise WHERE to_id = $1
    `, [hostId]).catch(() => ({ rows: [{ n: 0 }] }));

    await db.query(`
      INSERT INTO field_hall_visits (visitor_id, host_id)
      SELECT $1, $2
      WHERE NOT EXISTS (
        SELECT 1 FROM field_hall_visits
        WHERE visitor_id = $1 AND host_id = $2 AND created_at > NOW() - INTERVAL '1 hour'
      )
    `, [visitorId, hostId]).catch(() => {});

    return {
      host: {
        id: host.id,
        fio: host.fio,
        runes: host.runes,
        xp: host.xp,
        level: host.level,
        rank: rankRow?.rnk || null,
        lessons_passed: academy[0]?.lessons_passed || 0,
        praise_count: praiseCount?.n || 0,
        cosmetics: {
          active_avatar: host.active_avatar,
          active_frame: host.active_frame,
          active_theme: host.active_theme,
          active_badge: host.active_badge,
          active_helmet: host.active_helmet,
          active_weapon: host.active_weapon,
          active_armor: host.active_armor,
        },
        assets: {
          body: host.asset_body,
          helmet: host.asset_helmet,
          weapon: host.asset_weapon,
          armor: host.asset_armor,
          cape: host.asset_cape,
          boots: host.asset_boots,
          face_paint: host.asset_face_paint,
        },
      },
      is_self: visitorId === hostId,
    };
  });

  fastify.post('/:employeeId/praise', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const toId = parseInt(req.params.employeeId, 10);
    const fromId = req.fieldEmployee.id;
    if (toId === fromId) return reply.code(400).send({ error: 'Нельзя хвалить себя' });

    try {
      await db.query(`
        INSERT INTO field_hall_praise (from_id, to_id, praise_date)
        VALUES ($1, $2, CURRENT_DATE)
      `, [fromId, toId]);
    } catch (e) {
      if (String(e.message || '').includes('unique') || e.code === '23505') {
        return reply.code(409).send({ error: 'Уже хвалили сегодня' });
      }
      throw e;
    }

    await db.query(`
      INSERT INTO gamification_wallets (employee_id, currency, balance)
      VALUES ($1, 'xp', 5)
      ON CONFLICT (employee_id, currency) DO UPDATE
      SET balance = gamification_wallets.balance + 5, updated_at = NOW()
    `, [toId]).catch(() => {});

    return { ok: true, xp_bonus: 5 };
  });
}

module.exports = routes;
