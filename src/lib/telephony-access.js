'use strict';

/** Roles that see all telephony calls / reports. */
const TEL_FULL_VIEW_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO'];
const TEL_ADMIN_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const TEL_SETTINGS_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO'];

function hasFullCallView(user) {
  return !!(user && TEL_FULL_VIEW_ROLES.includes(user.role));
}

/**
 * Can the user view this call_history row?
 * Full-view roles: yes. Others: only if they participated (user_id, answered_by, or a pbx leg).
 */
async function canViewCall(db, user, callRow) {
  if (!user || !callRow) return false;
  if (hasFullCallView(user)) return true;
  const uid = user.id;
  if (callRow.user_id === uid || callRow.answered_by === uid) return true;
  if (callRow.pbx_uid || callRow.call_id) {
    const callKey =
      callRow.call_id ||
      (callRow.pbx_uid ? (String(callRow.pbx_uid).startsWith('pbx_') ? callRow.pbx_uid : 'pbx_' + callRow.pbx_uid) : null);
    try {
      const r = await db.query(
        `SELECT 1 FROM pbx_call_legs WHERE call_id = $1 AND user_id = $2 LIMIT 1`,
        [callKey, uid]
      );
      if (r.rows.length) return true;
    } catch (_) {
      /* таблица ещё не создана до V359 */
    }
  }
  return false;
}

async function loadCallForAccess(db, callId) {
  const id = parseInt(callId, 10);
  if (!id || id < 1 || Number.isNaN(id)) return null;
  const res = await db.query(
    `SELECT id, user_id, answered_by, pbx_uid, call_id, record_path, recording_id, recording_url
     FROM call_history WHERE id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

/** Resolve absolute path under allowed recording roots only. */
function resolveSafeRecordPath(recordPath) {
  if (!recordPath || typeof recordPath !== 'string') return null;
  const path = require('path');
  const resolved = path.resolve(recordPath);
  const allowedRoots = [
    path.resolve(process.env.TELEPHONY_RECORD_DIR || '/var/lib/asgard-crm/recordings'),
    path.resolve(process.env.TELEPHONY_LEGACY_RECORD_DIR || '/var/www/asgard-crm/uploads/recordings'),
  ];
  const ok = allowedRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
  return ok ? resolved : null;
}

module.exports = {
  TEL_FULL_VIEW_ROLES,
  TEL_ADMIN_ROLES,
  TEL_SETTINGS_ROLES,
  hasFullCallView,
  canViewCall,
  loadCallForAccess,
  resolveSafeRecordPath,
};
