'use strict';

/**
 * KPI Money — серверные агрегаты для страницы /kpi-money (React v2).
 *
 * Источник: миграция vanilla `public/assets/js/kpi_money.js` → React `public/desktop-v2-src/src/pages/KpiMoney/`.
 *
 * Endpoints:
 *   GET /api/kpi-money/expenses-by-category?period=YYYY-MM
 *     → агрегат `work_expenses` по category+subcategory за указанный месяц.
 *     Заменяет клиентское двойное `/api/expenses/work + /api/expenses/office` суммирование
 *     для блока «Расходы по категориям» (donut + таблица).
 *
 * RBAC: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH (финансовый агрегат).
 */

const ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH'];

async function routes(fastify, options) {
  const db = fastify.db;

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/kpi-money/expenses-by-category?period=YYYY-MM
  // ───────────────────────────────────────────────────────────────────────
  // Параметры:
  //   period — обязателен, формат YYYY-MM (валидируется регуляркой).
  // Ответ:
  //   { items: [{ category, subcategory, sum, count }], total }
  // Логика:
  //   GROUP BY category, subcategory; subcategory NULL → '-' (как в ТЗ).
  //   ORDER BY sum DESC.
  fastify.get(
    '/expenses-by-category',
    { preHandler: [fastify.requireRoles(ROLES)] },
    async (request, reply) => {
      const period = String((request.query && request.query.period) || '').trim();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
        return reply.code(400).send({ error: 'period обязателен, формат YYYY-MM' });
      }

      try {
        const { rows } = await db.query(
          `
          SELECT
            category,
            COALESCE(subcategory, '-') AS subcategory,
            COALESCE(SUM(amount), 0)::numeric AS sum,
            COUNT(*)::int AS count
          FROM work_expenses
          WHERE TO_CHAR(date, 'YYYY-MM') = $1
          GROUP BY category, subcategory
          ORDER BY sum DESC
          `,
          [period]
        );

        const items = rows.map((r) => ({
          category: r.category,
          subcategory: r.subcategory,
          sum: Number(r.sum) || 0,
          count: Number(r.count) || 0
        }));
        const total = items.reduce((acc, it) => acc + it.sum, 0);

        return reply.send({ items, total });
      } catch (err) {
        request.log && request.log.error
          ? request.log.error({ err }, '[kpi-money] expenses-by-category failed')
          : null;
        return reply.code(500).send({ error: 'Не удалось получить агрегат расходов' });
      }
    }
  );
}

module.exports = routes;
