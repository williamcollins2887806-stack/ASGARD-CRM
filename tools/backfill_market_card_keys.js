'use strict';
/**
 * Backfill market_card_key + placeholder photo_url на все products/equipment.
 *
 * Usage:
 *   node tools/backfill_market_card_keys.js              # dry-run counts
 *   node tools/backfill_market_card_keys.js --apply
 *   node tools/backfill_market_card_keys.js --apply --placeholders
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const archetype = require('../src/services/market-card-archetype');
const photo = require('../src/services/market-card-photo');

const APPLY = process.argv.includes('--apply');
const PLACEHOLDERS = process.argv.includes('--placeholders') || APPLY;

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    database: process.env.DB_NAME || 'asgard_crm',
  });

  const report = {
    at: new Date().toISOString(),
    apply: APPLY,
    archetypes_seeded: 0,
    products_assigned: 0,
    equipment_assigned: 0,
    placeholders: 0,
    keys_used: {},
  };

  try {
    // 1) seed archetype rows from taxonomy+extra+fallbacks
    const defs = archetype.listArchetypeDefs();
    for (const d of defs) {
      if (APPLY) {
        await archetype.ensureArchetype(pool, d);
        report.archetypes_seeded++;
      }
    }
    if (!APPLY) report.archetypes_seeded = defs.length;

    // 2) products
    const { rows: products } = await pool.query(
      `SELECT p.id, p.name, p.unit, p.market_card_key, c.search_group
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
       WHERE p.deleted_at IS NULL
       ORDER BY p.id`
    );
    for (const p of products) {
      const m = archetype.matchArchetype({
        name: p.name,
        unit: p.unit,
        search_group: p.search_group,
      });
      report.keys_used[m.key] = (report.keys_used[m.key] || 0) + 1;
      if (APPLY) {
        await archetype.assignProductCardKey(pool, p.id, {
          name: p.name,
          unit: p.unit,
          search_group: p.search_group,
        });
        report.products_assigned++;
      }
    }

    // 3) equipment
    const { rows: equipment } = await pool.query(
      `SELECT id, name, brand, model, market_card_key FROM equipment
       WHERE deleted_at IS NULL ORDER BY id`
    );
    for (const e of equipment) {
      const m = archetype.matchArchetype({
        name: e.name,
        brand: e.brand,
        model: e.model,
        search_group: 'equipment',
      });
      report.keys_used[m.key] = (report.keys_used[m.key] || 0) + 1;
      if (APPLY) {
        await archetype.assignEquipmentCardKey(pool, e.id, {
          name: e.name,
          brand: e.brand,
          model: e.model,
          search_group: 'equipment',
        });
        report.equipment_assigned++;
      }
    }

    // 4) placeholders for keys without hero / members without photo
    if (PLACEHOLDERS && APPLY) {
      const keys = Object.keys(report.keys_used);
      for (const key of keys) {
        const def = defs.find((d) => d.key === key) || { key, title: key };
        const tone = key.startsWith('fallback_')
          ? key.replace('fallback_', '')
          : key.split('_')[0];
        await photo.applyPlaceholderToArchetype(pool, key, def.title, tone);
        report.placeholders++;
      }
      // any remaining without photo_url
      await pool.query(
        `UPDATE products p SET
           photo_url = COALESCE(a.hero_photo_url, p.photo_url),
           photo_source = COALESCE(p.photo_source, a.photo_source, 'placeholder'),
           updated_at = NOW()
         FROM market_card_archetypes a
         WHERE p.market_card_key = a.key
           AND p.deleted_at IS NULL
           AND p.photo_url IS NULL
           AND a.hero_photo_url IS NOT NULL`
      );
      await pool.query(
        `UPDATE equipment e SET
           photo_url = COALESCE(a.hero_photo_url, e.photo_url),
           photo_source = COALESCE(e.photo_source, a.photo_source, 'placeholder'),
           updated_at = NOW()
         FROM market_card_archetypes a
         WHERE e.market_card_key = a.key
           AND e.photo_url IS NULL
           AND a.hero_photo_url IS NOT NULL`
      );
    }

    const uniqueKeys = Object.keys(report.keys_used).length;
    report.unique_keys = uniqueKeys;
    report.products_total = products.length;
    report.equipment_total = equipment.length;
    report.ok = uniqueKeys <= 500;

    if (APPLY) {
      const cov = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL) AS p_total,
          (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL AND photo_url IS NOT NULL) AS p_photo,
          (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL AND market_card_key IS NOT NULL) AS p_key,
          (SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL) AS e_total,
          (SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL AND photo_url IS NOT NULL) AS e_photo,
          (SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL AND market_card_key IS NOT NULL) AS e_key,
          (SELECT COUNT(*) FROM market_card_archetypes) AS arch,
          (SELECT COUNT(*) FROM market_card_archetypes WHERE hero_photo_url IS NOT NULL) AS arch_hero
      `);
      report.coverage = cov.rows[0];
    }

    const outDir = path.join(__dirname, '..', 'tests', 'reports', 'market-card-clusters');
    require('fs').mkdirSync(outDir, { recursive: true });
    require('fs').writeFileSync(
      path.join(outDir, 'BACKFILL-KEYS-REPORT.json'),
      JSON.stringify(report, null, 2),
      'utf8'
    );
    console.log(JSON.stringify({
      apply: APPLY,
      unique_keys: report.unique_keys,
      products: report.products_total,
      equipment: report.equipment_total,
      coverage: report.coverage || null,
      ok: report.ok,
    }, null, 2));
    if (!report.ok) process.exit(2);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
