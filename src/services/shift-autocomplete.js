/**
 * Shift Auto-Complete Service
 * ═══════════════════════════════════════════════════════════════
 * Runs every 30 minutes. Finds all active (unchecked-out) shifts
 * and auto-completes them when the shift end time has passed.
 *
 * Rules:
 *   Day shift (shift='day')   → ends at 20:00 MSK on checkin date
 *   Night shift (shift='night') → ends at 08:00 MSK next calendar day
 *   Safety-net → any shift active >14h gets force-closed immediately
 *
 * Grace period: 30 min after scheduled end before we act.
 * Auto-checkout note: "⚙️ Автозавершение системой"
 */

'use strict';

const db = require('./db');

const GRACE_MINUTES = 30;        // wait 30 min past shift end before autocomplete
const SAFETY_NET_HOURS = 14;     // any shift >14h gets force-closed regardless
const MSK_OFFSET_HOURS = 3;      // UTC+3

function nowMsk() {
  const now = new Date();
  return new Date(now.getTime() + MSK_OFFSET_HOURS * 3600 * 1000);
}

// Return the scheduled end time (UTC) for a given checkin
// checkinAt — JS Date in UTC
// shiftType — 'day' | 'night'
function getScheduledEnd(checkinAt, shiftType) {
  // Convert checkin time to MSK
  const msk = new Date(checkinAt.getTime() + MSK_OFFSET_HOURS * 3600 * 1000);
  const mskYear = msk.getUTCFullYear();
  const mskMonth = msk.getUTCMonth();
  const mskDay = msk.getUTCDate();

  let endMsk;
  if (shiftType === 'night') {
    // Night shift ends at 08:00 MSK the next day
    endMsk = new Date(Date.UTC(mskYear, mskMonth, mskDay + 1, 8, 0, 0));
  } else {
    // Day shift ends at 20:00 MSK on the same day
    endMsk = new Date(Date.UTC(mskYear, mskMonth, mskDay, 20, 0, 0));
    // If worker checked in after 20:00 MSK (shouldn't happen normally), end next day 20:00
    if (checkinAt >= endMsk) {
      endMsk = new Date(Date.UTC(mskYear, mskMonth, mskDay + 1, 20, 0, 0));
    }
  }

  // Convert MSK end back to UTC
  return new Date(endMsk.getTime() - MSK_OFFSET_HOURS * 3600 * 1000);
}

async function runAutoComplete(log) {
  try {
    const now = new Date();
    const safetyNetCutoff = new Date(now.getTime() - SAFETY_NET_HOURS * 3600 * 1000);

    // Find all active checkins
    const { rows: active } = await db.query(`
      SELECT fc.id, fc.employee_id, fc.work_id, fc.assignment_id,
             fc.checkin_at, fc.shift, fc.day_rate,
             COALESCE(fps.shift_hours, 11)::float AS shift_hours,
             COALESCE(fps.rounding_rule, 'none') AS rounding_rule,
             COALESCE(fps.rounding_step, 0.5)::float AS rounding_step
      FROM field_checkins fc
      LEFT JOIN field_project_settings fps ON fps.work_id = fc.work_id
      WHERE fc.checkout_at IS NULL
        AND fc.status = 'active'
        AND fc.checkin_at < NOW() - INTERVAL '2 hours'
      ORDER BY fc.checkin_at ASC
    `);

    if (!active.length) return;

    if (log) log.info(`[ShiftAutocomplete] Checking ${active.length} active shift(s)`);

    const graceMs = GRACE_MINUTES * 60 * 1000;
    let completed = 0;

    for (const fc of active) {
      try {
        const checkinAt = new Date(fc.checkin_at);
        const shiftType = fc.shift || 'day';
        const scheduledEnd = getScheduledEnd(checkinAt, shiftType);
        const safetyEnd = new Date(checkinAt.getTime() + SAFETY_NET_HOURS * 3600 * 1000);

        // Determine checkout time
        let checkoutAt = null;
        let reason = '';

        if (now > new Date(scheduledEnd.getTime() + graceMs)) {
          // Past scheduled end + grace → checkout at scheduled end
          checkoutAt = scheduledEnd;
          reason = `schedule (${shiftType === 'night' ? '08:00' : '20:00'} МСК)`;
        } else if (now > new Date(safetyEnd.getTime() + graceMs)) {
          // Safety net: >14h active → checkout now
          checkoutAt = now;
          reason = 'safety-net (>14h)';
        } else {
          continue; // not yet expired
        }

        // Don't checkout in the future
        if (checkoutAt > now) checkoutAt = now;

        // Calculate hours
        const hoursWorked = (checkoutAt - checkinAt) / (1000 * 60 * 60);
        const shiftHours = parseFloat(fc.shift_hours) || 11;
        const hoursPaid = Math.min(hoursWorked, shiftHours);
        const dayRate = parseFloat(fc.day_rate) || 0;
        const amountEarned = dayRate * Math.min(hoursPaid / shiftHours, 1);

        await db.query(`
          UPDATE field_checkins SET
            checkout_at = $2,
            checkout_source = 'auto',
            hours_worked = $3,
            hours_paid = $4,
            amount_earned = $5,
            status = 'completed',
            note = COALESCE(note || ' | ', '') || $6,
            updated_at = NOW()
          WHERE id = $1 AND checkout_at IS NULL
        `, [
          fc.id,
          checkoutAt.toISOString(),
          Math.round(hoursWorked * 100) / 100,
          Math.round(hoursPaid * 100) / 100,
          Math.round(amountEarned * 100) / 100,
          '⚙️ Автозавершение системой',
        ]);

        // Fire quest hooks
        try {
          const { updateQuestProgress } = require('./questProgress');
          updateQuestProgress(db, fc.employee_id, 'shift_complete').catch(() => {});
          updateQuestProgress(db, fc.employee_id, 'total_shifts').catch(() => {});
          if (hoursWorked >= 8) {
            updateQuestProgress(db, fc.employee_id, 'hours_min_8').catch(() => {});
          }
        } catch { /* non-critical */ }

        completed++;
        if (log) log.info(
          `[ShiftAutocomplete] Auto-closed checkin #${fc.id} emp=${fc.employee_id} ` +
          `shift=${shiftType} reason=${reason} hours=${hoursWorked.toFixed(1)}`
        );
      } catch (innerErr) {
        if (log) log.warn(`[ShiftAutocomplete] Failed to auto-close checkin #${fc.id}:`, innerErr.message);
      }
    }

    if (completed > 0 && log) {
      log.info(`[ShiftAutocomplete] Auto-completed ${completed} shift(s)`);
    }
  } catch (err) {
    if (log) log.error('[ShiftAutocomplete] Run error:', err.message);
    else console.error('[ShiftAutocomplete] Run error:', err.message);
  }
}

let _interval = null;

function start(log) {
  if (_interval) return;
  // First run after 60s (server warmup)
  setTimeout(() => runAutoComplete(log), 60_000);
  // Then every 30 minutes
  _interval = setInterval(() => runAutoComplete(log), 30 * 60 * 1000);
  if (log) log.info('[ShiftAutocomplete] Started (interval: 30 min)');
}

function stop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { start, stop, runAutoComplete };
