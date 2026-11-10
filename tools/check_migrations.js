'use strict';

/**
 * Сверка файлов migrations/V*.sql с журналом public.migrations.
 *
 * Использование:
 *   node tools/check_migrations.js              # статус
 *   node tools/check_migrations.js --json       # машинный JSON
 *   node tools/check_migrations.js --from V470  # только хвост
 *   node tools/check_migrations.js --fail-gap   # exit 1, если в хвосте есть дыры в журнале
 *
 * Канон: таблица `migrations`. VIEW `schema_migrations` — алиас (V482).
 * Коммиты git этим скриптом НЕ заменяют — это другая ось (код ≠ схема).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const MIG_DIR = process.env.MIGRATIONS_DIR || path.join(ROOT, 'migrations');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const failGap = args.includes('--fail-gap');
const fromArg = (() => {
  const i = args.indexOf('--from');
  return i >= 0 ? String(args[i + 1] || '').trim() : '';
})();

function verOf(name) {
  const m = String(name).match(/^V(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function listFiles() {
  return fs.readdirSync(MIG_DIR)
    .filter((f) => /^V\d+__.+\.sql$/i.test(f) && !f.endsWith('_down.sql'))
    .map((f) => f.replace(/\.sql$/i, ''))
    .sort((a, b) => verOf(a) - verOf(b) || a.localeCompare(b));
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

async function main() {
  const files = listFiles();
  const pool = poolFromEnv();
  try {
    const hasTable = await pool.query(`SELECT to_regclass('public.migrations') AS t`);
    if (!hasTable.rows[0].t) {
      const out = {
        ok: false,
        error: 'таблица public.migrations отсутствует — сначала npm run migrate или V482',
        files: files.length,
      };
      if (asJson) console.log(JSON.stringify(out, null, 2));
      else console.error(out.error);
      process.exit(2);
    }

    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='migrations'`
    );
    const colSet = new Set(cols.rows.map((r) => r.column_name));
    const hasMeta = ['checksum', 'git_commit', 'source'].every((c) => colSet.has(c));

    const { rows } = await pool.query(
      hasMeta
        ? `SELECT name, executed_at, source, git_commit, checksum FROM migrations ORDER BY name`
        : `SELECT name, executed_at, NULL::text AS source, NULL::text AS git_commit, NULL::text AS checksum FROM migrations ORDER BY name`
    );
    const byName = new Map(rows.map((r) => [r.name, r]));

    const fromVer = fromArg ? verOf(fromArg) : 0;
    const scoped = fromVer ? files.filter((n) => verOf(n) >= fromVer) : files;

    const recorded = [];
    const missing = [];
    for (const name of scoped) {
      if (byName.has(name)) recorded.push(name);
      else missing.push(name);
    }

    const orphan = [...byName.keys()].filter((n) => !files.includes(n) && (!fromVer || verOf(n) >= fromVer));
    const view = await pool.query(`SELECT to_regclass('public.schema_migrations') AS v`);

    const report = {
      ok: missing.length === 0,
      db: process.env.DB_NAME || 'asgard_crm',
      journal_table: 'migrations',
      schema_migrations_view: Boolean(view.rows[0].v),
      journal_meta_columns: hasMeta,
      files_total: files.length,
      journal_total: rows.length,
      scope_from: fromArg || null,
      scope_files: scoped.length,
      recorded: recorded.length,
      missing_in_journal: missing,
      orphan_in_journal: orphan,
      last_file: files[files.length - 1] || null,
      last_recorded: rows.length ? rows[rows.length - 1].name : null,
    };

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`БД: ${report.db}`);
      console.log(`Журнал: public.migrations (${report.journal_total} записей)`);
      console.log(`VIEW schema_migrations: ${report.schema_migrations_view ? 'есть' : 'нет (нужна V482)'}`);
      console.log(`Метаколонки (checksum/git_commit/source): ${hasMeta ? 'есть' : 'нет (нужна V482)'}`);
      console.log(`Файлов up-миграций: ${report.files_total}`);
      if (fromArg) console.log(`Срез --from ${fromArg}: файлов ${scoped.length}, в журнале ${recorded.length}`);
      console.log(`Последний файл: ${report.last_file}`);
      console.log(`Последняя запись журнала: ${report.last_recorded}`);
      console.log('');
      if (!missing.length) {
        console.log('✅ Дыр в журнале по выбранному срезу нет');
      } else {
        console.log(`⚠️  В журнале нет ${missing.length} миграций (схема могла быть накатана руками):`);
        for (const n of missing.slice(0, 40)) console.log(`   - ${n}`);
        if (missing.length > 40) console.log(`   … и ещё ${missing.length - 40}`);
        console.log('');
        console.log('Backfill по маркерам схемы: node tools/backfill_migrations_journal.js --apply');
      }
      if (orphan.length) {
        console.log('');
        console.log(`Записи без файла (${orphan.length}):`);
        for (const n of orphan.slice(0, 20)) console.log(`   - ${n}`);
      }
    }

    if (failGap && missing.length) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
