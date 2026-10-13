'use strict';

/**
 * Доступ к странице выплат (#/payouts).
 * ═══════════════════════════════════════════════════════════════════════════
 * Механизм: список user_id в settings.payout_manager_user_ids (JSON-массив).
 * Это НЕ роль — роль пользователя остаётся прежней (например PM). Грант даёт
 * доступ к странице выплат и её ручкам (список/выплата/подтверждение за рабочего).
 *
 * Список живёт в БД, а не в коде: состав меняется без деплоя.
 * Кэш 60 c — по образцу src/lib/timesheet-access.js (V384).
 */

const SETTING_KEY = 'payout_manager_user_ids';
const CACHE_TTL_MS = 60 * 1000;

// Роли, которым доступ к странице выплат разрешён всегда (без гранта).
const PAYOUT_BASE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

let _cache = { at: 0, ids: new Set(), loaded: false };

function parseIds(raw) {
  const out = new Set();
  if (raw == null) return out;
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch (_) { arr = []; }
  }
  if (!Array.isArray(arr)) return out;
  for (const v of arr) {
    // Только строго целые положительные id: `parseInt(1.9)` дало бы 1 —
    // молчаливый грант не тому пользователю. Строки-числа допускаем.
    const n = (typeof v === 'number' || typeof v === 'string') ? Number(v) : NaN;
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return out;
}

async function loadIds(db, { force = false } = {}) {
  const now = Date.now();
  if (!force && _cache.loaded && (now - _cache.at) < CACHE_TTL_MS) return _cache.ids;
  try {
    const { rows } = await db.query('SELECT value_json FROM settings WHERE key = $1 LIMIT 1', [SETTING_KEY]);
    const ids = parseIds(rows[0] ? rows[0].value_json : null);
    _cache = { at: now, ids, loaded: true };
    return ids;
  } catch (_) {
    // Нет таблицы/ключа — никого не грантуем. Кэш не отравляем.
    return _cache.ids;
  }
}

/** true, если у viewer есть доступ к странице выплат (по роли или по гранту). */
async function hasPayoutAccess(db, viewer) {
  const role = viewer && viewer.role;
  if (role && PAYOUT_BASE_ROLES.includes(role)) return true;
  const id = viewer && parseInt(viewer.id, 10);
  if (!Number.isFinite(id) || id <= 0) return false;
  const ids = await loadIds(db);
  return ids.has(id);
}

/** Список id из настроек (для диагностики/UI управления). */
async function getPayoutManagerIds(db) {
  return Array.from(await loadIds(db));
}

function clearCache() { _cache = { at: 0, ids: new Set(), loaded: false }; }

/** preHandler для fastify: аутентифицирует и проверяет доступ к выплатам. */
function requirePayoutAccess(fastify) {
  return async function (request, reply) {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    if (await hasPayoutAccess(fastify.db, request.user)) return;
    reply.code(403).send({ error: 'Forbidden', message: 'Нет доступа к странице выплат' });
  };
}

module.exports = {
  hasPayoutAccess,
  getPayoutManagerIds,
  requirePayoutAccess,
  loadIds,
  parseIds,
  clearCache,
  PAYOUT_BASE_ROLES,
  SETTING_KEY,
};
