/**
 * Quest Progress Tracker
 * ═══════════════════════════════════════════════════════════════
 * updateQuestProgress(db, employeeId, action) — increments progress
 * for all active quests matching the given target_action.
 * Call fire-and-forget from checkin/checkout/photo routes.
 *
 * Supported actions:
 *   shift_complete    — worker checked out (shift finished)
 *   hours_min_8       — shift was 8+ hours
 *   early_checkin     — checkin before 07:00 device local hour
 *   photo_upload      — photo uploaded
 *   total_shifts      — same as shift_complete (permanent quests)
 */

async function updateQuestProgress(db, employeeId, action, meta = {}) {
  try {
    // Current period start per quest_type
    const now = new Date();
    const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const todayMsk = new Date(msk); todayMsk.setHours(0, 0, 0, 0);
    const weekStartMsk = new Date(msk);
    weekStartMsk.setHours(0, 0, 0, 0);
    const dayOfWeek = weekStartMsk.getDay();
    weekStartMsk.setDate(weekStartMsk.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

    // Load matching active quests
    const { rows: quests } = await db.query(
      `SELECT id, quest_type, target_count, name FROM gamification_quests
       WHERE is_active = true AND target_action = $1`,
      [action]
    );
    if (!quests.length) return;

    for (const quest of quests) {
      const periodDate = quest.quest_type === 'daily'
        ? todayMsk
        : quest.quest_type === 'weekly'
        ? weekStartMsk
        : new Date(0); // permanent — epoch

      // Use plain date string (YYYY-MM-DD) to avoid UTC timezone mismatch when
      // PostgreSQL casts to ::date. toISOString() returns UTC which shifts the date
      // by -3h at midnight MSK, causing the INSERT and UPDATE to use different dates.
      const periodStart = periodDate.toISOString().slice(0, 10); // "YYYY-MM-DD"

      // Upsert progress row for current period (V094: unique on employee+quest+period)
      const { rows: [prog] } = await db.query(`
        INSERT INTO gamification_quest_progress (employee_id, quest_id, current_count, completed, reward_claimed, period_start)
        VALUES ($1, $2, 0, false, false, $3::date)
        ON CONFLICT (employee_id, quest_id, period_start) DO UPDATE SET
          current_count = gamification_quest_progress.current_count
        RETURNING current_count, completed
      `, [employeeId, quest.id, periodStart]);

      // Don't increment if already completed this period
      if (prog.completed) continue;

      // Increment (scope to current period to avoid touching old-period rows)
      const { rows: [updated] } = await db.query(`
        UPDATE gamification_quest_progress
        SET current_count = current_count + 1,
            completed = (current_count + 1 >= $3)
        WHERE employee_id = $1 AND quest_id = $2 AND period_start = $4::date
        RETURNING current_count, completed
      `, [employeeId, quest.id, quest.target_count, periodStart]);

      if (updated?.completed) {
        // Log quest completion for audit
        await db.query(
          `INSERT INTO gamification_audit_log (employee_id, action, details)
           VALUES ($1, 'quest_completed', $2)`,
          [employeeId, JSON.stringify({ quest_id: quest.id, quest_name: quest.name, action })]
        ).catch(() => {});
      }
    }
  } catch (err) {
    // Quest progress is non-critical — never throw
    console.warn('[questProgress] updateQuestProgress error:', err.message);
  }
}

module.exports = { updateQuestProgress };
