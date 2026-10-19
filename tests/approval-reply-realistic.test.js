'use strict';
/**
 * Проверка: найдёт ли «Добро» Гажилиева заявку, когда он отвечает на письмо инициатора.
 * Сценарий как в жизни: письмо (forward-цепочка, thread_id ≠ message_id) → заявка
 * awaiting_dir → директор отвечает Reply на ЭТО письмо → должен найти.
 */
const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { handleApprovalReply } = require('../src/services/approval-thread');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  const db = { query: (t, p) => pool.query(t, p), pool, connect: () => pool.connect() };

  // Три варианта письма (как реальные: forward и обычное)
  const cases = [
    { name: 'forward (thread_id ≠ message_id)', msg: '<265111792393570@mail.360.yandex.kz>', thr: '574811792392185@mail.360.yandex.kz', refs: '<574811792392185@mail.360.yandex.kz>' },
    { name: 'обычное (thread_id = message_id)', msg: '<297221792397197@mail.360.yandex.ru>', thr: '297221792397197@mail.360.yandex.ru', refs: null }
  ];

  for (const c of cases) {
    // 1) Письмо-счёт (инициатор → директору, CRM в копии)
    const em = (await db.query(
      `INSERT INTO emails(subject, body_text, from_email, direction, is_deleted, message_id, thread_id, references_header, email_date, created_at)
       VALUES($1,'Прошу согласовать и оплатить',$2,'inbound',false,$3,$4,$5,NOW(),NOW()) RETURNING id`,
      ['Счёт тест', 'bv@asgard-service.com', c.msg, c.thr, c.refs])).rows[0].id;
    // 2) Заявка из него
    const pay = (await db.query(
      `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, requires_payment, created_by, source_email_id, approval_expires_at)
       VALUES('awaiting_dir','awaiting_dir','ООО Тест',1000,true,3467,$1,NOW()+INTERVAL '72 hours') RETURNING id`,
      [em])).rows[0].id;

    // 3) Директор отвечает Reply на письмо
    const reply = {
      id: null,
      from_email: 'Олег Викторович Гажилиев <go@asgard-service.com>',
      body_text: 'Добро!',
      message_id: `<reply-${em}@test>`,
      in_reply_to: c.msg,                    // Reply → in_reply_to = message_id счёта
      references_header: c.refs || c.msg,
      thread_id: c.thr
    };
    const res = await handleApprovalReply(db, reply);
    const after = (await db.query(`SELECT status, dir_approved_by FROM payment_invoices WHERE id=$1`, [pay])).rows[0];

    ok(res.matched >= 1, `${c.name}: заявка найдена (matched=${res.matched})`);
    ok(after.status === 'pending_payment', `${c.name}: ушла бухгалтерии (status=${after.status})`);
    ok(after.dir_approved_by === 3456, `${c.name}: согласовал Гажилиев (by=${after.dir_approved_by})`);

    // откат
    await db.query(`UPDATE payment_invoices SET status='awaiting_dir', payment_status='awaiting_dir', dir_approved_by=NULL, dir_approved_at=NULL WHERE id=$1`, [pay]);
    await db.query(`DELETE FROM doc_approval_grant WHERE email_id=$1 OR thread_key=$2`, [em, c.thr]).catch(() => {});
    await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [pay]);
    await db.query(`DELETE FROM emails WHERE id=$1`, [em]);
  }

  // Негатив: чужой человек не должен согласовать
  const em2 = (await db.query(`INSERT INTO emails(subject, body_text, from_email, direction, is_deleted, message_id, thread_id, email_date, created_at) VALUES('x','Добро!','stranger@evil.test','inbound',false,'<str@test>','str@test',NOW(),NOW()) RETURNING id`)).rows[0].id;
  const pay2 = (await db.query(`INSERT INTO payment_invoices(status,payment_status,supplier_name,amount,requires_payment,created_by,source_email_id) VALUES('awaiting_dir','awaiting_dir','ООО Тест',1000,true,3467,$1) RETURNING id`, [em2])).rows[0].id;
  const bad = await handleApprovalReply(db, { id: null, from_email: 'stranger@evil.test', body_text: 'Добро!', message_id: '<r2@test>', in_reply_to: '<str@test>', thread_id: 'str@test' });
  const pay2After = (await db.query(`SELECT status FROM payment_invoices WHERE id=$1`, [pay2])).rows[0];
  ok(pay2After.status === 'awaiting_dir', 'чужой НЕ согласовал (reason=' + (bad.reason || '-') + ')');
  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [pay2]);
  await db.query(`DELETE FROM emails WHERE id=$1`, [em2]);

  await pool.end();
  console.log('\nИТОГ цепочки «Добро»: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message, e.stack); process.exit(1); });
