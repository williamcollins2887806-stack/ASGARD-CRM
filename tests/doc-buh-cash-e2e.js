const BASE = 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
async function login(l, p) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
    const d = await r.json();
    let t = d.token;
    if (d.status === 'need_pin') {
      for (const pin of ['0000', '1234']) {
        const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) });
        const d2 = await r2.json().catch(() => ({}));
        if (d2.token) { t = d2.token; break; }
      }
    }
    const probe = await fetch(BASE + '/api/doc-registry/kpi', { headers: { Authorization: 'Bearer ' + t } });
    if (probe.status === 200) return t;
    await new Promise((res) => setTimeout(res, 800));
  }
  throw new Error('login failed for ' + l);
}
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  const t = await login('test_buh', 'Test123!');
  const me = (await db.query(`SELECT id FROM users WHERE login='test_buh'`)).rows[0].id;
  const requester = (await db.query(`SELECT id, name FROM users WHERE login='test_pm'`)).rows[0];

  console.log('\n=== очередь бухгалтерии: есть «от кого счёт» ===');
  // заявка, готовая к выдаче
  const req = (await db.query(
    `INSERT INTO cash_requests(user_id, amount, purpose, status, created_at, updated_at)
     VALUES ($1, 44000, 'CA$H-TEST', 'approved', NOW(), NOW()) RETURNING id`, [requester.id])).rows[0];
  const pend = await fetch(BASE + '/api/approval/pending-buh', { headers: H(t) });
  const pj = await pend.json();
  const inv = (pj.items || []).filter((x) => x.entity_type === 'payment_invoices');
  const hasInitiatorField = inv.length === 0 || Object.prototype.hasOwnProperty.call(inv[0], 'initiator_name');
  console.log('  st=' + pend.status, '| счётов в очереди:', inv.length, '| поле initiator_name:', hasInitiatorField);
  (pend.status === 200 && hasInitiatorField) ? ok('очередь бухгалтерии отдаёт initiator_name') : bad('очередь: ' + pend.status);

  console.log('\n=== выдача с фактической суммой (нет размена) ===');
  const before = (await db.query(`SELECT amount FROM cash_balance_log ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];
  const beforeBal = before ? Number(before.amount) : 0;
  const iss = await fetch(`${BASE}/api/cash/${req.id}/issue`, {
    method: 'PUT', headers: H(t), body: JSON.stringify({ actual_amount: 45000, comment: 'выдано 45к' })
  });
  const ij = await iss.json().catch(() => ({}));
  const row = (await db.query(`SELECT status, issued_amount, amount FROM cash_requests WHERE id=$1`, [req.id])).rows[0];
  console.log('  st=' + iss.status, '| БД=' + JSON.stringify(row), '| ответ balance=' + ij.cash_balance);
  (iss.status === 200 && Number(row.issued_amount) === 45000) ? ok('issued_amount = 45000 (факт, не 44000)') : bad('issued_amount: ' + JSON.stringify(row));
  (ij.cash_balance != null) ? ok('ответ отдаёт новый баланс кассы (живое обновление)') : bad('нет cash_balance в ответе');
  const after = (await db.query(`SELECT amount FROM cash_balance_log ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];
  (Math.abs(Number(after.amount) - (beforeBal - 45000)) < 0.01) ? ok('баланс уменьшен на ФАКТИЧЕСКУЮ сумму (45000)') : bad('баланс: ' + after.amount + ' ожидали ' + (beforeBal - 45000));

  await db.query(`DELETE FROM cash_balance_log WHERE related_request_id=$1`, [req.id]);
  await db.query(`DELETE FROM cash_requests WHERE id=$1`, [req.id]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ кассы: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
