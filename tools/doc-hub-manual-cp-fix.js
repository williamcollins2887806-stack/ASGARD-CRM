'use strict';
/**
 * Manual counterparty/data fixes after human+web review.
 * Usage:
 *   DB_NAME=asgard_crm_test node tools/doc-hub-manual-cp-fix.js --dry-run
 *   DB_NAME=asgard_crm node tools/doc-hub-manual-cp-fix.js --apply
 *
 * - Renames broken Excel spellings to canonical legal names
 * - Fills supplier INN / merges supplier cards via DaData when token present
 * - Soft-deletes UI/test noise rows
 * - Soft-deletes near-dups (same invoice_number+amount, keep lowest id) when CP only differs by quotes/spaces
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dadata = require('../src/services/dadata');

const APPLY = process.argv.includes('--apply');
const OUT = path.join(__dirname, '..', 'tests', 'reports', 'doc-hub-excel', 'manual-cp-fix.md');

/** Exact old name → { name, inn? }  (inn used to enrich supplier via DaData) */
const RENAME_MAP = [
  // Broken quotes / group brandings → legal entity
  { from: 'Группа компаний"Деловые Линии"', to: 'ООО «Деловые Линии»', inn: '7826156685' },
  { from: 'ГК"Деловые Линии"', to: 'ООО «Деловые Линии»', inn: '7826156685' },
  { from: 'ООО"Все инструменты .ру"', to: 'ООО «ВсеИнструменты.ру»', inn: '7722753969' },
  { from: 'OОО «ВсеИнструменты.ру»', to: 'ООО «ВсеИнструменты.ру»', inn: '7722753969' }, // Latin O
  { from: 'ООО"Техноавиа-Хабаровск"ОП Свободный"', to: 'ООО «Техноавиа-Хабаровск»', inn: '2721096912' },
  { from: 'ОП"Техноавиа-Тушино"', to: 'ПВ ООО «Фирма «Техноавиа»', inn: '7724152603' },
  { from: 'ОО"ГК ПРЕУС"', to: 'ООО «ГК ПРЕУС»', inn: '5024138416' },
  { from: 'ООО"КБ Техэкспертс"', to: 'ООО «Техэксперт»', inn: null }, // typo «Техэкспертс»; DaData by name
  { from: 'ОП ООО"Благоустройство Запсиба"', to: 'ООО «Благоустройство Запсиба»', inn: null },
  { from: 'ООО ТП"ПРАБО"', to: 'ООО ТП «ПРАБО»', inn: null },
  { from: 'АО"ТехноПарт"', to: 'АО «ТехноПарт»', inn: null },
  { from: 'ООО"НЦПК УФР"', to: 'ООО «НЦПК УФР»', inn: null },
  { from: 'ОЧУДПО Корпоративный учебный центр', to: 'ОЧУ ДПО «Корпоративный учебный центр»', inn: '3015091542' },
  // IPs found via web (canonical display + INN)
  { from: 'ИП Гомзякова А.М.', to: 'ИП Гомзякова Анна Михайловна', inn: '301500780207' },
  { from: 'ИП Носенко В.Ю.', to: 'ИП Носенко Владимир Юрьевич', inn: '280603588318' },
  { from: 'ИП Афонин А.Е.', to: 'ИП Афонин Алексей Евгеньевич', inn: '280702844731' },
  { from: 'ИП Пентин Л.А.', to: 'ИП Пентин Леонид Александрович', inn: '773671037840' },
  { from: 'Гужва К.Ю.', to: 'ИП Гужва К.Ю.', inn: null },
];

