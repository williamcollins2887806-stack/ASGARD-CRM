const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
const th = require('../src/services/approval-thread');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  const intake = require('../src/services/doc-email-intake');
  const tag = Date.now() % 100000;
  const dirId = (await db.query(`SELECT id FROM users WHERE role='DIRECTOR_COMM' AND is_active=true ORDER BY id LIMIT 1`)).rows[0].id;
  const INVOICE = `СЧЁТ № ${tag} от 03.10.2026
Поставщик: ООО «ТРЕД-ТЕСТ»
ИНН 7721793895 КПП 771201001
Банк: ПАО СБЕРБАНК БИК 044525225
р/с 40702810600000012345 к/с 30101810400000000225
Итого без НДС: 8 333,33
НДС: 1 666,67
Всего к оплате: 10 000,00`;

  // письмо-заявка (source-письмо заявки) с message_id и thread_id
  const srcMsgId = `src-${tag}@asgard-service.com`;
  const execEmail = (await db.query(
    `INSERT INTO emails(account_id, direction, message_id, thread_id, from_email, subject, body_text, is_crm_copy, email_date, synced_at)
     VALUES (112,'inbound',$1,$2,'crm@asgard-service.com','Счёт на согласование',$3,true,NOW(),NOW()) RETURNING id`,
    [srcMsgId, srcMsgId, INVOICE])).rows[0];

  // intake создаёт заявку и связывает source_email_id = письмо-заявка
  const r1 = await intake.intakeOne(db, { email: { id: execEmail.id }, attachment: { id: 500000 + tag }, text: INVOICE, userId: null });
  const payId = r1.payment_invoice_id;
  console.log('заявка:', payId, '| doc:', r1.doc_id);
  (payId) ? ok('intake создал заявку') : bad('нет заявки');

  console.log('\n=== ответ директора «Добро» в треде → согласование ===');
  const reply = {
    id: 0, thread_id: srcMsgId, in_reply_to: `<${srcMsgId}>`, references_header: `<${srcMsgId}>`,
    body_text: 'Добро', from_email: 'go@asgard-service.com'
  };
  const res = await th.handleApprovalReply(db, reply);
  console.log('  ' + JSON.stringify(res));
  (res.action === 'approve' && res.applied === 1) ? ok('«Добро» согласовало заявку') : bad('результат: ' + JSON.stringify(res));
  const after = (await db.query(`SELECT status, dir_approved_by FROM payment_invoices WHERE id=$1`, [payId])).rows[0];
  (after.status === 'pending_payment') ? ok('статус → pending_payment от лица директора') : bad('статус: ' + JSON.stringify(after));
  (after.dir_approved_by === dirId) ? ok('согласовавший = Олег Гажилиев') : bad('dir_approved_by=' + after.dir_approved_by);

  console.log('\n=== счёт появился в реестре (хук) ===');
  const doc = (await db.query(`SELECT id, payment_invoice_id FROM doc_registry WHERE id=$1`, [r1.doc_id])).rows[0];
  (doc && doc.payment_invoice_id === payId) ? ok('реестр связан с заявкой') : bad('реестр: ' + JSON.stringify(doc));

  console.log('\n=== повтор «Добро» не воскрешает ===');
  const res2 = await th.handleApprovalReply(db, reply);
  (res2.applied === 0) ? ok('повтор без эффекта (уже согласовано)') : bad('повтор применён: ' + JSON.stringify(res2));

  console.log('\n=== отказ директора ===');
  const pay2 = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, requires_payment, created_by, pay_timing, source_email_id, source_thread_key)
     VALUES ('awaiting_dir','awaiting_dir','ТРЕД-REJ', 500, true, 1, 'immediate', $1, $2) RETURNING id`, [execEmail.id, srcMsgId])).rows[0];
  const rejRes = await th.handleApprovalReply(db, { ...reply, body_text: 'Отклоняю' });
  (rejRes.action === 'reject') ? ok('отказ распознан') : bad('отказ: ' + JSON.stringify(rejRes));
  const pay2st = (await db.query(`SELECT status FROM payment_invoices WHERE id=$1`, [pay2.id])).rows[0];
  (pay2st.status === 'awaiting_dir') ? ok('отказ НЕ согласовал заявку') : bad('заявка изменилась: ' + pay2st.status);

  console.log('\n=== неоднозначный тред → needs_manual ===');
  const nomatch = await th.handleApprovalReply(db, { id: 0, thread_id: 'нет-такого', in_reply_to: '<x-нет>', references_header: '', body_text: 'Добро', from_email: 'go@asgard-service.com' });
  (nomatch.needs_manual === true) ? ok('неоднозначность → ручная привязка') : bad('номатч: ' + JSON.stringify(nomatch));

  // Уборка
  const pays = [payId, pay2.id].filter(Boolean);
  await db.query(`DELETE FROM doc_email_intake WHERE payment_invoice_id = ANY($1::int[])`, [pays]);
  await db.query(`DELETE FROM payment_invoices WHERE id = ANY($1::int[])`, [pays]);
  await db.query(`DELETE FROM doc_registry WHERE id=$1`, [r1.doc_id]);
  await db.query(`DELETE FROM emails WHERE id=$1`, [execEmail.id]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ «Добро» в треде: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
