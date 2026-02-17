/**
 * Diagnostic script: check column types for emails and inbox_applications tables
 * Run: node scripts/check-email-columns.js
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
  console.log('=== Column types for emails table ===');
  const emails = await pool.query(`
    SELECT column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'emails'
    AND column_name LIKE 'ai_%'
    ORDER BY ordinal_position
  `);
  for (const row of emails.rows) {
    console.log(`  ${row.column_name}: ${row.data_type} (${row.udt_name}) nullable=${row.is_nullable}`);
  }

  console.log('\n=== Column types for inbox_applications table ===');
  const inbox = await pool.query(`
    SELECT column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'inbox_applications'
    AND (column_name LIKE 'ai_%' OR column_name IN ('workload_snapshot'))
    ORDER BY ordinal_position
  `);
  for (const row of inbox.rows) {
    console.log(`  ${row.column_name}: ${row.data_type} (${row.udt_name}) nullable=${row.is_nullable}`);
  }

  console.log('\n=== Column types for ai_analysis_log table ===');
  const log = await pool.query(`
    SELECT column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'ai_analysis_log'
    ORDER BY ordinal_position
  `);
  for (const row of log.rows) {
    console.log(`  ${row.column_name}: ${row.data_type} (${row.udt_name}) nullable=${row.is_nullable}`);
  }

  console.log('\n=== Sample emails with AI errors ===');
  const errEmails = await pool.query(`
    SELECT id, from_email, subject, ai_summary, ai_classification
    FROM emails
    WHERE ai_summary LIKE '%Ошибка AI%'
    ORDER BY id DESC
    LIMIT 5
  `);
  for (const row of errEmails.rows) {
    console.log(`  #${row.id} from=${row.from_email} subj="${(row.subject || '').slice(0, 50)}" ai_summary="${(row.ai_summary || '').slice(0, 100)}"`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
