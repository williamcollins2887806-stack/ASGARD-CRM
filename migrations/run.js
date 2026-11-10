/**
 * Database Migration Runner
 * ═══════════════════════════════════════════════════════════════════════════
 * Usage:
 *   node migrations/run.js        - Run all pending migrations
 *   node migrations/run.js down   - Rollback last migration
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || 'password',
});

function gitHead() {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8').trim().slice(0, 40);
  } catch {
    return null;
  }
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // V482 meta — идемпотентно, чтобы старые БД тоже писали полный журнал
  await pool.query(`ALTER TABLE migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)`);
  await pool.query(`ALTER TABLE migrations ADD COLUMN IF NOT EXISTS git_commit VARCHAR(40)`);
  await pool.query(`ALTER TABLE migrations ADD COLUMN IF NOT EXISTS applied_by TEXT DEFAULT CURRENT_USER`);
  await pool.query(`ALTER TABLE migrations ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'runner'`);
  await pool.query(`ALTER TABLE migrations ADD COLUMN IF NOT EXISTS note TEXT`);
}

async function getExecutedMigrations() {
  const result = await pool.query('SELECT name FROM migrations ORDER BY id');
  return result.rows.map(r => r.name);
}

async function markMigrationExecuted(name, sqlText) {
  await pool.query(
    `INSERT INTO migrations (name, checksum, git_commit, applied_by, source)
     VALUES ($1, $2, $3, CURRENT_USER, 'runner')
     ON CONFLICT (name) DO NOTHING`,
    [name, sha256(sqlText), gitHead()]
  );
}

async function markMigrationRolledBack(name) {
  await pool.query('DELETE FROM migrations WHERE name = $1', [name]);
}

async function runMigrations() {
  await ensureMigrationsTable();
  
  const executed = await getExecutedMigrations();
  const migrationsDir = path.join(__dirname);
  
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && f.startsWith('V') && !f.endsWith('_down.sql'))
    .sort();

  console.log(`Found ${files.length} migration files`);

  for (const file of files) {
    const name = file.replace('.sql', '');
    
    if (executed.includes(name)) {
      console.log(`⏭️  Skipping ${name} (already executed)`);
      continue;
    }

    console.log(`🚀 Running ${name}...`);
    
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    
    try {
      await pool.query('BEGIN');
      await pool.query(sql);
      await markMigrationExecuted(name, sql);
      await pool.query('COMMIT');
      console.log(`✅ ${name} completed`);
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error(`❌ ${name} failed:`, err.message);
      process.exit(1);
    }
  }

  console.log('✨ All migrations completed');
}

async function rollbackLast() {
  await ensureMigrationsTable();
  
  const result = await pool.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1');
  if (!result.rows.length) {
    console.log('No migrations to rollback');
    return;
  }

  const name = result.rows[0].name;
  const downFile = path.join(__dirname, `${name}_down.sql`);

  if (!fs.existsSync(downFile)) {
    console.error(`❌ Rollback file not found: ${downFile}`);
    process.exit(1);
  }

  console.log(`⬇️  Rolling back ${name}...`);
  
  const sql = fs.readFileSync(downFile, 'utf8');
  
  try {
    await pool.query('BEGIN');
    await pool.query(sql);
    await markMigrationRolledBack(name);
    await pool.query('COMMIT');
    console.log(`✅ Rollback of ${name} completed`);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(`❌ Rollback failed:`, err.message);
    process.exit(1);
  }
}

async function main() {
  const command = process.argv[2];
  
  try {
    if (command === 'down') {
      await rollbackLast();
    } else {
      await runMigrations();
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
