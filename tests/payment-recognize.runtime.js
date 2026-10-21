'use strict';
/**
 * D-320: фоновое распознавание счёта (клон :3101).
 * Проверяем, что заявка с заглушкой «Распознаётся…» дозаполняется сама
 * и не уходит директору сырой.
 */
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const BASE = process.env.DH_BASE || 'http://127.0.0.1:3101';
const SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';
const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  await db.connect();
  console.log('\n=== D-320: «Распознаётся…» не уходит директору ===');
  const u = (await db.query(`SELECT id, login, name, role FROM users WHERE role='PROC' AND is_active=true LIMIT 1`)).rows[0];
  const t = jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' });

  // Создаём черновик-заглушку напрямую в БД (как это делал старый поток).
  const ins = await db.query(
    `INSERT INTO payment_invoices(status, supplier_name, amount, created_by, basis_type, file_name)
     VALUES('draft','Распознаётся…',0,$1,'other','test.pdf') RETURNING id`, [u.id]);
  const id = ins.rows[0].id;

  const r = await fetch(`${BASE}/api/payment-invoices/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: JSON.stringify({ ids: [id] })
  });
  const j = await r.json();
  const after = (await db.query('SELECT status, supplier_name FROM payment_invoices WHERE id=$1', [id])).rows[0];
  if (after.status === 'draft') ok('сырой счёт НЕ отправлен директору (остался draft)');
  else bad(`сырой счёт ушёл директору: status=${after.status}`);
  if ((j.recognizing || []).includes(id)) ok('API вернул recognizing — фронт покажет «распознаём»');
  else bad('нет recognizing в ответе: ' + JSON.stringify(j).slice(0, 150));
  if ((j.skipped || []).some((s) => s.id === id && s.reason === 'recognizing')) ok('в skipped причина recognizing');
  else bad('skipped без recognizing');

  // Заглушка не должна попасть в очередь директора даже при прямом запросе.
  const list = await (await fetch(`${BASE}/api/payment-invoices?status=awaiting_dir`, { headers: { Authorization: 'Bearer ' + t } })).json();
  const has = (list.items || []).some((x) => Number(x.id) === Number(id));
  if (!has) ok('в очереди директора заглушки нет');
  else bad('заглушка видна в очереди директора');

  await db.query('DELETE FROM payment_invoices WHERE id=$1', [id]);
  await db.end();
  console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERR', e.message); process.exit(1); });
