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
      const periodStart = quest.quest_type === 'daily'
        ? todayMsk
        : quest.quest_type === 'weekly'
        ? weekStartMsk
        : new Date(0); // permanent — epoch

      // Upsert progress row, reset if period changed
      const { rows: [prog] } = await db.query(`
        INSERT INTO gamification_quest_progress (employee_id, quest_id, current_count, completed, reward_claimed, period_start)
        VALUES ($1, $2, 0, false, false, $3)
        ON CONFLICT (employee_id, quest_id) DO UPDATE SET
          -- Reset if period rolled over
          current_count  = CASE
            WHEN gamification_quest_progress.period_start < $3 THEN 0
            ELSE gamification_quest_progress.current_count
          END,
          completed      = CASE
            WHEN gamification_quest_progress.period_start < $3 THEN false
            ELSE gamification_quest_progress.completed
          END,
          reward_claimed = CASE
            WHEN gamification_quest_progress.period_start < $3 THEN false
            ELSE gamification_quest_progress.reward_claimed
          END,
          period_start   = CASE
            WHEN gamification_quest_progress.period_start < $3 THEN $3
            ELSE gamification_quest_progress.period_start
          END
        RETURNING current_count, completed, period_start
      `, [employeeId, quest.id, periodStart.toISOString()]);

      // Don't increment if already completed this period
      if (prog.completed) continue;

      // Increment
      const { rows: [updated] } = await db.query(`
        UPDATE gamification_quest_progress
        SET current_count = current_count + 1,
            completed = (current_count + 1 >= $3),
            updated_at = NOW()
        WHERE employee_id = $1 AND quest_id = $2
        RETURNING current_count, completed
      `, [employeeId, quest.id, quest.target_count]);

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
