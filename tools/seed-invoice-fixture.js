'use strict';
/**
 * seed-invoice-fixture.js — готовит счета в очереди директора на dev-БД
 * для проверки раскрытия карточки и превью файла. Только asgard_crm_dev.
 *
 * Создаёт два счёта:
 *   1. с приложенным PDF (проверка вьюера);
 *   2. без файла (проверка честного «файл не приложен»).
 *
 * Запуск: node tools/seed-invoice-fixture.js [--clean]
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MARK = 'FIXTURE-DIR-INVOICE';
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'payment-invoices');

/** Минимальный валидный PDF с текстом — чтобы poppler смог отрендерить страницу. */
function tinyPdf(text) {
  const content = `BT /F1 18 Tf 40 300 Td (${text}) Tj ET`;
  const objs = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 400]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>endobj',
    `4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const o of objs) { offsets.push(pdf.length); pdf += o + '\n'; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += String(off).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

(async () => {
  const clean = process.argv.includes('--clean');
  const c = new Client({ connectionString: 'postgres://asgard:123456789@127.0.0.1:5432/asgard_crm_dev' });
  await c.connect();

  if (clean) {
    const rows = await c.query('SELECT id, file_path FROM payment_invoices WHERE supplier_name LIKE $1', [MARK + '%']);
    for (const r of rows.rows) {
      if (r.file_path) {
        const p = path.join(__dirname, '..', String(r.file_path).replace(/^\//, ''));
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }
    const d = await c.query('DELETE FROM payment_invoices WHERE supplier_name LIKE $1 RETURNING id', [MARK + '%']);
    console.log('удалено счётов-фикстур: ' + d.rowCount);
    await c.end();
    return;
  }

  const author = await c.query("SELECT id, name FROM users WHERE role IN ('PROC','PM') ORDER BY id LIMIT 1");
  const authorId = author.rows[0]?.id || 3463;

  // PDF-файл для первого счёта
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const pdfName = 'fixture-invoice-dir.pdf';
  const pdfPath = path.join(UPLOAD_DIR, pdfName);
  fs.writeFileSync(pdfPath, tinyPdf('ASGARD INVOICE FIXTURE'));

  await c.query('BEGIN');
  try {
    const withFile = await c.query(
      `INSERT INTO payment_invoices
         (supplier_name, amount, currency, status, pay_timing, payment_status, basis_type, basis_text,
          invoice_number, invoice_date, vat_amount, initiator_intent, initiator_note,
          contract_basis_number, contract_missing, work_hint, file_name, file_path, created_by, approval_expires_at)
       VALUES ($1,$2,'RUB','awaiting_dir','immediate','pending','contract','Оплата по договору поставки',
               'FIX-42', CURRENT_DATE, $3, 'urgent', 'Оплатить сегодня, поставщик ждёт',
               'ДГ-2026/117', false, 'Монтаж трубопровода, участок 3',
               $4, $5, $6, NOW() + INTERVAL '60 hours')
       RETURNING id`,
      [MARK + '-WITH-FILE', 128500.00, 21416.67, pdfName, '/uploads/payment-invoices/' + pdfName, authorId]
    );
    const noFile = await c.query(
      `INSERT INTO payment_invoices
         (supplier_name, amount, currency, status, pay_timing, payment_status, basis_type, basis_text,
          initiator_intent, contract_basis_number, contract_missing, work_hint, created_by, approval_expires_at)
       VALUES ($1,$2,'RUB','awaiting_dir','deferred','pending','invoice','Оплата ремонта оборудования',
               'this_week', 'ДГ-2026/220', true, 'Склад, участок 1', $3, NOW() + INTERVAL '30 hours')
       RETURNING id`,
      [MARK + '-NO-FILE', 43210.50, authorId]
    );
    await c.query('COMMIT');
    console.log('с приложенным PDF: #' + withFile.rows[0].id + '  (' + pdfPath + ')');
    console.log('без файла:         #' + noFile.rows[0].id);
    console.log('автор заявки user_id=' + authorId);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('FAIL: ' + e.message);
    await c.end();
    process.exit(1);
  }
  await c.end();
})();
