'use strict';
/**
 * D-377q: масштаб расхождения ставки НДС в реестре.
 *
 * Симптом на #25/#41: amount_net/vat_amount посчитаны по 5 %, а vat_rate
 * в doc_registry = 0.2200. Doc Hub покажет «НДС 22 %», бухгалтер увидит
 * неверную ставку при верной сумме вычета.
 *
 * Причина в payment-mail.js:1051 — ставка обновляется ТОЛЬКО если текущая 0:
 *   vat_rate = CASE WHEN COALESCE(d.vat_rate,0)=0 AND $11>0 THEN $11 ELSE d.vat_rate END
 * Если в реестре уже лежало дефолтное 0.22 (OCR/создание), верное 0.05 не
 * записывается никогда.
 *
 * Считаем: у скольких документов фактическая доля (vat/amount_net) расходится
 * с записанной vat_rate больше чем на 1 п.п.
 *
 * ТОЛЬКО ЧТЕНИЕ.
 */
const pg = require('/var/www/asgard-crm/node_modules/pg');
require('/var/www/asgard-crm/node_modules/dotenv').config({ path: '/var/www/asgard-crm/.env' });

(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();

  const rows = (await c.query(`
    SELECT id, amount_gross, amount_net, vat_amount, vat_rate, has_vat, invoice_number,
           counterparty_name
      FROM doc_registry
     WHERE has_vat = true AND COALESCE(amount_net,0) > 0 AND COALESCE(vat_amount,0) > 0
     ORDER BY id`)).rows;

  let bad = 0;
  const list = [];
  for (const r of rows) {
    const implied = Number(r.vat_amount) / Number(r.amount_net);   // доля
    const stored = Number(r.vat_rate);
    if (Math.abs(implied - stored) > 0.01) {
      bad++;
      list.push({ ...r, implied });
    }
  }
  console.log(`документов с НДС: ${rows.length}`);
  console.log(`с расхождением ставки (>1 п.п.): ${bad}\n`);

  for (const r of list.slice(0, 30)) {
    console.log(`  #${r.id} №${r.invoice_number || '—'} · ${String(r.counterparty_name || '').slice(0, 34)}`);
    console.log(`      сумма ${Number(r.amount_gross).toLocaleString('ru-RU')} | нетто ${Number(r.amount_net).toLocaleString('ru-RU')} | НДС ${Number(r.vat_amount).toLocaleString('ru-RU')}`);
    console.log(`      записано ${(Number(r.vat_rate) * 100).toFixed(2)} % | по суммам ${(r.implied * 100).toFixed(2)} %`);
  }
  if (list.length > 30) console.log(`  … ещё ${list.length - 30}`);

  // Отдельно: наши два счёта.
  console.log('\n── проверяемые счета:');
  for (const id of [1592, 1607]) {
    const d = (await c.query(`SELECT id, invoice_number, amount_gross, amount_net, vat_amount, vat_rate FROM doc_registry WHERE id=$1`, [id])).rows[0];
    if (!d) continue;
    const imp = Number(d.vat_amount) / Number(d.amount_net);
    console.log(`  #${d.id} ${d.invoice_number}: записано ${(Number(d.vat_rate) * 100).toFixed(2)} %, по суммам ${(imp * 100).toFixed(2)} %`);
  }

  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
