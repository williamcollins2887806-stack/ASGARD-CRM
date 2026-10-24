'use strict';
/**
 * Чистка стенда после съёмки скриншотов.
 *
 * Мастер загрузки при каждой прокрутке создаёт ЧЕРНОВИКИ (это его штатное
 * поведение: upload → POST-черновик). После нескольких прогонов на локальной
 * БД накопилось 14 счетов вместо 7 демо. Здесь удаляем именно брошенные
 * черновики демо-пользователя, не трогая 7 подготовленных карточек.
 *
 * Только localhost/asgard_crm_dev.
 */
const pg = require(process.cwd() + '/node_modules/pg');
const DB = 'postgres://asgard:123456789@localhost/asgard_crm_dev';
const DEMO_USER = 3471;

(async () => {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();

  const before = await c.query(
    `SELECT id, status, supplier_name, amount FROM payment_invoices WHERE created_by=$1 ORDER BY id DESC`,
    [DEMO_USER]);
  console.log('счетов у демо-пользователя до чистки:', before.rows.length);
  for (const x of before.rows) {
    console.log(`  #${x.id} ${String(x.status).padEnd(16)} ${String(x.supplier_name).slice(0, 30)}`);
  }

  // Удаляем ТОЛЬКО черновики (status='draft'). Демо-карточки для скриншотов
  // имеют статусы awaiting_dir / pending_payment / paid / rejected — они целы.
  const del = await c.query(
    `DELETE FROM payment_invoices WHERE created_by=$1 AND status='draft'`, [DEMO_USER]);
  console.log('\nудалено брошенных черновиков:', del.rowCount);

  const after = await c.query(
    `SELECT status, count(*)::int n FROM payment_invoices WHERE created_by=$1 GROUP BY status`, [DEMO_USER]);
  console.log('осталось:', JSON.stringify(after.rows));

  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
