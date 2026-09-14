'use strict';

/**
 * Cron: автоснятие стейл/просроченных планируемых привлечений.
 * Ежедневно 07:15 MSK + сразу при старте сервиса (один раз).
 */

const cron = require('node-cron');
const { sweepStalePlannedEngagements } = require('../lib/planned-engagement-auto');

let _task = null;
let _startedOnce = false;

function start(db, log) {
  if (_task) return;

  const run = async (label) => {
    try {
      const stats = await sweepStalePlannedEngagements(db);
      const total = stats.arrived + stats.expired + stats.stale + (stats.orphan_undated || 0);
      if (total > 0 || label === 'startup') {
        log.info(
          `[PlannedEngagementCron] ${label}: arrived=${stats.arrived} expired=${stats.expired} stale=${stats.stale} orphan_undated=${stats.orphan_undated || 0}`
        );
      }
    } catch (err) {
      log.error(`[PlannedEngagementCron] ${label} failed: ${err.message}`);
    }
  };

  _task = cron.schedule('15 7 * * *', () => run('daily'), {
    timezone: 'Europe/Moscow',
  });

  if (!_startedOnce) {
    _startedOnce = true;
    setTimeout(() => run('startup'), 8000);
  }

  log.info('[PlannedEngagementCron] Started — daily 07:15 MSK + startup sweep');
}

function stop() {
  if (_task) {
    _task.stop();
    _task = null;
  }
}

module.exports = { start, stop };
