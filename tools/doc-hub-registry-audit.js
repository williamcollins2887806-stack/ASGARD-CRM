'use strict';
/**
 * Full Doc Hub registry audit: cells + exact/near duplicates + needs-manual classification.
 * Usage:
 *   DB_NAME=asgard_crm_test node tools/doc-hub-registry-audit.js
 *   node tools/doc-hub-registry-audit.js --prod-ssh   (fetch via SSH psql dump)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const OUT_DIR = path.join(__dirname, '..', 'tests', 'reports', 'doc-hub-excel');
const OUT_MD = path.join(OUT_DIR, 'registry-audit.md');
const OUT_JSON = path.join(OUT_DIR, 'registry-audit.json');

function normCp(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["«»„“”']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bооо\b/g, 'ооо')
    .replace(/\booo\b/g, 'ооо')
    .replace(/\bооо\s*/g, 'ооо ')
    .replace(/,\s*ооо\b/g, ' ооо')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD || ''),
    database: process.env.DB_NAME || 'asgard_crm_test'
  });
  const { rows } = await pool.query(`
    SELECT d.id, d.dir, d.invoice_number, d.invoice_date, d.counterparty_name, d.amount_gross,
           d.has_vat, d.ops_status, d.pay_status, d.wh_status, d.work_id, d.supplier_id,
           d.doc_owner_id, d.pm_id, d.is_incomplete, d.incomplete_reasons,
           d.purpose_consumables, d.purpose_asgard, d.purpose_customer,
           w.work_title
    FROM doc_registry d
    LEFT JOIN works w ON w.id = d.work_id
    WHERE d.deleted_at IS NULL
    ORDER BY d.id
  `);
  await pool.end();

  const cellIssues = [];
  const byExact = new Map();
  const byNear = new Map();

  for (const r of rows) {
    const miss = [];
    if (!(r.invoice_number || '').toString().trim()) miss.push('no_invoice_number');
    if (!r.invoice_date) miss.push('no_invoice_date');
    if (!(r.counterparty_name || '').toString().trim()) miss.push('no_counterparty');
    if (!(Number(r.amount_gross) > 0)) miss.push('bad_amount');
    if (!r.work_id && !r.purpose_asgard && !r.purpose_consumables && !r.purpose_customer) miss.push('no_work_or_purpose');
    if (!r.doc_owner_id) miss.push('no_doc_owner');
    if (!r.pm_id && r.work_id) miss.push('no_pm');
    if (!r.supplier_id) miss.push('no_supplier_id');
    if (miss.length) cellIssues.push({ id: r.id, inv: r.invoice_number, miss, amt: r.amount_gross, cp: r.counterparty_name });

    const exactKey = [
      String(r.counterparty_name || '').trim().toLowerCase(),
      String(r.invoice_number || '').trim().toLowerCase(),
      r.invoice_date ? String(r.invoice_date).slice(0, 10) : '',
      Number(r.amount_gross),
      r.dir || 'in'
    ].join('|');
    if (!byExact.has(exactKey)) byExact.set(exactKey, []);
    byExact.get(exactKey).push(r.id);

    const nearKey = [
      normCp(r.counterparty_name),
      String(r.invoice_number || '').trim().toLowerCase(),
      Number(r.amount_gross)
    ].join('|');
    if (!byNear.has(nearKey)) byNear.set(nearKey, []);
    byNear.get(nearKey).push({ id: r.id, cp: r.counterparty_name, date: r.invoice_date });
  }

  const exactDups = [...byExact.entries()].filter(([, ids]) => ids.length > 1);
  const nearDups = [...byNear.entries()].filter(([, arr]) => {
    if (arr.length < 2) return false;
    const cps = new Set(arr.map((x) => String(x.cp || '').trim().toLowerCase()));
    return cps.size > 1; // same number+amount, different spelling
  });

  const negAmt = cellIssues.filter((x) => x.miss.includes('bad_amount') && Number(x.amt) < 0);
  const zeroAmt = cellIssues.filter((x) => x.miss.includes('bad_amount') && !(Number(x.amt) < 0));
  const noCp = cellIssues.filter((x) => x.miss.includes('no_counterparty'));
  const noDate = cellIssues.filter((x) => x.miss.includes('no_invoice_date'));
  const noNum = cellIssues.filter((x) => x.miss.includes('no_invoice_number'));
  const noSupplier = cellIssues.filter((x) => x.miss.includes('no_supplier_id'));

  const payload = {
    generated: new Date().toISOString(),
    db: process.env.DB_NAME || 'asgard_crm_test',
    total: rows.length,
    exact_duplicates: exactDups.map(([k, ids]) => ({ key: k, ids })),
    near_duplicates: nearDups.slice(0, 200).map(([k, arr]) => ({ key: k, items: arr })),
    cell_issue_count: cellIssues.length,
    buckets: {
      negative_amount: negAmt.length,
      zero_or_missing_amount: zeroAmt.length,
      no_counterparty: noCp.length,
      no_invoice_date: noDate.length,
      no_invoice_number: noNum.length,
      no_supplier_id: noSupplier.length,
      incomplete_flag: rows.filter((r) => r.is_incomplete).length
    },
    cell_issues_sample: cellIssues.slice(0, 80)
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));
  const md = [
    '# Doc Hub registry audit',
    '',
    `**Generated:** ${payload.generated}`,
    `**DB:** ${payload.db}`,
    `**Rows:** ${payload.total}`,
    '',
    '## Duplicates',
    `- Exact (cp+number+date+amount+dir): **${exactDups.length}** groups`,
    `- Near (norm cp + number + amount, different spelling): **${nearDups.length}** groups`,
    '',
    '## Cell issues',
    `- Rows with any critical miss: **${cellIssues.length}**`,
    `- Negative amount: ${negAmt.length}`,
    `- Zero/missing amount: ${zeroAmt.length}`,
    `- No counterparty: ${noCp.length}`,
    `- No invoice_date: ${noDate.length}`,
    `- No invoice_number: ${noNum.length}`,
    `- No supplier_id: ${noSupplier.length}`,
    `- is_incomplete flag: ${payload.buckets.incomplete_flag}`,
    '',
    '## Needs-manual Excel 37 (reference)',
    'See `needs-manual-37.md`: 27 negative Excel sums (column corruption), 10 holes.',
    '',
    '## Exact dup sample',
    ...(exactDups.slice(0, 20).map(([k, ids]) => `- ${ids.join(', ')} · \`${k}\``)),
    exactDups.length ? '' : '- none',
    '',
    '## Next',
    '1. Merge/delete exact dups if any',
    '2. Normalize counterparties + DaData → suppliers',
    '3. Keep negative-amount Excel rows out of work until Excel fixed',
    ''
  ].join('\n');
  fs.writeFileSync(OUT_MD, md);
  console.log(JSON.stringify({
    wrote: OUT_MD,
    total: payload.total,
    exactDups: exactDups.length,
    nearDups: nearDups.length,
    cellIssues: cellIssues.length,
    buckets: payload.buckets
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
