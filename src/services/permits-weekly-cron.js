'use strict';

/**
 * Еженедельная рассылка допусков/удостоверений — понедельник 09:15 MSK
 *
 * Свободный слот (занято):
 *   08:00 crew-inactivity, 08:05 mlsp-stay,
 *   08:30 PM weekly digest,
 *   09:00 Mimir/OfficeAcademy, 09:07 letter-reminders, 09:30 per-diem
 */

const cron = require('node-cron');
const { sendDigest } = require('./permits-weekly-digest');

let _job = null;

async function acquireLock(db, key) {
  try {
    const r = await db.query(
      `INSERT INTO cron_locks (lock_key, acquired_at, expires_at)
       VALUES ($1, NOW(), NOW() + INTERVAL '2 hours')
       ON CONFLICT (lock_key) DO UPDATE SET
         acquired_at = NOW(),
         expires_at = NOW() + INTERVAL '2 hours'
       WHERE cron_locks.expires_at < NOW()
       RETURNING lock_key`,
      [key]
    );
    return !!r.rows[0];
  } catch (_) {
    return true;
  }
}

async function releaseLock(db, key) {
  try { await db.query(`DELETE FROM cron_locks WHERE lock_key = $1`, [key]); } catch (_) { /* ignore */ }
}

async function runOnce(db, log, opts = {}) {
  return sendDigest(db, log, opts);
}

function start(db, log) {
  if (_job) return;
  // Пн 09:15 MSK — между Mimir 09:00 и per-diem 09:30
  _job = cron.schedule('15 9 * * 1', async () => {
    const key = `permits_weekly_digest_${new Date().toISOString().slice(0, 10)}`;
    const ok = await acquireLock(db, key);
    if (!ok) {
      log?.info?.('[PermitsWeeklyDigest] lock held, skip');
      return;
    }
    try {
      await runOnce(db, log, { preview: false });
    } catch (err) {
      log?.error?.({ err }, '[PermitsWeeklyDigest] tick failed');
    } finally {
      await releaseLock(db, key);
    }
  }, { timezone: 'Europe/Moscow' });
  log?.info?.('[PermitsWeeklyDigest] started (Mon 09:15 MSK → TO+HEAD_TO, Cc Androsov)');
}

function stop() {
  if (_job) {
    _job.stop();
    _job = null;
  }
}

module.exports = { start, stop, runOnce };
