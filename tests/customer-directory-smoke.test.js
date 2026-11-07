'use strict';

/**
 * Smoke: directory SQL собирается и (если есть БД) отвечает.
 * Без PG — skip.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('customer-directory module exports', () => {
  const m = require('../src/services/customer-directory');
  assert.equal(typeof m.listDirectory, 'function');
  assert.equal(typeof m.statsForInn, 'function');
  assert.ok(m.RELATION_MONTHS >= 12);
});

test('listDirectory against asgard_crm_test (optional)', async (t) => {
  let Pool;
  try { Pool = require('pg').Pool; } catch (_) {
    t.skip('no pg');
    return;
  }
  const pool = new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'asgard',
    password: process.env.PGPASSWORD || '123456789',
    database: process.env.PGDATABASE || 'asgard_crm_test',
    connectionTimeoutMillis: 2000
  });
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    await pool.end().catch(() => {});
    t.skip('DB unavailable: ' + e.message);
    return;
  }
  const db = { query: (q, p) => pool.query(q, p) };
  const { listDirectory } = require('../src/services/customer-directory');
  const r = await listDirectory(db, { limit: 5, offset: 0 });
  assert.ok(Array.isArray(r.items));
  if (r.items[0]) {
    assert.ok(r.items[0].inn);
    assert.ok(r.items[0].counts);
    assert.ok(['buyer', 'supplier', 'both'].includes(r.items[0].roles));
    assert.ok(['active', 'idle', 'none'].includes(r.items[0].relation_status));
  }
  await pool.end();
});
