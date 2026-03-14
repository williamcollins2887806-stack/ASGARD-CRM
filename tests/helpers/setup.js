/**
 * ASGARD CRM — Глобальный setup для тестов
 */

'use strict';

require('./env-setup');

const { Pool } = require('pg');

let pool;

async function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'asgard_test',
      user: process.env.DB_USER || 'asgard_test',
      password: process.env.DB_PASSWORD || 'test_password'
    });
  }
  return pool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

async function cleanDb() {
  const db = await getPool();
  // Удаляем данные в правильном порядке (зависимости FK)
  const tables = [
    'audit_log', 'notifications', 'erp_sync_log', 'erp_field_mappings',
    'erp_connections', 'platform_parse_results', 'bank_transactions',
    'bank_import_batches', 'pre_tender_requests', 'inbox_applications',
    'email_attachments', 'email_sync_log', 'emails', 'email_accounts',
    'payroll_items', 'payroll_sheets', 'permit_application_history',
    'permit_application_items', 'permit_applications',
    'estimates', 'works', 'tenders', 'customers'
  ];
  for (const table of tables) {
    try { await db.query(`DELETE FROM ${table}`); } catch (_) { /* таблица может не существовать */ }
  }
  // Пользователей удаляем отдельно (кроме системных)
  try { await db.query(`DELETE FROM users WHERE login LIKE 'test_%'`); } catch (_) {}
}

async function seedTestData() {
  const db = await getPool();
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('Test123!', 10);

  const roles = [
    'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
    'HEAD_PM', 'HEAD_TO', 'PM', 'TO', 'HR', 'HR_MANAGER',
    'BUH', 'OFFICE_MANAGER', 'WAREHOUSE', 'PROC', 'CHIEF_ENGINEER'
  ];

  for (const role of roles) {
    const login = `test_${role.toLowerCase()}`;
    await db.query(`
      INSERT INTO users (login, password_hash, name, role, is_active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (login) DO UPDATE SET password_hash = $2, role = $4, is_active = true
    `, [login, hash, `Тест ${role}`, role]);
  }
}

module.exports = { getPool, closePool, cleanDb, seedTestData };
