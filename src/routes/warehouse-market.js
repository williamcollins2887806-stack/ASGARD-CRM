'use strict';
/**
 * GET /api/warehouse/market/search — единая выдача маркетплейса.
 */
const { searchMarket } = require('../services/warehouse-market');

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
}

module.exports = routes;
