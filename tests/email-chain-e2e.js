const BASE = 'http://127.0.0.1:3100';
const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
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
  const intake = require('../src/services/doc-email-intake');
  const pm = (await db.query(`SELECT id FROM users WHERE login='test_pm'`)).rows[0].id;
  const buhT = await login('test_buh', 'Test123!');
  const dirT = await login('test_director_comm', 'Test123!');
  const pmT = await login('test_pm', 'Test123!');
  const tag = Date.now() % 100000;

  console.log('\n=== ЭТАП 1: письмо со счётом → intake создаёт заявку ===');
  const text = `СЧЁТ № ${tag} от 01.10.2026\nПоставщик: ООО «ЦЕПОЧКА-ТЕСТ»\nИНН 7721793895 КПП 771201001\nБанк: ПАО СБЕРБАНК БИК 044525225\nр/с 40702810600000012345 к/с 30101810400000000225\nИтого без НДС: 50 000,00\nНДС: 10 000,00\nВсего к оплате: 60 000,00`;
  const r1 = await intake.intakeOne(db, { email: { id: 700000 + tag }, attachment: { id: 600000 + tag }, text, userId: pm });
  console.log('  status=' + r1.status, '| doc=' + r1.doc_id, '| pay=' + r1.payment_invoice_id);
  (r1.status === 'created' && r1.payment_invoice_id) ? ok('intake создал заявку') : bad('intake: ' + r1.status);
  const payId = r1.payment_invoice_id;
  const docId = r1.doc_id;

  console.log('\n=== ЭТАП 2: директор ВИДИТ заявку ===');
  const dirList = await (await fetch(BASE + '/api/approval/pending-dir', { headers: H(dirT) })).json();
  const inDir = (dirList.items || []).find((x) => x.id === payId);
  (inDir) ? ok('заявка в очереди директора') : bad('директор не видит заявку');

  console.log('\n=== ЭТАП 3: директор СОГЛАСУЕТ ===');
  const appr = await fetch(`${BASE}/api/payment-invoices/${payId}/dir-approve`, { method: 'POST', headers: H(dirT), body: JSON.stringify({ comment: 'Добро' }) });
  const aj = await appr.json().catch(() => ({}));
  const afterAppr = (await db.query(`SELECT status, dir_approved_by, dir_approved_at, doc_registry_id FROM payment_invoices WHERE id=$1`, [payId])).rows[0];
  console.log('  st=' + appr.status, '| ' + JSON.stringify(afterAppr));
  (appr.status === 200 && afterAppr.status === 'pending_payment') ? ok('статус → pending_payment (ждёт оплаты)') : bad('согласование: ' + JSON.stringify(afterAppr));
  (afterAppr.dir_approved_by) ? ok('зафиксирован согласовавший') : bad('нет dir_approved_by');

  console.log('\n=== ЭТАП 4: счёт появился в РЕЕСТРЕ (хук после approve) ===');
  const doc = (await db.query(`SELECT id, counterparty_name, amount_gross, is_incomplete, payment_invoice_id FROM doc_registry WHERE id=$1`, [docId])).rows[0];
  console.log('  ' + JSON.stringify(doc));
  (doc && Number(doc.amount_gross) === 60000) ? ok('запись реестра с суммой 60000') : bad('реестр: ' + JSON.stringify(doc));

  console.log('\n=== ЭТАП 5: бухгалтерия видит счёт в реестре ===');
  const buhQ = await (await fetch(BASE + '/api/approval/pending-buh', { headers: H(buhT) })).json();
  const inBuh = (buhQ.items || []).find((x) => x.entity_type === 'payment_invoices' && x.id === payId);
  (inBuh) ? ok('счёт в очереди бухгалтерии') : bad('бухгалтерия не видит счёт');

  console.log('\n=== ЭТАП 6: бухгалтер ОПЛАЧИВАЕТ ===');
  const bank = await fetch(`${BASE}/api/payment-invoices/${payId}/pay-bank`, { method: 'POST', headers: H(buhT), body: JSON.stringify({ comment: 'ПП 123', pp_number: '123', pp_date: '2026-10-17' }) });
  const paid = (await db.query(`SELECT status, payment_status, buh_id, pp_number, payee_requisites FROM payment_invoices WHERE id=$1`, [payId])).rows[0];
  console.log('  st=' + bank.status, '| ' + JSON.stringify({ status: paid.status, pp: paid.pp_number, req: !!paid.payee_requisites }));
  (bank.status === 200 && paid.status === 'paid') ? ok('счёт оплачен') : bad('оплата: ' + JSON.stringify(paid));
  (paid.pp_number === '123') ? ok('№ ПП сохранён') : bad('нет № ПП');
  (paid.payee_requisites && paid.payee_requisites.rs) ? ok('снимок реквизитов сохранён') : bad('нет реквизитов');

  console.log('\n=== ЭТАП 7: счёт в АРХИВЕ с историей ===');
  const ar = await (await fetch(BASE + '/api/approval/archive?limit=100', { headers: H(buhT) })).json();
  const rec = (ar.items || []).find((x) => x.kind === 'invoice' && x.id === payId);
  (rec && rec.status === 'paid') ? ok('архив: счёт оплачен') : bad('архив: ' + JSON.stringify(rec));
  (rec && rec.approved_by) ? ok('архив: кто согласовал') : bad('нет approved_by');
  (rec && rec.paid_by) ? ok('архив: кто оплатил') : bad('нет paid_by');

  await db.query(`DELETE FROM doc_email_intake WHERE payment_invoice_id=$1 OR doc_id=$2`, [payId, docId]);
  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [payId]);
  await db.query(`DELETE FROM doc_registry WHERE id=$1`, [docId]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ сквозной цепочки: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
