'use strict';

/**
 * D-328: поиск дублей расходов по проектам (один счёт — два расхода).
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик 21.10.2026: «проверь, что все счета идут в расходы по проектам,
 * сверяясь с дублями, чтобы не занести два раза одно и то же».
 *
 * Что считаем дублем (два независимых признака):
 *   A. Одинаковый (source_table, source_key) — ловится уникальным индексом,
 *      таких быть не должно;
 *   B. Один объект + один номер документа + одна сумма, но РАЗНЫЕ source_key.
 *      Это и есть реальный класс: в реестре две строки по одному счёту
 *      (разные id), каждая создала свой расход.
 *
 * Запуск: node tools/audit_expense_dups.js [--fix]
 *   --fix: помечает более поздний расход как 'rejected' (не удаляет: история).
 */

const path = process.cwd();
require(path + '/node_modules/dotenv').config({ path: path + '/.env' });
const { Client } = require(path + '/node_modules/pg');

const FIX = process.argv.includes('--fix');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;

  console.log('=== A. Дубли по (source_table, source_key) ===');
  const a = await q(`SELECT source_table, source_key, count(*)::int n, string_agg(id::text, ',' ORDER BY id) ids
      FROM work_expenses WHERE source_key IS NOT NULL
      GROUP BY 1,2 HAVING count(*) > 1`);
  if (!a.length) console.log('  нет — защита ключом работает');
  for (const r of a) console.log(`  ${r.source_table}/${r.source_key} ×${r.n} → #${r.ids}`);

  console.log('\n=== B. Один счёт — два расхода (номер + сумма + объект) ===');
  const b = await q(`
    SELECT a.work_id, a.doc_number, a.amount,
           a.id id1, b.id id2, a.source_key k1, b.source_key k2,
           a.created_at c1, b.created_at c2, a.status s1, b.status s2
      FROM work_expenses a
      JOIN work_expenses b
        ON a.work_id = b.work_id
       AND lower(trim(coalesce(a.doc_number,''))) = lower(trim(coalesce(b.doc_number,'')))
       AND abs(a.amount - b.amount) < 0.01
       AND a.id < b.id
     WHERE coalesce(trim(a.doc_number),'') <> ''
       AND COALESCE(a.status,'') <> 'rejected'
       AND COALESCE(b.status,'') <> 'rejected'
       AND a.source_key IS DISTINCT FROM b.source_key
     ORDER BY a.work_id, a.doc_number`);
  if (!b.length) console.log('  нет — дублей по счёту не найдено');
  let extra = 0;
  for (const r of b) {
    extra += Number(r.amount) || 0;
    console.log(`  work=${r.work_id} №${r.doc_number} ${r.amount} ₽`);
    console.log(`     #${r.id1} [${(r.k1 || 'вручную').slice(0, 22)}] ${new Date(r.c1).toISOString().slice(0, 10)} ${r.s1 || '-'}`);
    console.log(`     #${r.id2} [${(r.k2 || 'вручную').slice(0, 22)}] ${new Date(r.c2).toISOString().slice(0, 10)} ${r.s2 || '-'}`);
  }
  console.log(`\n  пар: ${b.length}, лишних денег: ${extra.toFixed(2)} ₽`);

  console.log('\n=== C. Итог по расходам объектов ===');
  console.log(JSON.stringify((await q(`SELECT count(*)::int total,
      COALESCE(SUM(amount),0)::float8 sum,
      COUNT(*) FILTER (WHERE source_table = 'doc_registry')::int from_doc_hub
    FROM work_expenses WHERE COALESCE(status,'') <> 'rejected'`))[0]));

  if (FIX && b.length) {
    console.log('\n=== FIX: помечаем более поздний расход как rejected ===');
    for (const r of b) {
      // Оставляем тот, что создан раньше и/или имеет статус confirmed.
      const keepFirst = new Date(r.c1) <= new Date(r.c2);
      const drop = keepFirst ? r.id2 : r.id1;
      await c.query(
        `UPDATE work_expenses SET status='rejected',
            comment = COALESCE(comment,'') || ' [D-328 авто: дубль расхода по счёту, оставлен ' ||
            CASE WHEN $2::int = id THEN '' ELSE '' END || ']'
          WHERE id=$1`, [drop, drop]);
      console.log(`  #${drop} → rejected (оставлен ${keepFirst ? r.id1 : r.id2})`);
    }
    const after = await q(`SELECT count(*)::int n, COALESCE(SUM(amount),0)::float8 s
      FROM work_expenses WHERE COALESCE(status,'') <> 'rejected'`);
    console.log(`  после: ${after[0].n} расходов на ${after[0].s.toFixed(2)} ₽`);
  } else if (b.length) {
    console.log('\n  (dry-run) запустите с --fix, чтобы пометить дубли');
  }

  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
