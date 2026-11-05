'use strict';
/**
 * Batch AI-фото архетипов (Flash packshot), лимит ≤500, бюджет.
 *
 * Usage:
 *   node tools/generate_market_card_photos.js --dry-run
 *   node tools/generate_market_card_photos.js --apply --max-cost 600 --max-photos 500
 *   node tools/generate_market_card_photos.js --apply --priority-only
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const photo = require('../src/services/market-card-photo');
const jobs = require('../src/services/market-ai-jobs');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PRIORITY = args.includes('--priority-only');
function argNum(name, def) {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) ? n : def;
}
const MAX_COST = argNum('--max-cost', 600);
const MAX_PHOTOS = argNum('--max-photos', 500);
const LIMIT = argNum('--limit', 500);

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
    max_cost: MAX_COST,
    max_photos: MAX_PHOTOS,
    results: [],
    total_cost: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    if (await jobs.isMarketAiBlocked(pool)) {
      console.error('market_ai_blocked_until active');
      process.exit(photo.EXIT_NO_CREDIT);
    }

    const { rows: keys } = await pool.query(
      `
      SELECT a.key, a.title, a.hero_photo_url, a.status, a.photo_source,
             COALESCE(pc.cnt,0)::int AS product_members,
             COALESCE(ec.cnt,0)::int AS equipment_members,
             COALESCE(ps.stock,0)::numeric AS stock_qty,
             COALESCE(ew.n,0)::int AS eq_on_wh
      FROM market_card_archetypes a
      LEFT JOIN (
        SELECT market_card_key, COUNT(*) cnt FROM products
        WHERE deleted_at IS NULL AND market_card_key IS NOT NULL GROUP BY 1
      ) pc ON pc.market_card_key = a.key
      LEFT JOIN (
        SELECT market_card_key, COUNT(*) cnt FROM equipment
        WHERE market_card_key IS NOT NULL GROUP BY 1
      ) ec ON ec.market_card_key = a.key
      LEFT JOIN (
        SELECT p.market_card_key, SUM(GREATEST(s.quantity - COALESCE(s.reserved_qty,0),0)) stock
        FROM products p
        JOIN stock s ON s.product_id = p.id
        WHERE p.deleted_at IS NULL AND p.market_card_key IS NOT NULL
        GROUP BY 1
      ) ps ON ps.market_card_key = a.key
      LEFT JOIN (
        SELECT market_card_key, COUNT(*) n FROM equipment
        WHERE market_card_key IS NOT NULL
          AND status = 'on_warehouse'
        GROUP BY 1
      ) ew ON ew.market_card_key = a.key
      WHERE a.photo_source IS DISTINCT FROM 'real'
      ORDER BY
        (CASE WHEN COALESCE(ps.stock,0)>0 OR COALESCE(ew.n,0)>0 THEN 0 ELSE 1 END),
        (COALESCE(pc.cnt,0)+COALESCE(ec.cnt,0)) DESC,
        a.key
      LIMIT $1
      `,
      [LIMIT]
    );

    let candidates = keys.filter((k) => !k.hero_photo_url || k.photo_source === 'placeholder');
    if (PRIORITY) {
      candidates = candidates.filter(
        (k) =>
          Number(k.stock_qty) > 0 ||
          k.eq_on_wh > 0 ||
          k.product_members + k.equipment_members >= 3
      );
    }

    console.log(JSON.stringify({
      candidates: candidates.length,
      apply: APPLY,
      max_cost: MAX_COST,
      max_photos: MAX_PHOTOS,
    }, null, 2));

    for (const c of candidates) {
      if (report.total_cost >= MAX_COST) {
        report.stopped = 'max_cost';
        break;
      }
      const ready = await jobs.countReadyHeroes(pool);
      if (ready >= MAX_PHOTOS) {
        report.stopped = 'max_photos';
        break;
      }
      if (!APPLY) {
        report.results.push({ key: c.key, dry: true, members: c.product_members + c.equipment_members });
        report.skipped++;
        continue;
      }
      try {
        const r = await photo.generateArchetypePhoto(pool, c.key, { maxPhotos: MAX_PHOTOS, force: c.photo_source === 'placeholder' });
        report.results.push({ key: c.key, ...r });
        if (r.ok && !r.skipped) {
          report.generated++;
          report.total_cost += Number(r.cost_rub) || photo.COST_ESTIMATE_RUB;
        } else if (r.skipped) {
          report.skipped++;
        } else {
          report.failed++;
          if (r.reason === 'blocked' || r.reason === 'max_photos') {
            report.stopped = r.reason;
            break;
          }
        }
      } catch (e) {
        report.results.push({ key: c.key, ok: false, error: e.message, code: e.code });
        report.failed++;
        if (e.code === 'NO_CREDIT') {
          report.stopped = 'NO_CREDIT';
          console.error('NO_CREDIT');
          const out = path.join(__dirname, '..', 'tests', 'reports', 'market-card-clusters', 'GENERATE-PHOTOS-REPORT.json');
          require('fs').writeFileSync(out, JSON.stringify(report, null, 2));
          process.exit(photo.EXIT_NO_CREDIT);
        }
      }
    }

    const out = path.join(__dirname, '..', 'tests', 'reports', 'market-card-clusters', 'GENERATE-PHOTOS-REPORT.json');
    require('fs').mkdirSync(path.dirname(out), { recursive: true });
    require('fs').writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      generated: report.generated,
      skipped: report.skipped,
      failed: report.failed,
      total_cost: report.total_cost,
      stopped: report.stopped || null,
      report: out,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
