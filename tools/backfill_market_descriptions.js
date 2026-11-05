'use strict';
/**
 * Backfill AI-описаний для products + equipment (дедуп по имени/марке/модели).
 *
 *   node tools/backfill_market_descriptions.js --dry-run
 *   node tools/backfill_market_descriptions.js --apply --limit 50
 *   node tools/backfill_market_descriptions.js --apply --stock-first
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const descSvc = require('../src/services/market-card-description');
const jobs = require('../src/services/market-ai-jobs');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const STOCK_FIRST = args.includes('--stock-first');
const FORCE = args.includes('--force');
function argNum(name, def) {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) ? n : def;
}
const LIMIT = argNum('--limit', 5000);
const CONCURRENCY = Math.min(4, argNum('--concurrency', 2));

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
    done: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    if (await jobs.isMarketAiBlocked(pool)) {
      console.error('market_ai_blocked_until active');
      process.exit(42);
    }

    const { rows: products } = await pool.query(
      `
      SELECT p.id, 'product'::text AS entity_type, p.name,
             COALESCE(st.qty,0) AS stock_qty
      FROM products p
      LEFT JOIN LATERAL (
        SELECT SUM(s.quantity - COALESCE(s.reserved_qty,0)) AS qty
        FROM stock s WHERE s.product_id = p.id
      ) st ON true
      WHERE p.deleted_at IS NULL
        AND ($1::bool OR p.attrs IS NULL OR p.attrs->>'description_ai' IS NULL
             OR btrim(COALESCE(p.attrs->>'description_ai',''))='')
      ORDER BY
        CASE WHEN $2::bool AND COALESCE(st.qty,0)>0 THEN 0 ELSE 1 END,
        p.id
      LIMIT $3
      `,
      [FORCE, STOCK_FIRST, LIMIT]
    );

    // equipment: один представитель на имя+бренд+модель без описания
    const { rows: equipment } = await pool.query(
      `
      SELECT DISTINCT ON (lower(trim(e.name)), COALESCE(lower(trim(e.brand)),''), COALESCE(lower(trim(e.model)),''))
        e.id, 'equipment'::text AS entity_type, e.name,
        CASE WHEN e.status='on_warehouse' THEN 1 ELSE 0 END AS stock_qty
      FROM equipment e
      WHERE e.deleted_at IS NULL
        AND ($1::bool OR e.attrs IS NULL OR e.attrs->>'description_ai' IS NULL
             OR btrim(COALESCE(e.attrs->>'description_ai',''))='')
      ORDER BY
        lower(trim(e.name)), COALESCE(lower(trim(e.brand)),''), COALESCE(lower(trim(e.model)),''),
        CASE WHEN e.status='on_warehouse' THEN 0 ELSE 1 END,
        e.id
      LIMIT $2
      `,
      [FORCE, LIMIT]
    );

    let queue = products.concat(equipment);
    if (STOCK_FIRST) {
      queue.sort((a, b) => Number(b.stock_qty > 0) - Number(a.stock_qty > 0));
    }
    queue = queue.slice(0, LIMIT);

    console.log(JSON.stringify({
      apply: APPLY,
      products: products.length,
      equipment_groups: equipment.length,
      queue: queue.length,
      concurrency: CONCURRENCY,
    }, null, 2));

    if (!APPLY) {
      report.dry = queue.slice(0, 20).map((x) => ({ type: x.entity_type, id: x.id, name: x.name }));
      require('fs').writeFileSync(
        path.join(__dirname, '..', 'tests', 'reports', 'market-card-clusters', 'DESC-BACKFILL-DRY.json'),
        JSON.stringify(report, null, 2)
      );
      return;
    }

    let idx = 0;
    async function worker() {
      while (idx < queue.length) {
        const i = idx++;
        const item = queue[i];
        try {
          const r = await descSvc.generateEntityDescription(pool, item.entity_type, item.id, {
            force: FORCE,
          });
          if (r.skipped) report.skipped++;
          else report.done++;
          if ((report.done + report.skipped + report.failed) % 25 === 0) {
            console.log(JSON.stringify({
              progress: report.done + report.skipped + report.failed,
              of: queue.length,
              done: report.done,
              skipped: report.skipped,
              failed: report.failed,
            }));
          }
        } catch (e) {
          report.failed++;
          report.errors.push({ id: item.id, type: item.entity_type, err: e.message, code: e.code });
          if (e.code === 'NO_CREDIT') {
            await jobs.blockMarketAi(pool, 24);
            console.error('NO_CREDIT');
            idx = queue.length;
            break;
          }
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const cov = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL) AS p_total,
        (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL AND attrs->>'description_ai' IS NOT NULL AND btrim(attrs->>'description_ai')<>'') AS p_desc,
        (SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL) AS e_total,
        (SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL AND attrs->>'description_ai' IS NOT NULL AND btrim(attrs->>'description_ai')<>'') AS e_desc
    `);
    report.coverage = cov.rows[0];
    const out = path.join(__dirname, '..', 'tests', 'reports', 'market-card-clusters', 'DESC-BACKFILL.json');
    require('fs').mkdirSync(path.dirname(out), { recursive: true });
    require('fs').writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      done: report.done,
      skipped: report.skipped,
      failed: report.failed,
      coverage: report.coverage,
      out,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
