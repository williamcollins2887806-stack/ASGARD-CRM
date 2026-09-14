'use strict';

/**
 * Free/busy + find-time for Outlook-like scheduling assistant.
 * Sources: meetings, calendar_events, staff_plan, employees.official_* leave.
 */

const WORK_START = 9;  // 09:00 MSK
const WORK_END = 18;   // 18:00 MSK
const SLOT_MIN = 30;

/** staff_plan codes → availability kind */
const DAY_UNAVAILABLE = new Set(['бн', 'сс', 'вх']);
const DAY_BUSY_OFFSITE = new Set(['об', 'км', 'ск', 'пг']);
const DAY_AVAILABLE = new Set(['оф', 'уд', 'уч']);

function toYmd(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseMskLocal(ymd, hh = 0, mm = 0) {
  // Interpret as Europe/Moscow wall time → Date (UTC instant)
  const s = `${ymd}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+03:00`;
  return new Date(s);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * @returns {Promise<Map<number, Array<{start:Date,end:Date,kind:string,title?:string}>>>}
 */
async function loadBusyBlocks(db, userIds, fromDate, toDate, { revealTitles = false } = {}) {
  const ids = (userIds || []).map(Number).filter(Boolean);
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;

  const from = fromDate instanceof Date ? fromDate : new Date(fromDate);
  const to = toDate instanceof Date ? toDate : new Date(toDate);

  // Meetings (accepted/tentative/pending block; declined does not)
  const { rows: meetings } = await db.query(`
    SELECT m.id, m.title, m.start_time, m.end_time, mp.user_id, mp.rsvp_status
    FROM meetings m
    JOIN meeting_participants mp ON mp.meeting_id = m.id
    WHERE mp.user_id = ANY($1::int[])
      AND m.status IN ('scheduled', 'in_progress')
      AND COALESCE(mp.rsvp_status, 'pending') <> 'declined'
      AND m.start_time < $3
      AND COALESCE(m.end_time, m.start_time + interval '1 hour') > $2
  `, [ids, from, to]);

  for (const row of meetings) {
    const start = new Date(row.start_time);
    const end = row.end_time
      ? new Date(row.end_time)
      : new Date(start.getTime() + 3600000);
    map.get(row.user_id).push({
      start,
      end,
      kind: 'meeting',
      title: revealTitles ? row.title : undefined
    });
  }

  // Personal calendar_events
  const { rows: events } = await db.query(`
    SELECT id, title, date, time, end_date, end_time, created_by, type
    FROM calendar_events
    WHERE created_by = ANY($1::int[])
      AND date <= $3::date
      AND COALESCE(end_date, date) >= $2::date
  `, [ids, toYmd(from), toYmd(to)]);

  for (const ev of events) {
    const dateStr = String(ev.date).slice(0, 10);
    const [hh, mm] = String(ev.time || '09:00').split(':').map(Number);
    const start = parseMskLocal(dateStr, hh || 0, mm || 0);
    let end;
    if (ev.end_time) {
      const et = String(ev.end_time).slice(0, 5);
      const [eh, em] = et.split(':').map(Number);
      const endDate = ev.end_date ? String(ev.end_date).slice(0, 10) : dateStr;
      end = parseMskLocal(endDate, eh || 0, em || 0);
    } else {
      end = new Date(start.getTime() + 3600000);
    }
    map.get(ev.created_by).push({
      start,
      end,
      kind: 'personal',
      title: revealTitles ? ev.title : undefined
    });
  }

  // staff_plan via staff.user_id
  const { rows: plans } = await db.query(`
    SELECT s.user_id, sp.date, sp.status_code
    FROM staff_plan sp
    JOIN staff s ON s.id = sp.staff_id
    WHERE s.user_id = ANY($1::int[])
      AND sp.date >= $2::date
      AND sp.date <= $3::date
  `, [ids, toYmd(from), toYmd(to)]);

  for (const p of plans) {
    if (!p.user_id || !map.has(p.user_id)) continue;
    const code = String(p.status_code || '').toLowerCase();
    const d = String(p.date).slice(0, 10);
    if (DAY_UNAVAILABLE.has(code)) {
      map.get(p.user_id).push({
        start: parseMskLocal(d, 0, 0),
        end: parseMskLocal(d, 23, 59),
        kind: 'day_off',
        title: revealTitles ? code : undefined
      });
    } else if (DAY_BUSY_OFFSITE.has(code)) {
      map.get(p.user_id).push({
        start: parseMskLocal(d, WORK_START, 0),
        end: parseMskLocal(d, WORK_END, 0),
        kind: 'offsite',
        title: revealTitles ? code : undefined
      });
    }
    // оф/уд/уч = available in work hours — no block
  }

  // Official leave / maternity / sick / fired via employees.user_id
  try {
    const { rows: leaves } = await db.query(`
      SELECT user_id, official_status, official_leave_from, official_leave_to
      FROM employees
      WHERE user_id = ANY($1::int[])
        AND (
          official_status IN ('unpaid_leave', 'maternity', 'sick_leave', 'fired')
          OR (official_leave_from IS NOT NULL AND official_leave_to IS NOT NULL
              AND official_leave_from <= $3::date AND official_leave_to >= $2::date)
        )
    `, [ids, toYmd(from), toYmd(to)]);

    for (const L of leaves) {
      if (!L.user_id || !map.has(L.user_id)) continue;
      let leaveFrom = L.official_leave_from ? String(L.official_leave_from).slice(0, 10) : toYmd(from);
      let leaveTo = L.official_leave_to ? String(L.official_leave_to).slice(0, 10) : toYmd(to);
      if (L.official_status === 'fired' || L.official_status === 'maternity' || L.official_status === 'sick_leave') {
        if (!L.official_leave_from) leaveFrom = toYmd(from);
        if (!L.official_leave_to) leaveTo = toYmd(to);
      }
      map.get(L.user_id).push({
        start: parseMskLocal(leaveFrom, 0, 0),
        end: parseMskLocal(leaveTo, 23, 59),
        kind: 'leave',
        title: revealTitles ? L.official_status : undefined
      });
    }
  } catch (e) {
    // column may be missing on old DBs
  }

  return map;
}

/**
 * For weekends with no staff_plan row, treat as unavailable (unless we only care about busy blocks).
 * find-time uses work-hours + weekend skip.
 */
function isWeekendYmd(ymd) {
  // Use MSK noon to get weekday
  const d = parseMskLocal(ymd, 12, 0);
  const wd = d.getUTCDay(); // careful: Date in +03 — getDay is local server TZ
  // Better: parse weekday from MSK
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', weekday: 'short' });
  const w = fmt.format(parseMskLocal(ymd, 12, 0));
  return w === 'Sat' || w === 'Sun';
}

function eachYmd(from, to, cb) {
  let cur = toYmd(from);
  const end = toYmd(to);
  while (cur <= end) {
    cb(cur);
    const [y, m, d] = cur.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  }
}

/**
 * Availability payload for UI planner.
 */
async function getAvailability(db, userIds, from, to, opts = {}) {
  const blocksMap = await loadBusyBlocks(db, userIds, from, to, opts);
  const users = {};
  for (const [uid, blocks] of blocksMap) {
    users[uid] = blocks.map((b) => ({
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      kind: b.kind,
      title: b.title || null
    }));
  }
  return { users, work_hours: { start: WORK_START, end: WORK_END, timezone: 'Europe/Moscow' } };
}

/**
 * Find slots where all (or all-but-N) users are free.
 */
async function findTime(db, {
  user_ids,
  duration_minutes = 60,
  window_from,
  window_to,
  allow_missing = 0
}) {
  const ids = (user_ids || []).map(Number).filter(Boolean);
  const durationMs = Math.max(SLOT_MIN, Number(duration_minutes) || 60) * 60 * 1000;
  const from = new Date(window_from);
  const to = new Date(window_to);
  if (!ids.length || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { slots: [] };
  }

  const blocksMap = await loadBusyBlocks(db, ids, from, to);

  // Preload which days have "оф/уд" plan (weekend override)
  const { rows: availPlans } = await db.query(`
    SELECT s.user_id, sp.date, sp.status_code
    FROM staff_plan sp
    JOIN staff s ON s.id = sp.staff_id
    WHERE s.user_id = ANY($1::int[])
      AND sp.date >= $2::date AND sp.date <= $3::date
  `, [ids, toYmd(from), toYmd(to)]);
  const planByUserDay = new Map();
  for (const p of availPlans) {
    planByUserDay.set(`${p.user_id}|${String(p.date).slice(0, 10)}`, String(p.status_code || '').toLowerCase());
  }

  const slots = [];
  const softSlots = []; // allow_missing > 0

  eachYmd(from, to, (ymd) => {
    const weekend = isWeekendYmd(ymd);

    for (let mins = WORK_START * 60; mins + duration_minutes / 1 <= WORK_END * 60; mins += SLOT_MIN) {
      const hh = Math.floor(mins / 60);
      const mm = mins % 60;
      const slotStart = parseMskLocal(ymd, hh, mm);
      const slotEnd = new Date(slotStart.getTime() + durationMs);
      if (slotStart < from || slotEnd > to) continue;
      if (slotEnd.getTime() - parseMskLocal(ymd, WORK_END, 0).getTime() > 0) continue;

      const blockers = [];
      for (const uid of ids) {
        const code = planByUserDay.get(`${uid}|${ymd}`);
        if (weekend && !DAY_AVAILABLE.has(code || '')) {
          blockers.push({ user_id: uid, reason: 'weekend' });
          continue;
        }
        if (code && DAY_UNAVAILABLE.has(code)) {
          blockers.push({ user_id: uid, reason: 'day_off' });
          continue;
        }
        if (code && DAY_BUSY_OFFSITE.has(code)) {
          blockers.push({ user_id: uid, reason: 'offsite' });
          continue;
        }
        const blocks = blocksMap.get(uid) || [];
        const hit = blocks.find((b) => overlaps(slotStart, slotEnd, b.start, b.end));
        if (hit) blockers.push({ user_id: uid, reason: hit.kind });
      }

      const freeCount = ids.length - blockers.length;
      if (blockers.length === 0) {
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          free_count: freeCount,
          blockers: []
        });
      } else if (blockers.length <= allow_missing) {
        softSlots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          free_count: freeCount,
          blockers
        });
      }
    }
  });

  // Cap results
  const perfect = slots.slice(0, 40);
  const soft = softSlots.slice(0, 20);
  return { slots: perfect.length ? perfect : soft, perfect_count: perfect.length };
}

module.exports = {
  getAvailability,
  findTime,
  loadBusyBlocks,
  WORK_START,
  WORK_END,
  SLOT_MIN
};
