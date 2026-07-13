#!/usr/bin/env node
'use strict';
/**
 * Idempotent backfill tenders.registry_no from sequence.
 */
require('dotenv').config();
const db = require('../src/services/db');

(async () => {
  await db.query(`CREATE SEQUENCE IF NOT EXISTS tenders_registry_no_seq`);
  const missing = await db.query(
    `SELECT id FROM tenders WHERE registry_no IS NULL ORDER BY created_at ASC, id ASC`
  );
  let n = 0;
  for (const row of missing.rows) {
    await db.query(
      `UPDATE tenders SET registry_no = nextval('tenders_registry_no_seq') WHERE id = $1`,
      [row.id]
    );
    n++;
  }
  console.log('backfill registry_no:', n, 'rows');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
