/**
 * V403/V404 E2E: счёт с договором/сроком/объектом/позициями → intake → заявка
 * → реестр → номенклатура. Проверяем, что заказчик 17.10 просил:
 *  1) ВСЕ позиции счёта → номенклатура (кол-во, цена, дата счёта, поставщик);
 *  2) договор-основание подтягивается; если его нет в CRM — подсветка;
 *  3) «оплата до 20.10.2026» → срок заявки;
 *  4) тело письма «оплати завтра / срочно / через 2 месяца» → режим оплаты;
 *  5) объект из счёта подтягивается к работе.
 */
const { Client } = require('pg');
// Конвенция тестов репо: db.js падает без DB_PASSWORD, а intake тянет ai-provider.
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { intakeOne } = require('../src/services/doc-email-intake');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };
// Дата из PG приходит Date-объектом (полночь локального пояса) — сравниваем день, а не строку.
const day = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const INVOICE = `Счёт на оплату № 1185 от 14.07.2026
Поставщик: ООО «ВСЕ ИНСТРУМЕНТЫ»
ИНН 7712345678 КПП 771234567
Основание: Договор № ДП-2025/01 от 01.02.2026
Объект: ЖК Северный, корпус 3
Оплата до 20.10.2026
1. Дрель аккумуляторная Makita DDF482 2 шт x 8 000,00 = 16 000,00
2. Бур SDS-plus 8x160 10 шт x 300,00 = 3 000,00
Итого к оплате: 19 000,00 руб.
НДС 20%: 3 166,67`;

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();
  console.log('=== V403/V404: счёт → заявка → реестр → номенклатура ===\n');

  // 1. Есть ли договор ДП-2025/01 в CRM? Создаём, если нет.
  const exist = await db.query(`SELECT id FROM contracts WHERE lower(regexp_replace(coalesce(number,''), '[^a-zA-Z0-9а-яА-ЯёЁ/\\-]', '', 'g')) = 'дп2025/01' LIMIT 1`);
  let contractId = exist.rows[0] && exist.rows[0].id;
  if (!contractId) {
    const ins = await db.query(`INSERT INTO contracts(number, counterparty_name, subject, status) VALUES('ДП-2025/01','ООО «ВСЕ ИНСТРУМЕНТЫ»','Поставка инструмента','active') RETURNING id`);
    contractId = ins.rows[0].id;
    console.log(`  (создан тестовый договор #${contractId} ДП-2025/01)`);
  } else {
    console.log(`  (договор ДП-2025/01 уже есть: #${contractId})`);
  }

  // 2. Прогон intake (письмо + вложение-счёт).
  const emailRow = await db.query(`INSERT INTO emails(subject, body_text, from_email, created_at) VALUES($1,$2,$3,NOW()) RETURNING id`,
    ['Счёт на оплату', 'Настя, оплати завтра, инструмент нужен на объект', 'iniciator@asgard-service.com']);
  const emailId = emailRow.rows[0].id;
  const attRow = await db.query(`INSERT INTO email_attachments(email_id, filename, mime_type, file_path, is_inline) VALUES($1,$2,$3,$4,false) RETURNING id`,
    [emailId, 'invoice.pdf', 'application/pdf', '/uploads/tmp/invoice-test.pdf']);
  const attachmentId = attRow.rows[0].id;

  const email = { id: emailId, body_text: 'Настя, оплати завтра, инструмент нужен на объект' };
  const attachment = { id: attachmentId };
  const res = await intakeOne(db, { email, attachment, text: INVOICE, userId: 4613 });
  console.log('\n  intake:', JSON.stringify({ status: res.status, doc_id: res.doc_id, pay_id: res.payment_invoice_id }));
  ok(res.status === 'created' || res.status === 'needs_manual', 'intake обработал счёт (status=' + res.status + ')');
  ok(!!res.doc_id, 'строка реестра создана: #' + res.doc_id);
  ok(!!res.payment_invoice_id, 'заявка создана (все счета должны обрабатываться): #' + res.payment_invoice_id);

  const doc = (await db.query(`SELECT * FROM doc_registry WHERE id=$1`, [res.doc_id])).rows[0];
  const pay = res.payment_invoice_id ? (await db.query(`SELECT * FROM payment_invoices WHERE id=$1`, [res.payment_invoice_id])).rows[0] : null;

  console.log('\n--- 1. СЧЁТ → РЕЕСТР ---');
  ok(String(doc.invoice_number) === '1185', 'номер счёта: ' + doc.invoice_number);
  ok(day(doc.invoice_date) === '2026-07-14', 'дата счёта: ' + day(doc.invoice_date));
  ok(Number(doc.amount_gross) === 19000, 'сумма: ' + doc.amount_gross);
  ok(Number(doc.vat_amount) === 3166.67, 'НДС: ' + doc.vat_amount);

  console.log('\n--- 2. ДОГОВОР-ОСНОВАНИЕ ---');
  ok(doc.contract_mode === 'linked', 'договор подтянут (mode=' + doc.contract_mode + ')');
  ok(Number(doc.contract_id) === Number(contractId), 'contract_id = #' + doc.contract_id + ' (ждали #' + contractId + ')');
  ok(String(doc.contract_label || '').includes('ДП-2025/01'), 'метка договора: ' + doc.contract_label);

  console.log('\n--- 3. СРОК ИЗ СЧЁТА ---');
  ok(day(doc.payment_due_at) === '2026-10-20', 'срок «оплата до» → ' + day(doc.payment_due_at));

  console.log('\n--- 4. ОБЪЕКТ (работа) ---');
  console.log('  work_hint:', doc.work_id ? ('привязан #' + doc.work_id) : 'в CRM нет однозначной работы — остаётся подсказкой');
  // Подсказка объекта хранится в заявке (payment_invoices.work_hint), привязка — в doc_registry.work_id.
  const hint = (pay && pay.work_hint) || null;
  ok(!!hint || !!doc.work_id, 'объект из счёта распознан: ' + (hint || ('work #' + doc.work_id)));

  if (pay) {
    console.log('\n--- 5. ЗАЯВКА: КОНТЕКСТ ИНИЦИАТОРА ---');
    ok(pay.initiator_intent === 'tomorrow', 'просьба «завтра» распознана: ' + pay.initiator_intent);
    ok(pay.pay_timing === 'immediate', 'режим immediate (срочно): ' + pay.pay_timing);
    // Дата «завтра» зависит от текущего дня — сверяем со завтрашним днём, а не хардкодом
    // (тест ломался при смене суток: 19.10 ожидал 19.10, а «завтра» уже 20.10).
    const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
    const p2 = (x) => String(x).padStart(2, '0');
    const expectTomorrow = `${tmr.getFullYear()}-${p2(tmr.getMonth() + 1)}-${p2(tmr.getDate())}`;
    ok(day(pay.due_date) === expectTomorrow, 'срок из письма «завтра» = ' + day(pay.due_date) + ' (ждали ' + expectTomorrow + ')');
    ok(String(pay.contract_basis_number) === 'ДП-2025/01', 'договор в заявке: ' + pay.contract_basis_number);
    ok(pay.contract_missing === false, 'договор найден (не missing)');
    ok(String(pay.invoice_number) === '1185', 'номер счёта в заявке: ' + pay.invoice_number);
  } else {
    console.log('\n--- 5. заявка не создана — ПРОБЛЕМА');
    fail++;
  }

  console.log('\n--- 6. НОМЕНКЛАТУРА ИЗ ПОЗИЦИЙ СЧЁТА (АВТОМАТИЧЕСКИ, из intake) ---');
  // ВАЖНО (FAIL верификатора 17.10.2026): раньше тест вызывал enrichCatalogFromLines
  // РУКАМИ и потому не ловил, что автоматический intake не наполняет номенклатуру.
  // Теперь проверяем только результат intake — позиции должны появиться сами.
  const pr = await db.query(`SELECT item_name, unit_price, quantity, total, invoice_date, invoice_number, doc_registry_id, supplier_name FROM price_records WHERE doc_registry_id=$1 ORDER BY id`, [res.doc_id]);
  console.log('  записей номенклатуры (после intake):', pr.rowCount);
  for (const r of pr.rows) {
    console.log(`    ${r.item_name.slice(0, 34)} | цена ${r.unit_price} | кол ${r.quantity} | сумма ${r.total} | дата ${day(r.invoice_date)} | счёт ${r.invoice_number}`);
  }
  ok(pr.rowCount === 2, 'intake САМ разложил обе позиции счёта в номенклатуру');
  ok(pr.rows.every((r) => Number(r.quantity) > 0), 'у каждой позиции есть КОЛИЧЕСТВО');
  ok(pr.rows.every((r) => Number(r.unit_price) > 0), 'у каждой позиции есть ЦЕНА');
  ok(pr.rows.every((r) => day(r.invoice_date) === '2026-07-14'), 'у каждой позиции ДАТА счёта');
  ok(pr.rows.every((r) => Number(r.doc_registry_id) === Number(res.doc_id)), 'каждая позиция связана со СЧЁТОМ');
  ok(pr.rows.every((r) => r.supplier_name), 'у каждой позиции ПОСТАВЩИК');
  const hasLines = pr.rows.some((r) => /Makita|Бур/i.test(r.item_name));
  ok(hasLines, 'позиции именно из счёта (Makita/Бур), а не заголовок');
  const pj = (await db.query(`SELECT parsed_json FROM doc_registry WHERE id=$1`, [res.doc_id])).rows[0].parsed_json;
  ok(Array.isArray(pj) && pj.length === 2, 'parsed_json строки заполнен позициями: ' + (Array.isArray(pj) ? pj.length : 'null'));

  console.log('\n--- 7. ДОГОВОРА НЕТ В CRM → ПОДСВЕТКА ---');
  const email2 = (await db.query(`INSERT INTO emails(subject, body_text, from_email, created_at) VALUES($1,$2,$3,NOW()) RETURNING id`,
    ['Счёт без договора', 'оплата через 2 месяца', 'iniciator@asgard-service.com'])).rows[0];
  const att2 = (await db.query(`INSERT INTO email_attachments(email_id, filename, mime_type, file_path, is_inline) VALUES($1,$2,$3,$4,false) RETURNING id`,
    [email2.id, 'inv2.pdf', 'application/pdf', '/uploads/tmp/inv2.pdf'])).rows[0];
  const INVOICE2 = `Счёт на оплату № 9001 от 01.10.2026
Поставщик: ООО «ИКС-МЕТАЛЛ»
ИНН 7707083893 КПП 770701001
Основание: Договор № НЕТ-ТАКОГО-999 от 05.05.2026
Итого к оплате: 50 000,00 руб.
НДС 20%: 8 333,33`;
  const res2 = await intakeOne(db, { email: { id: email2.id, body_text: 'оплата через 2 месяца' }, attachment: { id: att2.id }, text: INVOICE2, userId: 4613 });
  const doc2 = (await db.query(`SELECT * FROM doc_registry WHERE id=$1`, [res2.doc_id])).rows[0];
  const pay2 = res2.payment_invoice_id ? (await db.query(`SELECT * FROM payment_invoices WHERE id=$1`, [res2.payment_invoice_id])).rows[0] : null;
  console.log('  doc2: contract_mode=' + doc2.contract_mode + ' label=' + doc2.contract_label + ' incomplete=' + doc2.is_incomplete);
  ok(doc2.contract_mode === 'once' || doc2.contract_mode === 'none', 'договор НЕ создан молча (mode=' + doc2.contract_mode + ')');
  ok(!doc2.contract_id, 'contract_id пуст (нет чужого договора)');
  ok((doc2.incomplete_reasons || []).includes('contract_not_found'), 'строка помечена «договор не найден»');
  if (pay2) {
    ok(pay2.contract_missing === true, 'в заявке contract_missing=true (подсветка для директора/буха)');
    ok(pay2.initiator_intent === 'relative', '«через 2 месяца» распознано: ' + pay2.initiator_intent);
    ok(pay2.pay_timing === 'deferred', 'режим deferred: ' + pay2.pay_timing);
    ok(!!pay2.due_date, 'срок рассчитан: ' + day(pay2.due_date));
  }

  // уборка
  for (const d of [res.doc_id, res2.doc_id]) {
    await db.query(`DELETE FROM price_records WHERE doc_registry_id=$1`, [d]).catch(() => {});
    await db.query(`DELETE FROM payment_invoices WHERE doc_registry_id=$1`, [d]).catch(() => {});
    await db.query(`DELETE FROM doc_email_intake WHERE doc_id=$1`, [d]).catch(() => {});
    await db.query(`DELETE FROM doc_registry WHERE id=$1`, [d]).catch(() => {});
  }
  await db.query(`DELETE FROM email_attachments WHERE email_id IN ($1,$2)`, [emailId, email2.id]).catch(() => {});
  await db.query(`DELETE FROM emails WHERE id IN ($1,$2)`, [emailId, email2.id]).catch(() => {});
  // Убираем и тестовый договор (иначе повторные прогоны копят дубли номеров).
  await db.query(`DELETE FROM contracts WHERE number='ДП-2025/01' AND counterparty_name='ООО «ВСЕ ИНСТРУМЕНТЫ»' AND created_by IS NULL`).catch(() => {});
  console.log('\n  (тестовые строки и договор удалены)');

  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message, e.stack); process.exit(1); });
