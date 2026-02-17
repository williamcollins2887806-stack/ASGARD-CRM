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
  // 1. Count errored emails
  const before = await pool.query(`
    SELECT COUNT(*) as cnt FROM emails WHERE ai_summary LIKE '%Ошибка AI%'
  `);
  console.log(`Писем с ошибкой AI: ${before.rows[0].cnt}`);

  if (parseInt(before.rows[0].cnt) === 0) {
    console.log('Нечего сбрасывать.');
    await pool.end();
    return;
  }

  // 2. Reset them: clear ai fields so IMAP processor will retry
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

  // 3. Verify
  const after = await pool.query(`
    SELECT COUNT(*) as cnt FROM emails WHERE ai_processed_at IS NULL AND direction = 'inbound'
  `);
  console.log(`\nВсего писем в очереди на AI-обработку: ${after.rows[0].cnt}`);
  console.log('Сервер подхватит их автоматически при следующем цикле IMAP.');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
