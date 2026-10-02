'use strict';

/**
 * Жизненный цикл PBX-звонка: dial string, call_history, pbx_call_legs, NOTIFY.
 * Без заглушек — каждый шаг пишет реальные side-effects в БД.
 */

const { buildRingPlan } = require('./dial-engine');

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

/**
 * Один target → Asterisk Dial() tech/resource.
 * webrtc → PJSIP/<sip_username>
 * mobile → Local/<digits>@asgard-mobile-confirm (нажать 1)
 */
function targetToDialPart(target) {
  if (!target || !target.targetAddr) return null;
  if (target.targetType === 'webrtc') {
    return `PJSIP/${target.targetAddr}`;
  }
  const d = digitsOnly(target.targetAddr);
  if (!d) return null;
  return `Local/${d}@asgard-mobile-confirm`;
}

/**
 * @param {Array} targets — из buildRingPlan
 * @param {object} cfg
 * @returns {{ dialString: string, ringTimeout: number, firstTarget: object|null }}
 */
function buildDialVars(targets, cfg) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  const parallel = !!(cfg && (cfg.parallel_ring || cfg.routing_mode === 'parallel'));
  const parts = [];
  if (parallel) {
    for (const t of list) {
      const p = targetToDialPart(t);
      if (p) parts.push(p);
    }
  } else if (list.length) {
    const p = targetToDialPart(list[0]);
    if (p) parts.push(p);
  }
  const dialString = parts.join('&');
  let ringTimeout = cfg?.browser_ring_sec ?? 5;
  if (list[0]?.targetType === 'mobile') ringTimeout = cfg?.mobile_ring_sec ?? 20;
  if (parallel && list.length) {
    ringTimeout = Math.max(...list.map((t) => t.ringSec || ringTimeout));
  }
  return {
    dialString,
    ringTimeout: Math.max(1, Number(ringTimeout) || 5),
    firstTarget: list[0] || null,
  };
}

async function loadDutyUserIdMsk(client) {
  try {
    const { getCurrentDuty } = require('../services/tender-registry-helpers');
    const duty = await getCurrentDuty(client);
    if (duty?.pm_user_id) return duty.pm_user_id;
  } catch (_) { /* ignore */ }
  try {
    const { rows } = await client.query(
      `SELECT user_id FROM user_call_status WHERE is_duty = true LIMIT 1`
    );
    return rows[0]?.user_id ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * Создать строку call_history для PBX inbound.
 * call_id = pbx_<uid> — совместимо с PK varchar на проде.
 */
async function insertPbxCallHistory(client, { pbxUid, caller, toNumber, lookup, source = 'pbx' }) {
  const callId = 'pbx_' + String(pbxUid);
  const fromNum = caller || null;
  const clientInn = lookup?.inn || lookup?.customer_inn || null;
  const { rows } = await client.query(
    `INSERT INTO call_history (
       call_id, pbx_uid, source, direction, call_type, status,
       from_number, to_number, caller_number, called_number,
       client_inn, customer_id, started_at, timestamp, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'inbound', 'inbound', 'ringing',
       $4, $5, $4, $5,
       $6, $6, NOW(), NOW(), NOW(), NOW()
     )
     ON CONFLICT (call_id) DO UPDATE SET
       pbx_uid = EXCLUDED.pbx_uid,
       source = EXCLUDED.source,
       updated_at = NOW()
     RETURNING id, call_id, pbx_uid`,
    [callId, String(pbxUid), source, fromNum, toNumber || null, clientInn]
  );
  return rows[0];
}

async function insertCallLeg(client, {
  callId,
  legSeq = 1,
  userId = null,
  targetType,
  targetAddr = null,
  role = 'ring',
  outcome = null,
  ringMs = null,
  meta = {},
}) {
  const { rows } = await client.query(
    `INSERT INTO pbx_call_legs (
       call_id, leg_seq, user_id, target_type, target_addr, role, outcome, ring_ms, meta, started_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, NOW())
     RETURNING id`,
    [
      String(callId),
      legSeq,
      userId,
      targetType,
      targetAddr,
      role,
      outcome,
      ringMs,
      JSON.stringify(meta || {}),
    ]
  );
  return rows[0];
}

async function finishCallLeg(client, legId, outcome, extra = {}) {
  await client.query(
    `UPDATE pbx_call_legs SET
       outcome = $2,
       talk_ms = COALESCE($3, talk_ms),
       ended_at = NOW(),
       meta = COALESCE(meta, '{}'::jsonb) || $4::jsonb
     WHERE id = $1`,
    [legId, outcome, extra.talkMs ?? null, JSON.stringify(extra.meta || {})]
  );
}

async function markCallAnswered(client, pbxUid, userId) {
  await client.query(
    `UPDATE call_history SET
       status = 'answered',
       answered_by = $2,
       user_id = COALESCE(user_id, $2),
       outcome = 'answered',
       updated_at = NOW()
     WHERE pbx_uid = $1`,
    [String(pbxUid), userId]
  );
}

async function markCallMissed(client, pbxUid, outcome = 'no_answer') {
  await client.query(
    `UPDATE call_history SET
       call_type = 'missed',
       status = 'missed',
       outcome = $2,
       updated_at = NOW()
     WHERE pbx_uid = $1
     RETURNING id`,
    [String(pbxUid), outcome]
  );
}

/**
 * NOTIFY payload для CRM SSE (обязательны event + user_id).
 */
function buildRingNotifyPayload({ pbxUid, caller, lookup, target, channel, callHistoryId }) {
  const fromNumber = caller || null;
  const clientName = lookup?.name || lookup?.contact_person || null;
  const clientCompany = lookup?.company || null;
  return {
    event: 'call:incoming',
    user_id: target?.userId || null,
    data: {
      call_id: 'pbx_' + pbxUid,
      callId: 'pbx_' + pbxUid,
      pbx_uid: String(pbxUid),
      channel: channel || null,
      from: fromNumber,
      from_number: fromNumber,
      fromNumber,
      client_name: clientName,
      clientName,
      client_company: clientCompany,
      clientCompany,
      client_inn: lookup?.inn || null,
      lookup_type: lookup?.type || 'unknown',
      target_type: target?.targetType || null,
      history_id: callHistoryId || null,
    },
  };
}

/**
 * Нормализация admin UI ↔ dial-engine.
 * Admin писал dial_strategy / work_hours_from; engine ждёт routing_mode / work_hours.
 */
function normalizePbxConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? { ...raw } : {};
  if (cfg.dial_strategy && !cfg.routing_mode) {
    const map = {
      duty_first: 'duty_first',
      round_robin: 'round_robin',
      ordered: 'ordered',
      parallel: 'parallel',
      all: 'parallel',
    };
    cfg.routing_mode = map[cfg.dial_strategy] || cfg.dial_strategy;
  }
  if (!cfg.work_hours && (cfg.work_hours_from || cfg.work_hours_to)) {
    const start = cfg.work_hours_from || '09:00';
    const end = cfg.work_hours_to || '18:00';
    cfg.work_hours = {
      mon: { start, end },
      tue: { start, end },
      wed: { start, end },
      thu: { start, end },
      fri: { start, end },
      sat: null,
      sun: null,
    };
  }
  return cfg;
}

module.exports = {
  digitsOnly,
  targetToDialPart,
  buildDialVars,
  buildRingPlan,
  loadDutyUserIdMsk,
  insertPbxCallHistory,
  insertCallLeg,
  finishCallLeg,
  markCallAnswered,
  markCallMissed,
  buildRingNotifyPayload,
  normalizePbxConfig,
};
