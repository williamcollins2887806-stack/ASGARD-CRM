// Живая проверка новых фиксов верификатора N1 (quick pay race),
// N2 (дубли уведомлений), N3 (оракул чужого id). Клон :3100.
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });

async function login(l, p) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
  const d = await r.json(); let t = d.token;
  if (d.status === 'need_pin') {
    for (const pin of ['0000', '1234']) {
      const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) });
      const d2 = await r2.json(); if (d2.token) { t = d2.token; break; }
    }
  }
  return t;
}
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

(async () => {
  const P = 'Test123!';
  const admin = await login('test_admin', P);
  const pm = await login('test_pm', P);
  const me = (await db.query(`SELECT id FROM users WHERE login='test_admin'`)).rows[0].id;

  console.log('\n=== N1: гонка quick pay (2/3/4/8/12 параллельных → ровно 1 заявка) ===');
  for (const n of [2, 3, 4, 8, 12]) {
    const tag = 'N1-RACE-' + n + '-' + Date.now();
    const d = (await db.query(
      `INSERT INTO doc_registry(dir, counterparty_name, amount_gross, original_path_url, doc_owner_id, created_by, updated_by)
       VALUES ('in', $1, 1000, 'uploads/fake.pdf', $2, $2, $2) RETURNING id`, [tag, me])).rows[0];
    const st = await Promise.all(Array.from({ length: n }, () =>
      fetch(`${BASE}/api/doc-registry/${d.id}/quick`, { method: 'POST', headers: H(admin), body: JSON.stringify({ action: 'pay' }) })
        .then((r) => r.status).catch(() => 0)));
    const created = (await db.query(`SELECT count(*)::int n FROM payment_invoices WHERE supplier_name=$1`, [tag])).rows[0].n;
    const linked = (await db.query(`SELECT payment_invoice_id FROM doc_registry WHERE id=$1`, [d.id])).rows[0].payment_invoice_id;
    console.log(`  ${n} параллельных → заявок=${created}, linked=${linked}, статусы=${JSON.stringify(st)}`);
    created === 1 ? ok(`${n} параллельных → ровно 1 заявка`) : bad(`${n} параллельных → ${created} заявок`);
    await db.query(`DELETE FROM payment_invoices WHERE supplier_name=$1`, [tag]);
    await db.query(`DELETE FROM doc_registry WHERE id=$1`, [d.id]);
  }

  console.log('\n=== N2: /approval/payment_invoices/:id/pay-bank — уведомления не дублируются ===');
  const buh = await login('test_buh', P);
  const initiator = (await db.query(`SELECT id FROM users WHERE login='test_pm'`)).rows[0].id;
  const mkPay = async (name) => (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, requires_payment, created_by, pay_timing)
     VALUES ('awaiting_dir','pending_payment',$1, 500, true, $2, 'postpay') RETURNING id`, [name, initiator])).rows[0].id;
  const notifFor = async (id) => (await db.query(
    `SELECT count(*)::int n FROM notifications WHERE title LIKE '%#'||$1||'%'`, [id])).rows[0].n;

  const singleId = await mkPay('N2-SINGLE');
  await fetch(`${BASE}/api/approval/payment_invoices/${singleId}/pay-bank`, { method: 'POST', headers: H(buh), body: JSON.stringify({ comment: 'single' }) });
  await new Promise((r) => setTimeout(r, 1500));
  const singleN = await notifFor(singleId);

  const raceId = await mkPay('N2-RACE');
  await Promise.all(Array.from({ length: 8 }, () =>
    fetch(`${BASE}/api/approval/payment_invoices/${raceId}/pay-bank`, { method: 'POST', headers: H(buh), body: JSON.stringify({ comment: 'race' }) })
      .then((r) => r.status).catch(() => 0)));
  await new Promise((r) => setTimeout(r, 2000));
  const raceN = await notifFor(raceId);
  console.log(`  одиночный=${singleN}, гонка 8×=${raceN} (до фикса — 61)`);
  (raceN <= singleN + 2) ? ok('гонка не размножает уведомления') : bad(`дубли уведомлений: single=${singleN} race=${raceN}`);
  await db.query(`DELETE FROM payment_invoices WHERE id IN ($1,$2)`, [singleId, raceId]);
  await db.query(`DELETE FROM notifications WHERE title LIKE $1 OR title LIKE $2`, ['%#' + singleId + '%', '%#' + raceId + '%']);

  console.log('\n=== N3: check-duplicate не отдаёт чужой id ===');
  const other = (await db.query(`SELECT id FROM users WHERE role='PM' AND id<>$1 LIMIT 1`, [me])).rows[0].id;
  const foreign = (await db.query(
    `INSERT INTO doc_registry(dir, counterparty_name, invoice_number, invoice_date, amount_gross, doc_owner_id, created_by, updated_by)
     VALUES ('in','ООО ЧУЖОЙ N3','N3-DUP-1','2026-01-01', 777, $1, $1, $1) RETURNING id`, [other])).rows[0];
  const rr = await fetch(BASE + '/api/doc-registry/check-duplicate', {
    method: 'POST', headers: H(pm),
    body: JSON.stringify({ counterparty_name: 'ООО ЧУЖОЙ N3', invoice_number: 'N3-DUP-1', invoice_date: '2026-01-01', amount_gross: 777, dir: 'in' })
  });
  const dj = await rr.json();
  console.log('  ответ =', JSON.stringify(dj));
  // N3 (v2): пре-проверка неотличима от «нет дубля» для чужой строки.
  (dj.duplicate === false) ? ok('чужая строка неотличима от «нет дубля» (нет оракула)')
    : (dj.duplicate === true && dj.existing_id === foreign.id ? bad('раскрыт чужой id ' + dj.existing_id) : bad('осталась утечка: ' + JSON.stringify(dj)));

  console.log('\n=== N3b: POST / (409) не отдаёт чужой existing_id ===');
  const rr2 = await fetch(BASE + '/api/doc-registry', {
    method: 'POST', headers: H(pm),
    body: JSON.stringify({ dir: 'in', counterparty_name: 'ООО ЧУЖОЙ N3', invoice_number: 'N3-DUP-1', invoice_date: '2026-01-01', amount_gross: 777 })
  });
  const dj2 = await rr2.json();
  console.log('  st=' + rr2.status, JSON.stringify(dj2));
  (rr2.status === 409 && (dj2.existing_id == null || dj2.existing_id === undefined))
    ? ok('409 без чужого existing_id') : bad('409 раскрывает id: ' + JSON.stringify(dj2));

  await db.query(`DELETE FROM doc_registry WHERE id=$1`, [foreign.id]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ N-фиксов: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
