'use strict';
/**
 * Уборка прод-мусора от моих проб.
 *
 * Удаляем ТОЛЬКО то, что создал я и что ни к чему не привязано:
 *   1. Поставщик #480 «ТЕСТ-УДАЛИТЬ» — создан моей пробой POST
 *      23.10.2026 20:33. Использований: 0 заявок, 0 строк реестра.
 *   2. Черновик #16 — ДУБЛЬ счёта «РадиоДуплекс», созданный моей пробой
 *      распознавания 21.10 (в базе уже есть #14 с тем же файлом... — нет,
 *      у #14 другой файл). #16 — реальный счёт, НО мой комментарий
 *      «проверка D-369» в нём надо снять, а сам черновик не трогать:
 *      его завёл пользователь.
 *
 * По умолчанию dry-run. С --apply удаляет/правит.
 */
const pg = require('/var/www/asgard-crm/node_modules/pg');
require('/var/www/asgard-crm/node_modules/dotenv').config({ path: '/var/www/asgard-crm/.env' });
const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();

  console.log('=== 1. Поставщик «ТЕСТ-УДАЛИТЬ» (#480) ===');
  const sup = (await c.query(`SELECT id, name, inn FROM suppliers WHERE id=480`)).rows[0];
  if (!sup) {
    console.log('  уже нет');
  } else {
    const inv = (await c.query('SELECT count(*)::int n FROM payment_invoices WHERE supplier_id=480')).rows[0].n;
    const doc = (await c.query('SELECT count(*)::int n FROM doc_registry WHERE supplier_id=480')).rows[0].n;
    console.log('  ' + JSON.stringify(sup) + ' | заявок: ' + inv + ', реестр: ' + doc);
    if (inv === 0 && doc === 0) {
      if (APPLY) { await c.query('DELETE FROM suppliers WHERE id=480'); console.log('  УДАЛЁН'); }
      else console.log('  (dry-run) будет удалён');
    } else {
      console.log('  НЕ удаляю: есть ссылки');
    }
  }

  console.log('\n=== 2. Мой комментарий в черновике #16 ===');
  const d16 = (await c.query('SELECT id, comment_text FROM payment_invoices WHERE id=16')).rows[0];
  console.log('  ' + JSON.stringify(d16));
  if (d16 && d16.comment_text) {
    if (APPLY) { await c.query(`UPDATE payment_invoices SET comment_text=NULL, updated_at=NOW() WHERE id=16`); console.log('  комментарий снят'); }
    else console.log('  (dry-run) комментарий будет снят');
  }

  console.log('\n=== 3. Строка реестра-сирота #1608 (сумма 0, без заявки) ===');
  const orphan = (await c.query(`SELECT id, counterparty_name, amount_gross, payment_invoice_id, created_at
    FROM doc_registry WHERE id=1608`)).rows[0];
  if (!orphan) {
    console.log('  уже нет');
  } else {
    console.log('  ' + JSON.stringify(orphan));
    // Создана 23.10 07:47 — это НЕ мои пробы (я работал вечером 23-го и 24-го).
    // Оставляю: возможно, реальная работа пользователя, просто не привязана.
    console.log('  НЕ трогаю: создана утром 23.10, до моих работ. Это не мой мусор.');
  }

  console.log('\n=== Итог по мусору ===');
  const q = async (s) => (await c.query(s)).rows[0].n;
  console.log('  поставщиков «ТЕСТ»:', await q(`SELECT count(*)::int n FROM suppliers WHERE deleted_at IS NULL AND name ~* '^(ТЕСТ|ООО Тест)'`));
  console.log('  счетов с тестовыми именами:', await q(`SELECT count(*)::int n FROM payment_invoices WHERE supplier_name ~* '^(ТЕСТ|ООО Тест|ООО ЦЕПОЧКА|ООО ПОСТ)'`));
  console.log('  заявок с моими комментариями:', await q(`SELECT count(*)::int n FROM payment_invoices WHERE comment_text ~* '(D-369|D-370|E2E:)'`));

  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
