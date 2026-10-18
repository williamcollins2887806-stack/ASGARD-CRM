/**
 * Сквозной контур заказчика 18.10.2026 (вечерний живой тест):
 *   письмо от сотрудника (РП Андросов) + CRM в копии
 *     → intake → заявка с инициатором = АВТОРОМ письма
 *     → объект/договор/срок разобраны
 *     → согласование приходит с внешнего адреса согласующего (замена на тесты).
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { Client } = require('pg');
const { intakeOne } = require('../src/services/doc-email-intake');
const { handleApprovalReply } = require('../src/services/approval-thread');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const INVOICE = `Счёт на оплату № 4242 от 15.10.2026
Поставщик: ООО «ПРОМСНАБ»
ИНН 7707083893 КПП 770701001
Основание: Договор № ПС-18/2026 от 01.03.2026
Объект: Выполнение СМР по замене оголовка
Оплата до 25.10.2026
1. Насос центробежный 1 шт x 120 000,00 = 120 000,00
Итого к оплате: 120 000,00 руб.
НДС 20%: 20 000,00`;

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();
  if (!process.env.TEST_BASE_URL) console.log('(проверяем сервисный уровень, без HTTP)\n');

  console.log('=== Шаг 1. Письмо от РП Андросова (CRM в копии) ===');
  const em = (await db.query(
    `INSERT INTO emails(subject, body_text, from_email, is_crm_copy, message_id, created_at)
     VALUES($1,$2,$3,true,$4,NOW()) RETURNING id`,
    ['Счёт на оплату ПРОМСНАБ', 'Настя, оплати до 25.10, объект по оголовку', 'n.androsov@asgard-service.com', '<e2e-' + Date.now() + '@asgard>'])).rows[0];
  const att = (await db.query(
    `INSERT INTO email_attachments(email_id, filename, mime_type, file_path, is_inline)
     VALUES($1,$2,$3,$4,false) RETURNING id`,
    [em.id, 'inv.pdf', 'application/pdf', '/uploads/tmp/t.pdf'])).rows[0];

  const res = await intakeOne(db, {
    email: { id: em.id, body_text: 'Настя, оплати до 25.10, объект по оголовку' },
    attachment: { id: att.id }, text: INVOICE, userId: null
  });
  console.log('  intake:', JSON.stringify({ status: res.status, doc: res.doc_id, pay: res.payment_invoice_id }));

  const pay = (await db.query(`SELECT * FROM payment_invoices WHERE id=$1`, [res.payment_invoice_id])).rows[0];
  const doc = (await db.query(`SELECT * FROM doc_registry WHERE id=$1`, [res.doc_id])).rows[0];
  const author = (await db.query(`SELECT id, name, role FROM users WHERE id=$1`, [pay.created_by])).rows[0];

  ok(res.payment_invoice_id > 0, 'заявка создана');
  ok(Number(pay.created_by) === 3474, 'инициатор = АВТОР письма (Андросов, 3474), получили ' + pay.created_by);
  ok(author && /Андросов/.test(author.name), 'в заявке автор: ' + (author && author.name));
  ok(Number(doc.doc_owner_id) === 3474, 'ответственный за документ = Андросов, получили ' + doc.doc_owner_id);
  ok(!!doc.work_id, 'объект привязан из подсказки в счёте: work_id=' + doc.work_id);
  ok(doc.contract_label === 'ПС-18/2026' || Number(doc.contract_id) > 0, 'договор-основание: ' + (doc.contract_label || doc.contract_id));
  ok(pay.initiator_intent === 'explicit_date', 'срок из письма разобран: ' + pay.initiator_intent);
  ok(String(pay.invoice_number) === '4242', 'номер счёта в заявке: ' + pay.invoice_number);
  ok(Number(doc.amount_gross) === 120000, 'сумма: ' + doc.amount_gross);

  console.log('\n=== Шаг 2. Согласование с внешнего адреса согласующего ===');
  const r1 = await handleApprovalReply(db, {
    id: 999999, from_email: 'Андросов Никита <andr0sov.nikita@yandex.ru>',
    body_text: 'Добро', thread_id: null, in_reply_to: null, references_header: null
  });
  console.log('  «Добро» с Яндекс-адреса:', JSON.stringify({ action: r1.action, reason: r1.reason }));
  ok(r1.reason !== 'sender_not_approver', 'согласующий ПРИЗНАН (не отклонён по отправителю): ' + r1.reason);

  const r2 = await handleApprovalReply(db, { id: 999998, from_email: 'postoronniy@example.com', body_text: 'Добро' });
  ok(r2.reason === 'sender_not_approver', 'посторонний отклонён: ' + r2.reason);

  const r3 = await handleApprovalReply(db, { id: 999997, from_email: 'andr0sov.nikita@yandex.ru', body_text: 'нет, не оплачивайте пока' });
  ok(r3.action === 'none', '«не оплачивайте» НЕ считается согласием: ' + r3.reason);

  // уборка
  await db.query(`DELETE FROM price_records WHERE doc_registry_id=$1`, [res.doc_id]).catch(() => {});
  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [res.payment_invoice_id]).catch(() => {});
  await db.query(`DELETE FROM doc_email_intake WHERE doc_id=$1`, [res.doc_id]).catch(() => {});
  await db.query(`DELETE FROM doc_registry WHERE id=$1`, [res.doc_id]).catch(() => {});
  await db.query(`DELETE FROM email_attachments WHERE email_id=$1`, [em.id]).catch(() => {});
  await db.query(`DELETE FROM emails WHERE id=$1`, [em.id]).catch(() => {});
  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('CRASH', e.message); try { await db.end(); } catch (_) {} process.exit(1); });
