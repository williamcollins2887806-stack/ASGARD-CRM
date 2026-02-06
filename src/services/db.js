/**
 * Database Service - PostgreSQL Connection Pool
 * ═══════════════════════════════════════════════════════════════════════════
 * SECURITY: Требуется DB_PASSWORD (CRIT-5)
 */

const { Pool } = require('pg');

// SECURITY: Проверка обязательных переменных окружения (CRIT-5)
if (!process.env.DB_PASSWORD) {
  console.error('FATAL: DB_PASSWORD environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD, // SECURITY: Без fallback (CRIT-5)
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

// ─────────────────────────────────────────────────────────────────────────────
// Query Helper
// ─────────────────────────────────────────────────────────────────────────────
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  
  if (process.env.NODE_ENV !== 'production') {
    console.log('Query:', { text: text.substring(0, 100), duration: `${duration}ms`, rows: res.rowCount });
  }
  
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Helper
// ─────────────────────────────────────────────────────────────────────────────
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find one record by ID
 */
async function findById(table, id) {
  const res = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

/**
 * Find all records with optional filters
 */
async function findAll(table, { where = {}, orderBy = 'id DESC', limit, offset } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(where)) {
    if (value !== undefined && value !== null) {
      conditions.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }

  let sql = `SELECT * FROM ${table}`;
  if (conditions.length) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ` ORDER BY ${orderBy}`;
  
  if (limit) {
    sql += ` LIMIT $${idx}`;
    values.push(limit);
    idx++;
  }
  if (offset) {
    sql += ` OFFSET $${idx}`;
    values.push(offset);
  }

  const res = await query(sql, values);
  return res.rows;
}

/**
 * Insert a new record
 */
async function insert(table, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`);

  const sql = `
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `;

  const res = await query(sql, values);
  return res.rows[0];
}

/**
 * Update a record by ID
 */
async function update(table, id, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');

  const sql = `
    UPDATE ${table}
    SET ${setClause}, updated_at = NOW()
    WHERE id = $${keys.length + 1}
    RETURNING *
  `;

  const res = await query(sql, [...values, id]);
  return res.rows[0];
}

/**
 * Delete a record by ID
 */
async function remove(table, id) {
  const res = await query(`DELETE FROM ${table} WHERE id = $1 RETURNING *`, [id]);
  return res.rows[0];
}

/**
 * Count records
 */
async function count(table, where = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(where)) {
    if (value !== undefined && value !== null) {
      conditions.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }

  let sql = `SELECT COUNT(*) FROM ${table}`;
  if (conditions.length) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  const res = await query(sql, values);
  return parseInt(res.rows[0].count, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  pool,
  query,
  transaction,
  findById,
  findAll,
  insert,
  update,
  remove,
  count,
  end: () => pool.end()
};
