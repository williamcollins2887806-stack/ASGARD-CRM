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
  const buh = await login('test_buh', 'Test123!');
  const dir = await login('test_director_comm', 'Test123!') || await login('test_admin', 'Test123!');
  const adminT = await login('test_admin', 'Test123!');
  const me = (await db.query(`SELECT id FROM users WHERE login='test_buh'`)).rows[0].id;
  const dirId = (await db.query(`SELECT id FROM users WHERE login='test_director_comm'`)).rows[0]?.id
    || (await db.query(`SELECT id FROM users WHERE role='DIRECTOR_COMM' LIMIT 1`)).rows[0].id;

  console.log('\n=== очередь бухгалтерии: due_date + pay_timing + initiator ===');
  const t1 = 'BUH-T1-' + Date.now();
  const soon = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, due_date, requires_payment, created_by, pay_timing)
     VALUES ('pending_payment','pending_payment',$1, 1000, CURRENT_DATE+30, true, $2, 'deferred') RETURNING id`, [t1, me])).rows[0].id;
  const pend = await fetch(BASE + '/api/approval/pending-buh', { headers: H(buh) });
  const pj = await pend.json();
  const it = (pj.items || []).find((x) => x.id === soon && x.entity_type === 'payment_invoices');
  console.log('  найдено:', it ? JSON.stringify({ due: it.due_date, timing: it.pay_timing, init: it.initiator_name }) : 'нет');
  (it && it.due_date) ? ok('queue отдаёт due_date') : bad('нет due_date');
  (it && Object.prototype.hasOwnProperty.call(it, 'initiator_name')) ? ok('queue отдаёт initiator_name') : bad('нет initiator_name');

  console.log('\n=== GET /:id — доп.данные для модалки (инициатор/реквизиты) ===');
  const one = await fetch(`${BASE}/api/payment-invoices/${soon}`, { headers: H(buh) });
  const oj = await one.json();
  console.log('  st=' + one.status, '| initiator=' + oj.initiator_name, '| has_file=' + oj.has_file);
  (one.status === 200 && Object.prototype.hasOwnProperty.call(oj, 'initiator_name')) ? ok('/:id отдаёт initiator_name') : bad('/:id: ' + one.status);

  console.log('\n=== АРХИВ решений ===');
  const paidInv = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, requires_payment, created_by, pay_timing,
       dir_approved_by, dir_approved_at, buh_id, buh_acted_at)
     VALUES ('paid','paid', 'ARCH-TEST', 5000, true, $1, 'immediate', $2, NOW(), $3, NOW()) RETURNING id`, [me, dirId, me])).rows[0].id;
  const ar = await fetch(BASE + '/api/approval/archive?limit=50', { headers: H(adminT) });
  const aj = await ar.json();
  const rec = (aj.items || []).find((x) => x.kind === 'invoice' && x.id === paidInv);
  console.log('  st=' + ar.status, '| всего записей:', (aj.items || []).length, '| наша:', rec ? JSON.stringify({ st: rec.status, by: rec.approved_by, paid: rec.paid_by }) : 'нет');
  (ar.status === 200 && rec) ? ok('архив содержит оплаченный счёт') : bad('архив: ' + ar.status);
  (rec && rec.approved_by) ? ok('архив показывает «кто согласовал»') : bad('нет approved_by');
  (rec && rec.paid_by) ? ok('архив показывает «кто оплатил»') : bad('нет paid_by');
  const dirAr = await fetch(BASE + '/api/approval/archive?limit=20', { headers: H(dir) });
  (dirAr.status === 200) ? ok('директор видит архив') : bad('директор архив st=' + dirAr.status);

  await db.query(`DELETE FROM payment_invoices WHERE id IN ($1,$2)`, [soon, paidInv]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ реестра бухгалтерии/архива: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
