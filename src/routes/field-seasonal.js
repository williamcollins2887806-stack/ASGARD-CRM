/**
 * Field Seasonal Challenges API
 * ═══════════════════════════════════════════════════════════════
 * GET  /           — active + upcoming challenges with worker progress
 * GET  /history    — completed past seasons for this worker
 * POST /refresh    — force-recalculate progress (triggered by client)
 */

const { checkSeasonalProgress } = require('../services/seasonalChecker');

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.fieldAuthenticate] };

  // GET / — active challenges + worker progress
  fastify.get('/', auth, async (req) => {
    const eid = req.fieldEmployee.id;
    const now = new Date();

    // Active challenges (current window)
    const { rows: challenges } = await db.query(
      `SELECT * FROM seasonal_challenges
       WHERE is_active = true AND starts_at <= $1 AND ends_at >= $1
       ORDER BY starts_at`,
      [now]
    );

    // Upcoming challenges (starts in next 30 days)
    const soon = new Date(now.getTime() + 30 * 86400000);
    const { rows: upcoming } = await db.query(
      `SELECT * FROM seasonal_challenges
       WHERE is_active = true AND starts_at > $1 AND starts_at <= $2
       ORDER BY starts_at LIMIT 1`,
      [now, soon]
    );

    const result = [];

    for (const ch of challenges) {
      const { rows: tasks } = await db.query(
        `SELECT * FROM seasonal_challenge_tasks WHERE challenge_id=$1 ORDER BY sort_order`,
        [ch.id]
      );

      const { rows: progress } = await db.query(
        `SELECT task_slug, current_value, completed FROM seasonal_worker_progress
         WHERE employee_id=$1 AND challenge_id=$2`,
        [eid, ch.id]
      );
      const progressMap = new Map(progress.map((p) => [p.task_slug, p]));

      const { rows: [completion] } = await db.query(
        `SELECT completed_at, reward_granted FROM seasonal_worker_completions
         WHERE employee_id=$1 AND challenge_id=$2`,
        [eid, ch.id]
      );

      const tasksWithProgress = tasks.map((t) => {
        const p = progressMap.get(t.slug) || { current_value: 0, completed: false };
        return {
          slug: t.slug,
          name: t.name,
          description: t.description,
          icon: t.icon,
          action_type: t.action_type,
          target: t.target_value,
          current: p.current_value,
          completed: p.completed,
        };
      });

      const doneCount = tasksWithProgress.filter((t) => t.completed).length;
      const msLeft = new Date(ch.ends_at) - now;
      const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));

      result.push({
        id: ch.id,
        slug: ch.slug,
        season_name: ch.season_name,
        description: ch.description,
        icon: ch.icon,
        color: ch.color,
        starts_at: ch.starts_at,
        ends_at: ch.ends_at,
        days_left: daysLeft,
        reward_type: ch.reward_type,
        reward_value: ch.reward_value,
        reward_label: ch.reward_label,
        reward_icon: ch.reward_icon,
        tasks: tasksWithProgress,
        tasks_done: doneCount,
        tasks_total: tasks.length,
        fully_completed: !!completion,
        completed_at: completion?.completed_at || null,
        reward_granted: completion?.reward_granted || false,
      });
    }

    return {
      active: result,
      upcoming: upcoming.map((u) => ({
        slug: u.slug,
        season_name: u.season_name,
        icon: u.icon,
        color: u.color,
        starts_at: u.starts_at,
        reward_label: u.reward_label,
        reward_icon: u.reward_icon,
      })),
    };
  });

  // GET /history — past seasons worker participated in
  fastify.get('/history', auth, async (req) => {
    const eid = req.fieldEmployee.id;

    const { rows } = await db.query(
      `SELECT sc.slug, sc.season_name, sc.icon, sc.color, sc.ends_at,
              sc.reward_label, sc.reward_icon,
              swc.completed_at, swc.reward_granted,
              (SELECT COUNT(*) FROM seasonal_challenge_tasks WHERE challenge_id=sc.id)::int as tasks_total,
              (SELECT COUNT(*) FROM seasonal_worker_progress WHERE employee_id=$1 AND challenge_id=sc.id AND completed=true)::int as tasks_done
       FROM seasonal_challenges sc
       LEFT JOIN seasonal_worker_completions swc ON swc.challenge_id=sc.id AND swc.employee_id=$1
       WHERE sc.ends_at < NOW() AND sc.is_active=true
         AND EXISTS (
           SELECT 1 FROM seasonal_worker_progress swp
           WHERE swp.employee_id=$1 AND swp.challenge_id=sc.id
         )
       ORDER BY sc.ends_at DESC`,
      [eid]
    );

    return { history: rows };
  });

  // POST /refresh — recompute progress for current user
  fastify.post('/refresh', auth, async (req) => {
    const eid = req.fieldEmployee.id;
    await checkSeasonalProgress(db, eid);
    return { ok: true };
  });
}

module.exports = routes;
