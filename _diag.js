require('dotenv').config();
const db = require('./src/services/db');
(async()=>{
  // 1. Check pin columns
  const cols = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users' AND column_name LIKE '%pin%' ORDER BY ordinal_position");
  console.log('=== PIN COLUMNS ===');
  cols.rows.forEach(c => console.log(c.column_name, c.data_type));

  // 2. Check pin_hash values for admins
  const r = await db.query("SELECT id, login, role, pin_hash FROM users WHERE role='ADMIN' OR role='DIRECTOR_GEN' LIMIT 5");
  console.log('=== ADMIN/DIRECTOR USERS ===');
  r.rows.forEach(u => console.log(JSON.stringify({id:u.id, login:u.login, role:u.role, has_pin_hash: !!u.pin_hash, pin_hash_preview: u.pin_hash ? u.pin_hash.slice(0,15)+'...' : null})));

  // 3. Customers sequence check
  const maxId = await db.query('SELECT MAX(id) as max_id FROM customers');
  const seq = await db.query('SELECT last_value FROM customers_id_seq');
  const last5 = await db.query('SELECT id FROM customers ORDER BY id DESC LIMIT 5');
  console.log('=== CUSTOMERS SEQ ===');
  console.log('max_id:', maxId.rows[0].max_id, 'seq:', seq.rows[0].last_value);
  console.log('Last 5 IDs:', last5.rows.map(r=>r.id).join(', '));

  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
