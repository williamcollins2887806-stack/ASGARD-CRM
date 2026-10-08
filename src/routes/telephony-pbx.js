'use strict';

const crypto = require('crypto');
const { lookupCaller } = require('../services/caller-lookup');
const { config: pbxEnv } = require('../pbx/config');
const { normalizePbxConfig } = require('../pbx/call-lifecycle');
const { minutesUntilWorkEnd, isWithinWorkHours, resolveDutyUntilMinutes, getTzParts } = require('../pbx/dial-engine');
const { runOperatorMaintenance } = require('../pbx/operator-lifecycle');

const TEL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH'];
const PBX_ADMIN_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO'];

function pbxCmdBase() {
  const host = process.env.PBX_CMD_HOST || '127.0.0.1';
  const port = process.env.CMD_PORT || '4575';
  return `http://${host}:${port}`;
}

async function pbxFetch(pathname, opts = {}) {
  const secret = process.env.PBX_CMD_SECRET || pbxEnv.pbxCmdSecret;
  if (!secret) {
    const err = new Error('PBX_CMD_SECRET not configured');
    err.statusCode = 503;
    throw err;
  }
  const url = pbxCmdBase() + pathname;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-PBX-Secret': secret,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_) {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(body.error || `PBX command ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }
  return body;
}

function hashSipPassword(plain) {
  return crypto.createHash('sha256').update(String(plain)).digest('hex');
}

function genSipUsername(userId, name) {
  const slug = String(name || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12);
  return `u${userId}${slug ? '_' + slug : ''}`;
}

