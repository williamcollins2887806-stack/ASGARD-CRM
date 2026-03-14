'use strict';

const correspondenceService = require('../services/correspondence');

const CORRESPONDENCE_ROLES = [
  'ADMIN',
  'DIRECTOR_GEN',
  'DIRECTOR_COMM',
  'DIRECTOR_DEV',
  'OFFICE_MANAGER',
  'PM',
  'HEAD_PM',
  'TO',
  'HEAD_TO'
];

function hasAccess(user) {
  return !!user && CORRESPONDENCE_ROLES.includes(user.role);
}

module.exports = async function correspondenceRoutes(fastify) {
  const db = fastify.db;

  fastify.get('/next-outgoing-number', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }

    try {
      return await correspondenceService.getNextOutgoingNumberPreview(db, {
        date: request.query?.date
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Correspondence preview error');
      return reply.code(500).send({ error: 'Не удалось получить номер' });
    }
  });

  fastify.post('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }

    try {
      const result = await correspondenceService.createCorrespondence(db, request.body || {}, {
        userId: request.user.id
      });
      return {
        success: true,
        id: result.item.id,
        item: result.item,
        correspondence: result.item.number
          ? { id: result.item.id, number: result.item.number }
          : null
      };
    } catch (error) {
      if (error.statusCode) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      fastify.log.error({ err: error }, 'Correspondence create error');
      return reply.code(500).send({ error: 'Не удалось создать корреспонденцию' });
    }
  });

  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }

    try {
      const result = await correspondenceService.updateCorrespondence(db, request.params.id, request.body || {});
      return {
        success: true,
        item: result.item
      };
    } catch (error) {
      if (error.statusCode) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      fastify.log.error({ err: error }, 'Correspondence update error');
      return reply.code(500).send({ error: 'Не удалось обновить корреспонденцию' });
    }
  });
};
