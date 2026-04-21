/**
 * Field Worker Achievements API
 * ═══════════════════════════════════════════════════════════════
 * GET  /             — all achievements + earned status
 * GET  /progress     — progress bars for in-progress
 * GET  /leaderboard  — top 20 by points
 * POST /check        — force check (admin/cron trigger)
 * POST /app-visit    — record PWA visit (for secret achievements)
 */

const achievementChecker = require('../services/achievementChecker');

async function routes(fastify) {
  const db = fastify.db;

  // GET / — all achievements with earned status for current employee
  fastify.get('/', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const employeeId = req.fieldEmployee.id;
    const progress = await achievementChecker.getProgress(db, employeeId);

    // Points balance
    const { rows: balRows } = await db.query(
      'SELECT points_balance, points_earned_total FROM achievement_points_balance WHERE employee_id = $1',
      [employeeId]
    );
    const balance = balRows[0] || { points_balance: 0, points_earned_total: 0 };

    return {
      achievements: progress,
      points: balance.points_balance,
      points_total: balance.points_earned_total,
      earned_count: progress.filter((a) => a.earned).length,
      total_count: progress.length,
    };
  });

  // GET /progress — progress for in-progress achievements only
  fastify.get('/progress', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const employeeId = req.fieldEmployee.id;
    const progress = await achievementChecker.getProgress(db, employeeId);
    return progress.filter((a) => !a.earned && a.current > 0);
  });

  // GET /leaderboard — top 20 employees by points
  fastify.get('/leaderboard', { preHandler: [fastify.fieldAuthenticate] }, async () => {
    const { rows } = await db.query(`
      SELECT apb.employee_id, e.name as fio, apb.points_earned_total,
             (SELECT COUNT(*) FROM employee_achievements ea WHERE ea.employee_id = apb.employee_id) as achievements_count
      FROM achievement_points_balance apb
      JOIN employees e ON e.id = apb.employee_id
      WHERE apb.points_earned_total > 0
      ORDER BY apb.points_earned_total DESC
      LIMIT 20
    `);
    return { leaderboard: rows };
  });

  // POST /check — force-check achievements for current employee
  fastify.post('/check', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const employeeId = req.fieldEmployee.id;
    const earned = await achievementChecker.checkAndGrant(db, employeeId);
    return { earned, count: earned.length };
  });

  // POST /app-visit — record PWA visit (for Hugin's Eye & Dagaz Rune)
  fastify.post('/app-visit', { preHandler: [fastify.fieldAuthenticate] }, async (req) => {
    const employeeId = req.fieldEmployee.id;
    await db.query(`
      INSERT INTO field_app_visits (employee_id, visit_date, visits_count)
      VALUES ($1, CURRENT_DATE, 1)
      ON CONFLICT (employee_id, visit_date) DO UPDATE SET
        visits_count = field_app_visits.visits_count + 1
    `, [employeeId]);
    return { ok: true };
  });
}

module.exports = routes;
