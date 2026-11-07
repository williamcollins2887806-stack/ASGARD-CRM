#!/usr/bin/env node
'use strict';

/**
 * Quarantine кривых ИНН в customer_dadata_meta + отчёт по дублям suppliers.
 * Usage: node tools/cleanup_customers_junk.js [--apply] [--db=...]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { validCounterpartyInn, digitsInn, isStubOrgName } = require('../src/services/counterparty-inn');

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

  await db.query(`
    CREATE TABLE IF NOT EXISTS customer_dadata_meta (
      inn VARCHAR(12) PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'unchecked',
      raw_state TEXT,
      checked_at TIMESTAMPTZ,
      source TEXT DEFAULT 'dadata',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  const { rows: cust } = await db.query(`SELECT inn, name FROM customers`);
  const badCustomers = cust.filter((c) => !validCounterpartyInn(c.inn) || isStubOrgName(c.name));

  const { rows: sup } = await db.query(
    `SELECT id, inn, name FROM suppliers WHERE deleted_at IS NULL`);
  const badSup = sup.filter((s) => s.inn && !validCounterpartyInn(s.inn));

  const byInn = new Map();
  for (const s of sup) {
    const inn = digitsInn(s.inn);
    if (!validCounterpartyInn(inn)) continue;
    if (!byInn.has(inn)) byInn.set(inn, []);
    byInn.get(inn).push(s);
  }
  const dupGroups = [...byInn.entries()].filter(([, arr]) => arr.length > 1);

  const report = {
    apply,
    database,
    bad_customers: badCustomers.length,
    bad_suppliers_inn: badSup.length,
    supplier_dup_groups: dupGroups.length,
    sample_bad_customers: badCustomers.slice(0, 20).map((c) => ({ inn: c.inn, name: c.name })),
    sample_dups: dupGroups.slice(0, 10).map(([inn, arr]) => ({ inn, ids: arr.map((x) => x.id), names: arr.map((x) => x.name) }))
  };

  if (apply) {
    for (const c of badCustomers) {
      const inn = digitsInn(c.inn) || String(c.inn || '').slice(0, 12);
      if (!inn) continue;
      await db.query(
        `INSERT INTO customer_dadata_meta (inn, status, notes, checked_at, updated_at)
         VALUES ($1,'quarantine',$2,NOW(),NOW())
         ON CONFLICT (inn) DO UPDATE SET status='quarantine', notes=EXCLUDED.notes, updated_at=NOW()`,
        [inn.slice(0, 12), 'bad_inn_or_stub']
      );
    }
    report.quarantined = badCustomers.length;
  }

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
