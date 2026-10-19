/**
 * Проверка привязки «Добро» к счёту через РАЗРЫВ в треде (вопрос заказчика 19.10.2026):
 *   • директор ответил на счёт, который пришёл вчера, а между ними 10 других писем;
 *   • после счёта была переписка в том же треде, «Добро» пришло в конце.
 * Ищем, найдёт ли система, к какому счёту относится согласие (thread_id / references).
 */
const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { handleApprovalReply } = require('../src/services/approval-thread');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const ROOT = 'thread-root-aaaa@asgard-service.com';
const msg = (n) => `<msg-${n}@asgard-service.com>`;

(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  const db = { query: (t, p) => pool.query(t, p), pool, connect: () => pool.connect() };

  const ap = await db.query(`SELECT value_json FROM settings WHERE key='doc_approver_user_id' LIMIT 1`);
  const apId = ap.rows[0] ? JSON.parse(ap.rows[0].value_json) : 3456;
  const apUser = (await db.query(`SELECT email FROM users WHERE id=$1`, [apId])).rows[0];
  const approverEmail = (apUser && apUser.email) || 'go@asgard-service.com';
  console.log('  согласующий:', approverEmail, '(id ' + apId + ')');

  // 1) Письмо-счёт (вчера), корень треда = ROOT.
  const inv = (await db.query(
    `INSERT INTO emails(subject, body_text, from_email, direction, is_deleted, message_id, thread_id, references_header, email_date, created_at)
     VALUES($1,$2,$3,'inbound',false,$4,$5,$6, NOW() - INTERVAL '1 day', NOW()) RETURNING id`,
    ['МЛСП: счёт от БАШПРОМ', 'Прошу согласовать и оплатить', 'bv@asgard-service.com',
      msg(1), ROOT, msg(1)])).rows[0].id;
  const pay = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, requires_payment, created_by, source_email_id, invoice_number)
     VALUES('awaiting_dir','awaiting_dir','ООО БАШПРОМ',601456,true,$1,$2,'BP-7784') RETURNING id`,
    [apId, inv])).rows[0].id;

  // 2) ДЕСЯТЬ писем между счётом и «Добро» — в том же треде.
  const betweenIds = [];
  for (let i = 2; i <= 11; i++) {
    const r = (await db.query(
      `INSERT INTO emails(subject, body_text, from_email, direction, is_deleted, message_id, in_reply_to, thread_id, references_header, email_date, created_at)
       VALUES($1,$2,$3,'inbound',false,$4,$5,$6,$7,NOW(),NOW()) RETURNING id`,
      ['Re: МЛСП: счёт от БАШПРОМ', 'Уточнение по позиции ' + i, 'bv@asgard-service.com',
        msg(i), msg(i - 1), ROOT, msg(1) + ' ' + msg(i - 1)])).rows[0].id;
    betweenIds.push(r);
  }

  // 3) «Добро» директора — в КОНЦЕ переписки.
  const appr = (await db.query(
    `INSERT INTO emails(subject, body_text, from_email, direction, is_deleted, message_id, in_reply_to, thread_id, references_header, email_date, created_at)
     VALUES($1,$2,$3,'inbound',false,$4,$5,$6,$7,NOW(),NOW()) RETURNING id`,
    ['Re: МЛСП: счёт от БАШПРОМ', 'Добро!', approverEmail,
      msg(12), msg(11), ROOT, msg(1) + ' ' + msg(11)])).rows[0].id;
  const apprRow = (await db.query(`SELECT * FROM emails WHERE id=$1`, [appr])).rows[0];

  const res = await handleApprovalReply(db, apprRow);
  console.log('  результат:', JSON.stringify(res));

  const after = (await db.query(`SELECT status, dir_approved_by, dir_approved_at FROM payment_invoices WHERE id=$1`, [pay])).rows[0];
  ok(res.action === 'approve', 'действие распознано как approve (' + res.action + ')');
  ok(res.matched >= 1, 'заявка найдена по треду сквозь 10 сообщений (matched=' + res.matched + ')');
  ok(after.status === 'pending_payment', 'счёт согласован → у бухгалтерии (status=' + after.status + ')');
  ok(res.applied === 1, 'решение применено к 1 заявке (applied=' + res.applied + ')');

  // Чистка.
  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [pay]);
  for (const id of [inv, appr, ...betweenIds]) await db.query(`DELETE FROM emails WHERE id=$1`, [id]).catch(() => {});
  await pool.end();
  console.log('\nИТОГ разрыва треда: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message, e.stack); process.exit(1); });
