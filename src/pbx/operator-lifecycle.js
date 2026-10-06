'use strict';

/**
 * Фоновая гигиена линии: stale heartbeat → offline; конец work_hours / duty_until.
 */

const {
  isWithinWorkHours,
  isWithinDutyWindow,
  resolveDutyUntilMinutes,
  getTzParts,
} = require('./dial-engine');
const { loadDutyUserIdMsk, normalizePbxConfig } = require('./call-lifecycle');

const STALE_INTERVAL = '2 minutes';

/**
 * Снять с линии операторов без heartbeat, если нет активного звонка.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number[]} [activeUserIds] — user_id с активным каналом (не трогать)
 */
async function applyStaleOffline(db, activeUserIds = []) {
  const protect = (activeUserIds || []).filter((id) => Number.isFinite(Number(id))).map(Number);
  const { rows } = await db.query(
    `UPDATE pbx_operators SET
       on_line = false,
       webrtc_registered = false,
       updated_at = NOW()
     WHERE on_line = true
       AND (last_seen_at IS NULL OR last_seen_at < NOW() - $1::interval)
       AND NOT (user_id = ANY($2::int[]))
     RETURNING user_id`,
    [STALE_INTERVAL, protect]
  );
  return rows.map((r) => r.user_id);
}

/**
 * Вне work_hours: всех on_line=false, кроме текущего дежурного в окне duty_until.
 * Если duty_until прошёл — дежурного тоже снять.
 */
async function applyWorkHoursOffline(db, rawConfig, now = new Date()) {
  const cfg = normalizePbxConfig(rawConfig || {});
  const tz = cfg.timezone || 'Europe/Moscow';
  const within = isWithinWorkHours(cfg.work_hours, now, tz);
  if (within) {
    return { action: 'within_hours', offline: [] };
  }

  const dutyUserId = await loadDutyUserIdMsk(db);
  const dutyOk = dutyUserId && isWithinDutyWindow(cfg, now, tz);

  let rows;
  if (dutyOk) {
    const r = await db.query(
      `UPDATE pbx_operators SET on_line = false, webrtc_registered = false, updated_at = NOW()
       WHERE on_line = true AND user_id <> $1
       RETURNING user_id`,
      [dutyUserId]
    );
    rows = r.rows;
    return { action: 'after_hours_keep_duty', dutyUserId, offline: rows.map((x) => x.user_id) };
  }

  const r = await db.query(
    `UPDATE pbx_operators SET on_line = false, webrtc_registered = false, updated_at = NOW()
     WHERE on_line = true
     RETURNING user_id`
  );
  rows = r.rows;
  return {
    action: dutyUserId ? 'duty_until_expired' : 'after_hours_all',
    dutyUserId: dutyUserId || null,
    offline: rows.map((x) => x.user_id),
  };
}

async function loadPbxConfigFromDb(db) {
  const { rows } = await db.query(
    `SELECT value_json FROM settings WHERE key = 'pbx_config' LIMIT 1`
  );
  let raw = rows[0]?.value_json || {};
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { raw = {}; }
  }
  return normalizePbxConfig(raw);
}

/**
 * Один тик обслуживания (раз в минуту).
 */
async function runOperatorMaintenance(db, { now = new Date(), activeUserIds = [] } = {}) {
  const stale = await applyStaleOffline(db, activeUserIds);
  const cfg = await loadPbxConfigFromDb(db);
  const hours = await applyWorkHoursOffline(db, cfg, now);
  const tz = cfg.timezone || 'Europe/Moscow';
  const parts = getTzParts(now, tz);
  const dutyUntil = resolveDutyUntilMinutes(cfg, parts.key);
  return { stale, hours, duty_until_minutes: dutyUntil, at: now.toISOString() };
}

module.exports = {
  applyStaleOffline,
  applyWorkHoursOffline,
  runOperatorMaintenance,
  loadPbxConfigFromDb,
  STALE_INTERVAL,
};
