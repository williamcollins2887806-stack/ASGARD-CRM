#!/usr/bin/env node
'use strict';
/**
 * verify_e5_auto_expense_live.js — ЖИВОЙ гейт E5 (D-236).
 *
 * Проверяет живьём (реальный сервер + реальная БД asgard_crm_test), что после оплаты счёта
 * (POST /:id/pay-bank → afterPaid) при НЕпустом work_id появляется РОВНО ОДНА запись в
 * work_expenses (source_table='payment_invoices', source_key=<id счёта>), а карточка
 * doc_registry ссылается на неё через work_expense_id. Без work_id расход не создаётся.
 * Идемпотентность: повторный upsert по (source_table, source_key) обновляет ту же строку.
 *
 * Запуск: TEST_BASE_URL=http://127.0.0.1:3100 DB_NAME=asgard_crm_test node tools/verify_e5_auto_expense_live.js
 */
const { Pool } = require('pg');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
if (DB_NAME === 'asgard_crm') { console.error('E5 FAIL: прод-БД запрещена'); process.exit(1); }

const pool = new Pool({ host: '127.0.0.1', user: 'asgard', password: '123456789', database: DB_NAME });
const { insertWorkExpense } = require('../src/services/work-expense-writer');

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  [OK] ' + name + (detail ? ' — ' + String(detail).slice(0, 190) : '')); }
  else { fail++; fails.push(name); console.log('  [FAIL] ' + name + (detail ? ' — ' + String(detail).slice(0, 240) : '')); }
}

async function login(loginName) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password: 'Test123!' }),
  });
  const j = await r.json();
  if (!j.token) throw new Error(loginName + ' login: ' + JSON.stringify(j).slice(0, 160));
  let token = j.token, user = j.user;
  if (j.status === 'need_pin') {
    const r2 = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '0000' }),
    }).then((x) => x.json());
    token = r2.token || token; user = r2.user || user;
  }
  return { token, user };
}

async function api(token, method, p, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, data: j };
}

