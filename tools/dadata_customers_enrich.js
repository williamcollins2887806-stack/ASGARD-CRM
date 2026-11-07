#!/usr/bin/env node
'use strict';

/**
 * Batch-сверка ИНН через DaData findById/party.
 * Usage:
 *   node tools/dadata_customers_enrich.js [--apply] [--limit=50] [--db=asgard_crm_test]
 * Default: dry-run (только отчёт, без UPDATE).
 *
 * Требует DADATA_TOKEN и таблицу customer_dadata_meta (V469).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { validCounterpartyInn, digitsInn } = require('../src/services/counterparty-inn');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dadataFind(inn, token) {
  const response = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Token ' + token
    },
    body: JSON.stringify({ query: inn, count: 1 })
  });
  if (!response.ok) throw new Error('DaData HTTP ' + response.status);
  const data = await response.json();
  const s = (data.suggestions || [])[0];
  if (!s) return { found: false };
  const d = s.data || {};
  const state = (d.state && d.state.status) || null;
  return {
    found: true,
    liquidated: state === 'LIQUIDATED',
    state,
    suggestion: {
      inn: d.inn || inn,
      name: (d.name && d.name.short_with_opf) || s.value || '',
      full_name: (d.name && d.name.full_with_opf) || '',
      kpp: d.kpp || '',
      ogrn: d.ogrn || '',
      address: (d.address && (d.address.unrestricted_value || d.address.value)) || ''
    }
  };
}

async function upsertMeta(db, inn, status, rawState) {
  await db.query(
    `INSERT INTO customer_dadata_meta (inn, status, raw_state, checked_at, updated_at)
     VALUES ($1,$2,$3,NOW(),NOW())
     ON CONFLICT (inn) DO UPDATE SET
       status = EXCLUDED.status,
       raw_state = EXCLUDED.raw_state,
       checked_at = NOW(),
       updated_at = NOW()`,
    [inn, status, rawState || null]
  );
}

async function fillCustomer(db, sug) {
  const cur = await db.query('SELECT * FROM customers WHERE inn=$1', [sug.inn]);
  if (!cur.rows[0]) {
    if (!sug.name) return 'no_row';
    await db.query(
      `INSERT INTO customers (inn, name, full_name, kpp, ogrn, address, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
       ON CONFLICT (inn) DO NOTHING`,
      [sug.inn, sug.name.slice(0, 255), (sug.full_name || '').slice(0, 500) || null,
        sug.kpp || null, sug.ogrn || null, sug.address || null]
    );
    return 'created';
  }
  const row = cur.rows[0];
  const patch = [];
  const vals = [];
  const setIfEmpty = (col, val) => {
    if (row[col] != null && String(row[col]).trim() !== '') return;
    if (val == null || String(val).trim() === '') return;
    vals.push(val);
    patch.push(`${col}=$${vals.length}`);
  };
  setIfEmpty('name', sug.name);
  setIfEmpty('full_name', sug.full_name);
  setIfEmpty('kpp', sug.kpp);
  setIfEmpty('ogrn', sug.ogrn);
  setIfEmpty('address', sug.address);
  if (!patch.length) return 'unchanged';
  vals.push(sug.inn);
  await db.query(`UPDATE customers SET ${patch.join(',')}, updated_at=NOW() WHERE inn=$${vals.length}`, vals);
  return 'filled';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const limArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limArg ? parseInt(limArg.slice(8), 10) : 0;
  const dbArg = (process.argv.find((a) => a.startsWith('--db=')) || '').slice(5);
  const database = dbArg || process.env.PGDATABASE || 'asgard_crm';
  const token = process.env.DADATA_TOKEN;
  if (!token) {
    console.error('DADATA_TOKEN не задан');
    process.exit(2);
  }

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

  const { rows: innRows } = await db.query(`
    SELECT inn FROM (
      SELECT regexp_replace(inn, '\\D', '', 'g') AS inn FROM customers WHERE inn IS NOT NULL
      UNION
      SELECT regexp_replace(inn, '\\D', '', 'g') FROM suppliers WHERE deleted_at IS NULL AND inn IS NOT NULL
    ) x WHERE length(inn) IN (10,12)
    ORDER BY inn
  `);

  let list = innRows.map((r) => r.inn).filter(validCounterpartyInn);
  const skippedBad = innRows.length - list.length;
  if (limit > 0) list = list.slice(0, limit);

  const report = {
    apply, database, total: list.length, skipped_bad_inn: skippedBad,
    ok: 0, filled: 0, created: 0, not_found: 0, liquidated: 0, api_errors: 0
  };

  for (const inn of list) {
    try {
      const r = await dadataFind(inn, token);
      await sleep(120);
      if (!r.found) {
        report.not_found++;
        if (apply) await upsertMeta(db, inn, 'not_found', null);
        continue;
      }
      if (r.liquidated) {
        report.liquidated++;
        if (apply) {
          await upsertMeta(db, inn, 'liquidated', r.state);
          await fillCustomer(db, r.suggestion);
        }
        continue;
      }
      if (apply) {
        const fr = await fillCustomer(db, r.suggestion);
        if (fr === 'filled') report.filled++;
        else if (fr === 'created') report.created++;
        await upsertMeta(db, inn, 'ok', r.state);
      }
      report.ok++;
    } catch (e) {
      report.api_errors++;
      console.error('ERR', inn, e.message);
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
