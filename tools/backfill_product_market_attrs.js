#!/usr/bin/env node
'use strict';
/**
 * Backfill pack_qty / base_unit / unit_price_base / search_keywords
 * из последних price_records (без LLM).
 * Usage: node tools/backfill_product_market_attrs.js
 * Env: PG* или DATABASE_URL
 */
const { Pool } = require('pg');
const { enrichProductMarketCard } = require('../src/services/product-market-enrich');

async function main() {
  const pool = new Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
        host: process.env.PGHOST || '127.0.0.1',
        user: process.env.PGUSER || 'asgard',
        password: process.env.PGPASSWORD || '123456789',
        database: process.env.PGDATABASE || 'asgard_crm',
        port: +(process.env.PGPORT || 5432)
      }
  );
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (pr.product_id)
      pr.product_id, pr.item_name, pr.article, pr.unit, pr.unit_price
    FROM price_records pr
    WHERE pr.product_id IS NOT NULL AND pr.unit_price > 0
    ORDER BY pr.product_id, pr.recorded_at DESC NULLS LAST
  `);
  let ok = 0; let fail = 0;
  for (const r of rows) {
    try {
      await enrichProductMarketCard(pool, r.product_id, {
        name: r.item_name, article: r.article, unit: r.unit, unit_price: r.unit_price
      });
      ok++;
    } catch (e) {
      fail++;
      if (fail < 5) console.error(e.message);
    }
  }
  console.log(JSON.stringify({ total: rows.length, ok, fail }));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