(async () => {
  console.log('E5: авто-расход после оплаты счёта. BASE=' + BASE + ' DB=' + DB_NAME);

  const dir = await login('test_director_gen');
  const buh = await login('test_buh');
  const admin = await login('test_admin');
  const workId = (await pool.query('SELECT id FROM works ORDER BY id LIMIT 1')).rows[0].id;
  console.log('  роли: dir=' + dir.user.role + ' buh=' + buh.user.role + ' work_id=' + workId);

  const AMOUNT = 654321.09;
  const created = [];
  const insertPay = async (work_id, tag) => (await pool.query(
    `INSERT INTO payment_invoices (supplier_name, amount, currency, status, payment_status, pay_timing,
                                   basis_type, basis_text, work_id, created_by, created_at, updated_at)
     VALUES ($1, $2, 'RUB', 'awaiting_dir', 'none', 'immediate', 'work', $1, $3, $4, NOW(), NOW()) RETURNING id`,
    ['ООО «E5-' + tag + '»', AMOUNT, work_id, admin.user.id]
  )).rows[0].id;

  const payId = await insertPay(workId, 'AutoExp');
  created.push(payId);
  console.log('  поставлен счёт #' + payId + ' (work_id=' + workId + ', awaiting_dir)');

  // 1. Директор согласует (API — реальный роут).
  const appr = await api(dir.token, 'POST', '/api/payment-invoices/' + payId + '/dir-approve', { pay_timing: 'immediate' });
  check('1. dir-approve → 200 (реальный роут)', appr.status === 200, 'status=' + appr.status + ' ' + JSON.stringify(appr.data).slice(0, 120));
  const afterAppr = (await pool.query('SELECT status FROM payment_invoices WHERE id=$1', [payId])).rows[0];
  check('2. счёт ушёл в очередь оплаты (pending_payment)', afterAppr.status === 'pending_payment', 'status=' + afterAppr.status);

  // 2. Бух оплачивает.
  const payRes = await api(buh.token, 'POST', '/api/payment-invoices/' + payId + '/pay-bank', { skip_pp: true, comment: 'E5: живой прогон' });
  check('3. pay-bank → 200', payRes.status === 200, 'status=' + payRes.status + ' ' + JSON.stringify(payRes.data).slice(0, 120));
  const afterPay = (await pool.query('SELECT status, payment_status, buh_acted_at FROM payment_invoices WHERE id=$1', [payId])).rows[0];
  check('4. счёт оплачен (status=paid)', afterPay.status === 'paid' && afterPay.payment_status === 'paid', JSON.stringify(afterPay));

  // 3. E5: расход ровно один.
  const exp = await pool.query(
    `SELECT id, work_id, amount, source_table, source_key, category, description
       FROM work_expenses WHERE source_table='payment_invoices' AND source_key=$1 ORDER BY id`,
    [String(payId)]
  );
  const expRow = exp.rows[0] || null;
  check('5. E5: появилась РОВНО ОДНА запись work_expenses по счёту', exp.rows.length === 1, 'rows=' + exp.rows.length);
  check('6. расход привязан к той же работе', !!expRow && Number(expRow.work_id) === Number(workId), 'work_id=' + (expRow && expRow.work_id) + ' want=' + workId);
  check('7. сумма расхода = сумме счёта (по копейкам)', !!expRow && Number(expRow.amount) === AMOUNT, 'amount=' + (expRow && expRow.amount) + ' want=' + AMOUNT);
  const docCard = await pool.query('SELECT id, payment_invoice_id, work_expense_id FROM doc_registry WHERE payment_invoice_id=$1', [payId]);
  check('8. карточка реестра создана и ссылается на расход',
    docCard.rows.length >= 1 && !!expRow && Number(docCard.rows[0].work_expense_id) === Number(expRow.id),
    JSON.stringify(docCard.rows[0] || null));

  // 4. Идемпотентность upsert (source_table, source_key): повтор не создаёт вторую строку.
  const again = await insertWorkExpense(pool, {
    work_id: workId, category: 'materials', subcategory: 'other', amount: AMOUNT,
    description: 'E5 idempotency probe', source_table: 'payment_invoices', source_key: String(payId),
    created_by: admin.user.id,
  });
  const exp2 = await pool.query(
    `SELECT count(*) n FROM work_expenses WHERE source_table='payment_invoices' AND source_key=$1`, [String(payId)]
  );
  check('9. повторный upsert не создаёт вторую строку (идемпотентность)',
    Number(exp2.rows[0].n) === 1 && !!expRow && Number(again.id) === Number(expRow.id),
    'n=' + exp2.rows[0].n + ' same_id=' + (!!expRow && Number(again.id) === Number(expRow.id)));

  // 5. Негатив: без work_id расход не создаётся, но карточка реестра есть.
  const payNoWork = await insertPay(null, 'NoWork');
  created.push(payNoWork);
  await api(dir.token, 'POST', '/api/payment-invoices/' + payNoWork + '/dir-approve', { pay_timing: 'immediate' });
  await api(buh.token, 'POST', '/api/payment-invoices/' + payNoWork + '/pay-bank', { skip_pp: true, comment: 'E5: без работы' });
  const noWorkExp = await pool.query(
    `SELECT count(*) n FROM work_expenses WHERE source_table='payment_invoices' AND source_key=$1`, [String(payNoWork)]
  );
  check('10. без work_id расход НЕ создаётся', Number(noWorkExp.rows[0].n) === 0, 'n=' + noWorkExp.rows[0].n);
  const noWorkCard = await pool.query('SELECT count(*) n FROM doc_registry WHERE payment_invoice_id=$1', [payNoWork]);
  check('11. карточка реестра у счёта без работы всё равно создана', Number(noWorkCard.rows[0].n) >= 1, 'n=' + noWorkCard.rows[0].n);

  // Уборка (клон).
  await pool.query('DELETE FROM doc_registry WHERE payment_invoice_id = ANY($1)', [created]);
  await pool.query("DELETE FROM work_expenses WHERE source_table='payment_invoices' AND source_key = ANY($1)", [created.map(String)]);
  await pool.query('DELETE FROM payment_invoices WHERE id = ANY($1)', [created]);

  await pool.end();
  console.log('\nE5 ИТОГ: PASS=' + pass + ' FAIL=' + fail);
  if (fail) { console.log('Провалы: ' + fails.join(' | ')); process.exit(1); }
  console.log('E5 GREEN: оплата счёта с work_id создаёт ровно один расход проекта; без work_id — не создаёт.');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
