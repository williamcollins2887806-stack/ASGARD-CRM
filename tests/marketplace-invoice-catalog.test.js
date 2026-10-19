/**
 * РЕГРЕСС FAIL-1 (верификатор 19.10.2026): маркетплейс-счёт (продавец ≠ получатель)
 * обязан наполнять номенклатуру на карточку ПРОДАВЦА.
 *
 * Дефект: `sellerSupplierId` объявлялся внутри `if (!docId)`, а читался в блоке
 * каталога ВНЕ него → `ReferenceError` → enrichCatalogFromLines не вызывался вообще
 * → позиции маркетплейс-счетов НЕ попадали в price_records (catalog=null).
 *
 * Тест интеграционный: прогоняем реальный intakeOne с текстом Wildberries-счёта.
 */
const { Client } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { intakeOne } = require('../src/services/doc-email-intake');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// Маркетплейс-счёт: продавец ВМПАВТО (7814069526), получатель платежа РВБ (9714053621).
const MP_INVOICE = `wildberries
Счёт № 881040 от 17 июля 2026 г.
Получатель ООО РВБ, ИНН 9714053621, КПП 507401001
Банк получателя ООО "Вайлдберриз Банк", БИК 044525450, Корр.счёт 30101810245250000450, Счет получателя 40702810800000020353
Продавец 1. Общество с ограниченной ответственностью "ВМПАВТО", ИНН 7814069526, КПП 780501001
| Наименование товара | Кол-во | Ед.изм. | Цена с НДС, руб. | Ставка НДС | Всего с НДС, руб. |
| 1 | Жидкий ключ ВАЛЕРА, 650 мл флакон - аэрозоль | 6 | шт | 590.00 | 22% | 3 540.00 |
Итого: 3 540.00
Включая НДС: 638.36`;

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();
  console.log('=== FAIL-1: маркетплейс-счёт → номенклатура на ПРОДАВЦА ===\n');

  const emailRow = await db.query(
    `INSERT INTO emails(subject, body_text, from_email, created_at) VALUES($1,$2,$3,NOW()) RETURNING id`,
    ['Fwd: Запрос КП: химреагенты', 'Прошу согласовать и оплатить', 'iniciator@asgard-service.com']);
  const emailId = emailRow.rows[0].id;
  const attRow = await db.query(
    `INSERT INTO email_attachments(email_id, filename, mime_type, file_path, is_inline) VALUES($1,$2,$3,$4,false) RETURNING id`,
    [emailId, 'wb-invoice.pdf', 'application/pdf', '/uploads/tmp/wb-test.pdf']);
  const attachmentId = attRow.rows[0].id;

  const res = await intakeOne(db, { email: { id: emailId, body_text: 'Прошу согласовать и оплатить' }, attachment: { id: attachmentId }, text: MP_INVOICE, userId: 4613 });
  console.log('  intake:', JSON.stringify({ status: res.status, doc_id: res.doc_id, pay: res.payment_invoice_id, catalog: res.catalog && res.catalog.price_records }));
  if (!res.doc_id) { console.log('  НЕТ DOC — стоп'); await db.end(); process.exit(1); }

  // 1. Каталог должен наполниться (главный симптом FAIL-1: catalog=null).
  const pr = await db.query(
    `SELECT item_name, quantity, unit_price, total, supplier_name, supplier_id, invoice_number
       FROM price_records WHERE doc_registry_id=$1 ORDER BY id`, [res.doc_id]);
  console.log('\n  price_records:', JSON.stringify(pr.rows));
  ok(pr.rows.length > 0, 'позиции попали в номенклатуру (' + pr.rows.length + ') — catalog НЕ null');
  ok(typeof res.catalog === 'object' && res.catalog !== null, 'intake вернул catalog=' + (res.catalog ? 'объект' : 'null'));

  // 2. Имя поставщика в истории закупок — ПРОДАВЕЦ, не получатель.
  const supName = pr.rows[0] && pr.rows[0].supplier_name;
  ok(!!supName && /ВМПАВТО/i.test(supName), 'история на ПРОДАВЦА (' + supName + ')');
  ok(!!supName && !/РВБ|Вайлдберриз/i.test(supName), 'получатель платежа (РВБ) в историю НЕ попал');

  // 3. Карточка реестра: продавец и получатель раздельно.
  const doc = (await db.query(`SELECT counterparty_name, counterparty_inn, seller_name, seller_inn, payee_name, payee_inn, parsed_json FROM doc_registry WHERE id=$1`, [res.doc_id])).rows[0];
  console.log('  doc_registry:', JSON.stringify({ cp: doc.counterparty_name, cpInn: doc.counterparty_inn, seller: doc.seller_name, sellerInn: doc.seller_inn, payee: doc.payee_name, payeeInn: doc.payee_inn }));
  ok(/РВБ/i.test(String(doc.counterparty_name || '')), 'контрагент (кому платим) = ООО РВБ');
  ok(String(doc.counterparty_inn) === '9714053621', 'ИНН контрагента = получателя');
  ok(/ВМПАВТО/i.test(String(doc.seller_name || '')), 'продавец сохранён отдельно: ' + doc.seller_name);
  ok(String(doc.seller_inn) === '7814069526', 'ИНН продавца: ' + doc.seller_inn);

  // 4. parsed_json содержит позиции (не пустой массив — симптом FAIL-1).
  let pj = doc.parsed_json; try { if (typeof pj === 'string') pj = JSON.parse(pj); } catch (_) {}
  ok(Array.isArray(pj) && pj.length > 0, 'parsed_json содержит позиции (' + (Array.isArray(pj) ? pj.length : 'не массив') + ')');

  // 5. Арифметика позиции.
  ok(pr.rows[0] && Number(pr.rows[0].quantity) === 6 && Number(pr.rows[0].unit_price) === 590 && Number(pr.rows[0].total) === 3540,
    'позиция 6 × 590 = 3540');

  await db.end();
  console.log('\n────────────────────────────────────────');
  console.log('ИТОГ FAIL-1 (маркетплейс→номенклатура): PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message, e.stack); process.exit(1); });
