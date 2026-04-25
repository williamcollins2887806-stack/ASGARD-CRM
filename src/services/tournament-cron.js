/**
 * Tournament Cron — Real Weekly Bracket
 * ════════════════════════════════════════════════════════════════
 * Creates a new bracket every Monday 00:05 MSK (top-16 seeded by
 * all-time Сила Воина = shifts*10 + xp*5 + runes*8).
 * Finalizes (records champion) every Sunday 23:50 MSK.
 *
 * Bracket progression: weekly Сила Воина determines match winner.
 * Tiebreaker: higher all-time seed (lower seed number wins).
 */

'use strict';

const db = require('./db');

const MSK_OFFSET = 3 * 3600 * 1000; // UTC+3

function nowMsk() {
  // Returns a Date whose UTC fields represent MSK local time
  return new Date(Date.now() + MSK_OFFSET);
}

function toDateStr(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Get ISO week bounds (Monday–Sunday) for a given MSK Date
function getWeekBounds(mskDate) {
  const day = mskDate.getUTCDay(); // 0=Sun, 1=Mon…6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(mskDate);
  monday.setUTCDate(mskDate.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { weekStart: toDateStr(monday), weekEnd: toDateStr(sunday) };
}

// ─── All-time warrior_power top-16 for seeding ───────────────────────────────
async function getTop16ByAllTimeWarriorPower() {
  const { rows } = await db.query(`
    WITH earned AS (
      SELECT employee_id,
        SUM(CASE WHEN currency='runes' AND amount>0 THEN amount ELSE 0 END)::int AS earned_runes,
        SUM(CASE WHEN currency='xp'    AND amount>0 THEN amount ELSE 0 END)::int AS earned_xp
      FROM gamification_currency_ledger GROUP BY employee_id
    )
    SELECT
      e.id   AS employee_id,
      e.fio,
      (COALESCE(sh.shift_count,0)*10 + COALESCE(ea.earned_xp,0)*5 + COALESCE(ea.earned_runes,0)*8)::int AS warrior_power
    FROM employees e
    LEFT JOIN earned ea ON ea.employee_id = e.id
    LEFT JOIN (
      SELECT employee_id, COUNT(*)::int AS shift_count
      FROM field_checkins WHERE status='completed' GROUP BY employee_id
    ) sh ON sh.employee_id = e.id
    WHERE e.is_active = true
    ORDER BY warrior_power DESC
    LIMIT 16
  `);
  return rows;
}

// ─── Create tournament for current week (idempotent) ─────────────────────────
async function createWeeklyTournament(log) {
  try {
    const msk = nowMsk();
    const { weekStart, weekEnd } = getWeekBounds(msk);

    // Already exists?
    const { rows: [existing] } = await db.query(
      'SELECT id FROM gamification_tournaments WHERE week_start = $1', [weekStart]
    );
    if (existing) {
      if (log) log.info(`[TournamentCron] Week ${weekStart} — tournament #${existing.id} already exists`);
      return;
    }

    const top16 = await getTop16ByAllTimeWarriorPower();
    if (top16.length < 2) {
      if (log) log.info('[TournamentCron] Not enough active players to create tournament');
      return;
    }

    const seeding = top16.map((p, i) => ({
      seed: i + 1,
      employee_id: p.employee_id,
      fio: p.fio,
      warrior_power: parseInt(p.warrior_power) || 0,
    }));

    const { rows: [t] } = await db.query(`
      INSERT INTO gamification_tournaments (week_start, week_end, status, seeding)
      VALUES ($1, $2, 'active', $3::jsonb)
      ON CONFLICT (week_start) DO NOTHING
      RETURNING id
    `, [weekStart, weekEnd, JSON.stringify(seeding)]);

    if (t && log) {
      log.info(`[TournamentCron] Created tournament #${t.id} for ${weekStart}–${weekEnd} (${seeding.length} seeds)`);
    }
  } catch (err) {
    const msg = err?.message || String(err);
    if (log) log.error('[TournamentCron] createWeeklyTournament error:', msg);
    else console.error('[TournamentCron] createWeeklyTournament error:', msg);
  }
}

// ─── Finalize: record champion for active tournament ─────────────────────────
async function finalizeWeeklyTournament(log) {
  try {
    const msk = nowMsk();
    const { weekStart, weekEnd } = getWeekBounds(msk);

    const { rows: [tournament] } = await db.query(
      `SELECT * FROM gamification_tournaments WHERE week_start = $1 AND status = 'active'`,
      [weekStart]
    );
    if (!tournament) {
      if (log) log.info(`[TournamentCron] No active tournament for ${weekStart} to finalize`);
      return;
    }

    const seeding = tournament.seeding || [];
    const playerIds = seeding.map(s => s.employee_id);
    if (!playerIds.length) return;

    // Weekly warrior_power for each seeded player
    const { rows: weeklyRows } = await db.query(`
      WITH wc AS (
        SELECT employee_id,
          SUM(CASE WHEN currency='runes' AND amount>0 THEN amount ELSE 0 END)::int AS weekly_runes,
          SUM(CASE WHEN currency='xp'    AND amount>0 THEN amount ELSE 0 END)::int AS weekly_xp
        FROM gamification_currency_ledger
        WHERE employee_id = ANY($1)
          AND (created_at AT TIME ZONE 'Europe/Moscow')::date >= $2::date
          AND (created_at AT TIME ZONE 'Europe/Moscow')::date <= $3::date
        GROUP BY employee_id
      ),
      ws AS (
        SELECT employee_id, COUNT(*)::int AS weekly_shifts
        FROM field_checkins
        WHERE status='completed' AND employee_id = ANY($1)
          AND (checkin_at AT TIME ZONE 'Europe/Moscow')::date >= $2::date
          AND (checkin_at AT TIME ZONE 'Europe/Moscow')::date <= $3::date
        GROUP BY employee_id
      )
      SELECT e.id AS employee_id,
        (COALESCE(ws.weekly_shifts,0)*10 + COALESCE(wc.weekly_xp,0)*5 + COALESCE(wc.weekly_runes,0)*8)::int AS weekly_warrior_power
      FROM employees e
      LEFT JOIN wc ON wc.employee_id = e.id
      LEFT JOIN ws ON ws.employee_id = e.id
      WHERE e.id = ANY($1)
    `, [playerIds, weekStart, weekEnd]);

    const wmap = {};
    for (const r of weeklyRows) wmap[r.employee_id] = parseInt(r.weekly_warrior_power) || 0;

    // Build bracket to find champion
    const seeds = seeding.slice(0, 16);
    while (seeds.length < 16) seeds.push(null);

    function pw(s) { return s ? (wmap[s.employee_id] || 0) : 0; }
    function best(s1, s2) {
      if (!s1) return s2; if (!s2) return s1;
      const p1 = pw(s1), p2 = pw(s2);
      if (p1 !== p2) return p1 > p2 ? s1 : s2;
      return s1.seed < s2.seed ? s1 : s2; // lower seed# = stronger
    }

    const r1 = Array.from({ length: 8 }, (_, i) => best(seeds[i], seeds[15 - i]));
    const r2 = Array.from({ length: 4 }, (_, i) => best(r1[i * 2], r1[i * 2 + 1]));
    const r3 = Array.from({ length: 2 }, (_, i) => best(r2[i * 2], r2[i * 2 + 1]));
    const champion = best(r3[0], r3[1]);

    await db.query(`
      UPDATE gamification_tournaments
      SET status = 'completed', champion_id = $2, champion_name = $3, champion_power = $4, updated_at = NOW()
      WHERE id = $1
    `, [
      tournament.id,
      champion?.employee_id || null,
      champion?.fio || null,
      champion ? (wmap[champion.employee_id] || 0) : 0,
    ]);

    if (log) log.info(`[TournamentCron] Finalized #${tournament.id}. Champion: ${champion?.fio || '—'} (weekly СВ: ${champion ? (wmap[champion.employee_id] || 0) : 0})`);
  } catch (err) {
    const msg = err?.message || String(err);
    if (log) log.error('[TournamentCron] finalizeWeeklyTournament error:', msg);
    else console.error('[TournamentCron] finalizeWeeklyTournament error:', msg);
  }
}

// ─── Bootstrap: create current week's tournament if missing ──────────────────
async function bootstrapIfNeeded(log) {
  try {
    const { weekStart } = getWeekBounds(nowMsk());
    const { rows: [existing] } = await db.query(
      'SELECT id FROM gamification_tournaments WHERE week_start = $1', [weekStart]
    );
    if (!existing) {
      if (log) log.info('[TournamentCron] No tournament this week — bootstrapping...');
      await createWeeklyTournament(log);
    } else {
      if (log) log.info(`[TournamentCron] Current week tournament #${existing.id} already exists`);
    }
  } catch (err) {
    if (log) log.error('[TournamentCron] bootstrapIfNeeded error:', err?.message);
  }
}

// ─── Cron tick (runs every 5 min) ────────────────────────────────────────────
let _log = null;
let _lastCreateDay = -1;  // track which Monday we last created on
let _lastFinalizeDay = -1; // track which Sunday we last finalized on

function checkAndRun() {
  const msk = nowMsk();
  const dow = msk.getUTCDay();   // 0=Sun 1=Mon … 6=Sat
  const h   = msk.getUTCHours();
  const m   = msk.getUTCMinutes();
  const todayNum = parseInt(toDateStr(msk).replace(/-/g, ''));

  // Monday 00:00–00:15 MSK → create
  if (dow === 1 && h === 0 && m < 15 && _lastCreateDay !== todayNum) {
    _lastCreateDay = todayNum;
    createWeeklyTournament(_log).catch(() => {});
  }

  // Sunday 23:45–23:59 MSK → finalize
  if (dow === 0 && h === 23 && m >= 45 && _lastFinalizeDay !== todayNum) {
    _lastFinalizeDay = todayNum;
    finalizeWeeklyTournament(_log).catch(() => {});
  }
}

let _interval = null;

function start(log) {
  if (_interval) return;
  _log = log;
  // Bootstrap on startup (after 45s warmup to let DB settle)
  setTimeout(() => bootstrapIfNeeded(log), 45_000);
  // Check every 5 minutes
  _interval = setInterval(checkAndRun, 5 * 60 * 1000);
  if (log) log.info('[TournamentCron] Started (checks every 5 min)');
}

function stop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { start, stop, createWeeklyTournament, finalizeWeeklyTournament, bootstrapIfNeeded };
