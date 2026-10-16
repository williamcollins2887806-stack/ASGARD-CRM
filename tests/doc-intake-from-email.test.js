const BASE = 'http://127.0.0.1:3100';
const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  const imap = require('../src/services/imap');
  const tag = Date.now() % 100000;
  const INVOICE = `СЧЁТ № ${tag} от 02.10.2026
Поставщик: ООО «ИМАП-ИНТЕЙК»
ИНН 7721793895 КПП 771201001
Банк: ПАО СБЕРБАНК БИК 044525225
р/с 40702810600000012345 к/с 30101810400000000225
Итого без НДС: 30 000,00
НДС: 6 000,00
Всего к оплате: 36 000,00`;

  // фикстура: письмо-КОПИЯ CRM со счётом в теле
  const mail = (await db.query(
    `INSERT INTO emails(account_id, direction, from_email, subject, body_text, is_crm_copy, email_date, synced_at)
     VALUES (112,'inbound','crm@asgard-service.com','Fwd: счёт на согласование',$1,true,NOW(),NOW()) RETURNING id`,
    [INVOICE])).rows[0];
  console.log('письмо-копия:', mail.id);

  // Включаем intake в настройках.
  await db.query(`INSERT INTO settings(key, value_json, updated_at) VALUES('email_intake_enabled','true',NOW())
     ON CONFLICT (key) DO UPDATE SET value_json='true'`);

  console.log('\n=== runDocIntakeForEmail: счёт в теле письма-копии ===');
  const res = await imap.runDocIntakeForEmail(db, mail.id);
  console.log('  ' + JSON.stringify({ count: res.count, created: res.created, skipped: res.skipped }));
  (res.created >= 1) ? ok('intake создал заявку из письма-копии') : bad('intake: ' + JSON.stringify(res));

  const docs = (await db.query(`SELECT id, counterparty_inn, amount_gross FROM doc_registry WHERE receive_channel='email' AND invoice_number=$1`, [String(tag)])).rows;
  (docs.length === 1 && docs[0].counterparty_inn === '7721793895') ? ok('строка реестра создана с ИНН') : bad('реестр: ' + JSON.stringify(docs));

  console.log('\n=== повторный вызов не дублирует ===');
  const res2 = await imap.runDocIntakeForEmail(db, mail.id);
  const docs2 = (await db.query(`SELECT count(*)::int n FROM doc_registry WHERE receive_channel='email' AND invoice_number=$1`, [String(tag)])).rows[0].n;
  (docs2 === 1) ? ok('повтор не создаёт дубль (docs=' + docs2 + ')') : bad('дублей: ' + docs2);

  // Уборка
  const payIds = (await db.query(`SELECT payment_invoice_id AS id FROM doc_email_intake WHERE doc_id = ANY($1::int[])`, [docs.map((d) => d.id)])).rows.map((r) => r.id).filter(Boolean);
  await db.query(`DELETE FROM doc_email_intake WHERE doc_id = ANY($1::int[])`, [docs.map((d) => d.id)]);
  await db.query(`DELETE FROM payment_invoices WHERE id = ANY($1::int[])`, [payIds]);
  await db.query(`DELETE FROM doc_registry WHERE id = ANY($1::int[])`, [docs.map((d) => d.id)]);
  await db.query(`DELETE FROM emails WHERE id=$1`, [mail.id]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ intake из письма: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
