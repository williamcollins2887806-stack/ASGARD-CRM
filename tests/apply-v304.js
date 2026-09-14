'use strict';
const fs = require('fs');
const path = require('path');
let url = process.env.DATABASE_URL;
try {
  const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (m) url = m[1].trim().replace(/^['"]|['"]$/g, '');
} catch (_) {}
if (!url) {
  console.log('No DATABASE_URL — skip migration apply');
  process.exit(0);
}
const { Client } = require('pg');
const sql = fs.readFileSync(
  path.join(__dirname, '../migrations/V304__rp_review_participant_drafts.sql'),
  'utf8'
);
(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query(sql);
  const r = await c.query(
    "SELECT to_regclass('public.tender_rp_review_participant_drafts') AS t"
  );
  console.log('V304 applied, table=', r.rows[0].t);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
