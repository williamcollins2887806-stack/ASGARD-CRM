/**
 * Diagnostic: reproduce AI email classification INSERT/UPDATE to find exact error
 * Run: node scripts/diagnose-ai-email.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || 'password',
});

async function main() {
  // 1. Show current imap.js code being used (check if fix is deployed)
  const fs = require('fs');
  const imapPath = require('path').join(__dirname, '..', 'src', 'services', 'imap.js');
  const imapCode = fs.readFileSync(imapPath, 'utf8');

  console.log('=== CHECK 1: Is the fix deployed? ===');
  if (imapCode.includes("ai_classification = 'other'")) {
    console.log('  ❌ OLD CODE FOUND: ai_classification = \'other\' (hardcoded string, NOT JSON)');
  } else if (imapCode.includes('ai_classification = $2::jsonb')) {
    console.log('  ✅ NEW CODE: ai_classification = $2::jsonb (correct)');
  } else {
    console.log('  ⚠️  Unknown code pattern for ai_classification');
  }

  if (imapCode.includes("JSON.stringify(analysis.classification)")) {
    console.log('  ✅ NEW CODE: JSON.stringify(analysis.classification) (correct)');
  } else if (imapCode.includes("analysis.classification, analysis.color")) {
    console.log('  ❌ OLD CODE: analysis.classification passed as plain string');
  }

  if (imapCode.includes("JSON.stringify(analysis.keywords")) {
    console.log('  ❌ WRONG: ai_keywords uses JSON.stringify (should be raw array for text[])');
  } else {
    console.log('  ✅ ai_keywords passed as raw array (correct for text[])');
  }

  // 2. Show column types
  console.log('\n=== CHECK 2: Column types ===');
  const cols = await pool.query(`
    SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE (table_name = 'emails' AND column_name = 'ai_classification')
       OR (table_name = 'inbox_applications' AND column_name IN ('ai_keywords', 'ai_classification', 'ai_raw_json'))
    ORDER BY table_name, column_name
  `);
  for (const r of cols.rows) {
    console.log(`  ${r.table_name}.${r.column_name} = ${r.data_type} (${r.udt_name})`);
  }

  // 3. Try the exact queries that the code runs
  console.log('\n=== CHECK 3: Test UPDATE emails with JSONB classification ===');

  // Find a test email
  const testEmail = await pool.query(`SELECT id FROM emails ORDER BY id DESC LIMIT 1`);
  if (!testEmail.rows.length) {
    console.log('  No emails found');
    await pool.end();
    return;
  }
  const testId = testEmail.rows[0].id;
  console.log(`  Using email #${testId} for testing`);

  // Test A: Plain string -> JSONB (the OLD broken way)
  try {
    await pool.query('BEGIN');
    await pool.query(
      `UPDATE emails SET ai_classification = 'other' WHERE id = $1`,
      [testId]
    );
    await pool.query('ROLLBACK');
    console.log("  ✅ Plain 'other' -> JSONB works (unexpected!)");
  } catch (e) {
    await pool.query('ROLLBACK');
    console.log(`  ❌ Plain 'other' -> JSONB FAILS: ${e.message}`);
  }

  // Test B: JSON.stringify string -> JSONB (the NEW way)
  try {
    await pool.query('BEGIN');
    await pool.query(
      `UPDATE emails SET ai_classification = $1::jsonb WHERE id = $2`,
      [JSON.stringify('other'), testId]
    );
    await pool.query('ROLLBACK');
    console.log(`  ✅ JSON.stringify('other') = ${JSON.stringify('other')} -> JSONB works`);
  } catch (e) {
    await pool.query('ROLLBACK');
    console.log(`  ❌ JSON.stringify('other') -> JSONB FAILS: ${e.message}`);
  }

  // Test C: Plain string as parameter -> JSONB
  try {
    await pool.query('BEGIN');
    await pool.query(
      `UPDATE emails SET ai_classification = $1 WHERE id = $2`,
      ['other', testId]
    );
    await pool.query('ROLLBACK');
    console.log("  ✅ Param 'other' (no cast) -> JSONB works (unexpected!)");
  } catch (e) {
    await pool.query('ROLLBACK');
    console.log(`  ❌ Param 'other' (no cast) -> JSONB FAILS: ${e.message}`);
  }

  // Test D: JSON object -> JSONB
  try {
    await pool.query('BEGIN');
    await pool.query(
      `UPDATE emails SET ai_classification = $1::jsonb WHERE id = $2`,
      [JSON.stringify({type: 'other', color: 'red'}), testId]
    );
    await pool.query('ROLLBACK');
    console.log("  ✅ JSON object -> JSONB works");
  } catch (e) {
    await pool.query('ROLLBACK');
    console.log(`  ❌ JSON object -> JSONB FAILS: ${e.message}`);
  }

  // 4. Test inbox_applications ai_keywords (text[])
  console.log('\n=== CHECK 4: Test inbox_applications ai_keywords (text[]) ===');

  try {
    await pool.query('BEGIN');
    await pool.query(
      `CREATE TEMP TABLE _test_kw (kw text[]) ON COMMIT DROP`
    );
    // Test raw array
    await pool.query(`INSERT INTO _test_kw VALUES ($1)`, [['word1', 'word2']]);
    console.log("  ✅ Raw JS array -> text[] works");
    // Test JSON.stringify array
    await pool.query(`INSERT INTO _test_kw VALUES ($1)`, [JSON.stringify(['word1', 'word2'])]);
    console.log("  ✅ JSON.stringify array -> text[] works (unexpected!)");
    await pool.query('ROLLBACK');
  } catch (e) {
    await pool.query('ROLLBACK');
    console.log(`  ❌ text[] test FAILS: ${e.message}`);
  }

  // 5. Check if there are STILL errored emails after the reset
  console.log('\n=== CHECK 5: Current error state ===');
  const errors = await pool.query(`
    SELECT COUNT(*) as cnt FROM emails WHERE ai_summary LIKE '%Ошибка AI%'
  `);
  console.log(`  Emails with AI errors: ${errors.rows[0].cnt}`);

  const pending = await pool.query(`
    SELECT COUNT(*) as cnt FROM emails WHERE ai_processed_at IS NULL AND direction = 'inbound'
  `);
  console.log(`  Emails pending AI processing: ${pending.rows[0].cnt}`);

  const recent = await pool.query(`
    SELECT id, from_email, ai_summary, ai_classification
    FROM emails
    WHERE ai_summary LIKE '%Ошибка%' OR ai_summary LIKE '%Пропущено%'
    ORDER BY id DESC LIMIT 5
  `);
  console.log('\n  Recent problem emails:');
  for (const r of recent.rows) {
    console.log(`    #${r.id} from=${r.from_email} class=${JSON.stringify(r.ai_classification)} summary="${(r.ai_summary || '').slice(0, 80)}"`);
  }

  // 6. Check PM2 process start time (did it actually restart with new code?)
  console.log('\n=== CHECK 6: Server process info ===');
  const { execSync } = require('child_process');
  try {
    const pm2Info = execSync('pm2 jlist 2>/dev/null').toString();
    const procs = JSON.parse(pm2Info);
    for (const p of procs) {
      if (p.name === 'asgard-crm') {
        const uptime = Date.now() - p.pm2_env.pm_uptime;
        console.log(`  Process: ${p.name}, PID: ${p.pid}, uptime: ${Math.round(uptime/1000)}s, restarts: ${p.pm2_env.restart_time}`);
      }
    }
  } catch (e) {
    console.log('  Could not get PM2 info');
  }

  await pool.end();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
