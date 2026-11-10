'use strict';

/**
 * Дозапись в public.migrations уже применённых миграций (без повторного DDL).
 *
 * Зачем: на проде часть V* накатывалась руками/scp, а INSERT в журнал пропускали.
 * `npm run migrate` из-за дыр опасен — может попытаться прогнать сотни старых файлов.
 * Этот скрипт пишет ТОЛЬКО запись в журнал, если маркер схемы уже есть.
 *
 *   node tools/backfill_migrations_journal.js           # план
 *   node tools/backfill_migrations_journal.js --apply    # записать
 *   node tools/backfill_migrations_journal.js --apply --only V476,V482
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const MIG_DIR = process.env.MIGRATIONS_DIR || path.join(ROOT, 'migrations');

const args = process.argv.slice(2);
const doApply = args.includes('--apply');
const onlyArg = (() => {
  const i = args.indexOf('--only');
  return i >= 0 ? String(args[i + 1] || '') : '';
})();
const onlySet = onlyArg
  ? new Set(onlyArg.split(/[,\s]+/).filter(Boolean).map((s) => s.replace(/\.sql$/i, '')))
  : null;

/** Маркеры: SQL должен вернуть хотя бы одну строку, если миграция уже в схеме. */
const MARKERS = [
  {
    name: 'V472__norm_alt_units',
    check: `SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='work_norm_unit_conversions' LIMIT 1`,
  },
  {
    name: 'V473__obs_letters_v2',
    check: `SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='obs_accounts' LIMIT 1`,
  },
  {
    name: 'V474__documents_table_positions',
    check: `SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='documents'
               AND column_name='table_positions' LIMIT 1`,
  },
  {
    name: 'V475__counterparty_contracts_link',
    check: `SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='subcontract_agreements'
               AND column_name='counterparty_id' LIMIT 1`,
  },
  {
    name: 'V476__tender_digest_outbox',
    check: `SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='tender_digest_outbox' LIMIT 1`,
  },
  {
    name: 'V477__mlsp_passes',
    check: `SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='mlsp_applications' LIMIT 1`,
  },
  {
    name: 'V478__mlsp_app_workflow',
    check: `SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='mlsp_applications'
               AND column_name='sent_at' LIMIT 1`,
  },
  {
    name: 'V479__mlsp_pack_druzhina',
    check: `SELECT 1 FROM mlsp_requirement_pack WHERE code='MEDCHECK' AND is_active IS TRUE LIMIT 1`,
  },
  {
    name: 'V480__mlsp_pack_labels_from_druzhina',
    // data-only: считаем применённой, если V479 на месте (зависит от неё)
    check: `SELECT 1 FROM mlsp_requirement_pack WHERE code='MEDCHECK' AND is_active IS TRUE LIMIT 1`,
  },
  {
    name: 'V481__tender_digest_recipients_seed',
    check: `SELECT 1 FROM settings WHERE key='tender_digest_recipients' LIMIT 1`,
  },
  {
    name: 'V482__schema_migrations_journal',
    check: `SELECT 1 FROM information_schema.views
             WHERE table_schema='public' AND table_name='schema_migrations' LIMIT 1`,
  },
];

function gitHead() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim()
      .slice(0, 40);
  } catch {
    return null;
  }
}

function fileChecksum(name) {
  const f = path.join(MIG_DIR, `${name}.sql`);
  if (!fs.existsSync(f)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
}

function poolFromEnv() {
  return new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'asgard_crm',
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || 'password',
  });
}

function matchOnly(name) {
  if (!onlySet) return true;
  const ver = name.match(/^V\d+/)?.[0];
  return onlySet.has(name) || (ver && onlySet.has(ver));
}

async function ensureJournal(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)`);
  await pool.query(`ALTER TABLE migrations ADD COLUMN IF NOT EXISTS git_commit VARCHAR(40)`);
  await pool.query(`ALTER TABLE migrations ADD COLUMN IF NOT EXISTS applied_by TEXT DEFAULT CURRENT_USER`);
  await pool.query(`ALTER TABLE migrations ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'runner'`);
  await pool.query(`ALTER TABLE migrations ADD COLUMN IF NOT EXISTS note TEXT`);
}

async function main() {
  const pool = poolFromEnv();
  const head = gitHead();
  let inserted = 0;
  let skipped = 0;
  let absent = 0;

  try {
    await ensureJournal(pool);
    console.log(`БД: ${process.env.DB_NAME || 'asgard_crm'}`);
    console.log(doApply ? 'Режим: APPLY' : 'Режим: план (без записи). Для записи добавь --apply');
    console.log('');

    for (const m of MARKERS) {
      if (!matchOnly(m.name)) continue;

      const exists = await pool.query('SELECT 1 FROM migrations WHERE name=$1 LIMIT 1', [m.name]);
      if (exists.rowCount) {
        console.log(`[skip] ${m.name}: уже в журнале`);
        skipped++;
        continue;
      }

      let markerOk = false;
      try {
        const r = await pool.query(m.check);
        markerOk = r.rowCount > 0;
      } catch (e) {
        console.log(`[warn] ${m.name}: проверка упала — ${e.message}`);
        absent++;
        continue;
      }

      if (!markerOk) {
        console.log(`[miss] ${m.name}: маркера схемы нет — не записываю`);
        absent++;
        continue;
      }

      if (!doApply) {
        console.log(`[plan] ${m.name}: маркер есть → будет INSERT (source=backfill)`);
        inserted++;
        continue;
      }

      const checksum = fileChecksum(m.name);
      await pool.query(
        `INSERT INTO migrations (name, checksum, git_commit, applied_by, source, note)
         VALUES ($1, $2, $3, CURRENT_USER, 'backfill', $4)
         ON CONFLICT (name) DO NOTHING`,
        [
          m.name,
          checksum,
          head,
          'Запись по маркеру схемы без повторного DDL (tools/backfill_migrations_journal.js)',
        ]
      );
      console.log(`[ok]   ${m.name}: записана в журнал`);
      inserted++;
    }

    console.log('');
    console.log(`Итого: записано/в плане=${inserted}, уже было=${skipped}, нет маркера=${absent}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
