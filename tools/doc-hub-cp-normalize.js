'use strict';
/**
 * Normalize doc_registry counterparties → DaData → suppliers cards → link supplier_id.
 *
 * Usage:
 *   DB_NAME=asgard_crm_test node tools/doc-hub-cp-normalize.js            # dry-run
 *   DB_NAME=asgard_crm_test node tools/doc-hub-cp-normalize.js --apply     # twin/prod apply
 *
 * Without DADATA_TOKEN: local canonical rename only + unmatched report (graceful).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dadata = require('../src/services/dadata');

const APPLY = process.argv.includes('--apply');
const OUT_DIR = path.join(__dirname, '..', 'tests', 'reports', 'doc-hub-excel');
const OUT_MD = path.join(OUT_DIR, 'cp-normalize.md');
const OUT_JSON = path.join(OUT_DIR, 'cp-normalize.json');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function normCp(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["«»„“”'`]/g, '')
    .replace(/\booo\b/gi, 'ооо')
    .replace(/\baoо\b/gi, 'ао')
    .replace(/\bzao\b/gi, 'зао')
    .replace(/\bip\b/gi, 'ип')
    .replace(/\s*,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Prefer short readable form: "ООО Ромашка" over "Ромашка, ООО". */
function canonicalDisplay(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, ' ');
  s = s.replace(/[«»„“”]/g, '"').replace(/'+/g, "'");
  s = s.replace(/\bOOO\b/gi, 'ООО').replace(/\bOOО\b/gi, 'ООО');
  // "X, ООО" / "X ООО" → "ООО X"
  const m = s.match(/^(.+?)[,\s]+(ООО|ОАО|АО|ЗАО|ПАО|ИП)$/i);
  if (m) s = `${m[2].toUpperCase() === 'ИП' ? 'ИП' : m[2].toUpperCase()} ${m[1].trim()}`;
  // collapse quotes
  s = s.replace(/"\s+/g, '"').replace(/\s+"/g, '"');
  return s.trim();
}

function extractInn(s) {
  const m = String(s || '').match(/\b(\d{10}|\d{12})\b/);
  return m ? m[1] : null;
}

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD || ''),
    database: process.env.DB_NAME || 'asgard_crm_test'
  });

  const hasToken = !!process.env.DADATA_TOKEN;
  const { rows: names } = await pool.query(
    `SELECT counterparty_name AS name, COUNT(*)::int AS cnt,
            COUNT(*) FILTER (WHERE supplier_id IS NULL)::int AS no_sup
     FROM doc_registry WHERE deleted_at IS NULL AND counterparty_name IS NOT NULL
     GROUP BY 1 ORDER BY cnt DESC`
  );

  const byKey = new Map();
  for (const r of names) {
    const key = normCp(r.name);
    if (!byKey.has(key)) byKey.set(key, { key, variants: [], cnt: 0, no_sup: 0 });
    const g = byKey.get(key);
    g.variants.push({ name: r.name, cnt: r.cnt });
    g.cnt += r.cnt;
    g.no_sup += r.no_sup;
    g.canonical = canonicalDisplay(
      g.variants.slice().sort((a, b) => b.cnt - a.cnt)[0].name
    );
  }

  const groups = [...byKey.values()].sort((a, b) => b.cnt - a.cnt);
  const report = {
    at: new Date().toISOString(),
    db: process.env.DB_NAME || 'asgard_crm_test',
    apply: APPLY,
    dadata: hasToken,
    groups: groups.length,
    rows: names.reduce((s, r) => s + r.cnt, 0),
    results: [],
    unmatched: [],
    linked: 0,
    created_suppliers: 0,
    renamed: 0
  };

  // Existing suppliers by inn / norm name
  const { rows: suppliers } = await pool.query(
    `SELECT id, name, inn FROM suppliers WHERE deleted_at IS NULL`
  );
  const supByInn = new Map();
  const supByNorm = new Map();
  for (const s of suppliers) {
    if (s.inn) supByInn.set(String(s.inn).replace(/\D/g, ''), s);
    supByNorm.set(normCp(s.name), s);
  }

  let i = 0;
  for (const g of groups) {
    i += 1;
    const innHint = extractInn(g.canonical) || extractInn(g.variants.map((v) => v.name).join(' '));
    let resolved = null;
    let method = 'local';

    if (hasToken) {
      try {
        if (innHint) resolved = await dadata.resolveByInn(innHint);
        if (!resolved) resolved = await dadata.suggestByQuery(g.canonical);
        if (resolved) method = innHint && resolved.inn === innHint ? 'dadata_inn' : 'dadata_suggest';
        await sleep(120); // soft rate-limit
      } catch (e) {
        method = 'dadata_error:' + e.message;
      }
    }

    const displayName = (resolved && resolved.name) || g.canonical;
    const inn = (resolved && resolved.inn) || innHint || null;
    let supplier = null;
    if (inn && supByInn.has(String(inn).replace(/\D/g, ''))) {
      supplier = supByInn.get(String(inn).replace(/\D/g, ''));
    } else if (supByNorm.has(normCp(displayName))) {
      supplier = supByNorm.get(normCp(displayName));
    }

    const entry = {
      key: g.key,
      cnt: g.cnt,
      variants: g.variants.map((v) => v.name),
      canonical: g.canonical,
      displayName,
      inn,
      method,
      supplier_id: supplier ? supplier.id : null,
      action: 'none'
    };

    if (!resolved && hasToken) {
      report.unmatched.push(entry);
    }

    if (APPLY) {
      if (!supplier) {
        // Create card even without DaData — name (+ optional INN) is enough to link registry.
        const ins = await pool.query(
          `INSERT INTO suppliers(name, inn, kpp, ogrn, address, category, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,'materials',$6,NULL)
           RETURNING id, name, inn`,
          [
            displayName,
            inn,
            (resolved && resolved.kpp) || null,
            (resolved && resolved.ogrn) || null,
            (resolved && resolved.address) || null,
            hasToken ? 'doc-hub-cp-normalize+dadata' : 'doc-hub-cp-normalize-local'
          ]
        );
        supplier = ins.rows[0];
        report.created_suppliers += 1;
        if (supplier.inn) supByInn.set(String(supplier.inn).replace(/\D/g, ''), supplier);
        supByNorm.set(normCp(supplier.name), supplier);
        entry.action = 'create_supplier';
        entry.supplier_id = supplier.id;
      }

      const variantNames = g.variants.map((v) => v.name);
      if (supplier) {
        const link = await pool.query(
          `UPDATE doc_registry
           SET supplier_id = $1, updated_at = NOW()
           WHERE deleted_at IS NULL
             AND counterparty_name = ANY($2::text[])
             AND (supplier_id IS DISTINCT FROM $1)
           RETURNING id`,
          [supplier.id, variantNames]
        );
        report.linked += link.rowCount;

        // Soft rename one row at a time; on unique collision keep original spelling.
        let renamed = 0;
        const { rows: toRename } = await pool.query(
          `SELECT id, counterparty_name FROM doc_registry
           WHERE deleted_at IS NULL
             AND counterparty_name = ANY($1::text[])
             AND counterparty_name IS DISTINCT FROM $2`,
          [variantNames, displayName]
        );
        for (const row of toRename) {
          try {
            await pool.query('BEGIN');
            await pool.query(
              `UPDATE doc_registry SET counterparty_name=$1, updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL`,
              [displayName, row.id]
            );
            await pool.query('COMMIT');
            renamed += 1;
          } catch (e) {
            await pool.query('ROLLBACK');
            if (e && e.code === '23505') {
              // true near-dup after normalize — soft-delete this row, keep the existing canonical one
              await pool.query(
                `UPDATE doc_registry SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL`,
                [row.id]
              );
              report.renamed += 1; // counted as resolved dup
            } else {
              throw e;
            }
          }
        }
        report.renamed += renamed;
        entry.action = entry.action === 'create_supplier' ? 'create+link' : 'link';
        entry.updated = link.rowCount;
        entry.renamed = renamed;
        entry.supplier_id = supplier.id;
      }
    } else {
      entry.action = supplier ? 'would_link' : 'would_create+link';
    }

    report.results.push(entry);
    if (i % 50 === 0) console.log(`… ${i}/${groups.length}`);
  }

  const linkedPct = report.rows
    ? Math.round((100 * (report.results.filter((r) => r.supplier_id).reduce((s, r) => s + r.cnt, 0))) / report.rows)
    : 0;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');

  const topUnmatched = report.unmatched.slice(0, 40).map((u) =>
    `- ${u.cnt}× «${u.canonical}» (${u.variants.length} spellings)`
  ).join('\n') || '- none';

  const md = `# Doc Hub counterparty normalize

**Generated:** ${report.at}
**DB:** ${report.db}
**Mode:** ${APPLY ? 'APPLY' : 'dry-run'}
**DaData token:** ${hasToken ? 'yes' : 'no (local-only)'}

## Summary
- Distinct names: ${names.length}
- Canonical groups: ${groups.length}
- Rows: ${report.rows}
- Created suppliers: ${report.created_suppliers}
- Rows linked/updated (supplier): ${report.linked}
- Rows renamed only: ${report.renamed}
- Unmatched (DaData miss): ${report.unmatched.length}
- Would-be supplier coverage (by group hit): ~${linkedPct}% of rows have a resolved supplier_id in plan

## Top unmatched
${topUnmatched}

## Next
1. Review unmatched; fix Excel spellings or add INN
2. Re-run with \`--apply\` on twin, then prod
3. Re-run \`tools/doc-hub-registry-audit.js\`
`;
  fs.writeFileSync(OUT_MD, md, 'utf8');
  console.log(JSON.stringify({
    wrote: OUT_MD,
    apply: APPLY,
    dadata: hasToken,
    groups: groups.length,
    created: report.created_suppliers,
    linked: report.linked,
    renamed: report.renamed,
    unmatched: report.unmatched.length
  }, null, 2));
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
