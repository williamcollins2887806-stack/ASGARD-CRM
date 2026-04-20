/**
 * Achievement Checker Service
 * ═══════════════════════════════════════════════════════════════
 * Checks and grants achievements for a given employee.
 * Called: after checkout (inline), via cron (daily), on-demand (admin).
 *
 * Design: application-code triggers, NOT SQL triggers.
 * This avoids cross-migration dependency with Phase 3 wallets.
 */

// Achievement criteria definitions — each returns a SQL query
// that counts progress for the given employee
const CRITERIA = {
  // Onboarding
  new_viking: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  bifrost_guard: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed' AND EXTRACT(HOUR FROM checkin_at) < 8`,
  odin_son: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  valkyrie_path: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  seasoned_viking: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  asgard_warrior: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  saga_keeper: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,

  // Discipline — streaks
  iron_warrior: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  mjolnir: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  indomitable: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  clean_record: (eid) => `SELECT CASE WHEN COUNT(*)=0 THEN 30 ELSE 0 END as val FROM worker_payments WHERE employee_id=${eid} AND type='penalty' AND created_at > NOW() - INTERVAL '30 days'`,
  early_bird: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed' AND EXTRACT(HOUR FROM checkin_at) < 8 AND EXTRACT(MINUTE FROM checkin_at) <= 30`,
  time_keeper: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed' AND EXTRACT(HOUR FROM checkin_at) <= 9`,
  no_miss: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  fate_forger: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  discipline_shield: (eid) => `SELECT CASE WHEN COUNT(*)=0 THEN 90 ELSE 0 END as val FROM worker_payments WHERE employee_id=${eid} AND type='penalty' AND created_at > NOW() - INTERVAL '90 days'`,

  // Endurance
  night_guard: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed' AND shift='night'`,
  moon_warrior: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed' AND shift='night'`,
  fenrir_spirit: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed' AND shift='night'`,
  hel_master: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed' AND shift='night'`,
  marathoner: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed' AND hours_worked >= 12`,
  berserker: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  eternal_flame: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed' AND hours_worked >= 12`,

  // Travel
  east_path: (eid) => `SELECT COUNT(DISTINCT ea.work_id) as val FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=${eid} AND w.is_vachta=true`,
  world_wanderer: (eid) => `SELECT COUNT(DISTINCT w.object_name) as val FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=${eid}`,
  road_lord: (eid) => `SELECT COUNT(DISTINCT ea.work_id) as val FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=${eid} AND w.is_vachta=true`,
  land_opener: (eid) => `SELECT COUNT(DISTINCT w.customer_name) as val FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=${eid}`,
  bifrost_bridge: (eid) => `SELECT COUNT(DISTINCT w.city) as val FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=${eid}`,
  nine_worlds: (eid) => `SELECT COUNT(DISTINCT w.object_name) as val FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=${eid}`,
  five_seas: (eid) => `SELECT COUNT(DISTINCT w.city) as val FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=${eid}`,

  // Finance
  fafnir_gold: (eid) => `SELECT COALESCE(SUM(amount_earned),0) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  midgard_treasury: (eid) => `SELECT COALESCE(SUM(amount_earned),0) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  dragon_hoard: (eid) => `SELECT COALESCE(SUM(amount_earned),0) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  valhalla_wealth: (eid) => `SELECT COALESCE(SUM(amount_earned),0) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  clean_account: (eid) => `SELECT CASE WHEN COALESCE(SUM(CASE WHEN type='advance' AND status='pending' THEN amount ELSE 0 END),0)=0 THEN 1 ELSE 0 END as val FROM worker_payments WHERE employee_id=${eid}`,
  thrifty_jarl: (eid) => `SELECT COUNT(DISTINCT pay_month||'-'||pay_year) as val FROM worker_payments WHERE employee_id=${eid} AND type!='penalty'`,
  first_gold: (eid) => `SELECT COUNT(*) as val FROM worker_payments WHERE employee_id=${eid} AND confirmed_by_worker=true`,

  // Mastery
  apprentice: (eid) => `SELECT COUNT(*) as val FROM employee_assignments WHERE employee_id=${eid}`,
  right_hand: (eid) => `SELECT COUNT(*) as val FROM field_checkins WHERE employee_id=${eid} AND status='completed'`,
  master_resp: (eid) => `SELECT COUNT(*) as val FROM employee_assignments WHERE employee_id=${eid} AND field_role IN ('shift_master','senior_master')`,
  brigade_viking: (eid) => `SELECT COUNT(*) as val FROM field_checkins fc JOIN employee_assignments ea ON ea.id=fc.assignment_id WHERE fc.employee_id=${eid} AND fc.status='completed' AND ea.field_role IN ('shift_master','senior_master')`,
  work_king: (eid) => `SELECT COUNT(*) as val FROM field_checkins fc JOIN employee_assignments ea ON ea.id=fc.assignment_id WHERE fc.employee_id=${eid} AND fc.status='completed' AND ea.field_role IN ('shift_master','senior_master')`,
  shapeshifter: (eid) => `SELECT COUNT(DISTINCT ftg.category) as val FROM employee_assignments ea JOIN field_tariff_grid ftg ON ftg.id=ea.tariff_id WHERE ea.employee_id=${eid}`,

  // Secret
  hugin_eye: (eid) => `SELECT COALESCE(SUM(visits_count),0) as val FROM field_app_visits WHERE employee_id=${eid}`,
  dagaz_rune: (eid) => `SELECT COUNT(*) as val FROM field_app_visits WHERE employee_id=${eid} AND visit_date >= CURRENT_DATE - 30`,
  chronicler: (eid) => `SELECT COUNT(*) as val FROM field_photos WHERE employee_id=${eid}`,
  odin_chosen: (eid) => `SELECT COUNT(*) as val FROM employee_achievements WHERE employee_id=${eid}`,
};

