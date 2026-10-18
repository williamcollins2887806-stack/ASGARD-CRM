const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
(async () => {
  const q = async (s, p) => (await pool.query(s, p)).rows;
  console.log('doc_registry', (await q('select count(*)::int n from doc_registry'))[0].n);
  console.log('payment_invoices', (await q('select count(*)::int n from payment_invoices'))[0].n);
  console.log('doc_email_intake', (await q('select count(*)::int n from doc_email_intake'))[0].n);
  console.log('user3456', await q('select id,login,role,name,is_active from users where id=3456'));
  console.log('settings', await q("select key,value_json from settings where key in ('doc_approver_user_id','doc_approval_ttl_hours','email_parse_confidence_min')"));
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
