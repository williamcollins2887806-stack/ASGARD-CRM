'use strict';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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

/**
 * @param {object} workHours — config.work_hours
 * @param {Date} now
 * @param {string} [tz='Europe/Moscow']
 */
function isWithinWorkHours(workHours, now, tz = 'Europe/Moscow') {
  if (!workHours || typeof workHours !== 'object') return true;
  let weekday;
  let minutes;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === 'weekday')?.value?.toLowerCase().slice(0, 3);
    const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    weekday = map[wd] ?? now.getUTCDay();
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    minutes = hour * 60 + minute;
  } catch (_) {
    weekday = now.getDay();
    minutes = now.getHours() * 60 + now.getMinutes();
  }
  const key = WEEKDAY_KEYS[weekday];
  const day = workHours[key];
  if (!day || day.start == null || day.end == null) return false;
  const start = parseTimeToMinutes(day.start);
  const end = parseTimeToMinutes(day.end);
  if (start == null || end == null) return false;
  return minutes >= start && minutes < end;
}

function isOperatorPaused(op, nowMs) {
  if (!op.paused_until) return false;
  const t = Date.parse(op.paused_until);
  return Number.isFinite(t) && t > nowMs;
}

function isOperatorReachable(op) {
  if (!op.can_accept || !op.on_line) return false;
  const hasWeb = op.webrtc_registered && !!op.sip_username;
  const hasMob = !!op.mobile_phone;
  if (op.receive_mode === 'browser') return hasWeb || hasMob;
  if (op.receive_mode === 'mobile') return hasMob;
  return hasWeb || hasMob;
}

function expandOperatorTargets(op, config) {
  const browserSec = config.browser_ring_sec ?? 5;
  const mobileSec = config.mobile_ring_sec ?? 20;
  /** @type {RingTarget[]} */
  const targets = [];
  const baseOrder = op.sort_order ?? 100;

  if (op.receive_mode === 'browser' || op.receive_mode === 'both') {
    if (op.webrtc_registered && op.sip_username) {
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
  if (op.receive_mode === 'browser' && !targets.length && op.mobile_phone) {
    targets.push({
      userId: op.user_id,
      targetType: 'mobile',
      targetAddr: op.mobile_phone,
      role: 'ring',
      ringSec: mobileSec,
      sortOrder: baseOrder,
    });
  }
  return targets;
}

function filterEligibleOperators(operators, nowMs) {
  return (operators || []).filter((op) => {
    if (!op.can_accept || !op.on_line) return false;
    if (isOperatorPaused(op, nowMs)) return false;
    if (shouldPauseOperator(op, { miss_pause_after: 999999 })) {
      /* streak alone does not block until advanceAfterMiss sets paused_until */
    }
    return isOperatorReachable(op);
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
      targets.push(...expandOperatorTargets(op, cfg));
    }
  } else {
    for (const op of ordered) {
      const expanded = expandOperatorTargets(op, cfg);
      if (expanded.length) {
        targets.push(...expanded);
        break;
      }
    }
    if (!targets.length && mode === 'duty_first' && ordered.length > 1) {
      for (const op of ordered.slice(1)) {
        const expanded = expandOperatorTargets(op, cfg);
        if (expanded.length) {
          targets.push(...expanded);
          break;
        }
      }
    }
    if (!targets.length && mode !== 'parallel') {
      for (const op of ordered) {
        targets.push(...expandOperatorTargets(op, cfg));
      }
    }
  }

  targets.sort((a, b) => a.sortOrder - b.sortOrder || a.userId - b.userId);
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

module.exports = {
  buildRingPlan,
  advanceAfterMiss,
  shouldPauseOperator,
  isWithinWorkHours,
  isOperatorPaused,
  filterEligibleOperators,
  expandOperatorTargets,
  parseTimeToMinutes,
};
