/**
 * ОТЧЁТ заказчику 18.10.2026: полный прогон «письмо → заявка» с метриками
 * и проверкой: прикрепился ли счёт, заполнилась ли номенклатура, что ушло дальше.
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
require('dotenv').config();
process.env.OPENAI_URL = 'https://routerai.ru/api/v1/chat/completions';
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();
  const base = path.resolve(process.env.UPLOAD_DIR || './uploads');

  // Свои данные (реальные не трогаем).
  const srcRow = (await db.query(`SELECT file_path, filename FROM email_attachments WHERE email_id=5317 LIMIT 1`)).rows[0];
  const srcDisk = path.join(base, String(srcRow.file_path).replace(/^\/?uploads\//, ''));
  const stamp = Date.now();
  const mine = `uploads/mail/report-${stamp}.pdf`;
  fs.copyFileSync(srcDisk, path.join(base, mine.replace(/^uploads\//, '')));
  const em = (await db.query(
    `INSERT INTO emails(subject, body_text, from_email, is_crm_copy, message_id, thread_id, created_at)
     VALUES ($1,$2,$3,true,$4,$5,NOW()) RETURNING id`,
    ['Fwd: МЛСП, Замена факельного оголовка: счет от WILDBERRIES',
      'Добрый день, коллеги! Прошу согласовать и оплатить счет за закупку позиций для МЛСП, Замена факельного оголовка.',
      'n.androsov@asgard-service.com', `<report-${stamp}@asgard>`, `report-thr-${stamp}`])).rows[0];
  const at = (await db.query(
    `INSERT INTO email_attachments(email_id, filename, mime_type, file_path, is_inline)
     VALUES ($1,$2,'application/pdf',$3,false) RETURNING id`, [em.id, srcRow.filename, mine])).rows[0];

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║            ПИСЬМО → ЗАЯВКА: ПОЛНЫЙ ПРОГОН С МЕТРИКАМИ            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const ocr = require('../src/services/pdf-ocr');
  const imap = require('../src/services/imap');
  let ocrMs = 0;
  const orig = ocr.ocrPdfPath;
  ocr.ocrPdfPath = async (...a) => { const s = Date.now(); const r = await orig(...a); ocrMs += Date.now() - s; return r; };

  const t0 = Date.now();
  const r = await imap.runDocIntakeForEmail(db, em.id);
  const total = Date.now() - t0;
  ocr.ocrPdfPath = orig;

  const res = (r.results || [])[0] || {};
  const pay = res.payment_invoice_id ? (await db.query(`SELECT * FROM payment_invoices WHERE id=$1`, [res.payment_invoice_id])).rows[0] : null;
  const doc = res.doc_id ? (await db.query(`SELECT * FROM doc_registry WHERE id=$1`, [res.doc_id])).rows[0] : null;
  const author = pay ? (await db.query(`SELECT name, role FROM users WHERE id=$1`, [pay.created_by])).rows[0] : null;

  console.log('━━━ 1. ВРЕМЯ ОБРАБОТКИ ━━━');
  console.log(`  Всего от письма до заявки : ${(total / 1000).toFixed(1)} с`);
  console.log(`    из них распознавание счёта (OCR/ИИ): ${(ocrMs / 1000).toFixed(1)} с  (${Math.round(ocrMs / total * 100)}%)`);
  console.log(`    разбор + сопоставление + запись   : ${((total - ocrMs) / 1000).toFixed(1)} с`);

  console.log('\n━━━ 2. ЧТО РАСПОЗНАНО ИЗ СЧЁТА ━━━');
  console.log(`  Контрагент       : ${doc.counterparty_name}`);
  console.log(`  ИНН / КПП        : ${doc.counterparty_inn}`);
  console.log(`  № счёта и дата   : ${doc.invoice_number} от ${String(doc.invoice_date).slice(0, 10)}`);
  console.log(`  Сумма (с НДС)    : ${doc.amount_gross} ₽`);
  console.log(`    без НДС        : ${doc.amount_net} ₽`);
  console.log(`    НДС            : ${doc.vat_amount} ₽`);
  console.log(`  Объект (работа)  : ${doc.work_id ? 'привязан #' + doc.work_id : 'НЕ привязан'}`);
  if (doc.work_id) {
    const w = (await db.query(`SELECT work_title FROM works WHERE id=$1`, [doc.work_id])).rows[0];
    console.log(`                     → ${w.work_title.slice(0, 62)}`);
  }
  console.log(`  Договор          : ${doc.contract_label || doc.contract_mode || 'не указан'}`);

  console.log('\n━━━ 3. СЧЁТ ПРИКРЕПЛЁН К ЗАЯВКЕ? ━━━');
  console.log(`  file_path в заявке : ${pay.file_path || '✗ НЕТ'}`);
  console.log(`  file_name          : ${pay.file_name || '✗ НЕТ'}`);
  const disk = pay.file_path ? path.join(base, String(pay.file_path).replace(/^\/?uploads\//, '')) : null;
  const exists = disk && fs.existsSync(disk);
  console.log(`  файл на диске      : ${exists ? '✓ есть, ' + Math.round(fs.statSync(disk).size / 1024) + ' КБ' : '✗ НЕТ'}`);
  console.log(`  скачивание в CRM   : ${pay.file_path ? '✓ /api/payment-invoices/' + pay.id + '/file' : '✗'}`);

  console.log('\n━━━ 4. НОМЕНКЛАТУРА ЗАПОЛНИЛАСЬ? ━━━');
  const pr = await db.query(`SELECT item_name, quantity, unit, unit_price, total, invoice_number, invoice_date
    FROM price_records WHERE doc_registry_id=$1 ORDER BY id`, [res.doc_id]);
  console.log(`  позиций в номенклатуре: ${pr.rowCount}`);
  for (const x of pr.rows) {
    console.log(`    • ${String(x.item_name).slice(0, 48)}`);
    console.log(`      ${x.quantity} ${x.unit || ''} × ${x.unit_price} = ${x.total} ₽ (счёт ${x.invoice_number})`);
  }

  console.log('\n━━━ 5. ЗАЯВКА (ушла директору) ━━━');
  if (pay) {
    console.log(`  № заявки         : ${pay.id}`);
    console.log(`  Статус           : ${pay.status}`);
    console.log(`  Инициатор        : ${pay.created_by} — ${author ? author.name + ' (' + author.role + ')' : '?'}`);
    console.log(`  Контрагент/сумма : ${pay.supplier_name} / ${pay.amount} ₽`);
    console.log(`  № счёта          : ${pay.invoice_number}`);
    console.log(`  Объект из письма : ${pay.work_hint || '—'}`);
    console.log(`  Просьба инициатора: ${pay.initiator_intent || '—'}`);
    console.log(`  Срок оплаты      : ${pay.due_date ? String(pay.due_date).slice(0, 10) : '—'}`);
    console.log(`  TTL согласования : ${pay.approval_expires_at ? String(pay.approval_expires_at).slice(0, 16).replace('T', ' ') : '—'}`);
  } else console.log('  ✗ ЗАЯВКА НЕ СОЗДАНА');

  console.log('\n━━━ 6. СВЯЗИ ━━━');
  console.log(`  реестр → заявка : ${doc.payment_invoice_id ? '✓ связаны' : '✗ нет'}`);
  console.log(`  заявка → файл   : ${pay && pay.file_path ? '✓ есть' : '✗ нет'}`);
  console.log(`  заявка → реестр : ${pay && pay.doc_registry_id ? '✓ есть' : '✗ нет'}`);
  console.log(`  запись intake   : ${res.intake_id ? '✓ #' + res.intake_id : '✗'}`);

  // Оставляем данные для вашей проверки (не убираем — вы будете проверять в UI).
  console.log('\n░░░ ДАННЫЕ ОСТАВЛЕНЫ ДЛЯ ВАШЕЙ ПРОВЕРКИ ░░░');
  console.log(`  заявка #${pay ? pay.id : '-'} · документ #${doc ? doc.id : '-'}`);
  fs.writeFileSync('tests/reports/last-intake-run.json', JSON.stringify({
    email_id: em.id, payment_id: pay && pay.id, doc_id: doc && doc.id,
    total_ms: total, ocr_ms: ocrMs, file: mine
  }, null, 2));
  await db.end();
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
