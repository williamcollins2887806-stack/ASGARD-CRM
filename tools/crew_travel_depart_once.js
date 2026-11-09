'use strict';

/**
 * Разовый прогон crew-travel-depart.
 *   node tools/crew_travel_depart_once.js --dry-run
 *   node tools/crew_travel_depart_once.js          # реально снимет
 *
 * БД: .env / env (по умолчанию asgard_crm). Для клона: DB_NAME=asgard_crm_test
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');
const { run, todayYmdMsk } = require('../src/services/crew-travel-depart-cron');

const pool = new Pool({
  user: process.env.DB_USER || process.env.PGUSER || 'asgard',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '123456789',
  database: process.env.DB_NAME || process.env.PGDATABASE || 'asgard_crm',
  host: process.env.DB_HOST || process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || process.env.PGPORT || 5432)
});
const db = { query: (t, p) => pool.query(t, p) };
const log = {
  info: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a)
};

(async () => {
  try {
    console.log(JSON.stringify({
      db: process.env.DB_NAME || process.env.PGDATABASE || 'asgard_crm',
      today: todayYmdMsk(),
      dryRun
    }));
    const r = await run(db, log, { dryRun });
    console.log(JSON.stringify({
      ok: true,
      dryRun: r.dryRun,
      departed: r.departed,
      candidates: (r.candidates || []).map((c) => ({
        fio: c.fio,
        work_id: c.work_id,
        work_title: c.work_title,
        arrival_date: c.arrival_date,
        departure_date: c.departure_date,
        stage_id: c.stage_id,
        direction: c.direction
      }))
    }, null, 2));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
