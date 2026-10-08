'use strict';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HEARTBEAT_TTL_MS = 120000; // 2 min — без свежего heartbeat browser ≠ на линии

/**
 * @typedef {object} PbxOperator
 * @property {number} user_id
 * @property {boolean} can_accept
 * @property {number} sort_order
 * @property {string} receive_mode
 * @property {boolean} on_line
 * @property {string|null} mobile_phone
 * @property {string|null} sip_username
 * @property {number} miss_streak
 * @property {string|null} paused_until ISO
 * @property {boolean} webrtc_registered
 * @property {string|null} last_seen_at ISO
 */

/**
 * @typedef {object} RingTarget
 * @property {number} userId
 * @property {'webrtc'|'mobile'} targetType
 * @property {string} targetAddr
 * @property {'ring'} role
 * @property {number} ringSec
 * @property {number} sortOrder
 */

function parseTimeToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function getTzParts(now, tz = 'Europe/Moscow') {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === 'weekday')?.value?.toLowerCase().slice(0, 3);
    const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const weekday = map[wd] ?? now.getUTCDay();
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    return { weekday, minutes: hour * 60 + minute, key: WEEKDAY_KEYS[weekday] };
  } catch (_) {
    const weekday = now.getDay();
    return {
      weekday,
      minutes: now.getHours() * 60 + now.getMinutes(),
      key: WEEKDAY_KEYS[weekday],
    };
  }
}

/**
 * @param {object} workHours — config.work_hours
 * @param {Date} now
 * @param {string} [tz='Europe/Moscow']
 */
function isWithinWorkHours(workHours, now, tz = 'Europe/Moscow') {
  if (!workHours || typeof workHours !== 'object') return true;
  const { weekday, minutes } = getTzParts(now, tz);
  const key = WEEKDAY_KEYS[weekday];
  const day = workHours[key];
  if (!day || day.start == null || day.end == null) return false;
  const start = parseTimeToMinutes(day.start);
  const end = parseTimeToMinutes(day.end);
  if (start == null || end == null) return false;
  return minutes >= start && minutes < end;
}

/**
 * Дежурство после конца work_hours до duty_until (default end+2h).
 */
function resolveDutyUntilMinutes(cfg, weekdayKey) {
  if (cfg && cfg.duty_until) {
    const d = parseTimeToMinutes(String(cfg.duty_until));
    if (d != null) return d;
  }
  const day = cfg && cfg.work_hours && cfg.work_hours[weekdayKey];
  const endStr = (day && day.end) || (cfg && cfg.work_hours_to) || '18:00';
  const end = parseTimeToMinutes(endStr);
  if (end == null) return 20 * 60;
  return Math.min(end + 120, 24 * 60 - 1);
}

/**
 * true если сейчас в окне «дежурный может оставаться on_line» после конца смены.
 */
function isWithinDutyWindow(cfg, now, tz = 'Europe/Moscow') {
  const config = cfg || {};
  const { weekday, minutes, key } = getTzParts(now, tz);
  const day = config.work_hours && config.work_hours[key];
  if (!day || day.end == null) return false;
  const end = parseTimeToMinutes(day.end);
  if (end == null) return false;
  const dutyUntil = resolveDutyUntilMinutes(config, key);
  if (dutyUntil > end) {
    return minutes >= end && minutes < dutyUntil;
  }
  // duty_until через полночь
  return minutes >= end || minutes < dutyUntil;
}

function minutesUntilWorkEnd(cfg, now, tz = 'Europe/Moscow') {
  const config = cfg || {};
  const { weekday, minutes, key } = getTzParts(now, tz);
  const day = config.work_hours && config.work_hours[key];
  if (!day || day.end == null) return null;
  const end = parseTimeToMinutes(day.end);
  if (end == null) return null;
  return end - minutes;
}

function isOperatorPaused(op, nowMs) {
  if (!op.paused_until) return false;
  const t = Date.parse(op.paused_until);
  return Number.isFinite(t) && t > nowMs;
}

function isHeartbeatFresh(op, nowMs, ttlMs = HEARTBEAT_TTL_MS) {
  if (!op || !op.last_seen_at) return false;
  const t = Date.parse(op.last_seen_at);
  return Number.isFinite(t) && (nowMs - t) <= ttlMs;
}

function hasFreshWebRtc(op, nowMs) {
  return !!(op.webrtc_registered && op.sip_username && isHeartbeatFresh(op, nowMs));
}

function isOperatorReachable(op, nowMs = Date.now()) {
  if (!op.can_accept || !op.on_line) return false;
  const hasWeb = hasFreshWebRtc(op, nowMs);
  const hasMob = !!op.mobile_phone;
  // «browser» = чистый WebRTC: без зарегистрированного SIP оператор не на линии.
  if (op.receive_mode === 'browser') return hasWeb;
  if (op.receive_mode === 'mobile') return hasMob;
  return hasWeb || hasMob;
}

function expandOperatorTargets(op, config, nowMs = Date.now()) {
  const browserSec = config.browser_ring_sec ?? 10;
  const mobileSec = config.mobile_ring_sec ?? 30;
  /** @type {RingTarget[]} */
  const targets = [];
  const baseOrder = op.sort_order ?? 100;
  const freshWeb = hasFreshWebRtc(op, nowMs);

  if (op.receive_mode === 'browser' || op.receive_mode === 'both') {
    if (freshWeb) {
      targets.push({
        userId: op.user_id,
        targetType: 'webrtc',
        targetAddr: op.sip_username,
        role: 'ring',
        ringSec: browserSec,
        sortOrder: baseOrder,
      });
    }
  }
  if ((op.receive_mode === 'mobile' || op.receive_mode === 'both') && op.mobile_phone) {
    targets.push({
      userId: op.user_id,
      targetType: 'mobile',
      targetAddr: op.mobile_phone,
      role: 'ring',
      ringSec: mobileSec,
      sortOrder: baseOrder + 1,
    });
  }
  // 'browser' — строго WebRTC. Никакого авто-фолбэка на GSM.
  return targets;
}

