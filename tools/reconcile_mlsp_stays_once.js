'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envPath = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const k = m[1].trim();
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const { reconcileStays } = require('../src/lib/mlsp-stay');
const pool = new Pool({
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'asgard_crm',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
});
const db = { query: (t, p) => pool.query(t, p) };
const log = {
  info: (...a) => console.log('[mlsp-stay]', ...a),
  warn: (...a) => console.warn('[mlsp-stay]', ...a),
  error: (...a) => console.error('[mlsp-stay]', ...a),
};

(async () => {
  try {
    const r = await reconcileStays(db, log);
    console.log(JSON.stringify({ ok: true, ...r }));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
