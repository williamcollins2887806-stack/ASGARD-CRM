/**
 * V406: «Добро» ПРИШЛО РАНЬШЕ заявки (проверка заказчика 18.10.2026).
 * Согласующий отвечает через минуту, а OCR ещё разбирает счёт (~5 с).
 * Система должна: не упасть, сохранить согласие и САМА согласовать заявку,
 * когда она появится.
 *
 * ВАЖНО: тест создаёт СВОИ письма/вложения и убирает только их —
 * реальные строки реестра и письма не трогаем.
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
require('dotenv').config();
process.env.OPENAI_URL = 'https://routerai.ru/api/v1/chat/completions';
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();
  const thr = require('../src/services/approval-thread');
  const imap = require('../src/services/imap');

  // Своё вложение: копия реального счёта в отдельный файл.
  const base = path.resolve(process.env.UPLOAD_DIR || './uploads');
  const src = (await db.query(`SELECT file_path, filename FROM email_attachments WHERE email_id=5317 LIMIT 1`)).rows[0];
  const srcDisk = path.join(base, String(src.file_path).replace(/^\/?uploads\//, ''));
  const stamp = Date.now();
  const threadKey = 'e2e-defer-thr-' + stamp;
  // ВАЖНО: у каждого письма СВОЙ файл, а счёт должен быть УНИКАЛЬНЫМ, иначе intake
  // найдёт документ от прошлых прогонов и пойдёт в ветку «уже существует».
  const uniqInvoice = 'DEF-' + stamp;
  const mkMail = async (suffix) => {
    const mine = `uploads/mail/e2e-defer-${suffix}-${stamp}.pdf`;
    fs.copyFileSync(srcDisk, path.join(base, mine.replace(/^uploads\//, '')));
    const em = (await db.query(
      `INSERT INTO emails(subject, body_text, from_email, is_crm_copy, message_id, thread_id, created_at)
       VALUES ($1,$2,$3,true,$4,$5,NOW()) RETURNING id`,
      [`Fwd: Объект ${uniqInvoice}, Замена факельного оголовка: счет ${uniqInvoice} от 15.07.2026`,
        'Прошу согласовать и оплатить счет за закупку позиций.',
        'n.androsov@asgard-service.com', `<e2e-defer-${suffix}-${stamp}@asgard>`, threadKey])).rows[0];
    const at = (await db.query(
      `INSERT INTO email_attachments(email_id, filename, mime_type, file_path, is_inline)
       VALUES ($1,$2,'application/pdf',$3,false) RETURNING id`, [em.id, src.filename, mine])).rows[0];
    return { em, at, mine };
  };
  const cleanupMail = async (m) => {
    if (!m) return;
    await db.query(`DELETE FROM payment_invoices WHERE source_email_id=$1`, [m.em.id]);
    await db.query(`DELETE FROM doc_email_intake WHERE email_id=$1`, [m.em.id]);
    await db.query(`DELETE FROM email_attachments WHERE email_id=$1`, [m.em.id]);
    await db.query(`DELETE FROM emails WHERE id=$1`, [m.em.id]);
    try { fs.unlinkSync(path.join(base, m.mine.replace(/^uploads\//, ''))); } catch (_) {}
  };

  // Чистим СВОИ прошлые артефакты по этому счёту (кроме реальной строки 429,
  // которая была в реестре до тестов). Иначе антидубль найдёт старую заявку и
  // тест уйдёт в ветку «уже существует».
  const oldDocs = await db.query(`SELECT id FROM doc_registry WHERE invoice_number='881040' AND id <> 429`);
  for (const x of oldDocs.rows) {
    await db.query(`DELETE FROM price_records WHERE doc_registry_id=$1`, [x.id]).catch(() => {});
    await db.query(`DELETE FROM payment_invoices WHERE doc_registry_id=$1`, [x.id]).catch(() => {});
    await db.query(`DELETE FROM doc_email_intake WHERE doc_id=$1`, [x.id]).catch(() => {});
    await db.query(`DELETE FROM doc_registry WHERE id=$1`, [x.id]).catch(() => {});
  }
  await db.query(`DELETE FROM doc_approval_grant`);
  console.log('  (свои прошлые артефакты по счёту 881040 убраны: ' + oldDocs.rowCount + ')');

  console.log('=== Шаг 1. Согласующий отвечает «Добро» ДО создания заявки ===');
  const first = await mkMail('reply');
  let crashed = null; let r1 = null;
  try {
    r1 = await thr.handleApprovalReply(db, {
      id: first.em.id, from_email: 'andr0sov.nikita@yandex.ru', body_text: 'Добро',
      thread_id: threadKey, in_reply_to: null, references_header: null
    });
  } catch (e) { crashed = e.message; }
  ok(!crashed, 'не упало: ' + (crashed || 'ок'));
  console.log('  ответ системы:', JSON.stringify(r1));
  ok(r1 && (r1.deferred === true || r1.applied > 0 || r1.reason), 'решение обработано');

  const g = await db.query(`SELECT id, sender_email, action, applied_at FROM doc_approval_grant WHERE thread_key=$1 ORDER BY id DESC LIMIT 1`, [threadKey]);
  console.log('  сохранённое согласие:', JSON.stringify(g.rows[0] || {}));
  ok(g.rowCount > 0, 'согласие СОХРАНЕНО (не потеряно)');
  ok(g.rows[0] && !g.rows[0].applied_at, 'ждёт появления заявки');

  console.log('\n=== Шаг 2. Появляется заявка в ТОМ ЖЕ треде → согласие применяется само ===');
  const second = await mkMail('invoice');
  const r2 = await imap.runDocIntakeForEmail(db, second.em.id);
  const res2 = (r2.results || [])[0] || {};
  console.log('  заявка:', res2.payment_invoice_id);
  ok(!!res2.payment_invoice_id, 'заявка создана');
  const pay = res2.payment_invoice_id ? (await db.query(`SELECT id, status, created_by, file_path FROM payment_invoices WHERE id=$1`, [res2.payment_invoice_id])).rows[0] : null;
  ok(pay && pay.status === 'pending_payment', 'заявка САМА согласована (pending_payment), получили ' + (pay && pay.status));
  ok(Number(pay && pay.created_by) === 3474, 'инициатор — Андросов: ' + (pay && pay.created_by));
  ok(!!(pay && pay.file_path), 'файл счёта прикреплён к заявке');
  const g2 = await db.query(`SELECT applied_at, applied_ids FROM doc_approval_grant WHERE thread_key=$1`, [threadKey]);
  ok(g2.rows.some((r) => r.applied_at), 'согласие помечено применённым (' + g2.rowCount + ' записей)');

  console.log('\n=== Шаг 3. Повторное «Добро» — идемпотентность ===');
  const r3 = await thr.handleApprovalReply(db, {
    id: second.em.id, from_email: 'andr0sov.nikita@yandex.ru', body_text: 'Добро',
    thread_id: threadKey, in_reply_to: null, references_header: null
  });
  const p3 = (await db.query(`SELECT status FROM payment_invoices WHERE id=$1`, [res2.payment_invoice_id])).rows[0];
  ok(p3 && p3.status === 'pending_payment', 'повтор не сломал статус: ' + (p3 && p3.status));

  console.log('\n=== Шаг 4. «Не оплачивайте» раньше заявки — НЕ сохраняем как согласие ===');
  await db.query(`DELETE FROM doc_approval_grant WHERE thread_key=$1`, [threadKey]);
  const r4 = await thr.handleApprovalReply(db, {
    id: first.em.id, from_email: 'andr0sov.nikita@yandex.ru', body_text: 'нет, не оплачивайте пока',
    thread_id: threadKey, in_reply_to: null, references_header: null
  });
  const g4 = await db.query(`SELECT count(*)::int n FROM doc_approval_grant WHERE thread_key=$1`, [threadKey]);
  ok(g4.rows[0].n === 0, 'отказ НЕ сохранён как согласие (по этому треду: ' + g4.rows[0].n + ')');
  console.log('  ответ:', JSON.stringify(r4 && (r4.reason || r4.action)));

  // уборка — только своё
  await cleanupMail(first);
  await cleanupMail(second);
  await db.query(`DELETE FROM doc_approval_grant WHERE thread_key=$1`, [threadKey]);
  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });

