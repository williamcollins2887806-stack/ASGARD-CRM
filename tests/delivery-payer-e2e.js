'use strict';
/**
 * V483: сквозная проверка «за чей счёт доставка» на клоне (asgard_crm_test).
 *
 * Проверяем НА ЖИВОМ приложении (:3100), а не по коду:
 *   1. счёт без доставки → KPI `delivery_unknown` растёт, фильтр ?delivery=unknown его находит;
 *   2. PATCH после отправки директору: раньше 409, теперь разрешён ТОЛЬКО delivery_payer;
 *   3. PATCH не пропускает через этот путь чужое поле (сумму) — это была бы дыра;
 *   4. невалидное значение отклоняется, а не 500;
 *   5. PUT карточки реестра сохраняет delivery_payer (второй источник истины);
 *   6. «доставки нет» убирает счёт из очереди уточнения.
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
  if (d.status === 'need_pin') {
    const r2 = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ pin: '0000' })
    });
    const d2 = await r2.json();
    if (d2.token) t = d2.token;
  }
  return t;
}

(async () => {
  const t = await login();
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t };
  const call = async (method, url, body) => {
    const r = await fetch(BASE + '/api' + url, {
      method, headers: H, body: body ? JSON.stringify(body) : undefined
    });
    let d = null; try { d = await r.json(); } catch (_) {}
    return { st: r.status, d };
  };

  const tag = 'ДОСТ-V483-' + Date.now();
  const INN = '9704830001';
  // Строки создаём ОТ ИМЕНИ бухгалтера: список по умолчанию «мои», и это
  // правильно — тест не должен обходить матрицу видимости.
  const uid = (await db.query(`SELECT id FROM users WHERE login='test_buh'`)).rows[0].id;
  const MY = 'limit=200';

  // Документ и заявка «в работе» без признака доставки.
  const doc = (await db.query(
    `INSERT INTO doc_registry(dir, counterparty_name, counterparty_inn, invoice_number,
        invoice_date, amount_gross, ops_status, doc_owner_id, created_by, updated_by, currency)
     VALUES ('in',$1,$2,'D1','2026-11-01',1000,'wait_pay',$3,$3,$3,'RUB') RETURNING id`,
    [tag, INN, uid])).rows[0].id;
  const pay = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, invoice_number,
        invoice_date, doc_registry_id, created_by)
     VALUES ('pending_payment','pending_payment',$1,1000,'P1','2026-11-01',$2,$3) RETURNING id`,
    [tag, doc, uid])).rows[0].id;

  // 1. Счёт без доставки попадает в очередь уточнения.
  const kpi = await call('GET', '/doc-registry/kpi');
  (kpi.st === 200 && Number(kpi.d.delivery_unknown) > 0)
    ? ok('KPI считает неуточнённую доставку: ' + kpi.d.delivery_unknown)
    : bad('KPI delivery_unknown=' + JSON.stringify(kpi.d && kpi.d.delivery_unknown));

  const filt = await call('GET', '/doc-registry?delivery=unknown&' + MY);
  const found = (filt.d.items || []).some((x) => Number(x.id) === Number(doc));
  found ? ok('фильтр ?delivery=unknown находит строку') : bad('фильтр не нашёл строку ' + doc);

  // 2. Правка доставки у СОГЛАСОВАННОГО счёта (раньше здесь был 409).
  const patch = await call('PATCH', '/payment-invoices/' + pay, { delivery_payer: 'included' });
  (patch.st === 200 && patch.d.delivery_payer === 'included')
    ? ok('PATCH доставки после отправки директору разрешён')
    : bad('PATCH st=' + patch.st + ' ' + JSON.stringify(patch.d && patch.d.error));

  const after = (await db.query(
    `SELECT delivery_payer, delivery_payer_source FROM payment_invoices WHERE id=$1`, [pay])).rows[0];
  (after.delivery_payer === 'included' && after.delivery_payer_source === 'manual')
    ? ok('источник помечен manual (распознавание не перезапишет)')
    : bad('после PATCH: ' + JSON.stringify(after));

  // 3. Через путь «только доставка» нельзя подменить сумму.
  const hack = await call('PATCH', '/payment-invoices/' + pay, {
    delivery_payer: 'supplier', amount: 1
  });
  const amt = (await db.query(`SELECT amount FROM payment_invoices WHERE id=$1`, [pay])).rows[0];
  (hack.st === 409 && Number(amt.amount) === 1000)
    ? ok('подмена суммы через PATCH доставки заблокирована (409)')
    : bad('ДЫРА: st=' + hack.st + ' amount=' + amt.amount);

  // 4. Невалидное значение не роняет запрос и не пишется.
  const junk = await call('PATCH', '/payment-invoices/' + pay, { delivery_payer: 'телепатия' });
  const junkRow = (await db.query(
    `SELECT delivery_payer FROM payment_invoices WHERE id=$1`, [pay])).rows[0];
  (junk.st === 200 && junkRow.delivery_payer === 'included')
    ? ok('мусорное значение молча отброшено, прежнее сохранено')
    : bad('мусор: st=' + junk.st + ' value=' + JSON.stringify(junkRow.delivery_payer));

  // 5. Карточка реестра — второй источник истины, приоритетнее заявки.
  const put = await call('PUT', '/doc-registry/' + doc, { delivery_payer: 'ours_separate' });
  const dRow = (await db.query(
    `SELECT delivery_payer FROM doc_registry WHERE id=$1`, [doc])).rows[0];
  (put.st === 200 && dRow.delivery_payer === 'ours_separate')
    ? ok('PUT карточки сохраняет delivery_payer реестра')
    : bad('PUT st=' + put.st + ' value=' + JSON.stringify(dRow && dRow.delivery_payer));

  // Приоритет: плашка и фильтр читают COALESCE(d, pi) — значит значение реестра.
  const prv = await call('GET', '/doc-registry?delivery=ours_separate&' + MY);
  (prv.d.items || []).some((x) => Number(x.id) === Number(doc))
    ? ok('фильтр видит значение из реестра (приоритет над заявкой)')
    : bad('фильтр не учёл значение реестра');

  // 6. «Доставки нет» убирает счёт из очереди.
  await call('PUT', '/doc-registry/' + doc, { delivery_payer: 'none' });
  const none = await call('GET', '/doc-registry?delivery=unknown&' + MY);
  !(none.d.items || []).some((x) => Number(x.id) === Number(doc))
    ? ok('«доставки нет» убирает строку из очереди уточнения')
    : bad('строка осталась в очереди при none');

  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [pay]);
  await db.query(`DELETE FROM doc_registry WHERE id=$1`, [doc]);
  console.log('\n────────────────────────────');
  console.log(`ИТОГ доставки: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('CRASH', e.message);
  try { await db.end(); } catch (_) {}
  process.exit(1);
});
