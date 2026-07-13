#!/usr/bin/env node
/**
 * Backfill: is_final analysis-only reports without work_price/estimate → analysis phase + snapshot.
 * Run: node tools/backfill_analysis_phase.js [--dry-run]
 */
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://asgard:123456789@localhost/asgard_crm'
});

function parseRj(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
}

function buildSnapshot(rj, userId, userName, at) {
  return {
    decision: rj.decision || 'submit',
    feasibility: rj.feasibility || '',
    competition: rj.competition || '',
    price_range_min: rj.price_range_min ?? null,
    price_range_max: rj.price_range_max ?? null,
    summary: rj.summary || '',
    risks: rj.risks || '',
    recommendation: rj.recommendation || '',
    missing_info: Array.isArray(rj.missing_info) ? rj.missing_info : [],
    reject_preset: rj.reject_preset || '',
    points: rj.points || [],
    finalized_at: at,
    finalized_by_user_id: userId,
    finalized_by_name: userName || ''
  };
}

async function main() {
  const client = await pool.connect();
  try {
    const r = await client.query(`
      SELECT rev.*, u.name AS finalized_by_name
      FROM tender_rp_reviews rev
      LEFT JOIN users u ON u.id = rev.finalized_by_user_id
      WHERE rev.is_final = true
        AND rev.analysis_finalized_at IS NULL
        AND (rev.work_price IS NULL OR rev.work_price = 0)
        AND rev.estimate_file_id IS NULL
    `);
    let updated = 0;
    for (const row of r.rows) {
      const rj = parseRj(row.report_json);
      const mode = rj.mode === 'analysis' ? 'analysis' : 'calc';
      if (mode !== 'analysis' && !rj.summary && !rj.feasibility) continue;

      const at = row.updated_at || new Date().toISOString();
      const userId = row.finalized_by_user_id || row.started_by_user_id;
      const snap = buildSnapshot(
        { ...rj, decision: row.decision },
        userId,
        row.finalized_by_name,
        at
      );
      const nextJson = {
        ...rj,
        mode: 'calc',
        analysis_snapshot: rj.analysis_snapshot || snap
      };

      console.log(DRY ? '[dry-run]' : '[update]', 'tender', row.tender_id, 'review', row.id);
      if (!DRY) {
        await client.query(`
          UPDATE tender_rp_reviews SET
            is_final = false,
            analysis_finalized_at = COALESCE(analysis_finalized_at, $1),
            analysis_finalized_by_user_id = COALESCE(analysis_finalized_by_user_id, $2),
            report_json = $3,
            updated_at = NOW()
          WHERE id = $4
        `, [at, userId, JSON.stringify(nextJson), row.id]);
      }
      updated++;
    }
    console.log('Done. Candidates updated:', updated);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
