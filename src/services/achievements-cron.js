/**
 * Achievements Cron — daily check for all active field workers
 * Runs at 03:00 MSK daily (low-traffic hour)
 * Pattern: same as per-diem-cron.js
 */

const cron = require('node-cron');
const achievementChecker = require('./achievementChecker');

function init(fastify) {
  const db = fastify.db;

  // Daily at 03:00 Moscow time
  cron.schedule('0 3 * * *', async () => {
    try {
      // Get all employees with field activity in last 90 days
      const { rows: employees } = await db.query(`
        SELECT DISTINCT employee_id
        FROM field_checkins
        WHERE created_at > NOW() - INTERVAL '90 days'
          AND status = 'completed'
      `);

      let totalEarned = 0;
      for (const { employee_id } of employees) {
        try {
          const earned = await achievementChecker.checkAndGrant(db, employee_id);
          totalEarned += earned.length;
        } catch {
          // Skip individual employee errors
        }
      }

      if (totalEarned > 0) {
        fastify.log.info(`[achievements-cron] Checked ${employees.length} employees, granted ${totalEarned} achievements`);
      }
    } catch (err) {
      fastify.log.error('[achievements-cron] Error:', err.message);
    }
  }, { timezone: 'Europe/Moscow' });

  fastify.log.info('[achievements-cron] Scheduled daily at 03:00 MSK');
}

module.exports = { init };
