/**
 * ASGARD CRM - Seed 15 test users + apply role_presets to user_permissions
 *
 * Usage:
 *   node tests/helpers/seed.js                # Run seeding
 *   DATABASE_URL=postgres://... node tests/helpers/seed.js
 *
 * Environment variables:
 *   DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
 */
'use strict';

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'HEAD_PM', 'HEAD_TO', 'PM', 'TO', 'HR', 'HR_MANAGER',
  'BUH', 'OFFICE_MANAGER', 'PROC', 'CHIEF_ENGINEER', 'WAREHOUSE'
];

const TEST_PASSWORD = 'Test123!';
const TEST_PIN = '0000';

function getPool() {
  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'asgard_crm',
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789'
  });
}

async function seed() {
  const pool = getPool();
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const pinHash = await bcrypt.hash(TEST_PIN, 10);

  console.log('  [seed] Creating 15 test users...');

  const userIds = {};

  for (const role of ROLES) {
    const login = `test_${role.toLowerCase()}`;
    const name = `Test ${role}`;
    const email = `${login}@test.asgard.local`;

    try {
      const result = await pool.query(`
        INSERT INTO users (login, password_hash, pin_hash, name, email, role, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
        ON CONFLICT (login) DO UPDATE
          SET password_hash = $2, pin_hash = $3, name = $4, email = $5,
              role = $6, is_active = true, updated_at = NOW()
        RETURNING id
      `, [login, passwordHash, pinHash, name, email, role]);
      userIds[role] = result.rows[0].id;
      console.log(`    + ${login} (id=${result.rows[0].id}, role=${role})`);
    } catch (err) {
      console.log(`    ! ${login}: ${err.message.slice(0, 100)}`);
    }
  }

  // Apply role_presets to user_permissions
  console.log('  [seed] Applying role_presets to user_permissions...');

  for (const role of ROLES) {
    const userId = userIds[role];
    if (!userId) continue;

    try {
      // Check if role_presets table exists
      const { rows: presets } = await pool.query(`
        SELECT module_key, can_read, can_write, can_delete
        FROM role_presets
        WHERE role = $1
      `, [role]);

      if (presets.length > 0) {
        for (const p of presets) {
          await pool.query(`
            INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, module_key) DO UPDATE
              SET can_read = $3, can_write = $4, can_delete = $5
          `, [userId, p.module_key, p.can_read, p.can_write, p.can_delete]);
        }
        console.log(`    = ${role}: ${presets.length} permissions applied`);
      } else {
        console.log(`    ~ ${role}: no presets found (OK for ADMIN)`);
      }
    } catch (err) {
      // role_presets may not exist
      if (err.message.includes('does not exist')) {
        console.log(`    ~ role_presets table not found, skipping permissions`);
        break;
      }
      console.log(`    ! ${role} permissions: ${err.message.slice(0, 100)}`);
    }
  }

  await pool.end();
  console.log('  [seed] Done. User IDs:', JSON.stringify(userIds));
  return userIds;
}

async function cleanup() {
  const pool = getPool();
  console.log('  [cleanup] Removing test users...');
  try {
    await pool.query(`DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE login LIKE 'test_%')`);
    await pool.query(`DELETE FROM users WHERE login LIKE 'test_%'`);
    console.log('  [cleanup] Done');
  } catch (err) {
    console.log(`  [cleanup] Error: ${err.message.slice(0, 200)}`);
  }
  await pool.end();
}

// Direct execution
if (require.main === module) {
  const action = process.argv[2];
  if (action === 'cleanup') {
    cleanup().catch(e => { console.error(e); process.exit(1); });
  } else {
    seed().catch(e => { console.error(e); process.exit(1); });
  }
}

module.exports = { seed, cleanup, ROLES, TEST_PASSWORD, TEST_PIN };