// Thresholds: how much 'val' is needed to earn the achievement
const THRESHOLDS = {
  new_viking: 1, bifrost_guard: 1, odin_son: 5, valkyrie_path: 10, seasoned_viking: 30, asgard_warrior: 100, saga_keeper: 300,
  iron_warrior: 10, mjolnir: 30, indomitable: 60, clean_record: 30, early_bird: 10, time_keeper: 50, no_miss: 20, fate_forger: 100, discipline_shield: 90,
  night_guard: 5, moon_warrior: 20, fenrir_spirit: 50, hel_master: 100, marathoner: 10, berserker: 30, eternal_flame: 20,
  east_path: 1, world_wanderer: 3, road_lord: 10, land_opener: 5, bifrost_bridge: 2, nine_worlds: 9, five_seas: 5,
  fafnir_gold: 50000, midgard_treasury: 200000, dragon_hoard: 500000, valhalla_wealth: 1000000, clean_account: 1, thrifty_jarl: 5, first_gold: 1,
  apprentice: 1, right_hand: 20, master_resp: 1, brigade_viking: 50, work_king: 100, shapeshifter: 3,
  hugin_eye: 100, dagaz_rune: 30, chronicler: 100, odin_chosen: 46,
};

/**
 * Check all achievements for an employee and grant any newly earned ones.
 * @param {object} db - PostgreSQL pool
 * @param {number} employeeId
 * @returns {Array} newly earned achievement IDs
 */
async function checkAndGrant(db, employeeId) {
  const earned = [];

  // Get already earned achievements
  const { rows: existing } = await db.query(
    'SELECT achievement_id FROM employee_achievements WHERE employee_id = $1',
    [employeeId]
  );
  const alreadyEarned = new Set(existing.map((r) => r.achievement_id));

  // Check each unearned achievement
  for (const [achId, queryFn] of Object.entries(CRITERIA)) {
    if (alreadyEarned.has(achId)) continue;

    const threshold = THRESHOLDS[achId];
    if (!threshold) continue;

    try {
      const { rows } = await db.query(queryFn(employeeId));
      const val = parseFloat(rows[0]?.val || 0);

      if (val >= threshold) {
        // Grant achievement
        await db.query(
          `INSERT INTO employee_achievements (employee_id, achievement_id, earned_at)
           VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
          [employeeId, achId]
        );

        // Credit points to balance
        const { rows: achRow } = await db.query(
          'SELECT points FROM worker_achievements WHERE id = $1', [achId]
        );
        const points = achRow[0]?.points || 0;
        if (points > 0) {
          await db.query(
            `INSERT INTO achievement_points_balance (employee_id, points_balance, points_earned_total)
             VALUES ($1, $2, $2)
             ON CONFLICT (employee_id) DO UPDATE SET
               points_balance = achievement_points_balance.points_balance + $2,
               points_earned_total = achievement_points_balance.points_earned_total + $2,
               updated_at = NOW()`,
            [employeeId, points]
          );
        }

        earned.push(achId);
      }
    } catch (err) {
      // Skip individual achievement errors — don't break the whole check
    }
  }

  return earned;
}

/**
 * Get progress for all achievements for an employee
 * @returns {Array} [{ id, category, tier, name, icon, threshold, current, earned }]
 */
async function getProgress(db, employeeId) {
  const { rows: allAch } = await db.query(
    'SELECT id, category, tier, points, name, description, icon, is_secret FROM worker_achievements WHERE is_active = true ORDER BY sort_order'
  );
  const { rows: earnedRows } = await db.query(
    'SELECT achievement_id, earned_at FROM employee_achievements WHERE employee_id = $1',
    [employeeId]
  );
  const earnedMap = new Map(earnedRows.map((r) => [r.achievement_id, r.earned_at]));

  const result = [];
  for (const ach of allAch) {
    const threshold = THRESHOLDS[ach.id] || 0;
    let current = 0;

    if (!earnedMap.has(ach.id) && CRITERIA[ach.id]) {
      try {
        const { rows } = await db.query(CRITERIA[ach.id](employeeId));
        current = parseFloat(rows[0]?.val || 0);
      } catch { current = 0; }
    }

    result.push({
      id: ach.id,
      category: ach.category,
      tier: ach.tier,
      points: ach.points,
      name: ach.is_secret && !earnedMap.has(ach.id) ? '???' : ach.name,
      description: ach.is_secret && !earnedMap.has(ach.id) ? '???' : ach.description,
      icon: ach.icon,
      is_secret: ach.is_secret,
      threshold,
      current: earnedMap.has(ach.id) ? threshold : Math.min(current, threshold),
      earned: earnedMap.has(ach.id),
      earned_at: earnedMap.get(ach.id) || null,
    });
  }

  return result;
}

module.exports = { checkAndGrant, getProgress, THRESHOLDS };
