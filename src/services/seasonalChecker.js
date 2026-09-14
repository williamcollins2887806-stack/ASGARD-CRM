/**
 * Seasonal Challenge Checker
 * ═══════════════════════════════════════════════════════════════
 * Recomputes progress for all active seasonal challenges for a worker.
 * Called: after checkout (fire-and-forget), after roulette spin, daily cron,
 *         POST /api/field/seasonal/refresh.
 *
 * HARDENING (2026-09):
 * - gamification_spins.spin_at (NOT spun_at) — old typo silently zeroed roulette
 * - lesson progress by passed_at (any passed lesson in window), not only
 *   mandatory lessons released in window (almost nobody could finish)
 * - reward_type runes|points both granted; silent catch → console.warn
 */

'use strict';

async function calcTaskValue(db, employeeId, task, challenge) {
  const { starts_at, ends_at } = challenge;
  const eid = employeeId;

  switch (task.action_type) {
    case 'shifts':
      return db.query(
        `SELECT COUNT(*)::int AS val FROM field_checkins
         WHERE employee_id = $1 AND status = 'completed'
           AND checkin_at >= $2 AND checkin_at < $3`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    case 'no_penalty':
      // 1 if zero penalties in window, else 0
      return db.query(
        `SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END AS val
         FROM worker_payments
         WHERE employee_id = $1 AND type = 'penalty'
           AND created_at >= $2 AND created_at < $3`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    case 'lesson_passed':
      // Any academy lesson passed during season (by passed_at).
      // Fallback: read_completed_at if passed_at null (legacy rows).
      return db.query(
        `SELECT COUNT(*)::int AS val
         FROM academy_worker_progress
         WHERE employee_id = $1 AND passed = true
           AND COALESCE(passed_at, read_completed_at) >= $2
           AND COALESCE(passed_at, read_completed_at) < $3`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    case 'roulette_spins':
      // Column is spin_at (V090), never spun_at
      return db.query(
        `SELECT COUNT(*)::int AS val FROM gamification_spins
         WHERE employee_id = $1
           AND spin_at >= $2 AND spin_at < $3`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    case 'checkin_early':
      // Reality (2026-09): checkins stamped ~08:00 MSK. <09 = morning. Old <07 → 0 rewards.
      return db.query(
        `SELECT COUNT(*)::int AS val FROM field_checkins
         WHERE employee_id = $1 AND status = 'completed'
           AND checkin_at >= $2 AND checkin_at < $3
           AND EXTRACT(HOUR FROM checkin_at AT TIME ZONE 'Europe/Moscow') < 9`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    case 'streak_days':
      return db.query(
        `WITH dates AS (
           SELECT DISTINCT date FROM field_checkins
           WHERE employee_id = $1 AND status = 'completed'
             AND checkin_at >= $2 AND checkin_at < $3
           ORDER BY date
         ), gaps AS (
           SELECT date,
                  date - (ROW_NUMBER() OVER (ORDER BY date))::int AS grp
           FROM dates
         )
         SELECT COALESCE(MAX(cnt), 0)::int AS val FROM (
           SELECT COUNT(*) AS cnt FROM gaps GROUP BY grp
         ) x`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    case 'photo_upload':
      return db.query(
        `SELECT COUNT(*)::int AS val FROM field_photos
         WHERE employee_id = $1
           AND created_at >= $2 AND created_at < $3`,
        [eid, starts_at, ends_at]
      ).then(({ rows }) => rows[0].val);

    default:
      console.warn('[seasonalChecker] unknown action_type:', task.action_type);
      return 0;
  }
}

async function grantSeasonReward(db, employeeId, challenge) {
  const eid = employeeId;
  const amount = Number(challenge.reward_value) || 0;
  if (amount <= 0) return;

  const type = challenge.reward_type || 'points';

  if (type === 'runes' || type === 'xp') {
    await db.query(
      `INSERT INTO gamification_wallets (employee_id, currency, balance)
       VALUES ($1, $2, $3)
       ON CONFLICT (employee_id, currency) DO UPDATE
         SET balance = gamification_wallets.balance + $3, updated_at = NOW()`,
      [eid, type, amount]
    );
    const { rows: [w] } = await db.query(
      `SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = $2`,
      [eid, type]
    );
    await db.query(
      `INSERT INTO gamification_currency_ledger
         (employee_id, currency, amount, balance_after, operation, reference_id, reference_type)
       VALUES ($1, $2, $3, $4, 'seasonal_reward', $5, 'seasonal_challenge')`,
      [eid, type, amount, w?.balance || amount, challenge.id]
    );
    // Bonus achievement points so titles still progress (half of rune reward, min 50)
    const bonusPoints = Math.max(50, Math.floor(amount / 2));
    await db.query(
      `INSERT INTO achievement_points_balance (employee_id, points_balance, points_earned_total)
       VALUES ($1, $2, $2)
       ON CONFLICT (employee_id) DO UPDATE SET
         points_balance = achievement_points_balance.points_balance + $2,
         points_earned_total = achievement_points_balance.points_earned_total + $2,
         updated_at = NOW()`,
      [eid, bonusPoints]
    );
    return;
  }

  // Default: achievement points
  await db.query(
    `INSERT INTO achievement_points_balance (employee_id, points_balance, points_earned_total)
     VALUES ($1, $2, $2)
     ON CONFLICT (employee_id) DO UPDATE SET
       points_balance = achievement_points_balance.points_balance + $2,
       points_earned_total = achievement_points_balance.points_earned_total + $2,
       updated_at = NOW()`,
    [eid, amount]
  );
}

/**
 * Recompute and persist progress for all active seasonal challenges.
 * Grants reward once when all tasks completed.
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
      if (!tasks.length) continue;

      const { rows: [done] } = await db.query(
        `SELECT id, reward_granted FROM seasonal_worker_completions
         WHERE employee_id = $1 AND challenge_id = $2`,
        [eid, ch.id]
      );
      if (done?.reward_granted) continue;

      let allDone = true;

      for (const task of tasks) {
        let val = 0;
        try {
          val = await calcTaskValue(db, eid, task, ch);
        } catch (err) {
          console.warn('[seasonalChecker] calcTaskValue failed', {
            employee_id: eid,
            challenge: ch.slug,
            task: task.slug,
            action_type: task.action_type,
            err: err.message,
          });
          val = 0;
        }

        const completed = val >= task.target_value;
        if (!completed) allDone = false;

        await db.query(
          `INSERT INTO seasonal_worker_progress
             (employee_id, challenge_id, task_slug, current_value, completed, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (employee_id, challenge_id, task_slug) DO UPDATE SET
             current_value = $4, completed = $5, updated_at = NOW()`,
          [eid, ch.id, task.slug, Math.min(val, task.target_value * 2), completed]
          // allow current_value to show overshoot up to 2x for UX honesty
        );
      }

      if (allDone) {
        const { rows: inserted } = await db.query(
          `INSERT INTO seasonal_worker_completions (employee_id, challenge_id, reward_granted)
           VALUES ($1, $2, false)
           ON CONFLICT (employee_id, challenge_id) DO NOTHING
           RETURNING id`,
          [eid, ch.id]
        );

        // Grant if newly completed OR row exists without reward (retry after failed grant)
        const shouldGrant = inserted.length > 0 || (done && !done.reward_granted);
        if (shouldGrant) {
          try {
            await grantSeasonReward(db, eid, ch);
            await db.query(
              `UPDATE seasonal_worker_completions
               SET reward_granted = true
               WHERE employee_id = $1 AND challenge_id = $2`,
              [eid, ch.id]
            );
            await db.query(
              `INSERT INTO gamification_audit_log (employee_id, action, details)
               VALUES ($1, 'seasonal_completed', $2)`,
              [eid, JSON.stringify({
                challenge_id: ch.id,
                slug: ch.slug,
                reward_type: ch.reward_type,
                reward_value: ch.reward_value,
              })]
            ).catch(() => {});
          } catch (grantErr) {
            console.error('[seasonalChecker] grant failed', {
              employee_id: eid,
              challenge: ch.slug,
              err: grantErr.message,
            });
          }
        }
      }
    } catch (chErr) {
      console.warn('[seasonalChecker] challenge loop error', {
        employee_id: eid,
        challenge: ch.slug,
        err: chErr.message,
      });
    }
  }
}

/**
 * Recompute for every worker who has any seasonal progress or recent activity.
 * Used once after deploy / season rollover.
 */
async function refreshAllActiveSeasonWorkers(db, { limit = 500 } = {}) {
  const { rows } = await db.query(
    `SELECT DISTINCT employee_id FROM (
       SELECT employee_id FROM seasonal_worker_progress
       UNION
       SELECT employee_id FROM field_sessions
         WHERE last_active_at >= NOW() - INTERVAL '45 days'
       UNION
       SELECT employee_id FROM gamification_spins
         WHERE spin_at >= NOW() - INTERVAL '90 days'
       UNION
       -- Workers with real autumn checkins must be included even without app sessions
       SELECT employee_id FROM field_checkins
         WHERE checkin_at >= NOW() - INTERVAL '120 days'
           AND status IN ('completed', 'active', 'cancelled')
     ) x
     LIMIT $1`,
    [limit]
  );
  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    try {
      await checkSeasonalProgress(db, r.employee_id);
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  return { workers: rows.length, ok, fail };
}

module.exports = {
  checkSeasonalProgress,
  refreshAllActiveSeasonWorkers,
  calcTaskValue,
};
