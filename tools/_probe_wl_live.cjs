'use strict';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
const th = require('../src/services/approval-thread');
const det = require('../src/services/approval-detector');

(async () => {
  // ensure approver allowlist sane: approverId fallback 3456 email + setting
  const aid = await th.approverId(db);
  const u = (await db.query(`SELECT email FROM users WHERE id=$1`, [aid])).rows[0];
  const allowed = await th.approverEmails(db);
  console.log('approverId=', aid, 'user.email=', u && u.email, 'allowed=', JSON.stringify(allowed));
  const realSender = (allowed[0] || 'go@asgard-service.com');

  const tag = Date.now() % 1000000;
  const srcMsg = `newbypass-${tag}@asgard-service.com`;
  const em = (await db.query(
    `INSERT INTO emails(account_id, direction, message_id, thread_id, from_email, subject, body_text, is_crm_copy, email_date, synced_at)
     VALUES (112,'inbound',$1,$2,'crm@asgard-service.com','Счёт на согласование','СЧЁТ № 1',true,NOW(),NOW()) RETURNING id`, [srcMsg, srcMsg])).rows[0];
  const mkPay = async (lbl) => (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, requires_payment, created_by, pay_timing, source_email_id, source_thread_key)
     VALUES ('awaiting_dir','awaiting_dir',$1,1000,true,1,'immediate',$2,$3) RETURNING id`, [lbl, em.id, srcMsg])).rows[0].id;

  const run = async (label, body, from) => {
    const pid = await mkPay(label.slice(0, 20));
    const r = await th.handleApprovalReply(db, { id: 0, thread_id: srcMsg, in_reply_to: `<${srcMsg}>`, references_header: `<${srcMsg}>`, body_text: body, from_email: from || realSender });
    const st = (await db.query(`SELECT status FROM payment_invoices WHERE id=$1`, [pid])).rows[0].status;
    const leak = (r.applied > 0 || st === 'pending_payment');
    console.log(`${leak ? 'LEAK  ' : 'ok    '} ${label.padEnd(38)} appr=${det.detectApproval(body).approve} applied=${r.applied} status=${st} reason=${r.reason || r.action}`);
    await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [pid]);
    return leak;
  };

  console.log('\n=== NEW BYPASSES live (from real approver, negative intent) ===');
  await run('Добро ❌', 'Добро ❌');
  await run('Добро 🚫', 'Добро 🚫');
  await run('🚫 Добро', '🚫 Добро');
  await run('Добро\\n--\\nпозже', 'Добро\n--\nпозже');
  await run('Добро\\n--\\nстоп', 'Добро\n--\nстоп');
  await run('Добро\\n--\\nне сейчас', 'Добро\n--\nне сейчас');
  await run('Добро\\n--\\nот<ZWSP>мена', 'Добро\n--\nот\u200bмена');
  await run('Добро\\n--\\nподожди', 'Добро\n--\nподожди');
  await run('Добро\\n___\\nНе платите', 'Добро\n___\nНе платите');

  console.log('\n=== REQUIRED: previous 12 bypasses live (3 samples) ===');
  await run('Добро. Не оплачивайте.', 'Добро. Не оплачивайте.');
  await run('Согласовано. Однако не платите.', 'Согласовано. Однако не платите.');
  await run('Добро. Приостановите оплату.', 'Добро. Приостановите оплату.');

  console.log('\n=== REQUIRED: positives live ===');
  await run('Добро (POSITIVE expect applied>0)', 'Добро');
  await run('Согласовано, оплачивайте (POS)', 'Согласовано, оплачивайте');

  console.log('\n=== REQUIRED: address spoof live ===');
  await run('ext evil-suffix (expect sender_not_approver)', 'Добро', 'go@asgard-service.com.evil.ru');
  await run('ext double-@ (expect refuse)', 'Добро', 'go@asgard-service.com@evil.ru');
  await run('display-name real (POS)', 'Добро', 'Олег Гажилиев <' + realSender + '>');

  await db.query(`DELETE FROM emails WHERE id=$1`, [em.id]);
  await db.end();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
