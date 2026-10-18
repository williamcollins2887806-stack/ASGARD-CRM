const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
const det = require('../src/services/approval-detector');
const th = require('../src/services/approval-thread');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  console.log('\n=== 1. Все обходы трёх кругов верификатора ===');
  const bypasses = [
    'Пока не оплачивайте', 'Не оплачивайте пока', 'Я не даю добро', 'Добро, но не оплачивайте',
    'Добро. Не оплачивайте.', 'Утверждено. Не перечисляйте деньги.', 'Одобряю. Правда, платить пока не нужно.',
    'Согласен. Оплату заморозьте.', 'Добро. Приостановите оплату.', 'Согласовано. Не производите оплату.',
    'Согласовано. Однако не платите.', 'Утверждаю. Деньги не переводить.', 'Добро. Пока не платите.',
    'Добро. Не платите.', 'Согласовано. деньги не отправлять', 'Добро. платить не надо',
    'Добро\nно\nпотом', 'Добро\n--\nНе оплачивайте', 'Добро\n--\nзаморозьте', 'Не согласовано',
    'Отклоняю', 'против', 'на доработку', 'Оплачивайте позже', 'Отложить оплату'
  ];
  let leak = 0;
  for (const b of bypasses) if (det.detectApproval(b).approve) { leak++; console.log('    УТЕЧКА:', JSON.stringify(b)); }
  (leak === 0) ? ok(`все ${bypasses.length} обходов → не согласие`) : bad(`${leak} прошли`);

  console.log('\n=== 2. Положительные живы (не сломали продукт) ===');
  const pos = ['Добро', 'Добро!', 'добро', 'ДОБРО', 'Да, добро', 'Согласовано', 'Согласовано, оплачивайте',
    'Утверждаю', 'Одобряю', 'Оплачивайте', 'Подтверждаю', 'Даю добро', 'ок', 'Оплачивай', 'Добро, оплачивай', 'Да, можно оплатить'];
  let okPos = 0;
  for (const p of pos) { if (det.detectApproval(p).approve) okPos++; else console.log('    не согласие:', JSON.stringify(p), '→', JSON.stringify(det.detectApproval(p))); }
  (okPos === pos.length) ? ok(`все ${pos.length} положительных → согласие`) : bad(`${okPos}/${pos.length}`);

  console.log('\n=== 3. Цена fail-closed: разумные ответы → ручное ===');
  const manual = ['Хорошо, платим', 'Согласен на оплату', 'Оплачивай', 'Утверждаю оплату', 'Да, можно оплатить', 'Добро, спасибо!', 'Принято'];
  for (const m of manual) { const r = det.detectApproval(m); console.log(`    «${m}» → ${r.approve ? 'СОГЛАСИЕ' : 'ручное (' + (r.reason || r.unknown || '') + ')'}`); }

  console.log('\n=== 4. Подделка адреса ===');
  const bad1 = th.extractEmail('go@asgard-service.com@evil.ru');
  const bad2 = th.extractEmail('go@asgard-service.com.');
  (bad1 === '' && bad2 === '') ? ok('невалидные → пусто') : bad(`@1='${bad1}' @2='${bad2}'`);
  const g = th.extractEmail('Олег Гажилиев <go@asgard-service.com>');
  (g === 'go@asgard-service.com') ? ok('display-name разобран') : bad('display-name: ' + g);

  console.log('\n=== 5. Живой сквозной + fail-closed ===');
  const tag = Date.now() % 100000;
  const srcMsg = `cert-${tag}@asgard-service.com`;
  const em = (await db.query(
    `INSERT INTO emails(account_id, direction, message_id, thread_id, from_email, subject, body_text, is_crm_copy, email_date, synced_at)
     VALUES (112,'inbound',$1,$2,'crm@asgard-service.com','S','body',true,NOW(),NOW()) RETURNING id`, [srcMsg, srcMsg])).rows[0];
  const mk = async () => (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, requires_payment, created_by, pay_timing, source_email_id, source_thread_key)
     VALUES ('awaiting_dir','awaiting_dir','CERT', 1000, true, 1, 'immediate', $1, $2) RETURNING id`, [em.id, srcMsg])).rows[0].id;
  const p1 = await mk();
  const e1 = await th.handleApprovalReply(db, { id: 0, thread_id: srcMsg, in_reply_to: `<${srcMsg}>`, references_header: `<${srcMsg}>`, body_text: 'Добро. Не оплачивайте.', from_email: 'go@asgard-service.com' });
  const s1 = (await db.query(`SELECT status FROM payment_invoices WHERE id=$1`, [p1])).rows[0];
  (e1.applied === 0 && s1.status === 'awaiting_dir') ? ok('негатив не согласовал (живой)') : bad('ЭКСПЛОЙТ: ' + JSON.stringify(e1));
  const p2 = await mk();
  const e2 = await th.handleApprovalReply(db, { id: 0, thread_id: srcMsg, in_reply_to: `<${srcMsg}>`, references_header: `<${srcMsg}>`, body_text: 'Добро', from_email: 'go@asgard-service.com' });
  const s2 = (await db.query(`SELECT status FROM payment_invoices WHERE id=$1`, [p2])).rows[0];
  (e2.applied >= 1 && s2.status === 'pending_payment') ? ok('«Добро» согласовало (живой)') : bad('норма: ' + JSON.stringify(e2));
  const p3 = await mk();
  const e3 = await th.handleApprovalReply(db, { id: 0, thread_id: srcMsg, in_reply_to: `<${srcMsg}>`, references_header: `<${srcMsg}>`, body_text: 'Добро', from_email: 'go@asgard-service.com.evil.ru' });
  (e3.reason === 'sender_not_approver' && e3.applied === 0) ? ok('чужой домен отклонён (живой)') : bad('чужой домен: ' + JSON.stringify(e3));

  await db.query(`DELETE FROM payment_invoices WHERE id IN ($1,$2,$3)`, [p1, p2, p3]);
  await db.query(`DELETE FROM emails WHERE id=$1`, [em.id]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ сертификации whitelist: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
