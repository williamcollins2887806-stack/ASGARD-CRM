'use strict';
/**
 * V484: перенос документов с нерабочей карточки контрагента на рабочую.
 *
 * ЗАЧЕМ. Заказчик 11.11.2026: «3666113066 такого нет, мы с ним не работаем,
 * работаем только с 5009062762. И по ППР работаем только с 7743036465,
 * с 7840117279 не работаем. Перекинь все счета и документы.»
 *
 * То есть в справочнике было по две карточки одного контрагента, и часть счетов
 * висела на той, которой в реальности не существует. Нужно перенести ВСЁ.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ЧТО МЕНЯЕТСЯ (все таблицы с supplier_id, найденные в схеме):
 *   doc_registry                — счета и документы
 *   payment_invoices            — заявки на оплату
 *   price_records               — история цен
 *   procurement_items           — позиции закупок
 *   procurement_invoice_imports — импорты счетов закупок
 *   catalog_imports             — импорты каталога
 *   supplier_contacts           — контакты поставщика
 *   doc_reconciliation_acts     — акты сверки
 *
 * ПЛЮС: в doc_registry поле counterparty_inn хранит ИНН ТЕКСТОМ. Его тоже надо
 * переписать на ИНН рабочей карточки, иначе документ останется с «несуществующим»
 * ИНН и снова разъедется. Это НЕ подмена чужого ИНН: заказчик прямо сказал, что
 * первый ИНН недействителен, а счета — его.
 *
 * ЧЕГО НЕ ДЕЛАЕТ: не удаляет и не сливает карточки. Нерабочая остаётся пустой и
 * скрывается деактивацией — решение обратимо.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Запуск: node tools/transfer-supplier-docs.js [--apply]
 */
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

const db = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
});

/**
 * Пары «откуда → куда». Источник — карточка, с которой не работаем;
 * цель — рабочая. Указаны заказчиком 11.11.2026.
 */
const TRANSFERS = [
  {
    fromId: 56, fromInn: '3666113066', fromLabel: 'ООО "ОФИСМАГ" (Воронеж)',
    toId: 512, toInn: '5009062762', toLabel: 'ООО Офисмаг (Москва)',
  },
  {
    fromId: 81, fromInn: '7840117279', fromLabel: 'ООО "ППР" (СПб)',
    toId: 511, toInn: '7743036465', toLabel: 'ООО ППР (Москва)',
  },
];

/** Таблицы с supplier_id (проверено по information_schema на проде). */
const TABLES = [
  'doc_registry',
  'payment_invoices',
  'price_records',
  'procurement_items',
  'procurement_invoice_imports',
  'catalog_imports',
  'supplier_contacts',
  'doc_reconciliation_acts',
];

