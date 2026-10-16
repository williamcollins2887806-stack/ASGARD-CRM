const BASE = 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
async function login(l, p) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
  const d = await r.json(); let t = d.token;
  if (d.status === 'need_pin') { for (const pin of ['0000', '1234']) { const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) }); const d2 = await r2.json(); if (d2.token) { t = d2.token; break; } } }
  return t;
}
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  const t = await login('test_buh', 'Test123!');
  const call = async (method, url, body) => {
    const r = await fetch(BASE + '/api' + url, { method, headers: H(t), body: body ? JSON.stringify(body) : undefined });
    let d = null; try { d = await r.json(); } catch (_) {}
    return { st: r.status, d };
  };
  const INN = '9700000001';
  const tag = 'RECON-' + Date.now();
  // два документа за 2026 Q4: один оплачен, один с услугой
  const d1 = (await db.query(
    `INSERT INTO doc_registry(dir, counterparty_name, counterparty_inn, invoice_number, invoice_date, amount_gross, pay_status, doc_owner_id, created_by, updated_by, currency)
     VALUES ('in', $1, $2, $3, '2026-10-05', 10000, 'paid', 1, 1, 1, 'RUB') RETURNING id`, [tag, INN, 'R-1'])).rows[0].id;
  const d2 = (await db.query(
    `INSERT INTO doc_registry(dir, counterparty_name, counterparty_inn, invoice_number, invoice_date, service_done_at, amount_gross, doc_owner_id, created_by, updated_by, currency)
     VALUES ('in', $1, $2, $3, '2026-11-05', '2026-11-10', 4000, 1, 1, 1, 'RUB') RETURNING id`, [tag, INN, 'R-2'])).rows[0].id;

  console.log('\n=== GET /reconciliation/detail ===');
  const det = await call('GET', `/doc-registry/reconciliation/detail?inn=${INN}&year=2026&quarter=4`);
  console.log('  st=' + det.st, '| docs=' + (det.d.docs || []).length, '| paid=' + det.d.paidSum, '| docsSum=' + det.d.docsSum, '| balance=' + det.d.balanceRub, '| due=' + det.d.due_at);
  (det.st === 200 && det.d.docs.length === 2) ? ok('2 документа в сверке') : bad('docs=' + (det.d && det.d.docs && det.d.docs.length));
  (det.d.paidSum === 10000 && det.d.docsSum === 14000 && det.d.balanceRub === -4000) ? ok('баланс -4000 (мы должны 4000)') : bad('баланс ' + det.d.balanceRub);
  (det.d.due_at === '2027-01-10') ? ok('дедлайн квартала = 2027-01-10') : bad('due_at=' + det.d.due_at);

  console.log('\n=== GET /reconciliation (список) ===');
  const list = await call('GET', '/doc-registry/reconciliation?year=2026&quarter=4');
  console.log('  st=' + list.st, '| items=' + (list.d.items || []).length, '| дедлайн=' + list.d.due_at);
  (list.st === 200 && Array.isArray(list.d.items)) ? ok('список отдаётся') : bad('список: ' + list.st);

  console.log('\n=== POST /reconciliation/status ===');
  const s1 = await call('POST', '/doc-registry/reconciliation/status', { inn: INN, name: tag, year: 2026, quarter: 4, status: 'requested' });
  const s2 = await call('POST', '/doc-registry/reconciliation/status', { inn: INN, name: tag, year: 2026, quarter: 4, status: 'received', comment: 'файл от контрагента' });
  const act = (await db.query(`SELECT status, received_at FROM doc_reconciliation_acts WHERE counterparty_inn=$1 AND period_year=2026 AND period_quarter=4`, [INN])).rows[0];
  console.log('  requested st=' + s1.st, 'received st=' + s2.st, '| БД=' + JSON.stringify(act));
  (s1.st === 200 && s2.st === 200 && act && act.status === 'received' && act.received_at) ? ok('статус requested→received с датой') : bad('статус: ' + JSON.stringify(act));

  console.log('\n=== дедлайн годового акта = 15.01 ===');
  const year = await call('GET', `/doc-registry/reconciliation/detail?inn=${INN}&year=2026&quarter=0`);
  console.log('  year due=' + year.d.due_at);
  (year.d.due_at === '2027-01-15') ? ok('годовой дедлайн 2027-01-15') : bad('year due=' + year.d.due_at);

  await db.query(`DELETE FROM doc_registry WHERE id IN ($1,$2)`, [d1, d2]);
  await db.query(`DELETE FROM doc_reconciliation_acts WHERE counterparty_inn=$1`, [INN]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ актов: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