module.exports = async function telephonyPbxRoutes(fastify) {
  const db = fastify.db;

  async function syncOperatorMobilePhone(userId) {
    await db.query(
      `UPDATE pbx_operators o SET
         mobile_phone = COALESCE(
           NULLIF(BTRIM(o.mobile_phone), ''),
           NULLIF(BTRIM(u.phone), ''),
           NULLIF(BTRIM(ucs.fallback_mobile), '')
         ),
         updated_at = NOW()
       FROM users u
       LEFT JOIN user_call_status ucs ON ucs.user_id = u.id
       WHERE o.user_id = u.id AND o.user_id = $1
         AND (o.mobile_phone IS NULL OR BTRIM(o.mobile_phone) = '')`,
      [userId]
    );
  }

  async function ensureOperatorRow(userId) {
    await db.query(
      `INSERT INTO pbx_operators (user_id, receive_mode) VALUES ($1, 'both')
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    await syncOperatorMobilePhone(userId);
  }

  async function loadPbxCfg() {
    const { rows } = await db.query(`SELECT value_json FROM settings WHERE key = 'pbx_config' LIMIT 1`);
    let raw = rows[0]?.value_json || {};
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (_) { raw = {}; }
    }
    return normalizePbxConfig(raw);
  }

  // GET/POST /operator/status
  fastify.get('/operator/status', { preHandler: [fastify.authenticate] }, async (req) => {
    if (!TEL_ROLES.includes(req.user.role)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    await ensureOperatorRow(req.user.id);
    const { rows } = await db.query(
      `SELECT o.on_line, o.receive_mode, o.webrtc_registered, o.paused_until, o.miss_streak, o.last_seen_at,
              COALESCE(NULLIF(BTRIM(o.mobile_phone), ''), NULLIF(BTRIM(u.phone), ''), NULLIF(BTRIM(ucs.fallback_mobile), '')) AS mobile_phone,
              (o.sip_username IS NOT NULL AND o.sip_username <> '') AS has_sip
       FROM pbx_operators o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN user_call_status ucs ON ucs.user_id = o.user_id
       WHERE o.user_id = $1`,
      [req.user.id]
    );
    const st = rows[0] || { on_line: false, receive_mode: 'both', has_sip: false };
    const cfg = await loadPbxCfg();
    const now = new Date();
    const tz = cfg.timezone || 'Europe/Moscow';
    const minsLeft = minutesUntilWorkEnd(cfg, now, tz);
    const within = isWithinWorkHours(cfg.work_hours, now, tz);
    const parts = getTzParts(now, tz);
    const dutyUntilMin = resolveDutyUntilMinutes(cfg, parts.key);
    const hh = String(Math.floor(dutyUntilMin / 60)).padStart(2, '0');
    const mm = String(dutyUntilMin % 60).padStart(2, '0');
    const onlineCount = await db.query(
      `SELECT COUNT(*)::int AS n FROM pbx_operators WHERE on_line = true`
    );
    return {
      ...st,
      has_mobile: !!(st.mobile_phone),
      work_hours_active: within,
      minutes_to_work_end: minsLeft,
      duty_until: cfg.duty_until || `${hh}:${mm}`,
      online_count: onlineCount.rows[0]?.n || 0,
      reachability_ok: !st.on_line || !!(st.webrtc_registered || st.mobile_phone),
    };
  });

  fastify.post('/operator/status', { preHandler: [fastify.authenticate] }, async (req) => {
    if (!TEL_ROLES.includes(req.user.role)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    const { on_line } = req.body || {};
    let { receive_mode } = req.body || {};
    if (receive_mode != null && !['browser', 'mobile', 'both'].includes(receive_mode)) {
      receive_mode = undefined;
    }
    await ensureOperatorRow(req.user.id);
    const { rows } = await db.query(
      `UPDATE pbx_operators SET
         on_line = COALESCE($2, on_line),
         receive_mode = COALESCE($3, receive_mode),
         last_seen_at = NOW(),
         updated_at = NOW()
       WHERE user_id = $1
       RETURNING on_line, receive_mode, webrtc_registered, paused_until, miss_streak, last_seen_at`,
      [req.user.id, on_line, receive_mode]
    );
    return rows[0];
  });

  fastify.post('/operator/heartbeat', { preHandler: [fastify.authenticate] }, async (req) => {
    if (!TEL_ROLES.includes(req.user.role)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    await ensureOperatorRow(req.user.id);
    const { rows } = await db.query(
      `UPDATE pbx_operators SET last_seen_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND on_line = true
       RETURNING on_line, last_seen_at, webrtc_registered`,
      [req.user.id]
    );
    return rows[0] || { on_line: false, skipped: true };
  });

  fastify.post('/operator/maintenance', { preHandler: [fastify.authenticate, fastify.requireRoles(PBX_ADMIN_ROLES)] }, async (req) => {
    const result = await runOperatorMaintenance(db, {
      now: req.body?.now ? new Date(req.body.now) : new Date(),
      activeUserIds: Array.isArray(req.body?.active_user_ids) ? req.body.active_user_ids : [],
    });
    return { ok: true, ...result };
  });

  fastify.post('/operator/toggle', { preHandler: [fastify.authenticate] }, async (req) => {
    if (!TEL_ROLES.includes(req.user.role)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    await ensureOperatorRow(req.user.id);
    const { rows } = await db.query(
      `UPDATE pbx_operators SET on_line = NOT on_line, last_seen_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 RETURNING on_line, receive_mode`,
      [req.user.id]
    );
    return rows[0];
  });

  fastify.get('/softphone/credentials', { preHandler: [fastify.authenticate] }, async (req) => {
    if (!TEL_ROLES.includes(req.user.role)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    await ensureOperatorRow(req.user.id);
    const u = await db.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
    const name = u.rows[0]?.name;
    let { rows } = await db.query(
      'SELECT sip_username, sip_password, sip_password_hash FROM pbx_operators WHERE user_id = $1',
      [req.user.id]
    );
    let sipUsername = rows[0]?.sip_username;
    let plainPass = rows[0]?.sip_password || null;
    if (!sipUsername) {
      sipUsername = genSipUsername(req.user.id, name);
      plainPass = crypto.randomBytes(12).toString('base64url');
      await db.query(
        `UPDATE pbx_operators SET sip_username = $2, sip_password_hash = $3, sip_password = $4, updated_at = NOW() WHERE user_id = $1`,
        [req.user.id, sipUsername, hashSipPassword(plainPass), plainPass]
      );
    } else if (req.query.regenerate === '1' || !plainPass) {
      // Выданных паролей нет (миграция до V374) — выпустить новый.
      // PJSIP-эндпоинт заводится root-скриптом tools/provision_pjsip_operators.js.
      plainPass = crypto.randomBytes(12).toString('base64url');
      await db.query(
        `UPDATE pbx_operators SET sip_password_hash = $2, sip_password = $3, updated_at = NOW() WHERE user_id = $1`,
        [req.user.id, hashSipPassword(plainPass), plainPass]
      );
    }
    return {
      sip_username: sipUsername,
      sip_password: plainPass,
      ws_url: process.env.PBX_WS_PUBLIC_URL || '/pbx/ws',
      stun: process.env.PBX_STUN_URL || '',
    };
  });

  function callCtrl(action) {
    return async (req, reply) => {
      if (!TEL_ROLES.includes(req.user.role)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      try {
        const body = await pbxFetch(`/call/${action}`, {
          method: 'POST',
          body: JSON.stringify({ ...req.body, user_id: req.user.id }),
        });
        return body;
      } catch (e) {
        return reply.code(e.statusCode || 502).send({ error: e.message });
      }
    };
  }

  fastify.post('/call/answer', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!TEL_ROLES.includes(req.user.role)) return reply.code(403).send({ error: 'Forbidden' });
    try {
      return await pbxFetch('/call/answer', {
        method: 'POST',
        body: JSON.stringify({
          ...(req.body || {}),
          user_id: req.user.id,
          pbx_uid: (req.body && (req.body.pbx_uid || req.body.call_id || '')).toString().replace(/^pbx_/, ''),
        }),
      });
    } catch (e) {
      return reply.code(e.statusCode || 502).send({ error: e.message });
    }
  });
  fastify.post('/call/hangup', { preHandler: [fastify.authenticate] }, callCtrl('hangup'));
  fastify.post('/call/hold', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!TEL_ROLES.includes(req.user.role)) return reply.code(403).send({ error: 'Forbidden' });
    try {
      return await pbxFetch('/call/hold', {
        method: 'POST',
        body: JSON.stringify({
          channel: req.body?.channel,
          hold: req.body?.hold !== false,
        }),
      });
    } catch (e) {
      return reply.code(e.statusCode || 502).send({ error: e.message });
    }
  });
  fastify.post('/call/transfer', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!TEL_ROLES.includes(req.user.role)) return reply.code(403).send({ error: 'Forbidden' });
    try {
      return await pbxFetch('/call/transfer', {
        method: 'POST',
        body: JSON.stringify({
          channel: req.body?.channel,
          target: req.body?.target,
          mode: req.body?.mode || 'blind',
          user_id: req.user.id,
        }),
      });
    } catch (e) {
      return reply.code(e.statusCode || 502).send({ error: e.message });
    }
  });
  fastify.post('/call/outbound', { preHandler: [fastify.authenticate] }, callCtrl('originate'));

  fastify.post('/operator/webrtc', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!TEL_ROLES.includes(req.user.role)) return reply.code(403).send({ error: 'Forbidden' });
    try {
      return await pbxFetch('/operator/webrtc', {
        method: 'POST',
        body: JSON.stringify({
          user_id: req.user.id,
          registered: !!(req.body && req.body.registered),
        }),
      });
    } catch (e) {
      // Fallback: write DB directly if pbx CMD down
      await ensureOperatorRow(req.user.id);
      await db.query(
        `UPDATE pbx_operators SET webrtc_registered = $2, last_seen_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
        [req.user.id, !!(req.body && req.body.registered)]
      );
      return { ok: true, webrtc_registered: !!(req.body && req.body.registered), fallback: true };
    }
  });

  const { normalizePbxConfig } = require('../pbx/call-lifecycle');
  const { canViewCall, hasFullCallView } = require('../lib/telephony-access');

  // Staff list for transfer UI (PM+), not only PBX admins
  fastify.get('/transfer/staff', { preHandler: [fastify.authenticate] }, async (req) => {
    if (!TEL_ROLES.includes(req.user.role)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    const { rows } = await db.query(
      `SELECT o.user_id, u.name, u.role, o.on_line, o.receive_mode, o.miss_streak,
              o.webrtc_registered, o.last_seen_at, o.sip_username,
              COALESCE(NULLIF(BTRIM(o.mobile_phone), ''), NULLIF(BTRIM(u.phone), ''), NULLIF(BTRIM(ucs.fallback_mobile), '')) AS mobile_phone
       FROM pbx_operators o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN user_call_status ucs ON ucs.user_id = o.user_id
       WHERE u.is_active = true
       ORDER BY o.on_line DESC, o.sort_order, u.name`
    );
    return { staff: rows };
  });

  fastify.get('/settings', { preHandler: [fastify.authenticate, fastify.requireRoles(PBX_ADMIN_ROLES)] }, async () => {
    const { rows } = await db.query(`SELECT value_json FROM settings WHERE key = 'pbx_config'`);
    let raw = rows[0]?.value_json || {};
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (_) { raw = {}; }
    }
    return normalizePbxConfig(raw);
  });

  fastify.put('/settings', { preHandler: [fastify.authenticate, fastify.requireRoles(PBX_ADMIN_ROLES)] }, async (req) => {
    const value = normalizePbxConfig(req.body || {});
    await db.query(
      `INSERT INTO settings (key, value_json) VALUES ('pbx_config', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
      [JSON.stringify(value)]
    );
    return value;
  });

  fastify.get('/health', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!TEL_ROLES.includes(req.user.role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    try {
      const h = await pbxFetch('/health', { method: 'GET' });
      return h;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  fastify.get('/reports/journal', { preHandler: [fastify.authenticate] }, async (req) => {
    if (!TEL_ROLES.includes(req.user.role)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const full = hasFullCallView(req.user);
    const { rows } = await db.query(
      full
        ? `SELECT id, pbx_uid, source, from_number, to_number, call_type, outcome, wait_seconds,
                  answered_by, user_id, recording_url, started_at, ended_at, duration_seconds, client_inn
           FROM call_history
           WHERE source = 'pbx' OR pbx_uid IS NOT NULL
           ORDER BY COALESCE(started_at, created_at) DESC
           LIMIT $1`
        : `SELECT id, pbx_uid, source, from_number, to_number, call_type, outcome, wait_seconds,
                  answered_by, user_id, recording_url, started_at, ended_at, duration_seconds, client_inn
           FROM call_history
           WHERE (source = 'pbx' OR pbx_uid IS NOT NULL)
             AND (user_id = $2 OR answered_by = $2)
           ORDER BY COALESCE(started_at, created_at) DESC
           LIMIT $1`,
      full ? [limit] : [limit, req.user.id]
    );
    return { items: rows };
  });

  fastify.get('/reports/timeline/:callId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!TEL_ROLES.includes(req.user.role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const callId = req.params.callId;
    const hist = await db.query(
      `SELECT * FROM call_history WHERE pbx_uid = $1 OR call_id = $1 OR call_id = $2 LIMIT 1`,
      [callId, callId.startsWith('pbx_') ? callId : 'pbx_' + callId]
    );
    if (!hist.rows[0]) return reply.code(404).send({ error: 'Call not found' });
    if (!(await canViewCall(db, req.user, hist.rows[0]))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const legs = await db.query(
      `SELECT id, call_id, leg_seq, user_id, target_type, target_addr, role, outcome, ring_ms, talk_ms, started_at, ended_at, meta
       FROM pbx_call_legs WHERE call_id = $1 OR call_id = $2 ORDER BY leg_seq, started_at`,
      [hist.rows[0].call_id, hist.rows[0].pbx_uid]
    );
    return { call: hist.rows[0], legs: legs.rows };
  });

  fastify.get('/reports/staff', { preHandler: [fastify.authenticate, fastify.requireRoles(PBX_ADMIN_ROLES)] }, async () => {
    const { rows } = await db.query(
      `SELECT o.user_id, u.name, u.role, o.on_line, o.receive_mode, o.miss_streak, o.webrtc_registered, o.last_seen_at
       FROM pbx_operators o
       JOIN users u ON u.id = o.user_id
       ORDER BY o.sort_order, u.name`
    );
    return { staff: rows };
  });

  fastify.get('/reports/missed', { preHandler: [fastify.authenticate] }, async (req) => {
    if (!TEL_ROLES.includes(req.user.role)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    const full = hasFullCallView(req.user);
    const { rows } = await db.query(
      full
        ? `SELECT id, from_number, wait_seconds, started_at, client_inn, missed_acknowledged,
                  user_id, answered_by, pbx_uid, call_id
           FROM call_history
           WHERE call_type = 'missed' AND (source = 'pbx' OR pbx_uid IS NOT NULL)
           ORDER BY started_at DESC NULLS LAST
           LIMIT 100`
        : `SELECT id, from_number, wait_seconds, started_at, client_inn, missed_acknowledged,
                  user_id, answered_by, pbx_uid, call_id
           FROM call_history
           WHERE call_type = 'missed' AND (source = 'pbx' OR pbx_uid IS NOT NULL)
             AND (user_id = $1 OR answered_by = $1
                  OR EXISTS (
                    SELECT 1 FROM pbx_call_legs l
                    WHERE l.user_id = $1
                      AND (l.call_id = call_history.call_id OR l.call_id = call_history.pbx_uid)
                  ))
           ORDER BY started_at DESC NULLS LAST
           LIMIT 100`,
      full ? [] : [req.user.id]
    );
    return { items: rows };
  });

  fastify.get('/lookup/:phone', { preHandler: [fastify.authenticate] }, async (req) => {
    if (!TEL_ROLES.includes(req.user.role)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    return lookupCaller(db, req.params.phone);
  });

  // Fallback тик (если asgard-pbx не запущен): stale + work_hours offline
  const maint = setInterval(() => {
    runOperatorMaintenance(db).catch((e) => {
      fastify.log?.warn?.({ err: e }, 'pbx operator maintenance');
    });
  }, 60 * 1000);
  if (typeof maint.unref === 'function') maint.unref();
  fastify.addHook('onClose', async () => { clearInterval(maint); });
};

// Registration (parent index.js):
// fastify.register(require('./routes/telephony-pbx'), { prefix: '/api/telephony/pbx' });
