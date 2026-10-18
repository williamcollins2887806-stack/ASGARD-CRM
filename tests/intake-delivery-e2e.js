/**
 * Проверки заказчика 18.10.2026 (живой тест):
 *  A) ФАЙЛ счёта прикреплён к заявке → бухгалтерия и директор его скачают.
 *  B) Бухгалтерия видит заявку в своей очереди с нужными полями.
 *  C) ГОНКА: согласующий ответил «Добро» РАНЬШЕ, чем создалась заявка —
 *     система не должна сломаться и должна согласовать, когда заявка появится.
 *
 * ВАЖНО (исправлено 18.10.2026): тест РАНЬШЕ правил РЕАЛЬНУЮ строку реестра
 * (переименовывал `invoice_number` у id=429 и потом удалял её). Так делать нельзя:
 * тест обязан создавать СВОИ данные и убирать только их. Здесь всё изолировано.
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
require('dotenv').config();
process.env.OPENAI_URL = 'https://routerai.ru/api/v1/chat/completions';
const { Client } = require('pg');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await c.connect();

  // Создаём СВОЁ письмо и СВОЁ вложение (копия файла), чтобы не трогать реальные.
  const fs = require('fs');
  const path = require('path');
  const base = path.resolve(process.env.UPLOAD_DIR || './uploads');
  const src = (await c.query(`SELECT file_path, filename, mime_type FROM email_attachments WHERE email_id=5317`)).rows[0];
  const srcDisk = path.join(base, String(src.file_path).replace(/^\/?uploads\//, ''));
  const mine = 'uploads/mail/e2e-delivery-' + Date.now() + '.pdf';
  fs.copyFileSync(srcDisk, path.join(base, mine.replace(/^uploads\//, '')));

  const mail = (await c.query(
    `INSERT INTO emails(subject, body_text, body_html, from_email, is_crm_copy, message_id, thread_id, created_at)
     VALUES ($1,$2,$3,$4,true,$5,$6,NOW()) RETURNING id`,
    ['Fwd: МЛСП, Замена факельного оголовка: счет от WILDBERRIES',
      'Добрый день! Прошу согласовать и оплатить счет за закупку позиций для МЛСП, Замена факельного оголовка.',
      null, 'n.androsov@asgard-service.com', '<e2e-del-' + Date.now() + '@asgard>', 'e2e-del-thr-' + Date.now()])).rows[0];
  const att = (await c.query(
    `INSERT INTO email_attachments(email_id, filename, mime_type, file_path, is_inline)
     VALUES ($1,$2,'application/pdf',$3,false) RETURNING id`, [mail.id, src.filename, mine])).rows[0];

  const cleanup = async () => {
    const pays = await c.query(`DELETE FROM payment_invoices WHERE source_email_id=$1 RETURNING id`, [mail.id]);
    await c.query(`DELETE FROM doc_email_intake WHERE email_id=$1`, [mail.id]);
    await c.query(`DELETE FROM email_attachments WHERE email_id=$1`, [mail.id]);
    await c.query(`DELETE FROM emails WHERE id=$1`, [mail.id]);
    try { fs.unlinkSync(path.join(base, mine.replace(/^uploads\//, ''))); } catch (_) {}
    return pays.rowCount;
  };

  console.log('=== A. Файл счёта прикрепляется к заявке ===');
  const imap = require('../src/services/imap');
  const t0 = Date.now();
  const r = await imap.runDocIntakeForEmail(c, mail.id);
  const took = Date.now() - t0;
  const res = (r.results || [])[0] || {};
  const payId = res.payment_invoice_id;
  console.log(`  заявка ${payId} создана за ${took} мс`);
  ok(!!payId, 'заявка создана из письма');

  const pay = (await c.query(`SELECT file_path, file_name, status, created_by FROM payment_invoices WHERE id=$1`, [payId])).rows[0];
  console.log('  file_path:', pay && pay.file_path);
  ok(!!(pay && pay.file_path), 'в заявке есть путь к файлу счёта');
  ok(!!(pay && pay.file_name), 'в заявке есть имя файла');
  const disk = path.join(base, String(pay.file_path || '').replace(/^\/?uploads\//, ''));
  ok(fs.existsSync(disk), 'файл реально на диске (' + (fs.existsSync(disk) ? fs.statSync(disk).size + ' байт' : '-') + ')');

  console.log('\n=== B. Бухгалтерия видит заявку после согласования ===');
  await c.query(`UPDATE payment_invoices SET status='pending_payment', payment_status='pending_payment' WHERE id=$1`, [payId]);
  const buh = await login('test_buh', 'Test123!');
  const pb = await (await fetch(BASE + '/api/approval/pending-buh', { headers: { Authorization: 'Bearer ' + buh } })).json();
  const inQ = (pb.items || []).find((x) => x.entity_type === 'payment_invoices' && Number(x.id) === payId);
  ok(!!inQ, 'заявка в очереди бухгалтерии');
  if (inQ) {
    ok(!!inQ.invoice_number, '№ счёта: ' + inQ.invoice_number);
    ok(!!inQ.initiator_name, 'от кого счёт: ' + inQ.initiator_name);
    ok(!!inQ.supplier_name, 'контрагент: ' + inQ.supplier_name);
  }

  console.log('\n=== C. «Добро» РАНЬШЕ заявки — не ломает систему ===');
  // ВАЖНО: thread_id читаем ДО cleanup (cleanup удаляет письмо).
  const thrKey = (await c.query(`SELECT thread_id FROM emails WHERE id=$1`, [mail.id])).rows[0].thread_id;
  await cleanup();
  await c.query(`DELETE FROM doc_approval_grant WHERE thread_key=$1`, [thrKey]);
  const thr = require('../src/services/approval-thread');

  let crashed = null; let r1 = null;
  try {
    r1 = await thr.handleApprovalReply(c, {
      id: mail.id, from_email: 'andr0sov.nikita@yandex.ru', body_text: 'Добро',
      thread_id: thrKey, in_reply_to: null, references_header: null
    });
  } catch (e) { crashed = e.message; }
  ok(!crashed, 'ответ без заявки не падает');
  console.log('  →', JSON.stringify(r1));
  ok(r1 && (r1.deferred === true || r1.reason), 'решение обработано: ' + (r1 && (r1.reason || r1.action)));

  // Второе письмо в ТОМ ЖЕ треде со счётом → заявка → согласие должно примениться.
  const mail2 = (await c.query(
    `INSERT INTO emails(subject, body_text, from_email, is_crm_copy, message_id, thread_id, created_at)
     VALUES ($1,$2,$3,true,$4,$5,NOW()) RETURNING id`,
    ['Fwd: МЛСП, Замена факельного оголовка: счет от WILDBERRIES',
      'Прошу согласовать и оплатить счет для МЛСП, Замена факельного оголовка.',
      'n.androsov@asgard-service.com', '<e2e-del2-' + Date.now() + '@asgard>', thrKey])).rows[0];
  const mine2 = 'uploads/mail/e2e-delivery2-' + Date.now() + '.pdf';
  fs.copyFileSync(srcDisk, path.join(base, mine2.replace(/^uploads\//, '')));
  const att2 = (await c.query(
    `INSERT INTO email_attachments(email_id, filename, mime_type, file_path, is_inline)
     VALUES ($1,$2,'application/pdf',$3,false) RETURNING id`, [mail2.id, src.filename, mine2])).rows[0];

  const r2 = await imap.runDocIntakeForEmail(c, mail2.id);
  const res2 = (r2.results || [])[0] || {};
  ok(!!res2.payment_invoice_id, 'заявка создана после раннего «Добро»: ' + res2.payment_invoice_id);
  const p2 = res2.payment_invoice_id ? (await c.query(`SELECT status, created_by FROM payment_invoices WHERE id=$1`, [res2.payment_invoice_id])).rows[0] : null;
  console.log('  статус заявки:', p2 && p2.status);
  ok(p2 && p2.status === 'pending_payment', 'заявка САМА согласована (pending_payment)');
  ok(Number(p2 && p2.created_by) === 3474, 'инициатор верный (Андросов): ' + (p2 && p2.created_by));

  // уборка (только своё)
  await c.query(`DELETE FROM payment_invoices WHERE source_email_id=$1`, [mail2.id]);
  await c.query(`DELETE FROM doc_email_intake WHERE email_id=$1`, [mail2.id]);
  await c.query(`DELETE FROM email_attachments WHERE email_id=$1`, [mail2.id]);
  await c.query(`DELETE FROM emails WHERE id=$1`, [mail2.id]);
  await c.query(`DELETE FROM doc_approval_grant WHERE thread_key=$1`, [thrKey]);
  try { fs.unlinkSync(path.join(base, mine2.replace(/^uploads\//, ''))); } catch (_) {}
  await cleanup();
  await c.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('CRASH', e.message); process.exit(1); });

async function threadOf(db, emailId) {
  const r = await db.query(`SELECT thread_id FROM emails WHERE id=$1`, [emailId]);
  return r.rows[0] ? r.rows[0].thread_id : null;
}
async function login(l, p) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
  const d = await r.json(); let t = d.token;
  if (d.status === 'need_pin') {
    for (const pin of ['0000', '1234']) {
      const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) });
      const d2 = await r2.json().catch(() => ({})); if (d2.token) { t = d2.token; break; }
    }
  }
  return t;
}

