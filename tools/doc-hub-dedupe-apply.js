'use strict';
/**
 * Soft-delete exact doc_registry duplicates (same cp+number+date+amount+dir).
 * Keeps the lowest id in each group.
 *   DB_NAME=asgard_crm_test node tools/doc-hub-dedupe-apply.js
 *   DB_NAME=asgard_crm_test node tools/doc-hub-dedupe-apply.js --apply
 */
require('dotenv').config();
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD || ''),
    database: process.env.DB_NAME || 'asgard_crm_test'
  });
  const { rows } = await pool.query(`
    SELECT lower(trim(counterparty_name)) AS cp,
           lower(trim(coalesce(invoice_number,''))) AS inv,
           invoice_date, amount_gross, dir,
           array_agg(id ORDER BY id) AS ids,
           COUNT(*)::int AS c
    FROM doc_registry
    WHERE deleted_at IS NULL
    GROUP BY 1,2,3,4,5
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `);
  let soft = 0;
  const plan = [];
  for (const g of rows) {
    const keep = g.ids[0];
    const drop = g.ids.slice(1);
    plan.push({ keep, drop, inv: g.inv, cp: g.cp, date: g.invoice_date, amt: g.amount_gross });
    if (APPLY && drop.length) {
      const r = await pool.query(
        `UPDATE doc_registry SET deleted_at=NOW(), updated_at=NOW()
         WHERE id = ANY($1::int[]) AND deleted_at IS NULL RETURNING id`,
        [drop]
      );
      soft += r.rowCount;
    }
  }
  console.log(JSON.stringify({ apply: APPLY, groups: rows.length, wouldSoftDelete: plan.reduce((s, p) => s + p.drop.length, 0), softDeleted: soft, sample: plan.slice(0, 15) }, null, 2));
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
