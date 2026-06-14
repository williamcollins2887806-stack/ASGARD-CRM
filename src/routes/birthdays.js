'use strict';

/**
 * GET /api/birthdays — список дней рождения сотрудников CRM (users.birth_date).
 *
 * Используется виджетом «Дни рождения» на главной странице (Home).
 * Раньше виджет ловил 404 → показывал «не настроено». C-14 закрыт.
 *
 * Query:
 *   days   — на сколько дней вперёд смотреть (default 30, max 365)
 *
 * Response:
 *   { items: [{ id, name, role, birth_date, days_until, is_today }] }
 *   Сортировка: по `days_until` ASC (ближайшие сначала).
 */
async function routes(fastify) {
  const db = fastify.db;

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const daysAhead = Math.min(365, Math.max(1, parseInt(request.query.days) || 30));

    const { rows } = await db.query(`
      WITH today AS (SELECT CURRENT_DATE AS d),
      birthdays AS (
        SELECT
          u.id,
          COALESCE(NULLIF(u.name, ''), u.login) AS name,
          u.role,
          u.birth_date,
          /* следующий день рождения в этом или следующем году */
          CASE
            WHEN to_char(u.birth_date, 'MM-DD') >= to_char((SELECT d FROM today), 'MM-DD')
              THEN make_date(EXTRACT(YEAR FROM (SELECT d FROM today))::int,
                             EXTRACT(MONTH FROM u.birth_date)::int,
                             EXTRACT(DAY FROM u.birth_date)::int)
            ELSE make_date((EXTRACT(YEAR FROM (SELECT d FROM today)) + 1)::int,
                           EXTRACT(MONTH FROM u.birth_date)::int,
                           EXTRACT(DAY FROM u.birth_date)::int)
          END AS next_birthday
        FROM users u
        WHERE u.is_active = true
          AND u.birth_date IS NOT NULL
      )
      SELECT
        id, name, role, birth_date,
        (next_birthday - (SELECT d FROM today))::int AS days_until,
        (next_birthday = (SELECT d FROM today)) AS is_today
      FROM birthdays
      WHERE (next_birthday - (SELECT d FROM today))::int <= $1
      ORDER BY days_until ASC, name ASC
    `, [daysAhead]);

    return { items: rows };
  });
}

module.exports = routes;
