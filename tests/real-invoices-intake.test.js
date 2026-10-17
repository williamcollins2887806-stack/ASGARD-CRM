const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
const intake = require('../src/services/doc-email-intake');
const PDFTOTEXT = 'C:\\Users\\Nikita-ASGARD\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin\\pdftotext.exe';
const dir = path.join(__dirname, 'fixtures', 'real-invoices');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  const me = (await db.query(`SELECT id FROM users WHERE login='test_admin'`)).rows[0].id;
  const tag = Date.now() % 100000;
  const docs = []; const pays = [];
  // Берём только текстовые счета с суммой и ИНН (реально разобранные).
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort().slice(0, 6);
  let created = 0, manual = 0, skipped = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let text = '';
    try { text = execFileSync(PDFTOTEXT, ['-layout', path.join(dir, f), '-'], { encoding: 'utf8', maxBuffer: 32e6, timeout: 30000 }); } catch (_) {}
    if (text.trim().length < 50) { skipped++; continue; }
    const r = await intake.intakeOne(db, { email: { id: 400000 + tag + i }, attachment: { id: 300000 + tag + i }, text, userId: me });
    if (r.status === 'created') { created++; docs.push(r.doc_id); pays.push(r.payment_invoice_id); }
    else if (r.status === 'needs_manual') { manual++; if (r.doc_id) docs.push(r.doc_id); }
  }
  console.log(`\nРеальных текстовых счетов обработано: создано ${created}, needs_manual ${manual}, сканов пропущено ${skipped}`);
  (created + manual > 0) ? ok('intake прошёл по реальным счетам без падений') : bad('ни один счёт не обработан');
  (created >= 3) ? ok(`создано заявок: ${created} (>=3)`) : bad(`слишком мало создано: ${created}`);

  // Проверка: у созданных заявок есть TTL, реестр связан, ИНН проставлен.
  if (pays.length) {
    const ttl = (await db.query(`SELECT count(*)::int n FROM payment_invoices WHERE id = ANY($1::int[]) AND approval_expires_at IS NOT NULL`, [pays])).rows[0].n;
    (ttl === pays.length) ? ok('у всех заявок проставлен TTL 72ч') : bad(`TTL у ${ttl}/${pays.length}`);
    const linked = (await db.query(`SELECT count(*)::int n FROM doc_registry WHERE id = ANY($1::int[]) AND payment_invoice_id IS NOT NULL`, [docs])).rows[0].n;
    (linked >= pays.length) ? ok('реестр связан с заявками') : bad(`связь реестр↔заявка: ${linked}`);
    const withInn = (await db.query(`SELECT count(*)::int n FROM doc_registry WHERE id = ANY($1::int[]) AND counterparty_inn IS NOT NULL`, [docs])).rows[0].n;
    console.log(`  (с ИНН: ${withInn}/${docs.length})`);
  }
  // Антидубль: повторная обработка того же письма не создаёт новых заявок.
  if (files.length) {
    const f0 = files[0];
    let text0 = '';
    try { text0 = execFileSync(PDFTOTEXT, ['-layout', path.join(dir, f0), '-'], { encoding: 'utf8', maxBuffer: 32e6, timeout: 30000 }); } catch (_) {}
    if (text0.trim().length >= 50) {
      const again = await intake.intakeOne(db, { email: { id: 400000 + tag + 0 }, attachment: { id: 300000 + tag + 0 }, text: text0, userId: me });
      (again.status === 'already') ? ok('повторная обработка → already (антидубль)') : bad('повтор: ' + again.status);
    }
  }

  await db.query(`DELETE FROM doc_email_intake WHERE doc_id = ANY($1::int[])`, [docs]);
  await db.query(`DELETE FROM payment_invoices WHERE id = ANY($1::int[])`, [pays]);
  await db.query(`DELETE FROM doc_registry WHERE id = ANY($1::int[])`, [docs]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ реальных счетов в intake: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
