'use strict';
/**
 * Аудит прода на тестовый мусор после работ по D-369/D-370.
 *
 * Что ищем:
 *   1. Счета, заведённые пробами (по названиям вида «ООО Тест…», «ТЕСТ-…»,
 *      «R4…», «ЦЕПОЧКА», «ПОСТ-ТЕСТ», «ПРОБА», «ДУБЛЬ»).
 *   2. Счета с тестовыми комментариями («проверка D-369», «E2E:»).
 *   3. Строки реестра-сироты от проб (созданы пробой, заявки нет).
 *   4. Карточки поставщиков, заведённые из заглушки «Распознаётся…».
 *   5. Заявки, где doc_registry_id указывает на несуществующую строку.
 *
 * Только ЧТЕНИЕ. Ничего не удаляет и не меняет.
 */
const pg = require('/var/www/asgard-crm/node_modules/pg');
require('/var/www/asgard-crm/node_modules/dotenv').config({ path: '/var/www/asgard-crm/.env' });

(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();

  const show = (title, rows, map) => {
    console.log(`\n=== ${title}: ${rows.length} ===`);
    for (const r of rows) console.log('  ' + JSON.stringify(map ? map(r) : r));
  };

  // 1. Подозрительные названия поставщиков в заявках.
  const byName = (await c.query(`
    SELECT id, status, supplier_name, amount, comment_text, created_at
      FROM payment_invoices
     WHERE supplier_name ~* '^(ТЕСТ|ООО Тест|ООО "Тест|ООО ЦЕПОЧКА|ООО ПОСТ|ООО Дубль|ООО Ноль|ООО Сумма|ООО Защита|ООО Отрав|ООО Частич|ООО #|ООО К-|ООО B|ООО C|ООО D|ООО E|ООО G|ООО H|R[0-9]|ООО Явный|ООО Полный|ООО Метка|ООО Связка|ООО Т|ООО Склад|ООО Работы)'
     ORDER BY id`)).rows;
  show('Подозрительные названия в заявках', byName);

  // 2. Тестовые комментарии.
  const byComment = (await c.query(`
    SELECT id, status, supplier_name, amount, comment_text
      FROM payment_invoices
     WHERE comment_text ~* '(D-369|E2E:|проверка POST|десктоп-пересохранение|D-370|тест)'
     ORDER BY id`)).rows;
  show('Заявки с тестовыми комментариями', byComment);

  // 3. Строки реестра без заявки, созданные недавно (могут быть пробами).
  const orphanDocs = (await c.query(`
    SELECT d.id, d.counterparty_name, d.amount_gross, d.invoice_number, d.created_at
      FROM doc_registry d
      LEFT JOIN payment_invoices pi ON pi.doc_registry_id = d.id
     WHERE d.deleted_at IS NULL
       AND d.payment_invoice_id IS NULL
       AND pi.id IS NULL
       AND d.created_at > NOW() - INTERVAL '3 days'
     ORDER BY d.id DESC LIMIT 30`)).rows;
  show('Строки реестра-сироты за 3 дня', orphanDocs);

  // 4. Поставщики-заглушки.
  const stub = (await c.query(`
    SELECT id, name, inn, created_at FROM suppliers
     WHERE deleted_at IS NULL AND name ~* '(Распозна|ТЕСТ|Тест|ЦЕПОЧКА|ПОСТ-ТЕСТ|Дубль|Явный|Отрав|Частич|Полный|Ноль)'
     ORDER BY id`)).rows;
  show('Поставщики, похожие на тестовые', stub);

  // 5. Битые ссылки заявка → реестр.
  const broken = (await c.query(`
    SELECT pi.id, pi.status, pi.doc_registry_id
      FROM payment_invoices pi
      LEFT JOIN doc_registry d ON d.id = pi.doc_registry_id
     WHERE pi.doc_registry_id IS NOT NULL AND d.id IS NULL
     ORDER BY pi.id`)).rows;
  show('Заявки со ссылкой на несуществующий реестр', broken);

  // 6. Общие числа «до/после».
  const counts = (await c.query(`
    SELECT
      (SELECT count(*)::int FROM payment_invoices) AS invoices,
      (SELECT count(*)::int FROM payment_invoices WHERE status='pending_payment') AS pending,
      (SELECT count(*)::int FROM doc_registry WHERE deleted_at IS NULL AND dir='in') AS registry,
      (SELECT count(*)::int FROM suppliers WHERE deleted_at IS NULL) AS suppliers`)).rows[0];
  console.log('\n=== Текущие объёмы ===');
  console.log('  ' + JSON.stringify(counts));

  // 7. Черновики — не осталось ли брошенных после моих проверок.
  const drafts = (await c.query(`
    SELECT id, supplier_name, amount, supplier_name = 'Распознаётся…' AS is_stub, created_at
      FROM payment_invoices WHERE status='draft' ORDER BY id`)).rows;
  show('Черновики на проде', drafts);

  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
