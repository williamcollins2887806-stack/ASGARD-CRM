#!/usr/bin/env node
/**
 * Prepare tender registry import: assign period from sheets, audit vs CRM (no writes)
 *
 * Usage:
 *   node scripts/prepare-tender-registry-import.js [path/to/file.xlsx]
 *   node scripts/prepare-tender-registry-import.js --out report.json
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  DEFAULT_XLSX,
  readWorkbookRows,
  auditRowsAgainstCrm
} = require('../src/services/tender-registry-import-utils');

async function main() {
  const args = process.argv.slice(2);
  let filePath = DEFAULT_XLSX;
  let outPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      outPath = args[++i];
    } else if (!args[i].startsWith('-')) {
      filePath = args[i];
    }
  }

  console.log('Reading:', filePath);
  const { rows, byPeriod, sheetCount } = await readWorkbookRows(filePath);
  console.log(`Sheets: ${sheetCount}, rows: ${rows.length}`);
  console.log('By period:', byPeriod);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || 'asgard'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'asgard_crm'}`
  });

  let crmRows = [];
  try {
    const r = await pool.query(`
      SELECT id, customer_name, customer_inn, tender_title, purchase_url,
             registry_status, tender_price, docs_deadline, period, deleted_at
      FROM tenders WHERE deleted_at IS NULL
    `);
    crmRows = r.rows;
    console.log(`CRM tenders (active): ${crmRows.length}`);
  } finally {
    await pool.end();
  }

  const audit = auditRowsAgainstCrm(rows, crmRows);
  const report = {
    file: filePath,
    excel_rows: rows.length,
    crm_rows: crmRows.length,
    by_period: byPeriod,
    audit_summary: audit.summary,
    audit_by_period: audit.byPeriod,
    sample: audit.items.slice(0, 50)
  };

  console.log('\nAudit summary:', audit.summary);

  const json = JSON.stringify(report, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json, 'utf8');
    console.log('Written:', path.resolve(outPath));
  } else {
    console.log(json.slice(0, 4000));
  }
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
