/**
 * expense-dedup-object (находка 17.10.2026): один счёт не должен давать ДВА
 * расхода по объекту. Проверяем единый ключ `invoice:<docId>` для обоих путей:
 *  - ручная привязка из карточки Doc Hub (link-expense);
 *  - авто-расход после оплаты (autoWorkExpense).
 * Плюс: фолбэк-поиск уже существующего расхода (старые ключи).
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { Client } = require('pg');
const { insertWorkExpense } = require('../src/services/work-expense-writer');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();
  const w = (await db.query(`SELECT id FROM works WHERE deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
  const docId = 990001;
  const key = `invoice:${docId}`;
  // Чистим артефакты прошлых прогонов (тест мог упасть до уборки).
  await db.query(`DELETE FROM work_expenses WHERE doc_number LIKE 'DUP-%'`).catch(() => {});

  console.log('=== 1. Оба пути пишут ОДИН ключ → одна строка ===');
  const a = await insertWorkExpense(db, {
    work_id: w.id, category: 'materials', amount: 7000, doc_number: 'DUP-1',
    description: 'ручная привязка (link-expense)',
    source_table: 'doc_registry', source_key: key, created_by: 1
  });
  const b = await insertWorkExpense(db, {
    work_id: w.id, category: 'materials', amount: 7000, doc_number: 'DUP-1',
    description: 'после оплаты (autoWorkExpense)',
    source_table: 'doc_registry', source_key: key, created_by: 1
  });
  ok(a.id === b.id, 'ручная привязка и авто-расход обновляют ОДНУ строку (id ' + a.id + ' = ' + b.id + ')');

  const cnt = await db.query(`SELECT count(*)::int n FROM work_expenses WHERE work_id=$1 AND doc_number='DUP-1'`, [w.id]);
  ok(cnt.rows[0].n === 1, 'по счёту ровно ОДИН расход в объекте (найдено ' + cnt.rows[0].n + ')');

  console.log('\n=== 2. Фолбэк: старый расход с ДРУГИМ ключом находится по работе+сумме+номеру ===');
  const oldKey = `doc_registry:${docId}`;
  const old = await insertWorkExpense(db, {
    work_id: w.id, category: 'materials', amount: 7000, doc_number: 'DUP-1',
    description: 'старая запись (ключ doc_registry:...)',
    source_table: 'doc_registry', source_key: oldKey, created_by: 1
  });
  // Эмулируем фолбэк-проверку из роута (как в /:id/link-expense).
  const dup = await db.query(
    `SELECT id FROM work_expenses
      WHERE work_id=$1 AND COALESCE(source_key,'') <> $2
        AND ABS(amount - $3::numeric) < 0.01
        AND ($4::varchar IS NULL OR doc_number IS NULL OR doc_number = $4)
      LIMIT 1`,
    [w.id, key, 7000, 'DUP-1']
  );
  ok(dup.rows.length === 1, 'дубль со старым ключом обнаружен (id ' + (dup.rows[0] && dup.rows[0].id) + ')');

  console.log('\n=== 3. Разные счета → разные расходы (не склеиваем лишнее) ===');
  const c2 = await insertWorkExpense(db, {
    work_id: w.id, category: 'materials', amount: 7000, doc_number: 'DUP-2',
    description: 'другой счёт', source_table: 'doc_registry', source_key: `invoice:990002`, created_by: 1
  });
  ok(c2.id !== a.id, 'другой счёт даёт свою строку расхода (id ' + c2.id + ')');

  // уборка
  await db.query(`DELETE FROM work_expenses WHERE id = ANY($1::int[])`, [[a.id, old.id, c2.id]]).catch(() => {});
  const left = await db.query(`SELECT count(*)::int n FROM work_expenses WHERE work_id=$1 AND doc_number LIKE 'DUP-%'`, [w.id]);
  ok(left.rows[0].n === 0, 'тестовые строки удалены (осталось ' + left.rows[0].n + ')');

  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
