#!/usr/bin/env node
'use strict';

/**
 * Backfill: suppliers (валидный ИНН) → customers (fill-only).
 * Usage:
 *   node tools/backfill_customers_from_suppliers.js [--apply] [--db=asgard_crm_test]
 * Default: dry-run.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { validCounterpartyInn, isStubOrgName, digitsInn } = require('../src/services/counterparty-inn');
const { mirrorSupplierIdToCustomer } = require('../src/services/customer-from-supplier');

async function main() {
  const apply = process.argv.includes('--apply');
  const dbArg = (process.argv.find((a) => a.startsWith('--db=')) || '').slice(5);
  const database = dbArg || process.env.PGDATABASE || 'asgard_crm';
  const pool = new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'asgard',
    password: process.env.PGPASSWORD || '123456789',
    database
  });
  const db = { query: (t, p) => pool.query(t, p) };

  const { rows } = await db.query(
    `SELECT id, name, inn FROM suppliers WHERE deleted_at IS NULL ORDER BY id`
  );

  const report = { created: 0, filled: 0, skipped_bad_inn: 0, skipped_stub: 0, errors: 0, total: rows.length };

  for (const s of rows) {
    const inn = digitsInn(s.inn);
    if (!validCounterpartyInn(inn)) {
      report.skipped_bad_inn++;
      continue;
    }
    if (isStubOrgName(s.name)) {
      report.skipped_stub++;
      continue;
    }
    if (!apply) {
      const exists = await db.query('SELECT 1 FROM customers WHERE inn=$1', [inn]);
      if (!exists.rows[0]) report.created++;
      else report.filled++;
      continue;
    }
    try {
      const r = await mirrorSupplierIdToCustomer(db, s.id);
      if (r.created) report.created++;
      else if (r.filled > 0) report.filled++;
      else if (r.reason) {
        if (r.reason === 'bad_inn') report.skipped_bad_inn++;
        else if (r.reason === 'stub_name') report.skipped_stub++;
      }
    } catch (e) {
      report.errors++;
      console.error('ERR', s.id, inn, e.message);
    }
  }

  console.log(JSON.stringify({ apply, database, ...report }, null, 2));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
