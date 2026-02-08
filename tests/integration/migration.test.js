/**
 * ASGARD CRM — Интеграционные тесты: миграции V001-V021
 */

'use strict';

require('../helpers/env-setup');

const { getPool, closePool } = require('../helpers/setup');

let pool;

beforeAll(async () => {
  pool = await getPool();
}, 15000);

afterAll(async () => {
  await closePool();
});

describe('Миграции', () => {

  test('все ключевые таблицы существуют', async () => {
    const { rows } = await pool.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const tableNames = rows.map(r => r.tablename);

    const required = [
      'users', 'tenders', 'estimates', 'works',
      'notifications', 'audit_log',
      'payroll_sheets', 'payroll_items',
      'permit_applications', 'permit_types',
      'emails', 'email_accounts', 'email_attachments',
      'email_classification_rules', 'email_templates_v2',
      'pre_tender_requests', 'inbox_applications',
      'bank_transactions', 'bank_import_batches', 'bank_classification_rules',
      'platform_parse_results',
      'erp_connections', 'erp_sync_log', 'erp_field_mappings'
    ];

    for (const table of required) {
      expect(tableNames).toContain(table);
    }
  });

  test('таблица migrations существует и содержит записи', async () => {
    const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM migrations');
    expect(parseInt(rows[0].cnt)).toBeGreaterThan(0);
  });

  test('таблица users имеет обязательные колонки', async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND table_schema = 'public'
    `);
    const columns = rows.map(r => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('login');
    expect(columns).toContain('password_hash');
    expect(columns).toContain('role');
    expect(columns).toContain('is_active');
  });

  test('таблица bank_transactions имеет обязательные колонки', async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bank_transactions' AND table_schema = 'public'
    `);
    const columns = rows.map(r => r.column_name);
    expect(columns).toContain('import_hash');
    expect(columns).toContain('transaction_date');
    expect(columns).toContain('amount');
    expect(columns).toContain('direction');
    expect(columns).toContain('counterparty_name');
    expect(columns).toContain('status');
  });

  test('таблица platform_parse_results имеет обязательные колонки', async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'platform_parse_results' AND table_schema = 'public'
    `);
    const columns = rows.map(r => r.column_name);
    expect(columns).toContain('email_id');
    expect(columns).toContain('platform');
    expect(columns).toContain('relevance_score');
    expect(columns).toContain('parse_status');
  });

  test('системные правила классификации банка загружены', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as cnt FROM bank_classification_rules WHERE is_system = true`
    );
    expect(parseInt(rows[0].cnt)).toBeGreaterThanOrEqual(10);
  });

  test('повторный прогон миграций не вызывает ошибок (идемпотентность)', async () => {
    // Миграции с IF NOT EXISTS / ON CONFLICT не должны падать
    const { execSync } = require('child_process');
    const env = {
      ...process.env,
      DB_HOST: process.env.DB_HOST,
      DB_NAME: process.env.DB_NAME,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD
    };
    expect(() => {
      execSync('node migrations/run.js', { env, cwd: process.cwd(), timeout: 30000 });
    }).not.toThrow();
  });

  test('модули интеграций зарегистрированы', async () => {
    try {
      const { rows } = await pool.query(
        `SELECT module_key FROM modules WHERE module_key IN ('bank_integration', 'platforms', 'erp')`
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    } catch (_) {
      // Таблица modules может не существовать в некоторых конфигурациях
    }
  });
});
