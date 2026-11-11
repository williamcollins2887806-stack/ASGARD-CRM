'use strict';
/**
 * V483c: деактивация ПУСТЫХ дублей карточек контрагентов.
 *
 * РАЗРЕШЕНО заказчиком 11.11.2026.
 *
 * Что делает: помечает `deleted_at` у карточек, которые
 *   • имеют 0 документов в doc_registry (и 0 в payment_invoices),
 *   • дублируют по нормализованному имени карточку с документами,
 *   • имеют ПУСТОЙ ИНН (если у дубля другой ИНН — это другое юрлицо, не трогаем).
 *
 * Почему деактивация, а не DELETE: за карточкой могут стоять платёжные реквизиты,
 * история правок и будущие счета. `deleted_at` скрывает её из выбора, но данные
 * остаются — решение обратимо.
 *
 * Запуск: node tools/deactivate-empty-dupes.js [--apply]
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

/** Ключ сравнения: только буквы/цифры, нижний регистр. */
function key(name) {
  return String(name || '').toLowerCase().replace(/[^а-яёa-z0-9]/gi, '');
}

(async () => {
  // Все активные карточки + сколько у них документов в двух таблицах.
  const rows = await db.query(
    `SELECT s.id, s.name, coalesce(NULLIF(trim(s.inn),''),'') AS inn,
            (SELECT count(*) FROM doc_registry d
              WHERE d.supplier_id = s.id AND d.deleted_at IS NULL)::int AS docs,
            (SELECT count(*) FROM payment_invoices pi
              WHERE pi.supplier_id = s.id)::int AS invoices
       FROM suppliers s
      WHERE s.deleted_at IS NULL
      ORDER BY s.id`);

  const byKey = new Map();
  for (const r of rows.rows) {
    const k = key(r.name);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }

  const toDeactivate = [];
  const needHuman = [];
  for (const [k, group] of byKey) {
    if (group.length < 2) continue;
    const empty = group.filter((r) => r.docs === 0 && r.invoices === 0);
    const filled = group.filter((r) => r.docs > 0 || r.invoices > 0);
    if (!filled.length) { needHuman.push({ k, group, why: 'все карточки пусты — неясно, какая основная' }); continue; }

    for (const e of empty) {
      // Пустой ИНН = заведена по ошибке/недозаполнена → безопасно скрыть.
      if (!e.inn) { toDeactivate.push({ ...e, keep: filled[0] }); continue; }
      // Непустой ИНН: если он совпадает с ИНН «основной» — тот же контрагент.
      const sameInn = filled.some((f) => f.inn && f.inn === e.inn);
      if (sameInn) toDeactivate.push({ ...e, keep: filled.find((f) => f.inn === e.inn) });
      else needHuman.push({ k, group, why: `пустая карточка ${e.id} с ДРУГИМ ИНН ${e.inn} — возможно, отдельное юрлицо` });
    }
  }

  console.log('=== К ДЕАКТИВАЦИИ (пустые дубли без своего ИНН) ===');
  if (!toDeactivate.length) console.log('  (нет)');
  for (const r of toDeactivate) {
    console.log(`  ${r.id} «${r.name}» [ИНН ${r.inn || '—'}] → скрыть; остаётся ${r.keep.id} «${r.keep.name}» (док=${r.keep.docs})`);
  }

  if (needHuman.length) {
    console.log('\n=== ТРЕБУЕТ РЕШЕНИЯ ЧЕЛОВЕКА (не трогаем) ===');
    for (const h of needHuman) {
      console.log(`  ${h.why}`);
      for (const g of h.group) {
        console.log(`    ${g.id} «${g.name}» [ИНН ${g.inn || '—'}] док=${g.docs} заявок=${g.invoices}`);
      }
    }
  }

  if (!APPLY) {
    console.log(`\nСухой прогон. К деактивации: ${toDeactivate.length}. Для применения: --apply`);
    await db.end();
    return;
  }

  await db.query('BEGIN');
  try {
    let n = 0;
    for (const r of toDeactivate) {
      const u = await db.query(
        `UPDATE suppliers SET deleted_at = NOW(), updated_at = NOW()
          WHERE id=$1 AND deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM doc_registry d
                             WHERE d.supplier_id=$1 AND d.deleted_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM payment_invoices pi WHERE pi.supplier_id=$1)`,
        [r.id]);
      n += u.rowCount;
    }
    await db.query('COMMIT');
    console.log(`\nдеактивировано карточек: ${n}`);
  } catch (e) {
    await db.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
    await db.end();
    process.exit(1);
  }
  await db.end();
})().catch((e) => { console.error('ERR', e.message); db.end(); process.exit(1); });
