#!/usr/bin/env node
/**
 * Сброс ошибочного calculator_user_id после закрытия анализа (баг syncCalculatorActor).
 * Тендеры: рассмотрение, analysis_finalized_at set, is_final=false,
 * calculator = дежурный аналитик без явного assign_calculator от ТО.
 *
 * Run: node tools/fix_stuck_calculator_after_analysis.js [--dry-run]
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
             rev.analysis_finalized_at, rev.analysis_finalized_by_user_id,
             rev.is_final,
             EXISTS (
               SELECT 1 FROM audit_log a
               WHERE a.entity_type = 'tender' AND a.entity_id = t.id
                 AND a.action = 'assign_calculator'
                 AND a.created_at >= rev.analysis_finalized_at
             ) AS has_to_assign_after_analysis
      FROM tenders t
      JOIN tender_rp_reviews rev ON rev.tender_id = t.id
      WHERE t.deleted_at IS NULL
        AND COALESCE(t.registry_status, 'рассмотрение') = 'рассмотрение'
        AND rev.analysis_finalized_at IS NOT NULL
        AND (rev.is_final IS NULL OR rev.is_final = false)
        AND t.calculator_user_id IS NOT NULL
        AND rev.analysis_finalized_by_user_id IS NOT NULL
        AND t.calculator_user_id = rev.analysis_finalized_by_user_id
      ORDER BY t.id
    `);

    let fixed = 0;
    for (const row of r.rows) {
      if (row.has_to_assign_after_analysis) {
        console.log('[skip] tender', row.id, '— ТО уже назначал после анализа');
        continue;
      }
      console.log(
        (DRY ? '[dry-run]' : '[fix]'),
        'tender', row.id,
        row.customer_name || '',
        'calc=', row.calculator_user_id,
        'analyst=', row.analysis_finalized_by_user_id
      );
      if (!DRY) {
        await client.query(`
          UPDATE tenders SET calculator_user_id = NULL, calculator_kind = NULL, updated_at = NOW()
          WHERE id = $1
        `, [row.id]);
        await client.query(`
          UPDATE tender_rp_reviews SET calculator_user_id = NULL, updated_at = NOW()
          WHERE tender_id = $1
        `, [row.id]);
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
