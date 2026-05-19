/**
 * Seasonal Challenge Checker
 * ═══════════════════════════════════════════════════════════════
 * Recomputes progress for all active seasonal challenges for a worker.
 * Called: after checkout (fire-and-forget), after roulette spin, daily cron.
 */

/**
 * Calculate current progress value for a single task.
 * Season window: challenge.starts_at … ends_at
 */
async function calcTaskValue(db, employeeId, task, challenge) {
  const { starts_at, ends_at } = challenge;
  const eid = employeeId;

  switch (task.action_type) {
    case 'shifts':
      return db.query(
        `SELECT COUNT(*)::int as val FROM field_checkins
         WHERE employee_id=$1 AND status='completed'
           AND checkin_at >= $2 AND checkin_at < $3`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    case 'no_penalty':
      // Returns target (1) if 0 penalties, else 0
      return db.query(
        `SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END as val
         FROM worker_payments
         WHERE employee_id=$1 AND type='penalty'
           AND created_at >= $2 AND created_at < $3`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    case 'lesson_passed':
      // Count mandatory lessons published in season window that were passed
      return db.query(
        `SELECT COUNT(awp.id)::int as val
         FROM academy_lessons al
         JOIN academy_worker_progress awp ON awp.lesson_id = al.id AND awp.employee_id = $1
         WHERE al.status='published' AND al.is_mandatory=true
           AND al.release_monday >= $2 AND al.release_monday < $3
           AND awp.passed = true`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    case 'roulette_spins':
      return db.query(
        `SELECT COUNT(*)::int as val FROM gamification_spins
         WHERE employee_id=$1
           AND spun_at >= $2 AND spun_at < $3`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    case 'checkin_early':
      // Checkins before 07:00 local (use EXTRACT HOUR from checkin_at as rough proxy)
      return db.query(
        `SELECT COUNT(*)::int as val FROM field_checkins
         WHERE employee_id=$1 AND status='completed'
           AND checkin_at >= $2 AND checkin_at < $3
           AND EXTRACT(HOUR FROM checkin_at AT TIME ZONE 'Europe/Moscow') < 7`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    case 'streak_days':
      // Max consecutive work days in season
      return db.query(
        `WITH dates AS (
           SELECT DISTINCT date FROM field_checkins
           WHERE employee_id=$1 AND status='completed'
             AND checkin_at >= $2 AND checkin_at < $3
           ORDER BY date
         ), gaps AS (
           SELECT date,
                  date - (ROW_NUMBER() OVER (ORDER BY date))::int AS grp
           FROM dates
         )
         SELECT COALESCE(MAX(cnt),0)::int as val FROM (
           SELECT COUNT(*) as cnt FROM gaps GROUP BY grp
         ) x`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    default:
      return 0;
  }
}

/**
 * Recompute and persist progress for all active seasonal challenges.
 * Grants reward points when all tasks completed (once per challenge).
 * @param {object} db
 * @param {number} employeeId
 */
async function checkSeasonalProgress(db, employeeId) {
  const eid = parseInt(employeeId, 10);
  if (!Number.isFinite(eid) || eid <= 0) return;

  const now = new Date();
  const { rows: challenges } = await db.query(
    `SELECT * FROM seasonal_challenges
     WHERE is_active = true AND starts_at <= $1 AND ends_at >= $1`,
    [now]
  );

  for (const ch of challenges) {
    try {
      const { rows: tasks } = await db.query(
        `SELECT * FROM seasonal_challenge_tasks WHERE challenge_id = $1 ORDER BY sort_order`,
        [ch.id]
      );

      // Already fully completed?
      const { rows: [done] } = await db.query(
        `SELECT id FROM seasonal_worker_completions WHERE employee_id=$1 AND challenge_id=$2`,
        [eid, ch.id]
      );
      if (done) continue;

      let allDone = true;

      for (const task of tasks) {
        let val = 0;
        try { val = await calcTaskValue(db, eid, task, ch); } catch { val = 0; }

        const completed = val >= task.target_value;
        if (!completed) allDone = false;

        await db.query(`
          INSERT INTO seasonal_worker_progress (employee_id, challenge_id, task_slug, current_value, completed, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (employee_id, challenge_id, task_slug) DO UPDATE SET
            current_value = $4, completed = $5, updated_at = NOW()
        `, [eid, ch.id, task.slug, Math.min(val, task.target_value), completed]);
      }

      if (allDone && tasks.length > 0) {
        const { rows: inserted } = await db.query(`
          INSERT INTO seasonal_worker_completions (employee_id, challenge_id, reward_granted)
          VALUES ($1, $2, false)
          ON CONFLICT (employee_id, challenge_id) DO NOTHING
          RETURNING id
        `, [eid, ch.id]);

        if (inserted.length > 0 && ch.reward_type === 'points' && ch.reward_value > 0) {
          await db.query(`
            INSERT INTO achievement_points_balance (employee_id, points_balance, points_earned_total)
            VALUES ($1, $2, $2)
            ON CONFLICT (employee_id) DO UPDATE SET
              points_balance = achievement_points_balance.points_balance + $2,
              points_earned_total = achievement_points_balance.points_earned_total + $2,
              updated_at = NOW()
          `, [eid, ch.reward_value]);

          await db.query(
            `UPDATE seasonal_worker_completions SET reward_granted=true WHERE employee_id=$1 AND challenge_id=$2`,
            [eid, ch.id]
          );
        }
      }
    } catch { /* skip per-challenge errors */ }
  }
}

module.exports = { checkSeasonalProgress };
