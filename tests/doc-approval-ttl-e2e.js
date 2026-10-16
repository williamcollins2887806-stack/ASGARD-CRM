const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
const ttl = require('../src/services/doc-approval-ttl');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  const me = (await db.query(`SELECT id FROM users WHERE login='test_admin'`)).rows[0].id;
  const log = { info: () => {}, warn: () => {}, error: () => {} };

  console.log('\n=== TTL часов из настроек ===');
  const h = await ttl.ttlHours(db);
  console.log('  ttlHours =', h);
  (h === 72) ? ok('TTL = 72ч из settings') : bad('TTL = ' + h);

  console.log('\n=== stampExpiry ставит срок ===');
  const inv = (await db.query(
    `INSERT INTO payment_invoices(status, supplier_name, amount, requires_payment, created_by, pay_timing)
     VALUES ('awaiting_dir','TTL-TEST', 1000, true, $1, 'postpay') RETURNING id`, [me])).rows[0];
  await ttl.stampExpiry(db, inv.id);
  const stamped = (await db.query(`SELECT approval_expires_at FROM payment_invoices WHERE id=$1`, [inv.id])).rows[0];
  const hoursAhead = (new Date(stamped.approval_expires_at) - Date.now()) / 3600000;
  console.log('  expires через ~' + hoursAhead.toFixed(1) + ' ч');
  (hoursAhead > 71 && hoursAhead < 73) ? ok('approval_expires_at = NOW()+72ч') : bad('срок: ' + hoursAhead);

  console.log('\n=== canDecide арбитраж ===');
  (ttl.canDecide('awaiting_dir').ok === true) ? ok('awaiting_dir → можно решать') : bad('awaiting_dir');
  const arch = ttl.canDecide('archived');
  (arch.ok === false && arch.needsManual === true) ? ok('archived → needsManual (не воскрешает)') : bad('archived: ' + JSON.stringify(arch));
  const exp = ttl.canDecide('expired');
  (exp.ok === false && exp.needsManual === true) ? ok('expired → needsManual') : bad('expired');

  console.log('\n=== крон архивации (граница 72±1ч) ===');
  // просроченная (73ч): expires_at в прошлом
  await db.query(`UPDATE payment_invoices SET approval_expires_at = NOW() - INTERVAL '1 hour' WHERE id=$1`, [inv.id]);
  // не просроченная (71ч): создаём вторую
  const fresh = (await db.query(
    `INSERT INTO payment_invoices(status, supplier_name, amount, requires_payment, created_by, pay_timing, approval_expires_at)
     VALUES ('awaiting_dir','TTL-FRESH', 1000, true, $1, 'postpay', NOW() + INTERVAL '1 hour') RETURNING id`, [me])).rows[0];
  const res = await ttl.archiveExpired(db, log);
  const old = (await db.query(`SELECT status, archived_at FROM payment_invoices WHERE id=$1`, [inv.id])).rows[0];
  const fr = (await db.query(`SELECT status FROM payment_invoices WHERE id=$1`, [fresh.id])).rows[0];
  console.log('  archived=' + res.archived, '| просроченная:', old.status, '| свежая:', fr.status);
  (old.status === 'archived' && old.archived_at) ? ok('просроченная ушла в архив с датой') : bad('просроченная: ' + JSON.stringify(old));
  (fr.status === 'awaiting_dir') ? ok('свежая осталась awaiting_dir (граница 71ч)') : bad('свежая: ' + fr.status);

  await db.query(`DELETE FROM payment_invoices WHERE id IN ($1,$2)`, [inv.id, fresh.id]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ TTL: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