(async () => {
  console.log(`режим: ${APPLY ? 'ПРИМЕНИТЬ' : 'ПЛАН (ничего не пишем)'}\n`);

  for (const t of TRANSFERS) {
    console.log('═'.repeat(70));
    console.log(`${t.fromLabel} (id ${t.fromId}, ИНН ${t.fromInn})`);
    console.log(`   → ${t.toLabel} (id ${t.toId}, ИНН ${t.toInn})`);

    // Проверяем, что обе карточки существуют и ИНН совпадают с ожидаемым.
    const cards = await db.query(
      `SELECT id, name, inn, deleted_at FROM suppliers WHERE id IN ($1,$2) ORDER BY id`,
      [t.fromId, t.toId]);
    const from = cards.rows.find((r) => Number(r.id) === t.fromId);
    const to = cards.rows.find((r) => Number(r.id) === t.toId);
    if (!from || !to) { console.log('  СТОП: карточка не найдена'); continue; }
    if (String(from.inn || '').replace(/\D/g, '') !== t.fromInn) {
      console.log(`  СТОП: у ${t.fromId} ИНН ${from.inn}, ожидали ${t.fromInn}`); continue;
    }
    if (String(to.inn || '').replace(/\D/g, '') !== t.toInn) {
      console.log(`  СТОП: у ${t.toId} ИНН ${to.inn}, ожидали ${t.toInn}`); continue;
    }
    if (to.deleted_at) { console.log(`  СТОП: целевая карточка ${t.toId} деактивирована`); continue; }
    console.log(`  карточки: «${from.name}» → «${to.name}»  (ИНН совпали)`);

    // Сколько строк в каждой таблице
    for (const tbl of TABLES) {
      const q = await db.query(`SELECT count(*)::int n FROM ${tbl} WHERE supplier_id=$1`, [t.fromId]);
      if (q.rows[0].n > 0) console.log(`    ${tbl}: ${q.rows[0].n}`);
    }
    // ИНН в документах
    const innDocs = await db.query(
      `SELECT count(*)::int n FROM doc_registry WHERE supplier_id=$1 AND counterparty_inn=$2`,
      [t.fromId, t.fromInn]);
    console.log(`    doc_registry.counterparty_inn = ${t.fromInn}: ${innDocs.rows[0].n}`);
    console.log('');
  }

  if (!APPLY) {
    console.log('Сухой прогон. Для применения: --apply');
    await db.end();
    return;
  }

  console.log('--- применение ---');
  await db.query('BEGIN');
  try {
    for (const t of TRANSFERS) {
      let moved = 0;

      // 1. Переносим ссылки во всех таблицах.
      for (const tbl of TABLES) {
        const u = await db.query(
          `UPDATE ${tbl} SET supplier_id=$2 WHERE supplier_id=$1`, [t.fromId, t.toId]);
        moved += u.rowCount;
        if (u.rowCount) console.log(`  ${tbl}: ${u.rowCount}`);
      }

      // 2. ИНН текстом в документах — приводим к рабочему.
      const u2 = await db.query(
        `UPDATE doc_registry SET counterparty_inn=$2, updated_at=NOW()
          WHERE counterparty_inn=$1`, [t.fromInn, t.toInn]);
      console.log(`  doc_registry.counterparty_inn → ${t.toInn}: ${u2.rowCount}`);

      // 3. ИНН и имя в заявках — по supplier_id уже перенесены, но имя могло
      //    остаться от старой карточки. Приводим к рабочей.
      const toCard = (await db.query('SELECT name FROM suppliers WHERE id=$1', [t.toId])).rows[0];
      const u3 = await db.query(
        `UPDATE payment_invoices SET supplier_name=$2, counterparty_inn=$3, updated_at=NOW()
          WHERE supplier_id=$1`, [t.toId, String(toCard.name).trim(), t.toInn]);
      console.log(`  payment_invoices (имя+ИНН): ${u3.rowCount}`);

      // 4. Старую карточку скрываем — она пустая и недействительная.
      const left = await db.query(
        `SELECT
           (SELECT count(*) FROM doc_registry WHERE supplier_id=$1 AND deleted_at IS NULL)::int
         + (SELECT count(*) FROM payment_invoices WHERE supplier_id=$1)::int AS n`, [t.fromId]);
      if (Number(left.rows[0].n) === 0) {
        await db.query(
          `UPDATE suppliers SET deleted_at=NOW(), updated_at=NOW()
            WHERE id=$1 AND deleted_at IS NULL`, [t.fromId]);
        console.log(`  карточка ${t.fromId} скрыта (0 документов)`);
      } else {
        console.log(`  ВНИМАНИЕ: у ${t.fromId} осталось ${left.rows[0].n} строк — НЕ скрываем`);
      }
      console.log(`  перенесено ссылок: ${moved}\n`);
    }
    await db.query('COMMIT');
    console.log('COMMIT — применено');
  } catch (e) {
    await db.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
    await db.end();
    process.exit(1);
  }
  await db.end();
})().catch((e) => { console.error('ERR', e.message); db.end(); process.exit(1); });
