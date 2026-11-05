'use strict';
/**
 * Ручной прогон очереди market_ai_jobs.
 *   node tools/run_market_ai_jobs.js
 *   node tools/run_market_ai_jobs.js --limit 30
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const i = args.indexOf('--limit');
const limit = i >= 0 ? Number(args[i + 1]) || 20 : 20;

async function main() {
  const cron = require('../src/services/market-ai-cron');
  const stats = await cron.tick(limit);
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