function filterEligibleOperators(operators, nowMs) {
  return (operators || []).filter((op) => {
    if (!op.can_accept || !op.on_line) return false;
    if (isOperatorPaused(op, nowMs)) return false;
    if (shouldPauseOperator(op, { miss_pause_after: 999999 })) {
      /* streak alone does not block until advanceAfterMiss sets paused_until */
    }
    return isOperatorReachable(op, nowMs);
  });
}

/**
 * Round-robin: сортировка по last_seen_at (старее — раньше), затем sort_order.
 */
function sortRoundRobin(ops) {
  return [...ops].sort((a, b) => {
    const la = a.last_seen_at ? Date.parse(a.last_seen_at) : 0;
    const lb = b.last_seen_at ? Date.parse(b.last_seen_at) : 0;
    if (la !== lb) return la - lb;
    return (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.user_id - b.user_id;
  });
}

function sortOrdered(ops) {
  return [...ops].sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.user_id - b.user_id);
}

/**
 * @param {PbxOperator[]} operators
 * @param {number|null} dutyUserId
 * @param {object} config — pbx_config JSON
 * @param {Date} [now=new Date()]
 * @returns {{ withinHours: boolean, targets: RingTarget[], mode: string }}
 */
function buildRingPlan(operators, dutyUserId, config, now = new Date()) {
  const cfg = config || {};
  const nowMs = now.getTime();
  const tz = cfg.timezone || 'Europe/Moscow';
  const withinHours = isWithinWorkHours(cfg.work_hours, now, tz);
  if (!withinHours) {
    return { withinHours: false, targets: [], mode: cfg.routing_mode || 'duty_first' };
  }

  const eligible = filterEligibleOperators(operators, nowMs);
  if (!eligible.length) {
    return { withinHours: true, targets: [], mode: cfg.routing_mode || 'duty_first' };
  }

  const mode = cfg.routing_mode || 'duty_first';
  const parallel = !!cfg.parallel_ring || mode === 'parallel';
  const maxAgents = Math.max(1, Number(cfg.max_agents) || 3);
  /** @type {PbxOperator[]} */
  let ordered = eligible;

  if (mode === 'duty_first' && dutyUserId) {
    const duty = eligible.find((o) => o.user_id === dutyUserId);
    const rest = sortRoundRobin(eligible.filter((o) => o.user_id !== dutyUserId));
    ordered = duty ? [duty, ...rest] : sortRoundRobin(eligible);
  } else if (mode === 'round_robin' || (mode === 'duty_first' && cfg.fallback_routing === 'round_robin')) {
    ordered = sortRoundRobin(eligible);
  } else if (mode === 'ordered') {
    ordered = sortOrdered(eligible);
  } else if (mode === 'parallel') {
    ordered = sortOrdered(eligible);
  } else {
    ordered = sortRoundRobin(eligible);
  }

  /** @type {RingTarget[]} */
  const targets = [];
  if (parallel) {
    for (const op of ordered) {
      targets.push(...expandOperatorTargets(op, cfg, nowMs));
    }
  } else {
    let agentsTaken = 0;
    for (const op of ordered) {
      const expanded = expandOperatorTargets(op, cfg, nowMs);
      if (!expanded.length) continue;
      targets.push(...expanded);
      agentsTaken += 1;
      if (agentsTaken >= maxAgents) break;
    }
  }

  // Перенумеровать sortOrder по порядку каскада (агент → webrtc затем mobile)
  targets.forEach((t, i) => { t.sortOrder = i; });
  return { withinHours: true, targets, mode };
}

/**
 * После пропуска звонка оператором.
 * @returns {{ miss_streak: number, paused_until: string|null }}
 */
function advanceAfterMiss(operator, config, now = new Date()) {
  const cfg = config || {};
  const threshold = cfg.miss_pause_after ?? 3;
  const pauseMin = cfg.miss_pause_minutes ?? 15;
  const streak = (operator.miss_streak ?? 0) + 1;
  let paused_until = operator.paused_until || null;
  if (streak >= threshold) {
    paused_until = new Date(now.getTime() + pauseMin * 60 * 1000).toISOString();
  }
  return { miss_streak: streak, paused_until };
}

function shouldPauseOperator(operator, config) {
  const threshold = (config && config.miss_pause_after) ?? 3;
  return (operator.miss_streak ?? 0) >= threshold;
}

/**
 * Резолв цели перевода → ring targets (webrtc/GSM) как inbound.
 * @param {object|null} op — строка pbx_operators (+ mobile_phone)
 * @param {object} config
 * @param {Date} [now]
 */
function resolveTransferTargets(op, config, now = new Date()) {
  if (!op) return [];
  return expandOperatorTargets(
    {
      ...op,
      can_accept: op.can_accept !== false,
      on_line: op.on_line !== false,
    },
    config || {},
    now.getTime()
  );
}

module.exports = {
  buildRingPlan,
  advanceAfterMiss,
  shouldPauseOperator,
  isWithinWorkHours,
  isWithinDutyWindow,
  resolveDutyUntilMinutes,
  minutesUntilWorkEnd,
  isOperatorPaused,
  isHeartbeatFresh,
  isOperatorReachable,
  filterEligibleOperators,
  expandOperatorTargets,
  resolveTransferTargets,
  parseTimeToMinutes,
  getTzParts,
  HEARTBEAT_TTL_MS,
};
