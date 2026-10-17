const BASE = 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
async function login(l, p) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
  const d = await r.json(); let t = d.token;
  if (d.status === 'need_pin') { for (const pin of ['0000', '1234']) { const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) }); const d2 = await r2.json(); if (d2.token) { t = d2.token; break; } } }
  return t;
}
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  const pmT = await login('test_pm', 'Test123!');
  const buhT = await login('test_buh', 'Test123!');
  const other = (await db.query(`SELECT id FROM users WHERE role='PM' AND login<>'test_pm' LIMIT 1`)).rows[0]
    || (await db.query(`SELECT id FROM users WHERE role IN ('PROC','TO') LIMIT 1`)).rows[0];
  const tag = 'RECON-LEAK-' + (Date.now() % 100000);
  // Чужая строка: владелец — другой пользователь, суммы 2 696 299.
  const doc = (await db.query(
    `INSERT INTO doc_registry(dir, counterparty_name, counterparty_inn, invoice_number, invoice_date, amount_gross, pay_status, doc_owner_id, created_by, updated_by)
     VALUES ('in',$1,'7722753969','RL-1','2026-10-05', 2696299, 'paid', $2, $2, $2) RETURNING id`, [tag, other.id])).rows[0];

  console.log('\n=== PM по чужому ИНН: суммы НЕ должны течь ===');
  const r1 = await fetch(`${BASE}/api/doc-registry/reconciliation/detail?inn=7722753969&year=2026&quarter=4`, { headers: H(pmT) });
  const j1 = await r1.json();
  console.log('  st=' + r1.status, 'docs=' + (j1.docs || []).length, 'docsSum=' + j1.docsSum, 'paidSum=' + j1.paidSum);
  const leaked = (j1.docs || []).some((d) => d.id === doc.id) || Number(j1.docsSum) >= 2696299;
  (!leaked) ? ok('PM не видит чужую сумму') : bad('УТЕЧКА: PM видит docsSum=' + j1.docsSum);

  console.log('\n=== BUH (привилегированный) видит ===');
  const r2 = await fetch(`${BASE}/api/doc-registry/reconciliation/detail?inn=7722753969&year=2026&quarter=4`, { headers: H(buhT) });
  const j2 = await r2.json();
  const sees = (j2.docs || []).some((d) => d.id === doc.id);
  console.log('  docs=' + (j2.docs || []).length, 'docsSum=' + j2.docsSum);
  (sees) ? ok('BUH видит строку (матрица не ломает роль)') : bad('BUH не видит (регресс видимости)');

  console.log('\n=== нет 500 (класс «no parameter $1») ===');
  (r1.status === 200 && r2.status === 200) ? ok('оба запроса 200 (нет конфликта параметров)') : bad('st=' + r1.status + '/' + r2.status);

  await db.query(`DELETE FROM doc_registry WHERE id=$1`, [doc.id]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ утечки актов: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
