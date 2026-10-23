const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);

  const BASE = `deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NULL`;
  const PAID_RULE = `(
        EXTRACT(YEAR FROM COALESCE(invoice_date, created_at::date)) = 2025
        OR (COALESCE(invoice_date, created_at::date) >= '2026-01-01'
            AND COALESCE(invoice_date, created_at::date) < '2026-08-01')
        OR sf_received_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(closing_json)='array' THEN closing_json ELSE '[]'::jsonb END) e
            WHERE COALESCE(trim(e->>'no'),'') <> '' AND length(trim(e->>'no')) > 1)
      )`;

  console.log('=== СВОДКА ===');
  for (const r of await q(`SELECT
      count(*)::int all_n,
      count(*) FILTER (WHERE ${PAID_RULE})::int paid_n,
      count(*) FILTER (WHERE NOT ${PAID_RULE})::int unpaid_n,
      COALESCE(SUM(amount_gross),0)::float8 all_s,
      COALESCE(SUM(amount_gross) FILTER (WHERE ${PAID_RULE}),0)::float8 paid_s,
      COALESCE(SUM(amount_gross) FILTER (WHERE NOT ${PAID_RULE}),0)::float8 unpaid_s
    FROM doc_registry WHERE ${BASE}`))
    console.log(`  всего ${r.all_n} (${Math.round(r.all_s).toLocaleString('ru-RU')} ₽) | станет оплачено ${r.paid_n} (${Math.round(r.paid_s).toLocaleString('ru-RU')} ₽) | останется ${r.unpaid_n} (${Math.round(r.unpaid_s).toLocaleString('ru-RU')} ₽)`);

  console.log('\n=== НЕОПЛАЧЕННЫЕ по ИНН (объединяет разные написания) ===');
  const rows = await q(`SELECT
        COALESCE(NULLIF(regexp_replace(coalesce(counterparty_inn,''), '\\D', '', 'g'), ''), '(без ИНН)') inn,
        MIN(counterparty_name) cp,
        count(*)::int n,
        COALESCE(SUM(amount_gross),0)::float8 s,
        MIN(COALESCE(invoice_date, created_at::date))::date d_min,
        MAX(COALESCE(invoice_date, created_at::date))::date d_max,
        string_agg(DISTINCT COALESCE(spend_kind,'?'), ',') kinds
      FROM doc_registry WHERE ${BASE} AND NOT ${PAID_RULE}
      GROUP BY 1 ORDER BY 3 DESC, 4 DESC`);
  console.log(`  контрагентов: ${rows.length}\n`);
  console.log('  № | шт |        сумма ₽ | период | вид | контрагент (ИНН)');
  console.log('  --+----+----------------+--------+-----+------------------');
  let i = 0;
  for (const r of rows) {
    i++;
    const per = `${String(r.d_min).slice(8,10)}.${String(r.d_min).slice(5,7)}..${String(r.d_max).slice(8,10)}.${String(r.d_max).slice(5,7)}`;
    console.log(`  ${String(i).padStart(2)} | ${String(r.n).padStart(2)} | ${String(Math.round(r.s)).padStart(14)} | ${per.padEnd(11)} | ${String(r.kinds).slice(0,3).padEnd(3)} | ${String(r.cp).slice(0, 40)} ${r.inn !== '(без ИНН)' ? '(' + r.inn + ')' : ''}`);
  }

  console.log('\n=== ПОЧЕМУ НЕ ПОДОШЛИ под правило (счётчики причин) ===');
  for (const r of await q(`SELECT
      count(*) FILTER (WHERE NOT (
        EXTRACT(YEAR FROM COALESCE(invoice_date, created_at::date)) = 2025
        OR (COALESCE(invoice_date, created_at::date) >= '2026-01-01'
            AND COALESCE(invoice_date, created_at::date) < '2026-08-01')
        OR sf_received_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(closing_json)='array' THEN closing_json ELSE '[]'::jsonb END) e
            WHERE COALESCE(trim(e->>'no'),'') <> '' AND length(trim(e->>'no')) > 1)
      ))::int no_rule,
      count(*) FILTER (WHERE NOT ${PAID_RULE} AND sf_received_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(closing_json)='array' THEN closing_json ELSE '[]'::jsonb END) e
            WHERE COALESCE(trim(e->>'no'),'') <> '' AND length(trim(e->>'no')) > 1))::int no_closing
    FROM doc_registry WHERE ${BASE}`)) {
    console.log(`  не подошли под правило: ${r.no_rule}, из них БЕЗ закрывающих: ${r.no_closing}`);
  }
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
