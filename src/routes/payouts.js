'use strict';

/**
 * Payouts API — страница выплат (#/payouts)
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/payouts
 *
 * Доступ: роль (ADMIN, DIRECTOR_*, BUH) ИЛИ персональный грант
 *         settings.payout_manager_user_ids (Дима Путков).
 *
 * Этап 2 (текущий):
 *   GET /warnings/:year/:month  — мягкие предупреждения готовности периода
 *                                 (НЕ блокируют выплату, см. src/lib/payout-period.js)
 *   GET /me                     — кто я и есть ли доступ (для UI)
 *
 * Дальше (Этап 3+): /list, /employee/:id/summary, /pay, /archive, /history.
 */

const { requirePayoutAccess, hasPayoutAccess, getPayoutManagerIds } = require('../lib/payouts-access');
const { getPeriodWarnings } = require('../lib/payout-period');
const { logError } = require('../lib/log-error');

function isValidPeriod(year, month) {
  const yStr = String(year).trim();
  const mStr = String(month).trim();
  // Строгая проверка: только целые числа без «хвостов» (9abc → невалидно).
  if (!/^\d+$/.test(yStr) || !/^\d+$/.test(mStr)) return false;
  const y = Number(yStr);
  const m = Number(mStr);
  return Number.isInteger(y) && y >= 2020 && y <= 2099 && Number.isInteger(m) && m >= 1 && m <= 12;
}

async function routes(fastify, options) {
  const db = fastify.db;
  const payoutAuth = { preHandler: [requirePayoutAccess(fastify)] };

  // ─── GET /me — доступ и роль (для UI: показать/скрыть страницу) ───────────
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const allowed = await hasPayoutAccess(db, request.user);
      return reply.send({
        allowed,
        role: request.user ? request.user.role : null,
        user_id: request.user ? request.user.id : null,
      });
    } catch (err) {
      logError(fastify, '[payouts] GET /me error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /warnings/:year/:month — предупреждения периода (мягкие) ─────────
  fastify.get('/warnings/:year/:month', payoutAuth, async (request, reply) => {
    const { year, month } = request.params;
    if (!isValidPeriod(year, month)) {
      return reply.code(400).send({ error: 'Некорректный период (год/месяц)' });
    }
    try {
      const result = await getPeriodWarnings(db, year, month);
      // ready_to_pay: мягкий флаг для UI (true, если нет warn-предупреждений).
      const ready_to_pay = !result.warnings.some((w) => w.level === 'warn');
      return reply.send({ year: parseInt(year, 10), month: parseInt(month, 10), ready_to_pay, ...result });
    } catch (err) {
      logError(fastify, '[payouts] GET /warnings error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /access — список грантов (для админ-UI, только базовая роль) ─────
  fastify.get('/access', payoutAuth, async (request, reply) => {
    try {
      const ids = await getPayoutManagerIds(db);
      return reply.send({ user_ids: ids });
    } catch (err) {
      logError(fastify, '[payouts] GET /access error', err, request);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
