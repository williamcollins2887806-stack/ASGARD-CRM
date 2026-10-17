require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
const intake = require('../src/services/doc-email-intake');
const ocr = require('../src/services/pdf-ocr');
const PDFTOTEXT = 'C:\\Users\\Nikita-ASGARD\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin\\pdftotext.exe';
const dir = path.join(__dirname, 'fixtures', 'real-invoices');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  if (!process.env.OPENAI_API_KEY) { console.log('Нет OPENAI_API_KEY — тест пропущен'); process.exit(0); }
  const me = (await db.query(`SELECT id FROM users WHERE login='test_admin'`)).rows[0].id;
  const tag = Date.now() % 100000;
  // Только СКАНЫ (пустой текст-слой).
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  const scans = [];
  for (const f of files) {
    let t = '';
    try { t = execFileSync(PDFTOTEXT, ['-layout', path.join(dir, f), '-'], { encoding: 'utf8', maxBuffer: 32e6, timeout: 20000 }); } catch (_) {}
    if (t.trim().length < 50) scans.push(f);
  }
  console.log(`\nСканов для OCR-конвейера: ${scans.length}`);
  const docs = []; const pays = [];
  let created = 0, manual = 0, ocrFail = 0;
  for (let i = 0; i < scans.length; i++) {
    const f = scans[i];
    let text = '';
    try { const res = await ocr.ocrPdfPath(path.join(dir, f), f, { maxPages: 2 }); text = (res && res.text) || ''; }
    catch (e) { ocrFail++; console.log(`    OCR fail ${f.slice(0, 30)}: ${e.message.slice(0, 60)}`); continue; }
    if (text.trim().length < 50) { ocrFail++; continue; }
    const r = await intake.intakeOne(db, { email: { id: 200000 + tag + i }, attachment: { id: 100000 + tag + i }, text, userId: me });
    console.log(`    ${f.slice(0, 34).padEnd(36)} OCR ${String(text.length).padStart(5)}с → ${r.status} (ИНН ${r.parsed && r.parsed.inn ? 'да' : '—'}, сумма ${r.parsed && r.parsed.amount_gross != null ? r.parsed.amount_gross : '—'})`);
    if (r.status === 'created') { created++; docs.push(r.doc_id); pays.push(r.payment_invoice_id); }
    else if (r.status === 'needs_manual') { manual++; if (r.doc_id) docs.push(r.doc_id); }
  }
  console.log(`\nOCR-конвейер: создано ${created}, needs_manual ${manual}, без текста ${ocrFail}`);
  (created + manual >= 4) ? ok(`сканы обработаны (создано ${created}, manual ${manual})`) : bad(`обработано мало: ${created + manual}`);
  (created >= 2) ? ok(`создано заявок из сканов: ${created}`) : bad(`заявок мало: ${created}`);
  // Все созданные заявки: TTL + связь с реестром.
  if (pays.length) {
    const ttl = (await db.query(`SELECT count(*)::int n FROM payment_invoices WHERE id = ANY($1::int[]) AND approval_expires_at IS NOT NULL`, [pays])).rows[0].n;
    (ttl === pays.length) ? ok('TTL 72ч у всех заявок из сканов') : bad(`TTL ${ttl}/${pays.length}`);
    const linked = (await db.query(`SELECT count(*)::int n FROM doc_registry WHERE id = ANY($1::int[]) AND payment_invoice_id IS NOT NULL`, [docs])).rows[0].n;
    (linked >= pays.length) ? ok('реестр связан с заявками (сканы)') : bad(`связь ${linked}`);
  }
  await db.query(`DELETE FROM doc_email_intake WHERE doc_id = ANY($1::int[])`, [docs]);
  await db.query(`DELETE FROM payment_invoices WHERE id = ANY($1::int[])`, [pays]);
  await db.query(`DELETE FROM doc_registry WHERE id = ANY($1::int[])`, [docs]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ OCR-конвейера: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
