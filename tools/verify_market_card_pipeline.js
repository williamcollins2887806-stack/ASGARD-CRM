'use strict';
/**
 * Verify V450 market card pipeline:
 * - 100% photo_url on active products + equipment
 * - unique heroes ≤ 500
 * - smoke: enrichCatalogFromLines without AI (blocked) still creates product + jobs
 *
 * Usage:
 *   node tools/verify_market_card_pipeline.js
 *   node tools/verify_market_card_pipeline.js --smoke-invoice
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const fs = require('fs');

const SMOKE = process.argv.includes('--smoke-invoice');

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    database: process.env.DB_NAME || 'asgard_crm',
  });

  const report = { at: new Date().toISOString(), checks: [], smoke: null };
  const check = (name, ok, detail) => {
    report.checks.push({ name, ok: !!ok, detail });
    console.log(ok ? 'PASS' : 'FAIL', name, detail || '');
  };

  try {
    // schema
    const tables = await pool.query(`
      SELECT to_regclass('public.market_card_archetypes') AS a,
             to_regclass('public.market_ai_jobs') AS j
    `);
    check('schema_archetypes', !!tables.rows[0].a, tables.rows[0].a);
    check('schema_jobs', !!tables.rows[0].j, tables.rows[0].j);

    const cov = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM products WHERE deleted_at IS NULL) AS p_total,
        (SELECT COUNT(*)::int FROM products WHERE deleted_at IS NULL AND photo_url IS NOT NULL AND btrim(photo_url)<>'') AS p_photo,
        (SELECT COUNT(*)::int FROM products WHERE deleted_at IS NULL AND market_card_key IS NOT NULL) AS p_key,
        (SELECT COUNT(*)::int FROM equipment WHERE deleted_at IS NULL) AS e_total,
        (SELECT COUNT(*)::int FROM equipment WHERE deleted_at IS NULL AND photo_url IS NOT NULL AND btrim(photo_url)<>'') AS e_photo,
        (SELECT COUNT(*)::int FROM equipment WHERE deleted_at IS NULL AND market_card_key IS NOT NULL) AS e_key,
        (SELECT COUNT(*)::int FROM market_card_archetypes WHERE hero_photo_url IS NOT NULL) AS heroes,
        (SELECT COUNT(*)::int FROM market_card_archetypes) AS arch_total
    `);
    const c = cov.rows[0];
    report.coverage = c;
    check('products_photo_100', c.p_total > 0 && c.p_photo === c.p_total, c);
    check('equipment_photo_100', c.e_total > 0 && c.e_photo === c.e_total, c);
    check('products_keys', c.p_key === c.p_total, { p_key: c.p_key, p_total: c.p_total });
    check('equipment_keys', c.e_key === c.e_total, { e_key: c.e_key, e_total: c.e_total });
    check('heroes_le_500', c.heroes <= 500, { heroes: c.heroes });

    const realGuard = await pool.query(`
      SELECT COUNT(*)::int AS n FROM products
      WHERE deleted_at IS NULL AND photo_source='real'
        AND market_card_key IS NOT NULL
    `);
    const photoSrc = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'market-card-photo.js'),
      'utf8'
    );
    const realLockedInCode =
      /photo_source === 'real'/.test(photoSrc) && /real_locked/.test(photoSrc);
    check('real_photo_lock_in_code', realLockedInCode, {
      real_products: realGuard.rows[0].n,
    });

    if (SMOKE) {
      const jobs = require('../src/services/market-ai-jobs');
      const { enrichCatalogFromLines } = require('../src/services/catalog-from-invoice');
      // simulate no credit
      await jobs.blockMarketAi(pool, 1);
      const marker = `E2E Market Card ${Date.now()}`;
      const r = await enrichCatalogFromLines(pool, {
        lines: [{ name: marker, unit: 'шт', unit_price: 12.5, quantity: 1 }],
        supplierName: 'E2E Market Supplier',
        source: 'manual',
        userId: null,
      });
      const { rows: prod } = await pool.query(
        `SELECT id, name, market_card_key, photo_url, photo_source FROM products
         WHERE name=$1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
        [marker]
      );
      const p = prod[0];
      const { rows: jobRows } = await pool.query(
        `SELECT job_type, status FROM market_ai_jobs
         WHERE entity_id=$1 OR archetype_key=$2
         ORDER BY id DESC LIMIT 10`,
        [p?.id || 0, p?.market_card_key || '']
      );
      report.smoke = { enrich: r, product: p, jobs: jobRows };
      check('smoke_product_created', !!p?.id, p);
      check('smoke_has_key', !!p?.market_card_key, p?.market_card_key);
      check('smoke_has_photo_or_placeholder', !!p?.photo_url, p?.photo_url);
      check('smoke_jobs_enqueued', jobRows.length > 0, jobRows.map((j) => `${j.job_type}:${j.status}`));
      // cleanup: не оставлять smoke-товар на витрине
      if (p?.id) {
        await pool.query(
          `UPDATE products SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND name ILIKE 'E2E Market Card%'`,
          [p.id]
        );
      }
      await jobs.upsertSettingJson(pool, jobs.BLOCKED_KEY, null);
      await pool.query(
        `UPDATE market_ai_jobs SET status='pending', next_run_at=NOW() WHERE status='blocked'`
      );
    }

    report.ok = report.checks.every((x) => x.ok);
    const out = path.join(__dirname, '..', 'tests', 'reports', 'market-card-clusters', 'PIPELINE-VERIFY.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(report.ok ? 'VERIFIED' : 'FAIL', out);
    process.exit(report.ok ? 0 : 2);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
