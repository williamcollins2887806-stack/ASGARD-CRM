'use strict';

/**
 * Daily Presence — обязательная ежедневная отметка «где я сегодня» для ОФИСНЫХ сотрудников.
 *
 * ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ — таблица staff_plan (та же, что у «Графика офиса»):
 *   staff.user_id = users.id → staff.id = staff_plan.staff_id, дата = CURRENT_DATE, status_code.
 * Поэтому отметка в гейте СРАЗУ появляется в Графике офиса и наоборот.
 *
 * Статусы — коды графика офиса (оф/уд/бн/сс/км/пг/уч/ск/вх) + «об» (на объекте) с привязкой к работе.
 * «На объекте» доступно только если у пользователя есть активные работы (показываем ТОЛЬКО его работы).
 *
 * Полевые рабочие отмечаются через field_checkins (мобилка) — сюда не попадают.
 */

const { notClosedSql } = require('../helpers/work-status');

module.exports = async function (fastify, options) {
  const db = fastify.db;

  // офисные роли, которым ОБЯЗАТЕЛЬНО отмечаться.
  // ADMIN намеренно исключён: это техническая/системная учётка (единственный админ в СРМ,
  // у неё стоит ФИО владельца) — она не «ходит в офис» как сотрудник и не должна плодить
  // фантомную отметку в «Графике офиса» параллельно рабочему аккаунту человека.
  const OFFICE_ROLES = [
    'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'PROC', 'BUH', 'OFFICE_MANAGER', 'CHIEF_ENGINEER',
    'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
  ];
  const BOARD_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HR', 'HR_MANAGER', 'HEAD_PM', 'HEAD_TO'];

  // Статусы (коды как в «Графике офиса» + «об» на объекте). needsWork → требуется выбор работы.
  const STATUS_DEFS = [
    { code: 'оф', label: 'В офисе',            emoji: '🏢' },
    { code: 'уд', label: 'Удалёнка',           emoji: '🏠' },
    { code: 'об', label: 'На объекте',         emoji: '🚧', needsWork: true },
    { code: 'км', label: 'Командировка',       emoji: '🚗' },
    { code: 'пг', label: 'Встреча/переговоры', emoji: '🤝' },
    { code: 'уч', label: 'Учёба',              emoji: '📚' },
    { code: 'ск', label: 'Склад',              emoji: '📦' },
    { code: 'бн', label: 'Больничный',         emoji: '🤒' },
    { code: 'сс', label: 'За свой счёт',       emoji: '🌴' },
    { code: 'вх', label: 'Выходной',           emoji: '🛌' },
  ];
  const VALID_CODES = new Set(STATUS_DEFS.map(s => s.code));

  // Найти staff_id по users.id или создать (под advisory-локом — без дублей при гонке).
  async function ensureStaffId(userId, name, role) {
    const { rows } = await db.query('SELECT id FROM staff WHERE user_id = $1 ORDER BY id LIMIT 1', [userId]);
    if (rows.length) return rows[0].id;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [202, userId]); // namespace 202 = staff-by-user
      const re = await client.query('SELECT id FROM staff WHERE user_id = $1 ORDER BY id LIMIT 1', [userId]);
      if (re.rows.length) { await client.query('COMMIT'); return re.rows[0].id; }
      const ins = await client.query(
        `INSERT INTO staff (user_id, name, role_tag, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, true, NOW(), NOW()) RETURNING id`,
        [userId, name || ('user#' + userId), role || '']
      );
      await client.query('COMMIT');
      return ins.rows[0].id;
    } catch (e) { try { await client.query('ROLLBACK'); } catch (_) {} throw e; }
    finally { client.release(); }
  }

  // Прочитать отметку за сегодня (status_code + work_id) по staff_id
  async function todayPlan(staffId) {
    const { rows } = await db.query(
      `SELECT id, status_code, work_id FROM staff_plan
       WHERE staff_id = $1 AND date = CURRENT_DATE AND status_code IS NOT NULL AND status_code <> ''
       ORDER BY id DESC LIMIT 1`, [staffId]);
    return rows[0] || null;
  }

  // Мои активные работы (для статуса «На объекте») — ТОЛЬКО где я РП и работа не закрыта
  async function myActiveWorks(userId) {
    const { rows } = await db.query(
      `SELECT id, work_title, work_status, city, object_name FROM works
       WHERE pm_id = $1 AND deleted_at IS NULL AND ${notClosedSql('work_status')}
       ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 50`, [userId]);
    return rows.map(r => ({
      id: r.id,
      title: r.work_title || ('Работа #' + r.id),
      place: r.object_name || r.city || '',
      status: r.work_status
    }));
  }

  // UPSERT отметки в staff_plan за сегодня (под advisory-локом по staff_id)
  async function upsertPlan(staffId, code, workId, userId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [203, staffId]); // namespace 203 = staff_plan today
      const ex = await client.query(
        'SELECT id FROM staff_plan WHERE staff_id = $1 AND date = CURRENT_DATE ORDER BY id LIMIT 1', [staffId]);
      let row;
      if (ex.rows.length) {
        const r = await client.query(
          `UPDATE staff_plan SET status_code = $2, work_id = $3, updated_at = NOW()
           WHERE id = $1 RETURNING id, status_code, work_id`, [ex.rows[0].id, code, workId]);
        row = r.rows[0];
      } else {
        const r = await client.query(
          `INSERT INTO staff_plan (staff_id, date, status_code, work_id, created_at, updated_at)
           VALUES ($1, CURRENT_DATE, $2, $3, NOW(), NOW())
           RETURNING id, status_code, work_id`, [staffId, code, workId]);
        row = r.rows[0];
      }
      await client.query('COMMIT');
      return row;
    } catch (e) { try { await client.query('ROLLBACK'); } catch (_) {} throw e; }
    finally { client.release(); }
  }

  async function serverDate() {
    const { rows: [d] } = await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`);
    return d.d;
  }

  // ─────────────────────────────────────────────────────────────────
  // GET /api/daily-presence/today — нужна ли отметка + статусы + мои работы
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/today', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user && request.user.id;
      const role = request.user && request.user.role;
      const name = request.user && request.user.name;
      if (!userId) { reply.code(401); return { error: 'no_user' }; }

      const isOffice = OFFICE_ROLES.includes(role);
      const sd = await serverDate();
      if (!isOffice) {
        // полевые/прочие — гейт не нужен
        return { required: false, server_date: sd, statuses: STATUS_DEFS, works: [], current: null };
      }

      const staffId = await ensureStaffId(userId, name, role);
      const current = await todayPlan(staffId);
      const works = await myActiveWorks(userId);

      // «На объекте» доступно только если есть активные работы
      const statuses = STATUS_DEFS.filter(s => !s.needsWork || works.length > 0);

      return {
        required: !current,
        current: current ? { status_code: current.status_code, work_id: current.work_id } : null,
        statuses,
        works,
        server_date: sd
      };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'presence_today_failed', message: e.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/daily-presence — поставить/обновить отметку (пишет в staff_plan)
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user && request.user.id;
      const role = request.user && request.user.role;
      const name = request.user && request.user.name;
      if (!userId) { reply.code(401); return { error: 'no_user' }; }

      const body = request.body || {};
      const code = body.status_code;
      if (!VALID_CODES.has(code)) { reply.code(400); return { error: 'bad_status' }; }

      let workId = null;
      if (code === 'об') {
        workId = parseInt(body.work_id, 10) || null;
        if (!workId) { reply.code(400); return { error: 'work_required' }; }
        // защита: работа должна быть СВОЕЙ и активной
        const { rows } = await db.query(
          `SELECT id FROM works WHERE id = $1 AND pm_id = $2 AND deleted_at IS NULL AND ${notClosedSql('work_status')}`,
          [workId, userId]);
        if (!rows.length) { reply.code(400); return { error: 'work_not_yours_or_closed' }; }
      }

      const staffId = await ensureStaffId(userId, name, role);
      const row = await upsertPlan(staffId, code, workId, userId);
      return { ok: true, presence: { status_code: row.status_code, work_id: row.work_id } };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'presence_save_failed', message: e.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/daily-presence/board?date= — кто где сегодня (из staff_plan)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/board', { preHandler: [fastify.requireRoles(BOARD_ROLES)] }, async (request, reply) => {
    try {
      const date = request.query.date || null;
      const { rows } = await db.query(`
        SELECT s.user_id, u.name AS user_name, u.role,
               sp.status_code, sp.work_id, w.work_title, sp.date
        FROM staff_plan sp
        JOIN staff s ON s.id = sp.staff_id
        JOIN users u ON u.id = s.user_id
        LEFT JOIN works w ON w.id = sp.work_id
        WHERE sp.date = COALESCE($1::date, CURRENT_DATE)
          AND sp.status_code IS NOT NULL AND sp.status_code <> ''
        ORDER BY sp.status_code, u.name
      `, [date]);
      return { date: date || null, board: rows, statuses: STATUS_DEFS };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'presence_board_failed', message: e.message };
    }
  });
};
