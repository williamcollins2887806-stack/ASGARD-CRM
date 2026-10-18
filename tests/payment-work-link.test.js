/**
 * Подбор и привязка объекта (работы) к заявке на оплату.
 * Заказчик 18.10.2026: «показывать инициатору список работ на выбор — да».
 * Проверяем: маршрут не перехватывается как /:id; подбор по подсказке из счёта;
 * привязка/снятие; запрет менять объект после согласования; несуществующая работа.
 */
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

async function login(l, p) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
  const d = await r.json(); let t = d.token;
  if (d.status === 'need_pin') {
    for (const pin of ['0000', '1234']) {
      const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) });
      const d2 = await r2.json().catch(() => ({})); if (d2.token) { t = d2.token; break; }
    }
  }
  return t;
}
const H = (t) => ({ Authorization: 'Bearer ' + t });

(async () => {
  console.log('=== Подбор и привязка объекта к заявке ===');
  let me = (await db.query(`SELECT id FROM users WHERE login='test_pm'`)).rows[0];
  if (!me) me = (await db.query(`SELECT id FROM users WHERE login='test_admin'`)).rows[0];
  const loginName = (await db.query(`SELECT login FROM users WHERE id=$1`, [me.id])).rows[0].login;
  const tok = await login(loginName, 'Test123!');

  const tag = 'WS-' + String(Date.now()).slice(-5);
  const w = (await db.query(`INSERT INTO works(work_title, object_name, created_at) VALUES($1::varchar,$2::varchar,NOW()) RETURNING id`,
    [`Объект Тест ${tag}`, `Объект Тест, корпус 2 ${tag}`])).rows[0];

  console.log('\n-- /work-search не перехватывается как /:id --');
  let r = await fetch(BASE + '/api/payment-invoices/work-search?q=' + encodeURIComponent('Объект Тест ' + tag), { headers: H(tok) });
  let j = await r.json().catch(() => ({}));
  ok(r.status === 200, 'work-search отвечает 200, получили ' + r.status);
  ok(Array.isArray(j.items) && j.items.length >= 1, 'вернулся список items, длина ' + (j.items || []).length);
  ok((j.items || []).some((x) => Number(x.id) === Number(w.id)), 'наша работа найдена');
  ok((j.items || []).every((x) => x.label), 'у каждой записи есть label');
  ok((j.items || []).every((x) => 'object_name' in x), 'есть object_name (для подсказки в UI)');

  console.log('\n-- подбор по подсказке из счёта (hint) --');
  r = await fetch(BASE + '/api/payment-invoices/work-search?hint=' + encodeURIComponent('Объект: Объект Тест, корпус 2 ' + tag), { headers: H(tok) });
  j = await r.json().catch(() => ({}));
  ok(r.status === 200, 'hint-поиск работает');
  ok(Number(j.suggested_id) === Number(w.id), 'подсказка однозначно ведёт к работе (suggested=' + j.suggested_id + ')');

  console.log('\n-- привязка / снятие / защита --');
  const pay = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, requires_payment, created_by, pay_timing)
     VALUES('awaiting_dir','awaiting_dir','ООО «ВЯЗКА»',1000,true,$1,'immediate') RETURNING id`, [me.id])).rows[0];
  r = await fetch(BASE + `/api/payment-invoices/${pay.id}/work`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(tok) }, body: JSON.stringify({ work_id: w.id })
  });
  j = await r.json().catch(() => ({}));
  ok(r.status === 200 && Number(j.work_id) === Number(w.id), 'работа привязана (' + r.status + ')');

  r = await fetch(BASE + `/api/payment-invoices/${pay.id}/work`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(tok) }, body: JSON.stringify({ work_id: null })
  });
  ok(r.status === 200, 'привязку можно снять (' + r.status + ')');

  await db.query(`UPDATE payment_invoices SET status='pending_payment' WHERE id=$1`, [pay.id]);
  r = await fetch(BASE + `/api/payment-invoices/${pay.id}/work`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(tok) }, body: JSON.stringify({ work_id: w.id })
  });
  ok(r.status === 409, 'после согласования объект менять нельзя (409), получили ' + r.status);

  await db.query(`UPDATE payment_invoices SET status='awaiting_dir' WHERE id=$1`, [pay.id]);
  r = await fetch(BASE + `/api/payment-invoices/${pay.id}/work`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(tok) }, body: JSON.stringify({ work_id: 99999999 })
  });
  ok(r.status === 404, 'несуществующая работа → 404, получили ' + r.status);

  console.log('\n-- синхронизация карточки реестра --');
  const doc = (await db.query(
    `INSERT INTO doc_registry(dir,package_type,ops_status,pay_status,counterparty_name,amount_gross,amount_net,vat_amount,has_vat,wh_status)
     VALUES('in','invoice','done','wait','ООО «ВЯЗКА»',1000,1000,0,false,'none') RETURNING id`)).rows[0];
  await db.query(`UPDATE payment_invoices SET doc_registry_id=$2 WHERE id=$1`, [pay.id, doc.id]);
  await fetch(BASE + `/api/payment-invoices/${pay.id}/work`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(tok) }, body: JSON.stringify({ work_id: w.id })
  });
  const docWork = (await db.query(`SELECT work_id FROM doc_registry WHERE id=$1`, [doc.id])).rows[0];
  ok(Number(docWork.work_id) === Number(w.id), 'work_id синхронизирован в карточку реестра (' + docWork.work_id + ')');

  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [pay.id]).catch(() => {});
  await db.query(`DELETE FROM doc_registry WHERE id=$1`, [doc.id]).catch(() => {});
  await db.query(`DELETE FROM works WHERE id=$1`, [w.id]).catch(() => {});
  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('CRASH', e.message); try { await db.end(); } catch (_) {} process.exit(1); });
