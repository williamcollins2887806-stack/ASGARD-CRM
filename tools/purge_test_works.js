#!/usr/bin/env node
/**
 * Soft-delete test garbage works left by API tests run against prod.
 * Patterns: CASH-STMT-*, BULK-SE-*, MANUAL-*, security-sanitization titles.
 *
 * Run: node tools/purge_test_works.js [--dry-run]
 */
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://asgard:123456789@localhost/asgard_crm'
});

const WHERE = `
  deleted_at IS NULL
  AND (
    work_title LIKE 'CASH-STMT-%'
    OR work_title LIKE 'BULK-SE-%'
    OR work_title LIKE 'MANUAL-%'
    OR work_title IN (
      'HEAD_TO can write works',
      'TO should not write works',
      'XSS body onload',
      'Unauth work creation',
      'patch test',
      'XML content-type test',
      'Octet-stream test'
    )
    OR work_title LIKE '<marquee%'
    OR work_title LIKE '<script>%'
    OR work_title = $$'; SELECT version();--$$
    OR work_title LIKE 'TEST_AUTO_%'
  )
`;

async function main() {
  const client = await pool.connect();
  try {
    const preview = await client.query(`
      SELECT id, work_title, work_status, tender_id, pm_id, created_at::date AS created
      FROM works
      WHERE ${WHERE}
      ORDER BY id
    `);
    console.log(`Found ${preview.rows.length} test work(s):`);
    for (const row of preview.rows) {
      console.log(`  #${row.id} ${row.work_title} (${row.work_status || '—'})`);
    }
    if (!preview.rows.length) {
      console.log('Nothing to purge.');
      return;
    }
    if (DRY) {
      console.log(`[dry-run] Would soft-delete ${preview.rows.length} work(s)`);
      return;
    }
    const ids = preview.rows.map((r) => r.id);
    const r = await client.query(`
      UPDATE works
      SET deleted_at = NOW(), deleted_by = NULL, updated_at = NOW()
      WHERE id = ANY($1::int[])
      RETURNING id
    `, [ids]);
    console.log(`Soft-deleted ${r.rowCount} work(s)`);

    // Close personal kanban cards for these works (best-effort)
    await client.query(`
      UPDATE personal_kanban_cards
      SET closed_at = NOW(), updated_at = NOW()
      WHERE entity_kind = 'work' AND entity_id = ANY($1::int[]) AND closed_at IS NULL
    `, [ids]).catch(() => {});

    const remain = await client.query(`SELECT COUNT(*)::int AS n FROM works WHERE ${WHERE}`);
    console.log(`Remaining test works: ${remain.rows[0].n}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
