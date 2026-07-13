#!/usr/bin/env node
/**
 * Сброс назначения считающего до закрытия анализа (преждевременный «Считаю сам» / назначение РП).
 * Run: node tools/fix_premature_calculator_assignment.js [--dry-run]
 */
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://asgard:123456789@localhost/asgard_crm'
});

async function main() {
  const client = await pool.connect();
  try {
    const r = await client.query(`
      SELECT t.id, t.customer_name, t.tender_title,
             t.calculator_user_id, t.calculator_kind,
             rev.analysis_finalized_at
      FROM tenders t
      LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
      WHERE t.deleted_at IS NULL
        AND COALESCE(t.registry_status, 'рассмотрение') = 'рассмотрение'
        AND (rev.analysis_finalized_at IS NULL)
        AND (t.calculator_user_id IS NOT NULL OR t.calculator_kind IS NOT NULL)
      ORDER BY t.id
    `);

    let fixed = 0;
    for (const row of r.rows) {
      console.log(
        (DRY ? '[dry-run]' : '[fix]'),
        'tender', row.id,
        row.customer_name || '',
        'kind=', row.calculator_kind,
        'calc=', row.calculator_user_id
      );
      if (!DRY) {
        await client.query(`
          UPDATE tenders SET calculator_user_id = NULL, calculator_kind = NULL, updated_at = NOW()
          WHERE id = $1
        `, [row.id]);
        if (row.id) {
          await client.query(`
            UPDATE tender_rp_reviews SET calculator_user_id = NULL, updated_at = NOW()
            WHERE tender_id = $1
          `, [row.id]);
        }
        fixed += 1;
      }
    }
    console.log(DRY ? `Would fix ${r.rows.length} row(s)` : `Fixed ${fixed} tender(s)`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
