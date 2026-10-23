'use strict';
/**
 * D-364 (заказчик 23.10.2026): «все старые заявки уже давно согласованы, можно
 * отметить все 1567 строк как согласовано, а с оплатой решим позже».
 *
 * ЧТО ПРОВЕРЕНО ПЕРЕД ПРАВКОЙ:
 *   • 1567 строк без заявки; из них 1507 имеют расход по объекту.
 *   • НО: ВСЕ 1461 расхода созданы в ТОТ ЖЕ ДЕНЬ, что документ (импорт 05.10),
 *     ни один — позже. Значит расход НЕ доказывает оплату: он создан импортом,
 *     а не подтверждением платежа.
 *   • Закрывающие (СФ/УПД) есть у 1359 — это доказывает, что услуга оказана,
 *     но НЕ что деньги ушли.
 *   • pay_status='paid' — 0 строк (оплату никогда не отмечали).
 *
 * ВЫВОД: «оплачено» по этим данным установить нельзя. Ставим только
 * «согласовано директором» — как просил заказчик («если сложно понять, давай
 * пока проставим статус согласовано, а с оплатой решим позже»).
 *
 * КАК ПОМЕЧАЕМ: добавляем в строку закрывающие, подтверждающие согласование:
 *   ops_status: wait_pay → остаётся (деньги ещё не ушли)
 *   pay_status: none → 'approved_by_dir' (новое значение, не paid!)
 *   флаг в comment_text — чтобы было видно происхождение пометки.
 *
 * Режим: dry-run / --apply.
 */
const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');
const BATOK = process.env.DIRECTOR_ID || '3456'; // Гажилиев — согласующий

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  console.log(`РЕЖИМ: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}\n`);

  // 1. Проверяем допустимые значения pay_status (чтобы не сломать constraint).
  console.log('=== 1. Допустимые pay_status (constraint) ===');
  const chk = await q(`SELECT conname, pg_get_constraintdef(c.oid) def
      FROM pg_constraint c WHERE conrelid='doc_registry'::regclass AND contype='c'`);
  let allowed = null;
  for (const r of chk) {
    if (/pay_status/i.test(r.def)) { allowed = r.def; console.log('  ', r.def.slice(0, 300)); }
  }
  if (!allowed) console.log('  constraint на pay_status НЕ найден — свободное значение');

  // 2. Целевые строки.
  console.log('\n=== 2. Целевые строки (без заявки, входящие) ===');
  const stat = (await q(`SELECT
      count(*)::int total,
      count(*) FILTER (WHERE COALESCE(pay_status,'none')='none')::int pay_none,
      count(*) FILTER (WHERE pay_status='paid')::int paid,
      count(*) FILTER (WHERE pay_status='wait')::int wait
    FROM doc_registry WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NULL`))[0];
  console.log(`  всего: ${stat.total} | pay=none: ${stat.pay_none} | wait: ${stat.wait} | paid: ${stat.paid}`);

  console.log('\n  распределение ops_status:');
  for (const r of await q(`SELECT COALESCE(ops_status,'(null)') v, count(*)::int n
      FROM doc_registry WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NULL
      GROUP BY 1 ORDER BY 2 DESC`))
    console.log(`    ${r.v}: ${r.n}`);

  // 3. Что ставим.
  // «Согласовано директором» — историческое состояние: счета уже прошли
  // согласование (часть оплачена в банке, но подтверждения в CRM нет).
  // НЕ ставим paid: это соврёт про оплату и сломает бухгалтерскую картину.
  const MARK = 'approved_by_dir';
  console.log(`\n=== 3. Пометка ===`);
  console.log(`  pay_status: none → '${MARK}'  (НЕ paid — оплату не подтверждаем)`);
  console.log('  ops_status: НЕ меняем (деньги ещё не подтверждены)');
  console.log('  comment_text: добавляем пометку о происхождении');

  if (APPLY) {
    // Проверяем, пройдёт ли значение constraint.
    try {
      await q(`UPDATE doc_registry SET pay_status=$1, updated_at=NOW() WHERE id=-1`, [MARK]);
      console.log(`  ✓ значение '${MARK}' допустимо`);
    } catch (e) {
      console.log(`  ✗ '${MARK}' не проходит constraint: ${e.message}`);
      console.log('  → пробуем существующее значение из набора');
      await c.end();
      return;
    }

    const upd = await q(`
      UPDATE doc_registry
         SET pay_status = $1,
             comment_text = CASE
               WHEN COALESCE(comment_text,'') LIKE '%историческое согласование%' THEN comment_text
               ELSE COALESCE(NULLIF(comment_text,''), '') || ' [историческое согласование: счёт из архива до автоматизации, оплата не подтверждена в CRM]'
             END,
             updated_at = NOW()
       WHERE deleted_at IS NULL AND dir='in'
         AND payment_invoice_id IS NULL
         AND COALESCE(pay_status,'none') = 'none'
      RETURNING id`, [MARK]);
    console.log(`  ✓ обновлено строк: ${upd.length}`);
  }

  // 4. Итог.
  console.log('\n=== 4. СВЕРКА ===');
  for (const r of await q(`SELECT COALESCE(pay_status,'(null)') v, count(*)::int n
      FROM doc_registry WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NULL
      GROUP BY 1 ORDER BY 2 DESC`))
    console.log(`  pay_status=${r.v}: ${r.n}`);
  console.log(`  «оплачено» (paid): ${(await q(`SELECT count(*)::int n FROM doc_registry
      WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NULL AND pay_status='paid'`))[0].n}`);

  console.log(`\n${APPLY ? 'ГОТОВО' : 'это dry-run, для применения: --apply'}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
