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

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || 'password',
});

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getExecutedMigrations() {
  const result = await pool.query('SELECT name FROM migrations ORDER BY id');
  return result.rows.map(r => r.name);
}

async function markMigrationExecuted(name) {
  await pool.query('INSERT INTO migrations (name) VALUES ($1)', [name]);
}

async function markMigrationRolledBack(name) {
  await pool.query('DELETE FROM migrations WHERE name = $1', [name]);
}

async function runMigrations() {
  await ensureMigrationsTable();
  
  const executed = await getExecutedMigrations();
  const migrationsDir = path.join(__dirname);
  
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && f.startsWith('V'))
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
      await markMigrationExecuted(name);
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
