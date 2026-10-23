const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);

  // Базовый набор: входящие, без заявки (архив), не удалённые
  const BASE = `deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NULL`;

  console.log('=== БАЗА: все строки, которые рассматриваем ===');
  const base = (await q(`SELECT count(*)::int n, COALESCE(SUM(amount_gross),0)::float8 s
      FROM doc_registry WHERE ${BASE}`))[0];
  console.log(`  всего без заявки: ${base.n} на ${base.s.toLocaleString('ru-RU')} ₽`);

  // Правило 1: 2025 год
  const r1 = (await q(`SELECT count(*)::int n, COALESCE(SUM(amount_gross),0)::float8 s
      FROM doc_registry WHERE ${BASE}
        AND EXTRACT(YEAR FROM COALESCE(invoice_date, created_at::date)) = 2025`))[0];
  // Правило 2: 2026 до 1 августа
  const r2 = (await q(`SELECT count(*)::int n, COALESCE(SUM(amount_gross),0)::float8 s
      FROM doc_registry WHERE ${BASE}
        AND COALESCE(invoice_date, created_at::date) >= '2026-01-01'
        AND COALESCE(invoice_date, created_at::date) < '2026-08-01'`))[0];
  // Правило 3: есть закрывающие (СФ получен ИЛИ closing_json с реальным документом)
  const r3 = (await q(`SELECT count(*)::int n, COALESCE(SUM(amount_gross),0)::float8 s
      FROM doc_registry WHERE ${BASE}
        AND (sf_received_at IS NOT NULL
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(closing_json)='array' THEN closing_json ELSE '[]'::jsonb END) e
                WHERE COALESCE(trim(e->>'no'),'') <> '' AND length(trim(e->>'no')) > 1))`))[0];

  console.log('\n=== КАНДИДАТЫ НА «ОПЛАЧЕНО» ===');
  console.log(`  1) счета 2025 года:                    ${String(r1.n).padStart(4)} на ${r1.s.toLocaleString('ru-RU')} ₽`);
  console.log(`  2) счета 2026 до 01.08.2026:           ${String(r2.n).padStart(4)} на ${r2.s.toLocaleString('ru-RU')} ₽`);
  console.log(`  3) есть закрывающие (СФ/УПД):          ${String(r3.n).padStart(4)} на ${r3.s.toLocaleString('ru-RU')} ₽`);

  // Итог объединения
  const all = (await q(`SELECT count(*)::int n, COALESCE(SUM(amount_gross),0)::float8 s
      FROM doc_registry WHERE ${BASE} AND (
        EXTRACT(YEAR FROM COALESCE(invoice_date, created_at::date)) = 2025
        OR (COALESCE(invoice_date, created_at::date) >= '2026-01-01'
            AND COALESCE(invoice_date, created_at::date) < '2026-08-01')
        OR sf_received_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(closing_json)='array' THEN closing_json ELSE '[]'::jsonb END) e
            WHERE COALESCE(trim(e->>'no'),'') <> '' AND length(trim(e->>'no')) > 1)
      )`))[0];
  console.log(`\n  ВСЕГО станет «оплачено»: ${all.n} на ${all.s.toLocaleString('ru-RU')} ₽`);

  // Остаток
  const rest = (await q(`SELECT count(*)::int n, COALESCE(SUM(amount_gross),0)::float8 s
      FROM doc_registry WHERE ${BASE} AND NOT (
        EXTRACT(YEAR FROM COALESCE(invoice_date, created_at::date)) = 2025
        OR (COALESCE(invoice_date, created_at::date) >= '2026-01-01'
            AND COALESCE(invoice_date, created_at::date) < '2026-08-01')
        OR sf_received_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(closing_json)='array' THEN closing_json ELSE '[]'::jsonb END) e
            WHERE COALESCE(trim(e->>'no'),'') <> '' AND length(trim(e->>'no')) > 1)
      )`))[0];
  console.log(`  ОСТАНЕТСЯ НЕОПЛАЧЕННЫХ: ${rest.n} на ${rest.s.toLocaleString('ru-RU')} ₽`);

  console.log('\n=== НЕОПЛАЧЕННЫЕ: разбивка по контрагентам ===');
  const rows = await q(`SELECT
        COALESCE(NULLIF(trim(counterparty_name),''), 'Без контрагента') cp,
        count(*)::int n,
        COALESCE(SUM(amount_gross),0)::float8 s,
        MIN(COALESCE(invoice_date, created_at::date))::date d_min,
        MAX(COALESCE(invoice_date, created_at::date))::date d_max
      FROM doc_registry WHERE ${BASE} AND NOT (
        EXTRACT(YEAR FROM COALESCE(invoice_date, created_at::date)) = 2025
        OR (COALESCE(invoice_date, created_at::date) >= '2026-01-01'
            AND COALESCE(invoice_date, created_at::date) < '2026-08-01')
        OR sf_received_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(closing_json)='array' THEN closing_json ELSE '[]'::jsonb END) e
            WHERE COALESCE(trim(e->>'no'),'') <> '' AND length(trim(e->>'no')) > 1)
      )
      GROUP BY 1 ORDER BY 2 DESC`);
  console.log(`  контрагентов: ${rows.length}\n`);
  for (const r of rows)
    console.log(`  ${String(r.n).padStart(3)} | ${String(Math.round(r.s)).padStart(10)} ₽ | ${String(r.d_min).slice(0,10)}..${String(r.d_max).slice(0,10)} | ${String(r.cp).slice(0, 45)}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
