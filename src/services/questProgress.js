/**
 * Quest Progress Tracker v2
 * ═══════════════════════════════════════════════════════════════
 * updateQuestProgress(db, employeeId, action) — increments progress
 * for all active quests matching the given target_action.
 * Call fire-and-forget from checkin/checkout/photo/report routes.
 *
 * setQuestProgress(db, employeeId, action, value) — SETS progress
 * to an exact value (for streaks where count = current streak).
 *
 * Supported actions:
 *   shift_complete    — worker checked out (shift finished)
 *   hours_min_8       — shift was 8+ hours
 *   hours_min_10      — shift was 10+ hours
 *   early_checkin     — checkin before 07:00 device local hour
 *   photo_upload      — photo uploaded
 *   total_shifts      — same as shift_complete (permanent quests)
 *   night_shift       — completed a night shift
 *   report_submit     — daily report submitted (masters)
 *   crew_all_checked_in — all workers checked in today (masters)
 *   streak            — consecutive work days (set, not increment)
 */

function getPeriodBoundaries() {
  const now = new Date();
  const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));

  const todayMsk = new Date(msk);
  todayMsk.setHours(0, 0, 0, 0);

  const weekStartMsk = new Date(msk);
  weekStartMsk.setHours(0, 0, 0, 0);
  const dayOfWeek = weekStartMsk.getDay();
  weekStartMsk.setDate(weekStartMsk.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  const monthStartMsk = new Date(msk);
  monthStartMsk.setDate(1);
  monthStartMsk.setHours(0, 0, 0, 0);

  return { todayMsk, weekStartMsk, monthStartMsk };
}

function getPeriodDate(questType, boundaries) {
  if (questType === 'daily') return boundaries.todayMsk;
  if (questType === 'weekly') return boundaries.weekStartMsk;
  if (questType === 'monthly') return boundaries.monthStartMsk;
  return new Date(0); // permanent — epoch
}

