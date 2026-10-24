/**
 * D-337: разбор зависших счетов через intakeOne (штатный путь) после фикса.
 * Запуск: node tools/reparse_stuck_intake.js [--apply] [email_id...]
 */
const ROOT = '/var/www/asgard-crm';
const path = require('path');
const fs = require('fs');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const db = { query: (s, p) => c.query(s, p) };

  console.log(`режим: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}`);

  // D-337: берём ВСЕ PDF без записи в intake за месяц. Классификатор сам решит,
  // счёт это или договор/чертёж — «не счёт» попадёт в журнал как rejected.
  // Фильтр по имени файла ненадёжен: у счёта 276 номер был только в теме письма.
  const lost = (await c.query(`
      SELECT e.id email_id, e.subject, e.email_date, e.from_email,
             a.id att_id, a.filename, a.original_filename, a.mime_type, a.file_path
        FROM emails e JOIN email_attachments a ON a.email_id = e.id
       WHERE e.email_date > NOW() - INTERVAL '31 days'
         AND a.mime_type = 'application/pdf'
         AND NOT EXISTS (SELECT 1 FROM doc_email_intake i WHERE i.attachment_id = a.id)
       ORDER BY e.email_date`)).rows;

  console.log(`\n=== потерянных счётов-вложений: ${lost.length} ===`);
  for (const r of lost)
    console.log(` email#${r.email_id} att#${r.att_id} ${String(r.email_date).slice(0,10)} "${String(r.filename).slice(0,50)}"`);

  if (!APPLY) {
    console.log('\n(dry-run) для применения: --apply');
    await c.end();
    return;
  }

  const intake = require(ROOT + '/src/services/doc-email-intake.js');

  for (const r of lost) {
    console.log(`\n--- разбираю email#${r.email_id} / ${r.filename} ---`);
    try {
      // текст: сначала текстовый слой, затем vision (как в штатном пути)
      const rel = String(r.file_path || '').replace(/^\/?uploads\//i, '');
      const full = path.isAbsolute(String(r.file_path)) ? String(r.file_path) : path.join(ROOT, 'uploads', rel);
      if (!fs.existsSync(full)) { console.log('  файла нет на диске'); continue; }

      const ocr = require(ROOT + '/src/services/pdf-ocr.js');
      const res = await ocr.ocrPdfPath(full, r.filename);
      const text = String(res.text || '');
      console.log(`  текст: ${text.length} символов (${res.diagnostics && res.diagnostics.source || 'vision'})`);
      if (text.trim().length < 20) { console.log('  ПУСТО — пропускаю'); continue; }

      const email = (await c.query(`SELECT id, body_text, body_html, subject, from_email FROM emails WHERE id=$1`, [r.email_id])).rows[0];
      const att = (await c.query(`SELECT id, filename, mime_type, file_path FROM email_attachments WHERE id=$1`, [r.att_id])).rows[0];

      const out = await intake.intakeOne(db, { email, attachment: att, text, userId: null });
      console.log('  результат:', JSON.stringify({
        status: out.status, doc_id: out.doc_id, payment_invoice_id: out.payment_invoice_id,
        kind: out.kind, needs_manual: out.status === 'needs_manual'
      }));
    } catch (e) {
      console.log('  ERR:', e.message);
    }
  }
  await c.end();
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
