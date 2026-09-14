'use strict';

/**
 * POST /api/client-errors — приёмник JS/render/API ошибок с фронтов.
 * Auth не обязателен (падение на логине тоже нужно).
 * Пишет в journalctl тег [client-error]; ответ всегда 204.
 */

const ALLOWED_SOURCES = new Set(['m', 'v2', 'vanilla']);
const ALLOWED_KINDS = new Set(['js', 'rejection', 'boundary', 'api']);

function clip(val, max) {
  if (val == null) return null;
  const s = String(val);
  return s.length > max ? s.slice(0, max) : s;
}

async function tryDecodeOfficeUser(fastify, authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const decoded = await fastify.jwt.verify(authHeader.slice(7));
    return decoded?.id || decoded?.userId || null;
  } catch (_) {
    return null;
  }
}

function tryDecodeFieldEmployee(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const jwt = require('jsonwebtoken');
    const secret = process.env.FIELD_JWT_SECRET || (process.env.JWT_SECRET + '_field');
    const payload = jwt.verify(authHeader.slice(7), secret);
    if (payload?.type === 'field' && payload.employee_id) return payload.employee_id;
  } catch (_) { /* ignore */ }
  return null;
}

async function routes(fastify) {
  fastify.post('/', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
        keyGenerator: (req) => req.ip,
      },
    },
    schema: {
      body: {
        type: 'object',
        additionalProperties: true,
        properties: {
          source: { type: 'string' },
          kind: { type: 'string' },
          message: { type: 'string' },
          stack: { type: 'string' },
          url: { type: 'string' },
          ua: { type: 'string' },
          endpoint: { type: 'string' },
          status: { type: 'number' },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const body = req.body || {};
      const source = ALLOWED_SOURCES.has(body.source) ? body.source : 'unknown';
      const kind = ALLOWED_KINDS.has(body.kind) ? body.kind : 'js';
      const message = clip(body.message || 'client error', 500) || 'client error';
      const stack = clip(body.stack, 2000);
      const url = clip(body.url, 300);
      const ua = clip(body.ua || req.headers['user-agent'], 300);
      const endpoint = clip(body.endpoint, 300);
      const status = typeof body.status === 'number' ? body.status : null;

      const authHeader = req.headers.authorization;
      const userId = await tryDecodeOfficeUser(fastify, authHeader);
      const fieldEmployeeId = tryDecodeFieldEmployee(authHeader);

      const meta = {
        source,
        kind,
        message,
        stack,
        url,
        ua,
        endpoint,
        status,
        req_id: req.id,
        ip: req.ip,
      };
      if (userId) meta.user_id = userId;
      if (fieldEmployeeId) meta.field_employee_id = fieldEmployeeId;

      fastify.log.error(meta, '[client-error]');
    } catch (err) {
      // Никогда не роняем приёмник — клиенту всё равно 204
      try { fastify.log.warn({ err: err?.message }, '[client-error] ingest failed'); } catch (_) {}
    }
    return reply.code(204).send();
  });
}

module.exports = routes;
