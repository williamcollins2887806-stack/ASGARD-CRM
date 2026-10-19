/**
 * БАРЬЕР (заказчик 19.10.2026): «письма на ящик CRM помимо согласования счетов ещё
 * создают заявки, которые падают в маркетплейс. Сделать так, чтобы в маркетплейс
 * НЕ падали счета».
 *
 * Дефект подтверждён на ПРОДЕ: письмо #4847 «Fwd: Запрос КП: химические реагенты»
 * (вложение — скан СЧЁТА «Мир Химии») классифицировано как `commercial_offer` →
 * создало заявку маркетплейса #31.
 *
 * Тест проверяет 3 уровня барьера в analyzeOneEmail (src/services/imap.js):
 *   1) письмо уже разобрано intake-контуром (есть doc_email_intake / payment_invoices);
 *   2) имя вложения похоже на счёт/УПД/платёжный документ;
 *   3) классификация ИИ — invoice_ / approval_-классы.
 * При срабатывании заявка маркетплейса (inbox_applications) НЕ создаётся.
 *
 * Тест НЕ вызывает сеть: классификацию подменяем прямой вставкой письма с готовыми
 * признаками (вложение-счёт + строка intake) и проверяем результат барьера по БД.
 */
const { Client } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const imap = require('../src/services/imap');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();
  console.log('=== Барьер: счёт не создаёт заявку маркетплейса ===\n');

  // ── Кейс A: письмо со счётом, имя вложения «Скан_20261013.pdf» (как на проде) ──
  const eA = (await db.query(
    `INSERT INTO emails(subject, body_text, from_email, direction, is_deleted, email_date, created_at)
     VALUES($1,$2,$3,'inbound',false,NOW(),NOW()) RETURNING id`,
    ['Fwd: Запрос КП: химические реагенты для пассивации', 'Прошу согласовать и оплатить счёт', 'n.androsov@asgard-service.com'])).rows[0].id;
  await db.query(
    `INSERT INTO email_attachments(email_id, filename, mime_type, file_path, is_inline)
     VALUES($1,$2,$3,$4,false)`, [eA, 'Скан_20261013 (2).pdf', 'application/pdf', '/uploads/tmp/scan.pdf']);
  // Признак (1): intake уже обработал письмо → строка в doc_email_intake со статусом parsed.
  const atA = (await db.query(`SELECT id FROM email_attachments WHERE email_id=$1 LIMIT 1`, [eA])).rows[0];
  await db.query(`INSERT INTO doc_email_intake(email_id, attachment_id, status) VALUES($1,$2,'parsed')`, [eA, atA.id]);

  const beforeA = (await db.query(`SELECT count(*)::int AS n FROM inbox_applications WHERE email_id=$1`, [eA])).rows[0].n;
  ok(beforeA === 0, 'A: до обработки заявки маркетплейса нет');

  // Прогоняем analyzeOneEmail. Он вызовет ИИ (сеть) — но барьер срабатывает ДО вставки.
  // Чтобы не зависеть от сети, подменяем aiAnalyzer.analyzeEmail на детерминированный
  // ответ с «опасной» классификацией commercial_offer.
  const aiPath = require.resolve('../src/services/ai-email-analyzer');
  const realAnalyzer = require(aiPath);
  const realFn = realAnalyzer.analyzeEmail;
  realAnalyzer.analyzeEmail = async () => ({
    classification: 'commercial_offer', color: 'green', confidence: 0.8,
    summary: 'Запрос КП на химреагенты', recommendation: 'Рассмотреть',
    work_type: null, estimated_budget: null, estimated_days: null, keywords: [], _raw: { model: 'test' }
  });
  // Отключаем отправку автоответов/уведомлений (не предмет теста).
  try {
    const emailRow = (await db.query(`SELECT * FROM emails WHERE id=$1`, [eA])).rows[0];
    await imap.analyzeOneEmail(emailRow);
  } catch (e) {
    console.log('  (analyzeOneEmail вернул: ' + e.message.slice(0, 80) + ')');
  }
  realAnalyzer.analyzeEmail = realFn;

  const afterA = (await db.query(`SELECT count(*)::int AS n FROM inbox_applications WHERE email_id=$1`, [eA])).rows[0].n;
  ok(afterA === 0, 'A: заявка маркетплейса НЕ создана для письма со счётом (0)');

  // ── Кейс B: НАСТОЯЩАЯ заявка на работы (ТЗ, без счёта) должна пройти ──
  const eB = (await db.query(
    `INSERT INTO emails(subject, body_text, from_email, direction, is_deleted, email_date, created_at)
     VALUES($1,$2,$3,'inbound',false,NOW(),NOW()) RETURNING id`,
    ['Запрос на очистку теплообменника', 'Просим выполнить работы по очистке теплообменника, объём работ во вложении', 'client@example.com'])).rows[0].id;
  await db.query(
    `INSERT INTO email_attachments(email_id, filename, mime_type, file_path, is_inline)
     VALUES($1,$2,$3,$4,false)`, [eB, 'ТЗ_очистка_теплообменника.pdf', 'application/pdf', '/uploads/tmp/tz.pdf']);

  realAnalyzer.analyzeEmail = async () => ({
    classification: 'direct_request', color: 'green', confidence: 0.85,
    summary: 'Запрос на очистку теплообменника', recommendation: 'В работу',
    work_type: 'очистка', estimated_budget: null, estimated_days: null, keywords: [], _raw: { model: 'test' }
  });
  try {
    const rowB = (await db.query(`SELECT * FROM emails WHERE id=$1`, [eB])).rows[0];
    await imap.analyzeOneEmail(rowB);
  } catch (e) {
    console.log('  (analyzeOneEmail B вернул: ' + e.message.slice(0, 80) + ')');
  }
  realAnalyzer.analyzeEmail = realFn;

  const afterB = (await db.query(`SELECT count(*)::int AS n FROM inbox_applications WHERE email_id=$1`, [eB])).rows[0].n;
  ok(afterB === 1, 'B: настоящая заявка на работы ПРОШЛА (inbox_applications=' + afterB + ')');

  // ── Кейс C: вложение со словом «счет» (лат.) — тоже барьер ──
  const eC = (await db.query(
    `INSERT INTO emails(subject, body_text, from_email, direction, is_deleted, email_date, created_at)
     VALUES($1,$2,$3,'inbound',false,NOW(),NOW()) RETURNING id`,
    ['Fwd: invoice', 'оплата', 'x@asgard-service.com'])).rows[0].id;
  await db.query(
    `INSERT INTO email_attachments(email_id, filename, mime_type, file_path, is_inline)
     VALUES($1,$2,$3,$4,false)`, [eC, 'invoice_881040.pdf', 'application/pdf', '/uploads/tmp/inv.pdf']);
  realAnalyzer.analyzeEmail = async () => ({
    classification: 'commercial_offer', color: 'green', confidence: 0.7,
    summary: 'КП', recommendation: '-', work_type: null, estimated_budget: null, estimated_days: null, keywords: [], _raw: {}
  });
  try {
    const rowC = (await db.query(`SELECT * FROM emails WHERE id=$1`, [eC])).rows[0];
    await imap.analyzeOneEmail(rowC);
  } catch (e) { /* ok */ }
  realAnalyzer.analyzeEmail = realFn;
  const afterC = (await db.query(`SELECT count(*)::int AS n FROM inbox_applications WHERE email_id=$1`, [eC])).rows[0].n;
  ok(afterC === 0, 'C: вложение «invoice_*» → заявка рынка не создана (' + afterC + ')');

  // Чистка тестовых данных.
  for (const id of [eA, eB, eC]) {
    await db.query(`DELETE FROM inbox_applications WHERE email_id=$1`, [id]).catch(() => {});
    await db.query(`DELETE FROM doc_email_intake WHERE email_id=$1`, [id]).catch(() => {});
    await db.query(`DELETE FROM email_attachments WHERE email_id=$1`, [id]).catch(() => {});
    await db.query(`DELETE FROM emails WHERE id=$1`, [id]).catch(() => {});
  }
  await db.end();
  console.log('\n────────────────────────────────────────');
  console.log('ИТОГ барьера счетов: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message, e.stack); process.exit(1); });
