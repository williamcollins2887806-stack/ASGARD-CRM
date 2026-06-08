'use strict';

/**
 * Daily Presence — обязательная ежедневная отметка «где я сегодня» для ОФИСНЫХ сотрудников.
 * Полевые рабочие отмечаются через field_checkins (мобилка), поэтому сюда они не попадают.
 * Ключ — users.id (JWT). UPSERT по (user_id, date). Полная блокировка СРМ реализуется на фронте,
 * бэкенд отдаёт required=true/false.
 */

module.exports = async function (fastify, options) {
  const db = fastify.db;

  // офисные роли, которым ОБЯЗАТЕЛЬНО отмечаться
  const OFFICE_ROLES = [
    'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'PROC', 'BUH', 'OFFICE_MANAGER', 'CHIEF_ENGINEER',
    'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'
  ];
  const STATUSES = ['office', 'remote', 'object', 'vacation', 'sick', 'trip'];
  const BOARD_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HR', 'HR_MANAGER', 'HEAD_PM', 'HEAD_TO'];

  // ─────────────────────────────────────────────────────────────────
  // GET /api/daily-presence/today — нужна ли отметка + текущая
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/today', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user && request.user.id;
      const role = request.user && request.user.role;
      if (!userId) { reply.code(401); return { error: 'no_user' }; }

      const { rows: [pr] } = await db.query(
        `SELECT status, site_id, note FROM daily_presence WHERE user_id = $1 AND date = CURRENT_DATE`,
        [userId]
      );
      const isOffice = OFFICE_ROLES.includes(role);
      return {
        required: isOffice && !pr,
        presence: pr || null,
        statuses: STATUSES
      };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'presence_today_failed', message: e.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/daily-presence — поставить/обновить отметку за сегодня
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user && request.user.id;
      if (!userId) { reply.code(401); return { error: 'no_user' }; }
      const { status, site_id, note } = request.body || {};
      if (!STATUSES.includes(status)) { reply.code(400); return { error: 'bad_status' }; }
      if (status === 'object' && !site_id) { reply.code(400); return { error: 'site_required' }; }

      const sid = status === 'object' ? parseInt(site_id, 10) || null : null;
      const { rows: [row] } = await db.query(`
        INSERT INTO daily_presence (user_id, date, status, site_id, note, created_at, updated_at)
        VALUES ($1, CURRENT_DATE, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (user_id, date)
        DO UPDATE SET status = EXCLUDED.status, site_id = EXCLUDED.site_id,
                      note = EXCLUDED.note, updated_at = NOW()
        RETURNING id, status, site_id, note
      `, [userId, status, sid, (note || '').slice(0, 255) || null]);

      return { ok: true, presence: row };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'presence_save_failed', message: e.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/daily-presence/board?date= — кто где сегодня (для карты/HR)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/board', { preHandler: [fastify.requireRoles(BOARD_ROLES)] }, async (request, reply) => {
    try {
      const date = request.query.date || null; // YYYY-MM-DD; по умолчанию сегодня
      const { rows } = await db.query(`
        SELECT dp.user_id, u.name AS user_name, u.role,
               dp.status, dp.site_id, s.name AS site_name, dp.note, dp.date
        FROM daily_presence dp
        JOIN users u ON u.id = dp.user_id
        LEFT JOIN sites s ON s.id = dp.site_id
        WHERE dp.date = COALESCE($1::date, CURRENT_DATE)
        ORDER BY dp.status, u.name
      `, [date]);
      return { date: date || null, board: rows };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'presence_board_failed', message: e.message };
    }
  });
};
