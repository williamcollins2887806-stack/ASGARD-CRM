'use strict';

/**
 * Единая запись в audit_log + автолог мутаций API.
 * Нужен для дайджеста «активность в CRM» и разбора действий.
 * Ошибки записи никогда не ломают основной запрос.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const SKIP_PREFIXES = [
  '/api/daily-presence/heartbeat',
  '/api/daily-presence/self-act',
  '/api/field/',
  '/api/auth/refresh-token',
  '/api/auth/refresh',
  '/api/sse',
  '/api/events',
  '/api/push'
];

const SKIP_EXACT = new Set([
  '/api/auth/me',
  '/api/auth/verify-pin',
  '/api/daily-presence/today',
  '/api/daily-presence'
]);

function normalizePath(url) {
  return String(url || '').split('?')[0].replace(/\/+$/, '') || '/';
}

function shouldSkipApiAudit(path, method, user) {
  if (!MUTATING.has(method)) return true;
  if (!user || !user.id) return true;
  if (user.role === 'FIELD_WORKER' || user.role === 'BOT') return true;
  if (!path.startsWith('/api/')) return true;
  if (SKIP_EXACT.has(path)) return true;
  for (const p of SKIP_PREFIXES) {
    if (path === p || path.startsWith(p)) return true;
  }
  return false;
}

function parseEntity(path) {
  const m = String(path).match(/^\/api\/([a-z0-9_-]+)(?:\/(\d+))?/i);
  if (!m) return { entityType: 'api', entityId: null };
  return {
    entityType: String(m[1]).slice(0, 64),
    entityId: m[2] ? Number(m[2]) : null
  };
}

async function writeAudit(db, opts = {}) {
  if (!db || !opts.actorUserId || !opts.action) return;
  try {
    await db.query(
      `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, details, payload_json, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())`,
      [
        opts.actorUserId,
        opts.entityType || 'api',
        opts.entityId != null ? Number(opts.entityId) : null,
        String(opts.action).slice(0, 80),
        opts.details != null ? JSON.stringify(opts.details) : null,
        opts.payload != null ? JSON.stringify(opts.payload) : null
      ]
    );
  } catch (_) {
    /* audit не должен валить бизнес-операцию */
  }
}

/**
 * После успешного ответа — записать мутацию API (fire-and-forget).
 */
function recordApiMutation(db, request, reply) {
  try {
    const path = normalizePath(request.raw?.url || request.url);
    const method = String(request.method || 'GET').toUpperCase();
    const user = request.user;
    if (shouldSkipApiAudit(path, method, user)) return;

    const status = reply.statusCode || 0;
    if (status < 200 || status >= 400) return;

    const { entityType, entityId } = parseEntity(path);
    // не блокируем ответ
    writeAudit(db, {
      actorUserId: user.id,
      entityType,
      entityId,
      action: `api_${method.toLowerCase()}`,
      payload: {
        path: path.slice(0, 220),
        method,
        status
      }
    });
  } catch (_) { /* ignore */ }
}

module.exports = {
  writeAudit,
  recordApiMutation,
  shouldSkipApiAudit,
  MUTATING
};
