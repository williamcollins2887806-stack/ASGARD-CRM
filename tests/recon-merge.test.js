'use strict';
/**
 * V483: склейка контрагента в ОДИН акт сверки на живом API (:3100).
 *
 * Дефект: счета одного контрагента частично без ИНН → два акта на одного
 * контрагента, у одного из них «требуется запросить», хотя акт уже есть.
 */
const { Pool } = require('pg');
const BASE = 'http://127.0.0.1:3100';
const db = new Pool({
  host: '127.0.0.1', port: 5432, database: 'asgard_crm_test',
  user: 'asgard', password: '123456789'
});

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_buh', password: 'Test123!' })
  });
  const d = await r.json();
  let t = d.token;
  const r2 = await fetch(BASE + '/api/auth/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: JSON.stringify({ pin: '0000' })
  });
  const d2 = await r2.json();
  return d2.token || t;
}

(async () => {
  const t = await login();
  const H = { Authorization: 'Bearer ' + t };
  const INN = '7712345678';
  const tag = 'СКЛЕЙКА-' + Date.now();
  const nameA = tag + ' ООО «Ромашка»';
  const nameB = tag + ' ООО "РОМАШКА"';   // то же имя, другие кавычки/регистр

  // Убираем остатки прошлых прогонов: они попали бы в ту же группу по ИНН и
  // сломали бы ожидание «ровно 5 счетов». Тест должен быть воспроизводимым.
  await db.query(`DELETE FROM doc_registry WHERE counterparty_name ILIKE '%СКЛЕЙКА-%'`);
  await db.query(`DELETE FROM doc_reconciliation_acts WHERE counterparty_inn=$1`, [INN]);

  // 2 счёта с ИНН и 3 без ИНН, но с тем же именем (в разных написаниях).
  const ids = [];
  let seq = 0;
  for (const [nm, inn, ch] of [
    [nameA, INN, 'edo'], [nameA, INN, 'edo'],
    [nameA, null, null], [nameB, null, null], [nameB, null, 'edo']
  ]) {
    seq += 1;
    // Номер счёта обязан быть разным: uq_doc_registry_dedup ловит дубли по
    // (ИНН/имя, номер, дата, сумма). Тест создаёт похожие строки намеренно.
    const r = await db.query(
      `INSERT INTO doc_registry(dir, counterparty_name, counterparty_inn, invoice_number,
          invoice_date, amount_gross, pay_status, receive_channel, doc_owner_id, created_by, updated_by, currency)
       VALUES ('in',$1,$2,$3,'2026-11-05',1000,'paid',$4,1,1,1,'RUB') RETURNING id`,
      [nm, inn, 'S' + seq, ch]);
    ids.push(r.rows[0].id);
  }

  const res = await fetch(BASE + '/api/doc-registry/reconciliation?year=2026&quarter=4&scope=all',
    { headers: H });
  const data = await res.json();
  const mine = (data.items || []).filter((x) => String(x.name || '').includes(tag));

  console.log('  строк для тестового контрагента:', mine.length,
    '| сумма docs:', mine.reduce((s, x) => s + (x.docs || 0), 0));

  // Главное: один контрагент → ОДНА строка, все 5 счетов.
  (mine.length === 1) ? ok('один контрагент = один акт (склейка)')
    : bad('раздвоение: ' + mine.length + ' строк');
  (mine.length === 1 && mine[0].docs === 5) ? ok('в акте все 5 счетов')
    : bad('docs=' + (mine[0] && mine[0].docs));
  (mine.length === 1 && mine[0].inn === INN) ? ok('группой стал ИНН ' + INN)
    : bad('inn=' + (mine[0] && mine[0].inn));

  // Канал: 3 из 5 по ЭДО → большинство ЭДО.
  (mine.length === 1 && mine[0].receive_channel === 'edo')
    ? ok('канал посчитан по ВСЕМ счетам группы: edo')
    : bad('channel=' + (mine[0] && mine[0].receive_channel)
        + ' stats=' + JSON.stringify(mine[0] && mine[0].receive_channel_stats));

  // Сохранённый акт по ИНН находится: «требуется запросить» не должно висеть.
  await fetch(BASE + '/api/doc-registry/reconciliation/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: JSON.stringify({ inn: INN, name: mine[0] && mine[0].name, year: 2026, quarter: 4, status: 'received' })
  });
  const res2 = await fetch(BASE + '/api/doc-registry/reconciliation?year=2026&quarter=4&scope=all', { headers: H });
  const d2 = await res2.json();
  const mine2 = (d2.items || []).filter((x) => String(x.name || '').includes(tag));
  (mine2.length === 1 && mine2[0].received_at)
    ? ok('после «получен» статус виден на той же строке (не появился дубль)')
    : bad('после получения: строк=' + mine2.length + ' received=' + (mine2[0] && !!mine2[0].received_at));

  await db.query(`DELETE FROM doc_registry WHERE id = ANY($1::int[])`, [ids]);
  await db.query(`DELETE FROM doc_reconciliation_acts WHERE counterparty_inn=$1`, [INN]);
  console.log('\n────────────────────────────');
  console.log(`ИТОГ склейки: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('CRASH', e.message);
  try { await db.end(); } catch (_) {}
  process.exit(1);
});
