'use strict';

/**
 * PM Analysis Rating Cron — ежедневно ~03:00 МСК пересчёт снапшотов рейтинга РП.
 */

const cron = require('node-cron');
const { recomputeAll } = require('./pm-analysis-rating');

let _job = null;

function start(db, log) {
  if (_job) return;
  // 03:00 МСК = 00:00 UTC
  _job = cron.schedule('0 0 * * *', () => {
    recomputeAll(db, new Date(), log).catch((err) => {
      log?.error?.({ err }, '[PmAnalysisRatingCron] tick failed');
    });
  });
  log?.info?.('[PmAnalysisRatingCron] started (daily 03:00 MSK)');
}

function stop() {
  if (_job) {
    _job.stop();
    _job = null;
  }
}

module.exports = { start, stop, recomputeAll };