async function updateQuestProgress(db, employeeId, action, meta = {}) {
  try {
    const boundaries = getPeriodBoundaries();

    // Load matching active quests
    const { rows: quests } = await db.query(
      `SELECT id, quest_type, target_count, name FROM gamification_quests
       WHERE is_active = true AND target_action = $1`,
      [action]
    );
    if (!quests.length) return;

    for (const quest of quests) {
      const periodDate = getPeriodDate(quest.quest_type, boundaries);
      const periodStart = periodDate.toISOString().slice(0, 10);

      // Upsert progress row for current period
      const { rows: [prog] } = await db.query(`
        INSERT INTO gamification_quest_progress (employee_id, quest_id, current_count, completed, reward_claimed, period_start)
        VALUES ($1, $2, 0, false, false, $3::date)
        ON CONFLICT (employee_id, quest_id, period_start) DO UPDATE SET
          current_count = gamification_quest_progress.current_count
        RETURNING current_count, completed
      `, [employeeId, quest.id, periodStart]);

      // Don't increment if already completed this period
      if (prog.completed) continue;

      // Increment
      const { rows: [updated] } = await db.query(`
        UPDATE gamification_quest_progress
        SET current_count = current_count + 1,
            completed = (current_count + 1 >= $3),
            completed_at = CASE WHEN (current_count + 1 >= $3) THEN NOW() ELSE completed_at END
        WHERE employee_id = $1 AND quest_id = $2 AND period_start = $4::date
        RETURNING current_count, completed
      `, [employeeId, quest.id, quest.target_count, periodStart]);

      if (updated?.completed) {
        await db.query(
          `INSERT INTO gamification_audit_log (employee_id, action, details)
           VALUES ($1, 'quest_completed', $2)`,
          [employeeId, JSON.stringify({ quest_id: quest.id, quest_name: quest.name, action })]
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[questProgress] updateQuestProgress error:', err.message);
  }
}

/**
 * Set quest progress to an exact value (for streaks).
 * Unlike updateQuestProgress, this REPLACES the count instead of incrementing.
 */
async function setQuestProgress(db, employeeId, action, value) {
  try {
    const boundaries = getPeriodBoundaries();

    const { rows: quests } = await db.query(
      `SELECT id, quest_type, target_count, name FROM gamification_quests
       WHERE is_active = true AND target_action = $1`,
      [action]
    );
    if (!quests.length) return;

    for (const quest of quests) {
      const periodDate = getPeriodDate(quest.quest_type, boundaries);
      const periodStart = periodDate.toISOString().slice(0, 10);
      const completed = value >= quest.target_count;

      const { rows: [result] } = await db.query(`
        INSERT INTO gamification_quest_progress (employee_id, quest_id, current_count, completed, reward_claimed, period_start)
        VALUES ($1, $2, $3, $4, false, $5::date)
        ON CONFLICT (employee_id, quest_id, period_start) DO UPDATE SET
          current_count = $3,
          completed = CASE
            WHEN gamification_quest_progress.reward_claimed THEN gamification_quest_progress.completed
            ELSE $4
          END,
          completed_at = CASE
            WHEN $4 AND NOT gamification_quest_progress.completed THEN NOW()
            ELSE gamification_quest_progress.completed_at
          END
        RETURNING completed, reward_claimed
      `, [employeeId, quest.id, value, completed, periodStart]);

      if (result?.completed && !result?.reward_claimed) {
        await db.query(
          `INSERT INTO gamification_audit_log (employee_id, action, details)
           VALUES ($1, 'quest_completed', $2)`,
          [employeeId, JSON.stringify({ quest_id: quest.id, quest_name: quest.name, action, value })]
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[questProgress] setQuestProgress error:', err.message);
  }
}

/**
 * Update brigade quest progress — increments shared counter for the whole crew.
 * Called alongside individual quest updates.
 */
async function updateBrigadeQuestProgress(db, employeeId, action) {
  try {
    // Find worker's active work_id
    const { rows: [assign] } = await db.query(
      `SELECT work_id FROM employee_assignments WHERE employee_id = $1 AND is_active = true LIMIT 1`, [employeeId]
    );
    if (!assign) return;

    // Find active brigade quests matching this action
    const { rows: quests } = await db.query(
      `SELECT id, target_count FROM gamification_brigade_quests
       WHERE work_id = $1 AND is_active = true AND completed = false AND target_action = $2`,
      [assign.work_id, action]
    );

    for (const q of quests) {
      const { rows: [updated] } = await db.query(
        `UPDATE gamification_brigade_quests
         SET current_count = current_count + 1,
             completed = (current_count + 1 >= $2),
             completed_at = CASE WHEN (current_count + 1 >= $2) THEN NOW() ELSE completed_at END
         WHERE id = $1 AND completed = false
         RETURNING current_count, completed`,
        [q.id, q.target_count]
      );

      // If just completed — distribute rewards to all crew
      if (updated?.completed) {
        const { rows: crew } = await db.query(
          `SELECT employee_id FROM employee_assignments
           WHERE work_id = $1 AND is_active = true AND field_role = 'worker'`, [assign.work_id]
        );
        const { rows: [bq] } = await db.query(`SELECT reward_per_person, name FROM gamification_brigade_quests WHERE id = $1`, [q.id]);
        for (const member of crew) {
          await db.query(
            `INSERT INTO gamification_wallets (employee_id, currency, balance)
             VALUES ($1, 'runes', $2)
             ON CONFLICT (employee_id, currency) DO UPDATE SET balance = gamification_wallets.balance + $2, updated_at = NOW()`,
            [member.employee_id, bq.reward_per_person]
          );
          await db.query(
            `INSERT INTO gamification_currency_ledger (employee_id, currency, amount, balance_after, operation, reference_id, reference_type, note)
             VALUES ($1, 'runes', $2,
               (SELECT balance FROM gamification_wallets WHERE employee_id = $1 AND currency = 'runes'),
               'brigade_quest', $3, 'brigade', $4)`,
            [member.employee_id, bq.reward_per_person, q.id, bq.name]
          );
        }
        await db.query(`UPDATE gamification_brigade_quests SET reward_distributed = true WHERE id = $1`, [q.id]);
      }
    }
  } catch (err) {
    console.warn('[questProgress] updateBrigadeQuestProgress error:', err.message);
  }
}

module.exports = { updateQuestProgress, setQuestProgress, updateBrigadeQuestProgress };
