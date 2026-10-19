'use strict';
/**
 * Изоляция тестов отпусков на клоне: каждый набор стартует с чистого состояния.
 * Без этого предыдущий прогон оставляет approved/rejected периоды и статусы «отп»
 * в staff_plan, и следующий набор падает на чужих данных.
 *
 * Использование:
 *   const { resetVacations, pool } = require('../helpers/vacation-isolation');
 *   await resetVacations([2027]);
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm_test',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
});

async function resetVacations(years) {
  const ys = (years && years.length) ? years : [2027];
  for (const y of ys) {
    await pool.query(
      'DELETE FROM office_vacation_blocked_days WHERE vacation_id IN (SELECT id FROM office_vacations WHERE year = $1)', [y]);
    await pool.query(
      'DELETE FROM office_vacation_approvals WHERE vacation_id IN (SELECT id FROM office_vacations WHERE year = $1)', [y]);
    await pool.query(
      'DELETE FROM office_vacation_reminders WHERE vacation_id IN (SELECT id FROM office_vacations WHERE year = $1)', [y]);
    await pool.query(
      'DELETE FROM office_vacation_audit WHERE vacation_id IN (SELECT id FROM office_vacations WHERE year = $1)', [y]);
    await pool.query('DELETE FROM office_vacations WHERE year = $1', [y]);
    await pool.query('DELETE FROM office_vacation_periods WHERE year = $1', [y]);
    // «отп» в графике офиса от прошлых прогонов
    await pool.query(
      "DELETE FROM staff_plan WHERE status_code = 'отп' AND EXTRACT(YEAR FROM date) = $1", [y]);
  }
}

module.exports = { pool, resetVacations };
