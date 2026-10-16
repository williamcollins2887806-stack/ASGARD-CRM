const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
const intake = require('../src/services/doc-email-intake');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
const INVOICE_TEXT = `СЧЁТ № 777 от 01.10.2026
Поставщик: ООО «ИНТЕЙК-ТЕСТ»
ИНН 7721793895 КПП 771201001
Банк: ПАО СБЕРБАНК БИК 044525225
р/с 40702810600000012345 к/с 30101810400000000225
Итого без НДС: 100 000,00
НДС: 20 000,00
Всего к оплате: 120 000,00`;
(async () => {
  const me = (await db.query(`SELECT id FROM users WHERE login='test_admin'`)).rows[0].id;
  const tag = Date.now() % 100000;
  const email = { id: 700000 + tag };
  const att = { id: 600000 + tag };
  const docs = []; const pays = [];

  console.log('\n=== одиночный счёт: заявка + запись реестра ===');
  const r1 = await intake.intakeOne(db, { email, attachment: att, text: INVOICE_TEXT, userId: me });
  console.log('  status=' + r1.status, '| doc=' + r1.doc_id, '| pay=' + r1.payment_invoice_id, '| conf=' + r1.parsed.confidence);
  (r1.status === 'created' && r1.doc_id && r1.payment_invoice_id) ? ok('созданы doc + payment_invoice') : bad('status=' + r1.status);
  if (r1.doc_id) docs.push(r1.doc_id);
  if (r1.payment_invoice_id) pays.push(r1.payment_invoice_id);
  const d = (await db.query(`SELECT counterparty_name, counterparty_inn, amount_gross, has_vat, invoice_number FROM doc_registry WHERE id=$1`, [r1.doc_id])).rows[0];
  (d && d.counterparty_inn === '7721793895' && Number(d.amount_gross) === 120000) ? ok('поля реестра заполнены (ИНН, сумма)') : bad('doc: ' + JSON.stringify(d));
  const pay = (await db.query(`SELECT status, doc_registry_id, approval_expires_at FROM payment_invoices WHERE id=$1`, [r1.payment_invoice_id])).rows[0];
  (pay && pay.status === 'awaiting_dir' && pay.doc_registry_id === r1.doc_id) ? ok('заявка awaiting_dir связана с реестром') : bad('pay: ' + JSON.stringify(pay));
  (pay && pay.approval_expires_at) ? ok('TTL 72ч проставлен') : bad('нет TTL');

  console.log('\n=== антидубль: та же пара письмо+вложение → already ===');
  const r2 = await intake.intakeOne(db, { email, attachment: att, text: INVOICE_TEXT, userId: me });
  (r2.status === 'already') ? ok('повтор не создаёт дубль') : bad('status=' + r2.status);
  const nPay = (await db.query(`SELECT count(*)::int n FROM payment_invoices WHERE doc_registry_id=$1`, [r1.doc_id])).rows[0].n;
  (nPay === 1) ? ok('ровно 1 заявка на строку') : bad('заявок: ' + nPay);

  console.log('\n=== N счетов в одном письме → N записей ===');
  const email2 = { id: 700100 + tag };
  const r3 = await intake.intakeEmail(db, {
    email: email2, userId: me,
    invoices: [
      { attachment: { id: 600100 + tag }, text: INVOICE_TEXT.replace('777', '778') },
      { attachment: { id: 600101 + tag }, text: INVOICE_TEXT.replace('777', '779') },
      { attachment: { id: 600102 + tag }, text: INVOICE_TEXT.replace('777', '780') }
    ]
  });
  console.log('  ' + JSON.stringify({ count: r3.count, created: r3.created, manual: r3.needs_manual }));
  (r3.count === 3 && r3.created === 3) ? ok('3 вложения → 3 записи') : bad('N счетов: ' + JSON.stringify(r3));
  for (const r of r3.results) { if (r.doc_id) docs.push(r.doc_id); if (r.payment_invoice_id) pays.push(r.payment_invoice_id); }

  console.log('\n=== низкая уверенность (мусор) → needs_manual, без заявки ===');
  const r4 = await intake.intakeOne(db, { email: { id: 700200 + tag }, attachment: { id: 600200 + tag }, text: 'Привет, это не счёт', userId: me });
  console.log('  status=' + r4.status, '| pay=' + r4.payment_invoice_id, '| doc=' + r4.doc_id);
  (r4.status === 'needs_manual' && !r4.payment_invoice_id) ? ok('мусор → needs_manual без заявки') : bad('мусор: ' + JSON.stringify(r4));
  if (r4.doc_id) docs.push(r4.doc_id);

  await db.query(`DELETE FROM doc_email_intake WHERE doc_id = ANY($1::int[]) OR payment_invoice_id = ANY($2::int[])`, [docs, pays]);
  await db.query(`DELETE FROM payment_invoices WHERE id = ANY($1::int[])`, [pays]);
  await db.query(`DELETE FROM doc_registry WHERE id = ANY($1::int[])`, [docs]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ intake: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
