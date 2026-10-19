/**
 * V411: ПАРТИЯ счетов — выборочное согласование директором (заказчик 19.10.2026).
 * «10 счетов: 10 заявок или одна? директор может выборочно согласовать?»
 * Ответ: одна партия, решение по каждому счёту отдельно.
 */
const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { applyDecision } = require('../src/services/payment-mail');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  const db = { query: (t, p) => pool.query(t, p), pool, connect: () => pool.connect() };

  const director = (await db.query(`SELECT id, name, role FROM users WHERE role='DIRECTOR_COMM' ORDER BY id LIMIT 1`)).rows[0];
  const initiator = (await db.query(`SELECT id FROM users WHERE login='bv'`)).rows[0];

  console.log('=== Создаём партию из 5 счетов ===');
  const batch = (await db.query(
    `INSERT INTO payment_batches(created_by, title, total_amount, invoices_count, expires_at)
     VALUES($1,'Тестовая партия',50000,5, NOW()+INTERVAL '72 hours') RETURNING *`, [initiator.id])).rows[0];
  const ids = [];
  for (let i = 1; i <= 5; i++) {
    const p = (await db.query(
      `INSERT INTO payment_invoices(status,payment_status,supplier_name,amount,requires_payment,created_by,batch_id,invoice_number)
       VALUES('awaiting_dir','awaiting_dir',$1,$2,true,$3,$4,$5) RETURNING id`,
      ['ООО Поставщик ' + i, 10000, initiator.id, batch.id, 'Т-' + i])).rows[0].id;
    ids.push(p);
  }
  ok(ids.length === 5, 'создано 5 счетов в партии');

  const summary0 = (await db.query(
    `SELECT count(*)::int total, count(*) FILTER (WHERE status='awaiting_dir')::int pending
       FROM payment_invoices WHERE batch_id=$1`, [batch.id])).rows[0];
  ok(summary0.total === 5 && summary0.pending === 5, 'все 5 ждут решения (pending=' + summary0.pending + ')');

  console.log('\n=== Директор: 3 согласовать, 1 отклонить, 1 оставить ===');
  const dbp = { query: (t, p) => db.query(t, p), pool, connect: () => pool.connect() };
  const actor = { id: director.id, name: director.name, role: director.role };
  const approve = ids.slice(0, 3);
  const reject = [ids[3]];
  const pending = ids[4];

  for (const pid of approve) {
    const pay = (await db.query('SELECT * FROM payment_invoices WHERE id=$1', [pid])).rows[0];
    await applyDecision(dbp, pay, 'approve', actor);
  }
  for (const pid of reject) {
    const pay = (await db.query('SELECT * FROM payment_invoices WHERE id=$1', [pid])).rows[0];
    await applyDecision(dbp, pay, 'reject', actor);
  }

  console.log('\n=== Статусы по каждому счёту ===');
  const after = (await db.query(
    `SELECT id, status, payment_status, dir_approved_by FROM payment_invoices WHERE batch_id=$1 ORDER BY id`, [batch.id])).rows;
  const st = Object.fromEntries(after.map((r) => [r.id, r.status]));
  ok(approve.every((id) => st[id] === 'pending_payment'), '3 согласованных → pending_payment (ушли бухгалтерии)');
  ok(st[reject[0]] === 'rejected', '1 отклонённый → rejected');
  ok(st[pending] === 'awaiting_dir', '1 не тронут → awaiting_dir (директор решит позже)');

  ok(after.filter((r) => r.status === 'pending_payment').every((r) => Number(r.dir_approved_by) === director.id),
    'все согласованные помечены автором решения');

  console.log('\n=== Индикатор выборочности ===');
  const s = (await db.query(
    `SELECT count(*)::int total,
            count(*) FILTER (WHERE status='pending_payment')::int approved,
            count(*) FILTER (WHERE status='rejected')::int rejected,
            count(*) FILTER (WHERE status='awaiting_dir')::int pending
       FROM payment_invoices WHERE batch_id=$1`, [batch.id])).rows[0];
  ok(s.approved === 3 && s.rejected === 1 && s.pending === 1, `сводка: согласовано ${s.approved}, отклонено ${s.rejected}, ждёт ${s.pending}`);

  // Чистка
  await db.query(`DELETE FROM payment_invoices WHERE batch_id=$1`, [batch.id]);
  await db.query(`DELETE FROM payment_batches WHERE id=$1`, [batch.id]);
  await pool.end();
  console.log('\nИТОГ партии счетов: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message, e.stack); process.exit(1); });
