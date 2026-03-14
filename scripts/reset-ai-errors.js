/**
 * Reset errored AI emails so they get re-processed by the fixed code
 * Run: node scripts/reset-ai-errors.js
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
  // 1. Show error details for diagnostics
  const errors = await pool.query(`
    SELECT id, from_email, subject, ai_summary
    FROM emails
    WHERE ai_summary LIKE '%Ошибка AI%'
    ORDER BY id DESC
    LIMIT 10
  `);
  console.log(`=== Последние ошибки AI (до 10) ===`);
  for (const row of errors.rows) {
    console.log(`  #${row.id} from=${row.from_email || '?'} subj="${(row.subject || '').slice(0, 40)}" err="${(row.ai_summary || '').slice(0, 120)}"`);
  }

  // 2. Count errored emails
  const before = await pool.query(`
    SELECT COUNT(*) as cnt FROM emails WHERE ai_summary LIKE '%Ошибка AI%'
  `);
  console.log(`\nПисем с ошибкой AI: ${before.rows[0].cnt}`);

  if (parseInt(before.rows[0].cnt) === 0) {
    console.log('Нечего сбрасывать.');
    await pool.end();
    return;
  }

  // 3. Reset them: clear ai fields so IMAP processor will retry
  const result = await pool.query(`
    UPDATE emails
    SET ai_processed_at = NULL,
        ai_summary = NULL,
        ai_classification = NULL,
        ai_color = NULL,
        ai_recommendation = NULL,
        updated_at = NOW()
    WHERE ai_summary LIKE '%Ошибка AI%'
    RETURNING id
  `);

  console.log(`Сброшено ${result.rowCount} писем для повторной AI-обработки:`);
  console.log(`  IDs: ${result.rows.map(r => r.id).join(', ')}`);

  // 4. Show queue status
  const after = await pool.query(`
    SELECT COUNT(*) as cnt FROM emails WHERE ai_processed_at IS NULL AND direction = 'inbound'
  `);
  console.log(`\nВсего писем в очереди на AI-обработку: ${after.rows[0].cnt}`);

  // 5. Show emails stuck with NULL email_type
  const nullType = await pool.query(`
    SELECT COUNT(*) as cnt FROM emails
    WHERE ai_processed_at IS NULL AND direction = 'inbound' AND email_type IS NULL
  `);
  console.log(`Из них с NULL email_type: ${nullType.rows[0].cnt}`);

  console.log('\nСервер подхватит их автоматически при следующем цикле (30 сек).');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
