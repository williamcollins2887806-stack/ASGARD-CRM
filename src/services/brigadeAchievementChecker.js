/**
 * Brigade Achievement Checker
 * ═══════════════════════════════════════════════════════════════
 * Checks and grants brigade achievements for all active members of a work.
 * Called: after checkout (fire-and-forget), via daily cron.
 *
 * Brigade = all active workers on same work_id.
 * Each achievement is granted once per brigade (tracked in brigade_achievement_log),
 * then credited to every active member's employee_achievements + points.
 */

const BRIGADE_ACHIEVEMENTS = {
  brigade_first_blood: {
    points: 15,
    // All active members have ≥1 completed checkin on this work
    async check(db, workId, memberIds) {
      if (memberIds.length === 0) return false;
      const { rows: [{ cnt }] } = await db.query(`
        SELECT COUNT(DISTINCT employee_id)::int as cnt
        FROM field_checkins
        WHERE work_id = $1 AND status = 'completed'
          AND employee_id = ANY($2::int[])
      `, [workId, memberIds]);
      return cnt >= memberIds.length;
    },
  },

  brigade_iron_pact: {
    points: 40,
    // All active members passed the latest published mandatory lesson
    async check(db, workId, memberIds) {
      if (memberIds.length === 0) return false;
      const { rows: [lesson] } = await db.query(`
        SELECT id FROM academy_lessons
        WHERE status = 'published' AND is_mandatory = true
        ORDER BY week_number DESC LIMIT 1
      `);
      if (!lesson) return false;
      const { rows: [{ cnt }] } = await db.query(`
        SELECT COUNT(*)::int as cnt
        FROM academy_worker_progress
        WHERE lesson_id = $1 AND passed = true
          AND employee_id = ANY($2::int[])
      `, [lesson.id, memberIds]);
      return cnt >= memberIds.length;
    },
  },

  brigade_no_weakness: {
    points: 50,
    // No penalties for any member in last 14 days
    async check(db, workId, memberIds) {
      if (memberIds.length === 0) return false;
      const { rows: [{ cnt }] } = await db.query(`
        SELECT COUNT(*)::int as cnt
        FROM worker_payments
        WHERE type = 'penalty'
          AND created_at > NOW() - INTERVAL '14 days'
          AND employee_id = ANY($1::int[])
      `, [memberIds]);
      return cnt === 0;
    },
  },

  brigade_century: {
    points: 75,
    // Brigade total completed checkins on this work ≥ 100
    async check(db, workId, memberIds) {
      if (memberIds.length === 0) return false;
      const { rows: [{ cnt }] } = await db.query(`
        SELECT COUNT(*)::int as cnt
        FROM field_checkins
        WHERE work_id = $1 AND status = 'completed'
          AND employee_id = ANY($2::int[])
      `, [workId, memberIds]);
      return cnt >= 100;
    },
  },

  brigade_war_machine: {
    points: 75,
    async check(db, workId, memberIds) {
      if (memberIds.length === 0) return false;
      const { rows: [{ cnt }] } = await db.query(`
        SELECT COUNT(*)::int as cnt
        FROM field_checkins
        WHERE work_id = $1 AND status = 'completed'
          AND employee_id = ANY($2::int[])
      `, [workId, memberIds]);
      return cnt >= 300;
    },
  },

  brigade_gold_rush: {
    points: 60,
    // Brigade total amount_earned on this work ≥ 500 000 ₽
    async check(db, workId, memberIds) {
      if (memberIds.length === 0) return false;
      const { rows: [{ total }] } = await db.query(`
        SELECT COALESCE(SUM(amount_earned), 0) as total
        FROM field_checkins
        WHERE work_id = $1 AND status = 'completed'
          AND employee_id = ANY($2::int[])
      `, [workId, memberIds]);
      return parseFloat(total) >= 500000;
    },
  },

  brigade_legends: {
    points: 100,
    async check(db, workId, memberIds) {
      if (memberIds.length === 0) return false;
      const { rows: [{ cnt }] } = await db.query(`
        SELECT COUNT(*)::int as cnt
        FROM field_checkins
        WHERE work_id = $1 AND status = 'completed'
          AND employee_id = ANY($2::int[])
      `, [workId, memberIds]);
      return cnt >= 1000;
    },
  },

  brigade_all_masters: {
    points: 45,
    // Every member has ≥1 achievement from the 'mastery' category
    async check(db, workId, memberIds) {
      if (memberIds.length === 0) return false;
      const { rows: [{ cnt }] } = await db.query(`
        SELECT COUNT(DISTINCT ea.employee_id)::int as cnt
        FROM employee_achievements ea
        JOIN worker_achievements wa ON wa.id = ea.achievement_id
        WHERE wa.category = 'mastery'
          AND ea.employee_id = ANY($1::int[])
      `, [memberIds]);
      return cnt >= memberIds.length;
    },
  },
};

/**
 * Grant a brigade achievement to every active member of the work.
 * Inserts into brigade_achievement_log for dedup, then credits each member.
 */
async function grantToAll(db, workId, achId, points, memberIds) {
  // Log brigade-level earn (UNIQUE guard — skips if already granted)
  const { rows: logged } = await db.query(`
    INSERT INTO brigade_achievement_log (work_id, achievement_id, member_count)
    VALUES ($1, $2, $3)
    ON CONFLICT (work_id, achievement_id) DO NOTHING
    RETURNING id
  `, [workId, achId, memberIds.length]);

  if (logged.length === 0) return; // already granted before

  // Credit each member individually
  for (const eid of memberIds) {
    try {
      const { rows: inserted } = await db.query(`
        INSERT INTO employee_achievements (employee_id, achievement_id, earned_at, metadata)
        VALUES ($1, $2, NOW(), $3)
        ON CONFLICT DO NOTHING RETURNING id
      `, [eid, achId, JSON.stringify({ brigade: true, work_id: workId })]);

      if (inserted.length > 0 && points > 0) {
        await db.query(`
          INSERT INTO achievement_points_balance (employee_id, points_balance, points_earned_total)
          VALUES ($1, $2, $2)
          ON CONFLICT (employee_id) DO UPDATE SET
            points_balance = achievement_points_balance.points_balance + $2,
            points_earned_total = achievement_points_balance.points_earned_total + $2,
            updated_at = NOW()
        `, [eid, points]);
      }
    } catch { /* skip individual errors */ }
  }
}

/**
 * Check and grant all brigade achievements for a given work.
 * @param {object} db - PostgreSQL pool
 * @param {number} workId
 */
async function checkBrigadeAchievements(db, workId) {
  const wid = parseInt(workId, 10);
  if (!Number.isFinite(wid) || wid <= 0) return;

  // Get active brigade members
  const { rows: members } = await db.query(`
    SELECT DISTINCT employee_id
    FROM employee_assignments
    WHERE work_id = $1 AND is_active = true
  `, [wid]);

  if (members.length === 0) return;
  const memberIds = members.map((r) => r.employee_id);

  // Which brigade achievements already granted for this work?
  const { rows: alreadyDone } = await db.query(
    `SELECT achievement_id FROM brigade_achievement_log WHERE work_id = $1`,
    [wid]
  );
  const done = new Set(alreadyDone.map((r) => r.achievement_id));

  for (const [achId, def] of Object.entries(BRIGADE_ACHIEVEMENTS)) {
    if (done.has(achId)) continue;

    try {
      const met = await def.check(db, wid, memberIds);
      if (met) {
        await grantToAll(db, wid, achId, def.points, memberIds);
      }
    } catch { /* non-fatal, skip this achievement */ }
  }
}

module.exports = { checkBrigadeAchievements };