const TEST_CP_LIKE = [
  '%UI %', 'ООО UI%', '%Gate XLSX%', '%ScanOnly%', '%FullCatalog%',
  '%DocHub E2E%', '%Заказчик Север%', '%Клиент Full%', '%Тест DocHub%'
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function ensureSupplier(pool, name, inn, dadataHit) {
  const cleanInn = inn ? String(inn).replace(/\D/g, '') : null;
  if (cleanInn) {
    const byInn = await pool.query(
      `SELECT id, name, inn FROM suppliers WHERE deleted_at IS NULL AND regexp_replace(coalesce(inn,''), '\\D', '', 'g')=$1 LIMIT 1`,
      [cleanInn]
    );
    if (byInn.rows[0]) {
      await pool.query(
        `UPDATE suppliers SET name=COALESCE(NULLIF($2,''), name),
          kpp=COALESCE($3,kpp), ogrn=COALESCE($4,ogrn), address=COALESCE($5,address),
          updated_at=NOW()
         WHERE id=$1`,
        [byInn.rows[0].id, name, dadataHit && dadataHit.kpp, dadataHit && dadataHit.ogrn, dadataHit && dadataHit.address]
      );
      return byInn.rows[0].id;
    }
  }
  const byName = await pool.query(
    `SELECT id FROM suppliers WHERE deleted_at IS NULL AND lower(trim(name))=lower(trim($1)) LIMIT 1`,
    [name]
  );
  if (byName.rows[0]) {
    if (cleanInn) {
      await pool.query(
        `UPDATE suppliers SET inn=$2, kpp=COALESCE($3,kpp), ogrn=COALESCE($4,ogrn), address=COALESCE($5,address), updated_at=NOW()
         WHERE id=$1 AND (inn IS NULL OR inn='')`,
        [byName.rows[0].id, cleanInn, dadataHit && dadataHit.kpp, dadataHit && dadataHit.ogrn, dadataHit && dadataHit.address]
      );
    }
    return byName.rows[0].id;
  }
  const ins = await pool.query(
    `INSERT INTO suppliers(name,inn,kpp,ogrn,address,category,notes)
     VALUES($1,$2,$3,$4,$5,'materials','doc-hub-manual-cp-fix') RETURNING id`,
    [name, cleanInn, dadataHit && dadataHit.kpp, dadataHit && dadataHit.ogrn, dadataHit && dadataHit.address]
  );
  return ins.rows[0].id;
}

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD || ''),
    database: process.env.DB_NAME || 'asgard_crm_test'
  });
  const report = {
    at: new Date().toISOString(),
    db: process.env.DB_NAME,
    apply: APPLY,
    renames: [],
    softTest: 0,
    nearDupSoft: 0,
    createdSuppliers: 0
  };

  for (const m of RENAME_MAP) {
    const { rows: found } = await pool.query(
      `SELECT COUNT(*)::int c FROM doc_registry WHERE deleted_at IS NULL AND counterparty_name=$1`,
      [m.from]
    );
    if (!found[0].c) {
      report.renames.push({ from: m.from, to: m.to, rows: 0, skipped: 'not found' });
      continue;
    }
    let hit = null;
    if (process.env.DADATA_TOKEN) {
      if (m.inn) hit = await dadata.resolveByInn(m.inn);
      if (!hit) hit = await dadata.suggestByQuery(m.to);
      await sleep(100);
    }
    const finalName = (hit && hit.name) || m.to;
    const inn = (hit && hit.inn) || m.inn || null;
    let supplierId = null;
    if (APPLY) {
      supplierId = await ensureSupplier(pool, finalName, inn, hit);
      // link + rename carefully (avoid unique collisions → soft-delete colliding row)
      const { rows: rows } = await pool.query(
        `SELECT id, invoice_number, invoice_date, amount_gross, dir FROM doc_registry
         WHERE deleted_at IS NULL AND counterparty_name=$1`,
        [m.from]
      );
      let ok = 0;
      for (const r of rows) {
        try {
          await pool.query('BEGIN');
          await pool.query(
            `UPDATE doc_registry SET counterparty_name=$1, supplier_id=$2, updated_at=NOW() WHERE id=$3`,
            [finalName, supplierId, r.id]
          );
          await pool.query('COMMIT');
          ok += 1;
        } catch (e) {
          await pool.query('ROLLBACK');
          if (e.code === '23505') {
            await pool.query(
              `UPDATE doc_registry SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`,
              [r.id]
            );
            report.nearDupSoft += 1;
          } else throw e;
        }
      }
      report.renames.push({ from: m.from, to: finalName, inn, supplierId, rows: ok });
    } else {
      report.renames.push({ from: m.from, to: finalName, inn, rows: found[0].c, would: true });
    }
  }

  // Soft-delete UI/test noise
  const testSql = TEST_CP_LIKE.map((_, i) => `counterparty_name ILIKE $${i + 1}`).join(' OR ');
  const testParams = TEST_CP_LIKE.map((x) => x);
  const testCount = await pool.query(
    `SELECT COUNT(*)::int c FROM doc_registry WHERE deleted_at IS NULL AND (${testSql} OR invoice_number ILIKE 'UI-%')`,
    testParams
  );
  if (APPLY && testCount.rows[0].c) {
    const r = await pool.query(
      `UPDATE doc_registry SET deleted_at=NOW(), updated_at=NOW()
       WHERE deleted_at IS NULL AND (${testSql} OR invoice_number ILIKE 'UI-%')
       RETURNING id`,
      testParams
    );
    report.softTest = r.rowCount;
  } else {
    report.softTest = testCount.rows[0].c;
  }

  // Excel year typo 3036 → 2026
  if (APPLY) {
    const r = await pool.query(
      `UPDATE doc_registry SET invoice_date = (invoice_date - INTERVAL '1010 years')::date, updated_at=NOW()
       WHERE deleted_at IS NULL AND invoice_date >= DATE '3030-01-01' AND invoice_date < DATE '3040-01-01'
       RETURNING id, invoice_number, invoice_date::text`
    );
    report.dateFixes = r.rows;
  } else {
    const r = await pool.query(
      `SELECT id, invoice_number, invoice_date::text FROM doc_registry
       WHERE deleted_at IS NULL AND invoice_date >= DATE '3030-01-01' AND invoice_date < DATE '3040-01-01'`
    );
    report.dateFixes = r.rows;
  }

  // Near-dups: same invoice_number + amount, different CP spelling after normalize — keep min id
  const near = await pool.query(`
    SELECT array_agg(id ORDER BY id) ids, COUNT(*)::int c,
           lower(trim(coalesce(invoice_number,''))) inv, amount_gross
    FROM doc_registry WHERE deleted_at IS NULL
    GROUP BY 3,4 HAVING COUNT(*)>1
  `);
  let nearSoft = 0;
  for (const g of near.rows) {
    // only soft-delete if counterparties normalize equal OR dates equal (true dup)
    const detail = await pool.query(
      `SELECT id, counterparty_name, invoice_date::text d FROM doc_registry WHERE id = ANY($1::int[])`,
      [g.ids]
    );
    const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/["«»„“”'`]/g, '').replace(/\s+/g, ' ').trim();
    const byKey = new Map();
    for (const row of detail.rows) {
      const k = norm(row.counterparty_name) + '|' + (row.d || '');
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(row.id);
    }
    // exact same norm CP+date within group → soft extras
    for (const ids of byKey.values()) {
      if (ids.length < 2) continue;
      const drop = ids.slice(1);
      if (APPLY) {
        const r = await pool.query(
          `UPDATE doc_registry SET deleted_at=NOW(), updated_at=NOW() WHERE id=ANY($1::int[]) AND deleted_at IS NULL RETURNING id`,
          [drop]
        );
        nearSoft += r.rowCount;
      } else nearSoft += drop.length;
    }
  }
  report.nearDupSoft += nearSoft;

  // Re-audit quick stats
  const stats = await pool.query(`
    SELECT COUNT(*)::int total,
           COUNT(*) FILTER (WHERE supplier_id IS NULL)::int no_sup,
           COUNT(*) FILTER (WHERE counterparty_name ILIKE '%UI %' OR invoice_number ILIKE 'UI-%')::int ui_left
    FROM doc_registry WHERE deleted_at IS NULL
  `);
  report.stats = stats.rows[0];

  const md = [
    '# Manual CP / data fix',
    '',
    `**Generated:** ${report.at}`,
    `**DB:** ${report.db}`,
    `**Mode:** ${APPLY ? 'APPLY' : 'dry-run'}`,
    '',
    '## Renames (web+DaData)',
    ...report.renames.map((r) =>
      `- ${r.rows || 0}× «${r.from}» → «${r.to}»${r.inn ? ` INN ${r.inn}` : ''}${r.skipped ? ` (${r.skipped})` : ''}`
    ),
    '',
    `## Soft-delete UI/test rows: ${report.softTest}`,
    `## Near-dup soft-deletes: ${report.nearDupSoft}`,
    `## Date typo fixes (3036→2026): ${JSON.stringify(report.dateFixes || [])}`,
    '',
    '## Stats after',
    '```json',
    JSON.stringify(report.stats, null, 2),
    '```'
  ].join('\n');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md, 'utf8');
  console.log(JSON.stringify({ wrote: OUT, apply: APPLY, renames: report.renames.length, softTest: report.softTest, nearDupSoft: report.nearDupSoft, stats: report.stats }, null, 2));
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
