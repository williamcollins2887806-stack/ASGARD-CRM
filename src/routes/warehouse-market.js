'use strict';
/**
 * GET /api/warehouse/market/search — единая выдача маркетплейса.
 * GET /api/warehouse/market/related — «С этим обычно берут» / похожие.
 */
const { searchMarket } = require('../services/warehouse-market');
const { getRelatedCards } = require('../services/market-related');

const WMS_READ = ['ADMIN', 'WAREHOUSE', 'PM', 'HEAD_PM', 'CHIEF_ENGINEER',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ACCOUNTANT'];

async function routes(fastify) {
  const db = fastify.db;

  fastify.get('/search', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WMS_READ)]
  }, async (req) => {
    const q = req.query || {};
    return searchMarket(db, {
      q: q.q || '',
      availability: q.availability || 'all',
      kind: q.kind || 'all',
      search_group: q.search_group || null,
      warehouse_id: q.warehouse_id || null,
      limit: q.limit
    });
  });

  fastify.get('/related', {
    preHandler: [fastify.authenticate, fastify.requireRoles(WMS_READ)]
  }, async (req, reply) => {
    const kind = String(req.query.kind || '').trim();
    const id = Number(req.query.id);
    if (!['product', 'equipment'].includes(kind) || !Number.isFinite(id)) {
      return reply.code(400).send({ error: 'Укажите kind=product|equipment и id' });
    }
    try {
      const data = await getRelatedCards(db, {
        kind,
        id,
        limit: req.query.limit || 8,
      });
      return { success: true, ...data };
    } catch (e) {
      // таблица ещё не применена — пустой ответ, карточка не ломается
      if (String(e.message || '').includes('market_related_pairs')) {
        return { success: true, seed_key: null, items: [] };
      }
      throw e;
    }
  });
}

module.exports = routes;
