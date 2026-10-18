/**
 * V406: «Добро» ПРИШЛО РАНЬШЕ заявки (проверка заказчика 18.10.2026).
 * Согласующий отвечает, а OCR ещё разбирает счёт (~5 с). Система должна:
 *   • не упасть;
 *   • СОХРАНИТЬ согласие (не потерять);
 *   • применить его, когда заявка появится.
 *
 * Тест проверяет САМ МЕХАНИЗМ (saveDeferredGrant → applyPendingGrants) без OCR:
 * так он детерминированный и не зависит от того, что тот же счёт обрабатывался раньше.
 * Полный путь с OCR покрыт tests/intake-delivery-e2e.js.
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { Client } = require('pg');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();
  const thr = require('../src/services/approval-thread');

  // 19.10.2026: адрес согласующего НЕ хардкодим. Раньше тест слал с
  // 'andr0sov.nikita@yandex.ru', а согласующий в настройках сейчас
  // 'go@asgard-service.com' — тест падал (FAIL 5) на sender_not_approver,
  // хотя механизм работал. Берём актуальный список из settings.
  const allowed = await thr.approverEmails(db);
  if (!allowed.length) { console.error('Нет согласующего в настройках (doc_approver_user_id/emails)'); process.exit(1); }
  const APPROVER = allowed[0];
  console.log('Согласующий (из настроек):', APPROVER);

  const stamp = Date.now();
  const threadKey = 'defer-mech-' + stamp;
  // Уникальный контрагент — чтобы НИЧЕГО из прошлых прогонов не пересеклось.
  const cp = 'ООО «ДЕФЕР-МЕХ-' + stamp + '»';

  // Чистим только своё (по уникальному маркеру).
  const wipe = async () => {
    await db.query(`DELETE FROM payment_invoices WHERE supplier_name=$1`, [cp]);
    await db.query(`DELETE FROM doc_registry WHERE counterparty_name=$1`, [cp]);
    await db.query(`DELETE FROM doc_approval_grant WHERE thread_key=$1`, [threadKey]);
    await db.query(`DELETE FROM emails WHERE thread_id=$1`, [threadKey]);
  };
  await wipe();

  console.log('=== Шаг 1. Согласующий пишет «Добро», заявки ЕЩЁ НЕТ ===');
  const em = (await db.query(
    `INSERT INTO emails(subject, body_text, from_email, is_crm_copy, message_id, thread_id, created_at)
     VALUES ('Re: счёт','Добро!',$1,true,$2,$3,NOW()) RETURNING id`,
    [APPROVER, `<defer-mech-${stamp}@asgard>`, threadKey])).rows[0];

  let crashed = null; let r1 = null;
  try {
    r1 = await thr.handleApprovalReply(db, {
      id: em.id, from_email: APPROVER, body_text: 'Добро!',
      thread_id: threadKey, in_reply_to: null, references_header: null
    });
  } catch (e) { crashed = e.message; }
  ok(!crashed, 'ответ без заявки не падает');
  console.log('     →', JSON.stringify(r1));
  ok(r1 && (r1.deferred === true || r1.reason), 'решение обработано');

  const g1 = (await db.query(`SELECT id, thread_key, applied_at FROM doc_approval_grant WHERE thread_key=$1`, [threadKey])).rows[0];
  console.log('     согласие:', JSON.stringify(g1 || {}));
  ok(!!g1, 'согласие СОХРАНЕНО (не потеряно)');
  ok(g1 && !g1.applied_at, 'ждёт появления заявки');

  console.log('\n=== Шаг 2. Появляется заявка в том же треде → согласие применяется САМО ===');
  const doc = (await db.query(
    `INSERT INTO doc_registry(dir,package_type,ops_status,pay_status,invoice_number,invoice_date,
       counterparty_name,amount_gross,amount_net,vat_amount,has_vat,wh_status,parsed_json)
     VALUES ('in','invoice','wait_sf','wait',$1,CURRENT_DATE,$2,5000,4166.67,833.33,true,'none','[]'::jsonb)
     RETURNING id`, ['MECH-' + stamp, cp])).rows[0];
  const pay = (await db.query(
    `INSERT INTO payment_invoices(status,payment_status,supplier_name,amount,requires_payment,created_by,
       pay_timing,doc_registry_id,source_email_id)
     VALUES ('awaiting_dir','awaiting_dir',$1,5000,true,3474,'immediate',$2,$3) RETURNING id`,
    [cp, doc.id, em.id])).rows[0];
  console.log('     заявка:', pay.id, '| документ:', doc.id);

  const r2 = await thr.applyPendingGrants(db, { paymentId: pay.id, sourceEmailId: em.id, threadKey });
  console.log('     applyPendingGrants:', JSON.stringify(r2));

  const after = (await db.query(`SELECT id, status, payment_status, dir_approved_by FROM payment_invoices WHERE id=$1`, [pay.id])).rows[0];
  const g2 = (await db.query(`SELECT id, applied_at, applied_ids FROM doc_approval_grant WHERE thread_key=$1`, [threadKey])).rows[0];
  console.log('     статус заявки:', after.status, '| согласие:', g2 ? g2.applied_at : null);
  ok(after.status === 'pending_payment', 'заявка САМА согласована (pending_payment), получили ' + after.status);
  ok(!!(g2 && g2.applied_at), 'согласие помечено применённым');
  ok(!!(g2 && Array.isArray(g2.applied_ids) && g2.applied_ids.includes(pay.id)), 'в applied_ids указана наша заявка');

  console.log('\n=== Шаг 3. Повторное «Добро» — идемпотентность ===');
  const before = after.status;
  await thr.applyPendingGrants(db, { paymentId: pay.id, sourceEmailId: em.id, threadKey });
  const again = (await db.query(`SELECT status FROM payment_invoices WHERE id=$1`, [pay.id])).rows[0];
  ok(again.status === before, 'повтор не сломал статус: ' + again.status);

  console.log('\n=== Шаг 4. Отказ НЕ сохраняется как согласие ===');
  const thrKey2 = threadKey + '-rej';
  const em2 = (await db.query(
    `INSERT INTO emails(subject,body_text,from_email,is_crm_copy,message_id,thread_id,created_at)
     VALUES ('Re: счёт','нет, не оплачивайте пока',$1,true,$2,$3,NOW()) RETURNING id`,
    [APPROVER, `<defer-rej-${stamp}@asgard>`, thrKey2])).rows[0];
  await thr.handleApprovalReply(db, {
    id: em2.id, from_email: APPROVER, body_text: 'нет, не оплачивайте пока',
    thread_id: thrKey2, in_reply_to: null, references_header: null
  });
  const g4 = (await db.query(`SELECT count(*)::int n FROM doc_approval_grant WHERE thread_key=$1`, [thrKey2])).rows[0].n;
  ok(g4 === 0, 'отказ НЕ сохранён как согласие (по этому треду: ' + g4 + ')');

  console.log('\n=== Шаг 5. Посторонний не может сохранить согласие ===');
  const thrKey3 = threadKey + '-alien';
  const em3 = (await db.query(
    `INSERT INTO emails(subject,body_text,from_email,is_crm_copy,message_id,thread_id,created_at)
     VALUES ('Re: счёт','Добро',$1,true,$2,$3,NOW()) RETURNING id`,
    ['chuzhoy@example.com', `<defer-alien-${stamp}@asgard>`, thrKey3])).rows[0];
  const r5 = await thr.handleApprovalReply(db, {
    id: em3.id, from_email: 'chuzhoy@example.com', body_text: 'Добро',
    thread_id: thrKey3, in_reply_to: null, references_header: null
  });
  ok(r5.reason === 'sender_not_approver', 'посторонний отклонён: ' + r5.reason);
  const g5 = (await db.query(`SELECT count(*)::int n FROM doc_approval_grant WHERE thread_key=$1`, [thrKey3])).rows[0].n;
  ok(g5 === 0, 'согласие постороннего не сохранено');

  // уборка — только своё
  await db.query(`DELETE FROM doc_approval_grant WHERE thread_key LIKE $1`, [threadKey + '%']);
  await db.query(`DELETE FROM emails WHERE id = ANY($1::int[])`, [[em.id, em2.id, em3.id]]);
  await wipe();
  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
