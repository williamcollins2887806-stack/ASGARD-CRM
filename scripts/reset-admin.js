#!/usr/bin/env node

/**
 * Reset Admin Password
 * Usage: node scripts/reset-admin.js [new-password]
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || 'password',
});

async function main() {
  const newPassword = process.argv[2] || 'admin123';
  
  console.log('🔐 Resetting admin password...');
  
  const hash = await bcrypt.hash(newPassword, 10);
  
  await pool.query(`
    UPDATE users 
    SET password_hash = $1, updated_at = NOW() 
    WHERE login = 'admin'
  `, [hash]);
  
  console.log('✅ Admin password reset successfully!');
  console.log(`   Login: admin`);
  console.log(`   Password: ${newPassword}`);
  
  await pool.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
