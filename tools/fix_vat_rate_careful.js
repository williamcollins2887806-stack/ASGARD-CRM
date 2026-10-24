'use strict';
/**
 * D-377v: уточнение правки ставок — не навредить.
 *
 * Массовый пересчёт «ставка = НДС / нетто» верен только там, где суммы
 * корректны. На двух документах суммы БИТЫЕ, и пересчёт дал абсурд:
 *
 *   #1600 «Комус»: брутто 34 313,65 / нетто 34 303,65 / «НДС» 10,00 ₽
 *   #1601 «Комус»: брутто  6 072,36 / нетто  6 050,36 / «НДС» 22,00 ₽
 *
 * 10 и 22 — это СТАВКИ, записанные в поле суммы. При 22 % «в том числе»
 * НДС должен быть 6 187,71 ₽ и 1 095,02 ₽. Суммы не трогаем (это деньги и
 * отдельное решение), ставку возвращаем к 22 % — как было до моей правки.
 *
 *   #1520 «АэроОтель»: в заявке ставка 10 %, НДС 757,38 ₽ — арифметика
 *   округления даёт 9,91 %. Ставка в документе должна быть 10 %, а не 22 %
 *   (было) и не 9,91 % (мой пересчёт).
 *
 * Идемпотентно.
 */
const pg = require('/var/www/asgard-crm/node_modules/pg');
require('/var/www/asgard-crm/node_modules/dotenv').config({ path: '/var/www/asgard-crm/.env' });

const FIX = [
  { id: 1520, rate: 0.10, why: 'в заявке ставка 10 %, суммы округлены' },
  { id: 1600, rate: 0.22, why: 'суммы НДС битые (записана ставка) — ставку возвращаем, суммы отдельным решением' },
  { id: 1601, rate: 0.22, why: 'суммы НДС битые (записана ставка) — ставку возвращаем, суммы отдельным решением' },
];

(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();

  for (const f of FIX) {
    const before = (await c.query(`SELECT id, vat_rate, vat_amount, amount_net, invoice_number FROM doc_registry WHERE id=$1`, [f.id])).rows[0];
    if (!before) { console.log(`#${f.id}: нет документа`); continue; }
    if (Math.abs(Number(before.vat_rate) - f.rate) < 0.0001) {
      console.log(`#${f.id}: уже ${f.rate} — пропуск`);
      continue;
    }
    await c.query(`UPDATE doc_registry SET vat_rate=$2, updated_at=NOW() WHERE id=$1`, [f.id, f.rate]);
    console.log(`#${f.id} №${before.invoice_number}: ${(Number(before.vat_rate) * 100).toFixed(2)} % → ${(f.rate * 100).toFixed(0)} %`);
    console.log(`   причина: ${f.why}`);
  }

  console.log('\n── состояние двух наших счетов (не трогаем):');
  for (const id of [1592, 1607]) {
    const d = (await c.query(`SELECT id, invoice_number, amount_gross, amount_net, vat_amount, vat_rate FROM doc_registry WHERE id=$1`, [id])).rows[0];
    if (d) console.log(`  #${d.id} ${d.invoice_number}: ${d.amount_gross} = ${d.amount_net} + ${d.vat_amount}, ставка ${(Number(d.vat_rate) * 100).toFixed(2)} %`);
  }

  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
