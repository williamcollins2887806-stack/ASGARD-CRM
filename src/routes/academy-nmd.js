'use strict';

/**
 * NMD admin API — upload / list normative docs for academy RAG.
 * Prefix: /api/pm/academy-nmd
 */
const path = require('path');
const nmd = require('../services/academy-nmd');

const ADMIN_ROLES = ['ADMIN', 'HEAD_PM', 'PM', 'HR', 'HEAD_TO', 'TO'];

async function routes(fastify) {
  const db = fastify.db;

  fastify.get('/', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ADMIN_ROLES)]
  }, async (req) => {
    const tag = req.query.tag || null;
    const docs = await nmd.listDocs(db, tag);
    return { docs };
  });

  fastify.post('/upload', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ADMIN_ROLES)]
  }, async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'Файл обязателен' });
    const buf = await data.toBuffer();
    const title = (req.query.title || data.filename || 'НМД').toString();
    const objectTag = (req.query.tag || 'mlsp').toString();
    try {
      const result = await nmd.ingestBuffer(db, {
        buffer: buf,
        originalName: data.filename,
        mimeType: data.mimetype,
        title,
        objectTag,
        uploadedBy: req.user.id
      });
      return { ok: true, doc: result.doc, chunks: result.chunks };
    } catch (e) {
      return reply.code(400).send({ error: e.message || 'Ошибка загрузки' });
    }
  });

  fastify.post('/search', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ADMIN_ROLES)]
  }, async (req) => {
    const q = req.body?.query || '';
    const tag = req.body?.tag || 'mlsp';
    return nmd.retrieveNmdContext(db, { query: q, objectTag: tag, limit: 8 });
  });

  // After NMD upload: archive + regenerate MLSP lessons with RAG
  fastify.post('/regenerate-mlsp', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ADMIN_ROLES)]
  }, async (req, reply) => {
    const docs = await nmd.listDocs(db, 'mlsp');
    if (!docs.length) {
      return reply.code(400).send({
        error: 'Нет загруженных НМД (tag=mlsp). Сначала POST /upload, затем regenerate.'
      });
    }
    try {
      const academyCron = require('../services/academy-cron');
      const result = await academyCron.regenerateMlspWithNmd();
      return { ok: true, nmd_docs: docs.length, ...result };
    } catch (e) {
      return reply.code(500).send({ error: e.message || 'Ошибка перегенерации' });
    }
  });

  fastify.post('/reembed', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ADMIN_ROLES)]
  }, async (req) => {
    const force = !!(req.body && req.body.force);
    return nmd.reembedChunks(db, { force });
  });
}

module.exports = routes;
