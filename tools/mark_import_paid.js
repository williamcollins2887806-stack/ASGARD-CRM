'use strict';
/**
 * D-367 (заказчик 23.10.2026): «все оплачены, если созданы ДО импорта в СРМ.
 * То, что создано в СРМ и имеет заявку — не помечаем, там бухгалтерия отметит».
 *
 * ПРАВИЛО:
 *   • payment_invoice_id IS NULL (импорт, история) → pay_status='paid'
 *   • payment_invoice_id IS NOT NULL (создано через почту/заявку) → НЕ ТРОГАЕМ
 *
 * ИСКЛЮЧЕНИЯ, названные заказчиком (позиции 1 и 2 из таблицы 88 неоплаченных):
 *   • АДАБАШ АНДРЕЙ СЕРГЕЕВИЧ — 34 счёта (без ИНН)
 *   • ООО «КОМУС» (ИНН 7721793895) — 6 счетов без закрывающих
 * Эти 40 остаются как есть (оплата не подтверждена).
 *
 * Режим: dry-run / --apply.
 */
const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');
const NOTE = ' [оплачено: исторический счёт до импорта в СРМ, подтверждено заказчиком 23.10.2026]';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  console.log(`РЕЖИМ: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}\n`);

  // 1. Проверяем, что 'paid' допустим.
  console.log('=== 1. Допустимо ли pay_status=paid ===');
  try {
    await q(`UPDATE doc_registry SET pay_status='paid', updated_at=NOW() WHERE id=-1`);
    console.log('  ✓ допустимо');
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    await c.end(); return;
  }

  // 2. Исключения — точный отбор (те же условия, что в отчёте 88).
  console.log('\n=== 2. Исключения (остаются неоплаченными) ===');
  const exRows = await q(`
      SELECT id, counterparty_name, counterparty_inn, amount_gross
        FROM doc_registry
       WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NULL
         AND (
           counterparty_name ILIKE '%АДАБАШ%'
           OR regexp_replace(coalesce(counterparty_inn,''), '\\D', '', 'g') = '7721793895'
         )
         AND NOT (
           EXTRACT(YEAR FROM COALESCE(invoice_date, created_at::date)) = 2025
           OR (COALESCE(invoice_date, created_at::date) >= '2026-01-01'
               AND COALESCE(invoice_date, created_at::date) < '2026-08-01')
           OR sf_received_at IS NOT NULL
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(closing_json)='array' THEN closing_json ELSE '[]'::jsonb END) e
               WHERE COALESCE(trim(e->>'no'),'') <> '' AND length(trim(e->>'no')) > 1)
         )
       ORDER BY id`);
  const exIds = exRows.map((r) => r.id);
  const exSum = exRows.reduce((s, r) => s + Number(r.amount_gross), 0);
  console.log(`  АДАБАШ + КОМУС без закрывающих: ${exRows.length} счетов на ${Math.round(exSum).toLocaleString('ru-RU')} ₽`);
  const byCp = {};
  for (const r of exRows) {
    const k = /АДАБАШ/i.test(r.counterparty_name) ? 'АДАБАШ' : 'КОМУС';
    byCp[k] = (byCp[k] || 0) + 1;
  }
  for (const [k, v] of Object.entries(byCp)) console.log(`    ${k}: ${v}`);

  // 3. Что помечаем.
  console.log('\n=== 3. К пометке «оплачено» ===');
  const target = (await q(`
      SELECT count(*)::int n, COALESCE(SUM(amount_gross),0)::float8 s
        FROM doc_registry
       WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NULL
         AND id <> ALL($1::int[])
         AND COALESCE(pay_status,'') <> 'paid'`, [exIds.length ? exIds : [0]]))[0];
  console.log(`  ${target.n} счетов на ${Math.round(target.s).toLocaleString('ru-RU')} ₽`);

  console.log('\n=== 4. НЕ трогаем: счета с заявкой (созданы через почту) ===');
  const withPay = (await q(`SELECT count(*)::int n, COALESCE(SUM(amount_gross),0)::float8 s
      FROM doc_registry WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NOT NULL`))[0];
  console.log(`  ${withPay.n} счетов на ${Math.round(withPay.s).toLocaleString('ru-RU')} ₽ — их отметит бухгалтерия`);

  if (APPLY) {
    console.log('\n=== 5. Применяю ===');
    const upd = await q(`
      UPDATE doc_registry
         SET pay_status='paid',
             ops_status = CASE WHEN COALESCE(ops_status,'') IN ('wait_pay','wait_sf','wait_closing','draft')
                               THEN 'done' ELSE ops_status END,
             comment_text = CASE
               WHEN COALESCE(comment_text,'') LIKE '%исторический счёт до импорта%' THEN comment_text
               ELSE rtrim(COALESCE(comment_text,'')) || $2
             END,
             updated_at=NOW()
       WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NULL
         AND id <> ALL($1::int[])
         AND COALESCE(pay_status,'') <> 'paid'
      RETURNING id`, [exIds.length ? exIds : [0], NOTE]);
    console.log(`  ✓ обновлено: ${upd.length}`);
  }

  // 6. Итог.
  console.log('\n=== 6. СВЕРКА ПОСЛЕ ===');
  for (const r of await q(`SELECT
        count(*) FILTER (WHERE pay_status='paid')::int paid,
        count(*) FILTER (WHERE COALESCE(pay_status,'')<>'paid')::int not_paid,
        count(*) FILTER (WHERE pay_status='paid')::int dummy
      FROM doc_registry WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NULL`))
    console.log(`  без заявки: оплачено ${r.paid}, не оплачено ${r.not_paid}`);
  for (const r of await q(`SELECT pay_status, count(*)::int n FROM doc_registry
      WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NULL GROUP BY 1 ORDER BY 2 DESC`))
    console.log(`    ${r.pay_status}: ${r.n}`);
  console.log(`  с заявкой (не трогали): ${(await q(`SELECT count(*)::int n FROM doc_registry
      WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NOT NULL AND pay_status='paid'`))[0].n} оплачено`);

  console.log(`\n${APPLY ? 'ГОТОВО' : 'это dry-run, для применения: --apply'}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
