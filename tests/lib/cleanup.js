/**
 * Database cleanup - removes all TEST_AUTO_ prefixed data
 * Uses SSH + psql with FK-aware deletion order
 */

const { TEST_PREFIX } = require('../config');
const { sshPsql } = require('./ssh-exec');

const LIKE = `'${TEST_PREFIX}%'`;

/**
 * Run full cleanup of test data from the database
 * Deletion order: children → parents to respect FK constraints
 * @returns {Promise<{success: boolean, deletedCounts: object, errors: string[]}>}
 */
async function fullCleanup() {
  const deletedCounts = {};
  const errors = [];

  console.log('[CLEANUP] Starting full cleanup of TEST_AUTO_* data...');

  // Level 3: Deepest dependencies
  const level3 = [
    {
      name: 'cash_messages',
      sql: `DELETE FROM cash_messages WHERE request_id IN (SELECT id FROM cash_requests WHERE purpose LIKE ${LIKE});`,
    },
    {
      name: 'cash_expenses',
      sql: `DELETE FROM cash_expenses WHERE request_id IN (SELECT id FROM cash_requests WHERE purpose LIKE ${LIKE});`,
    },
    {
      name: 'cash_returns',
      sql: `DELETE FROM cash_returns WHERE request_id IN (SELECT id FROM cash_requests WHERE purpose LIKE ${LIKE});`,
    },
    {
      name: 'payroll_items',
      sql: `DELETE FROM payroll_items WHERE sheet_id IN (SELECT id FROM payroll_sheets WHERE name LIKE ${LIKE});`,
    },
  ];

  // Level 2: Mid-level dependencies
  const level2 = [
    {
      name: 'work_expenses',
      sql: `DELETE FROM work_expenses WHERE work_id IN (SELECT id FROM works WHERE work_title LIKE ${LIKE});`,
    },
    {
      name: 'estimates',
      sql: `DELETE FROM estimates WHERE tender_id IN (SELECT id FROM tenders WHERE customer_name LIKE ${LIKE} OR tender_title LIKE ${LIKE});`,
    },
    {
      name: 'employee_permits',
      sql: `DELETE FROM employee_permits WHERE employee_id IN (SELECT id FROM employees WHERE full_name LIKE ${LIKE});`,
    },
    {
      name: 'employee_assignments',
      sql: `DELETE FROM employee_assignments WHERE employee_id IN (SELECT id FROM employees WHERE full_name LIKE ${LIKE});`,
    },
    {
      name: 'employee_reviews',
      sql: `DELETE FROM employee_reviews WHERE employee_id IN (SELECT id FROM employees WHERE full_name LIKE ${LIKE});`,
    },
    {
      name: 'employee_rates',
      sql: `DELETE FROM employee_rates WHERE employee_id IN (SELECT id FROM employees WHERE full_name LIKE ${LIKE});`,
    },
    {
      name: 'equipment_movements',
      sql: `DELETE FROM equipment_movements WHERE equipment_id IN (SELECT id FROM equipment WHERE name LIKE ${LIKE});`,
    },
    {
      name: 'equipment_requests',
      sql: `DELETE FROM equipment_requests WHERE equipment_id IN (SELECT id FROM equipment WHERE name LIKE ${LIKE});`,
    },
    {
      name: 'equipment_maintenance',
      sql: `DELETE FROM equipment_maintenance WHERE equipment_id IN (SELECT id FROM equipment WHERE name LIKE ${LIKE});`,
    },
    {
      name: 'equipment_reservations',
      sql: `DELETE FROM equipment_reservations WHERE equipment_id IN (SELECT id FROM equipment WHERE name LIKE ${LIKE});`,
    },
    {
      name: 'invoice_payments',
      sql: `DELETE FROM invoice_payments WHERE invoice_id IN (SELECT id FROM invoices WHERE comment LIKE ${LIKE});`,
    },
    {
      name: 'work_assign_requests',
      sql: `DELETE FROM work_assign_requests WHERE work_id IN (SELECT id FROM works WHERE work_title LIKE ${LIKE});`,
    },
    {
      name: 'pm_consents',
      sql: `DELETE FROM pm_consents WHERE work_id IN (SELECT id FROM works WHERE work_title LIKE ${LIKE});`,
    },
    {
      name: 'incomes',
      sql: `DELETE FROM incomes WHERE work_id IN (SELECT id FROM works WHERE work_title LIKE ${LIKE});`,
    },
  ];

  // Level 1: Main entities
  const level1 = [
    { name: 'cash_requests', sql: `DELETE FROM cash_requests WHERE purpose LIKE ${LIKE};` },
    { name: 'works', sql: `DELETE FROM works WHERE work_title LIKE ${LIKE};` },
    { name: 'tenders', sql: `DELETE FROM tenders WHERE customer_name LIKE ${LIKE} OR tender_title LIKE ${LIKE};` },
    { name: 'invoices', sql: `DELETE FROM invoices WHERE comment LIKE ${LIKE};` },
    { name: 'acts', sql: `DELETE FROM acts WHERE name LIKE ${LIKE};` },
    { name: 'employees', sql: `DELETE FROM employees WHERE full_name LIKE ${LIKE};` },
    { name: 'equipment', sql: `DELETE FROM equipment WHERE name LIKE ${LIKE};` },
    { name: 'tasks', sql: `DELETE FROM tasks WHERE title LIKE ${LIKE};` },
    { name: 'calendar_events', sql: `DELETE FROM calendar_events WHERE title LIKE ${LIKE};` },
    { name: 'customers', sql: `DELETE FROM customers WHERE name LIKE ${LIKE};` },
    { name: 'payroll_sheets', sql: `DELETE FROM payroll_sheets WHERE name LIKE ${LIKE};` },
    { name: 'purchase_requests', sql: `DELETE FROM purchase_requests WHERE title LIKE ${LIKE};` },
    { name: 'bonus_requests', sql: `DELETE FROM bonus_requests WHERE reason LIKE ${LIKE};` },
    { name: 'staff_plan', sql: `DELETE FROM staff_plan WHERE position LIKE ${LIKE};` },
    { name: 'contracts', sql: `DELETE FROM contracts WHERE name LIKE ${LIKE};` },
    { name: 'correspondence', sql: `DELETE FROM correspondence WHERE subject LIKE ${LIKE};` },
  ];

  // Level 0: Side effects
  const level0 = [
    { name: 'notifications', sql: `DELETE FROM notifications WHERE title LIKE '%${TEST_PREFIX}%' OR message LIKE '%${TEST_PREFIX}%';` },
    { name: 'audit_log', sql: `DELETE FROM audit_log WHERE details::text LIKE '%${TEST_PREFIX}%';` },
  ];

  const allLevels = [
    { name: 'Level 3 (deepest deps)', items: level3 },
    { name: 'Level 2 (mid deps)', items: level2 },
    { name: 'Level 1 (main entities)', items: level1 },
    { name: 'Level 0 (side effects)', items: level0 },
  ];

  for (const level of allLevels) {
    console.log(`[CLEANUP] ${level.name}...`);
    for (const item of level.items) {
      try {
        const result = await sshPsql(item.sql);
        // Parse "DELETE N" from output
        const match = result.match(/DELETE\s+(\d+)/);
        const count = match ? parseInt(match[1]) : 0;
        deletedCounts[item.name] = count;
        if (count > 0) {
          console.log(`  [CLEANUP] ${item.name}: deleted ${count} rows`);
        }
      } catch (e) {
        const msg = `${item.name}: ${e.message}`;
        errors.push(msg);
        console.warn(`  [CLEANUP] ERROR ${msg}`);
      }
    }
  }

  const totalDeleted = Object.values(deletedCounts).reduce((a, b) => a + b, 0);
  console.log(`[CLEANUP] Complete. Total deleted: ${totalDeleted} rows. Errors: ${errors.length}`);

  return {
    success: errors.length === 0,
    deletedCounts,
    totalDeleted,
    errors,
  };
}

/**
 * Quick count of remaining TEST_AUTO_* data in main tables
 */
async function countTestData() {
  const tables = [
    { name: 'tenders', col: 'customer_name' },
    { name: 'works', col: 'work_title' },
    { name: 'employees', col: 'full_name' },
    { name: 'equipment', col: 'name' },
    { name: 'invoices', col: 'comment' },
    { name: 'cash_requests', col: 'purpose' },
    { name: 'tasks', col: 'title' },
  ];

  const counts = {};
  for (const t of tables) {
    try {
      const result = await sshPsql(`SELECT count(*) FROM ${t.name} WHERE ${t.col} LIKE ${LIKE};`);
      const match = result.match(/(\d+)/);
      counts[t.name] = match ? parseInt(match[1]) : 0;
    } catch {
      counts[t.name] = -1;
    }
  }
  return counts;
}

module.exports = { fullCleanup, countTestData };
