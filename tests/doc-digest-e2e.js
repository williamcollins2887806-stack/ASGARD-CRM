const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
const cron = require('../src/services/reminder-cron');
(async () => {
  // фикстура: 3 задачи одному владельцу
  const owner = (await db.query(`SELECT id, name, email FROM users WHERE role='BUH' AND email IS NOT NULL LIMIT 1`)).rows[0];
  console.log('получатель:', owner.id, owner.email);
  const tag = 'DIGEST-' + Date.now();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = (await db.query(
      `INSERT INTO doc_registry(dir, counterparty_name, invoice_number, invoice_date, amount_gross, payment_due_at,
         pay_status, doc_owner_id, created_by, updated_by, correction_state, correction_kind, correction_comment)
       VALUES ('in',$1,$2,'2026-10-01',1000, CURRENT_DATE, 'wait', $3, $3, $3, 'requested','sf','тест') RETURNING id`,
      [tag, 'D-' + i, owner.id])).rows[0];
    ids.push(r.id);
  }
  // два «прогона»: должны вернуть число писем, второй — 0 (антидубль)
  await db.query(`DELETE FROM doc_reminder_log WHERE doc_id = ANY($1::int[])`, [ids]);
  const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
  const sent1 = await cron.sendDailyDigests(db, noopLog);
  const sent2 = await cron.sendDailyDigests(db, noopLog);
  const logged = (await db.query(`SELECT count(*)::int n FROM doc_reminder_log WHERE doc_id = ANY($1::int[])`, [ids])).rows[0].n;
  const errLogged = (await db.query(
    `SELECT count(*)::int n FROM doc_reminder_log WHERE doc_id = ANY($1::int[]) AND (error IS NOT NULL OR attempts > 0)`, [ids])).rows[0].n;
  console.log('прогон1 sent=' + sent1, '| прогон2 sent=' + sent2, '| строк лога:', logged, '(ожидаем 3)', '| с ошибкой/ретраем:', errLogged);
  // Среда может не иметь SMTP — тогда проверяем, что ошибка ЗАФИКСИРОВАНА, а задача не потеряна.
  const pass1 = (sent1 >= 1 || errLogged === 3) ? 'PASS' : 'FAIL';
  const pass2 = sent2 === 0 ? 'PASS' : 'FAIL';
  const pass3 = logged === 3 ? 'PASS' : 'FAIL';
  console.log(`  ${pass1} дайджест сформирован (письмо ушло либо ошибка SMTP в логе)`);
  console.log(`  ${pass2} повтор не дублирует (антидубль doc_reminder_log)`);
  console.log(`  ${pass3} в логе ровно 3 задачи`);
  const passed = [pass1, pass2, pass3].filter((x) => x === 'PASS').length;
  // Сводка в формате сводного прогона (tests/doc-hub-all.js ищет «PASS N / FAIL N»).
  console.log(`PASS ${passed} / FAIL ${3 - passed}`);
  await db.query(`DELETE FROM doc_reminder_log WHERE doc_id = ANY($1::int[])`, [ids]);
  await db.query(`DELETE FROM doc_registry WHERE id = ANY($1::int[])`, [ids]);
  await db.end();
  process.exit(passed === 3 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
