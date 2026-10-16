const BASE = 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const { trafficSql, trafficOf } = require('../src/lib/doc-traffic');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
async function login(l, p) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
  const d = await r.json(); let t = d.token;
  if (d.status === 'need_pin') { for (const pin of ['0000', '1234']) { const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) }); const d2 = await r2.json(); if (d2.token) { t = d2.token; break; } } }
  return t;
}
const H = (t) => ({ Authorization: 'Bearer ' + t });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  console.log('\n=== FAIL-1: граничные случаи JS↔SQL (partial без графика; SF при done) ===');
  const cal = {};
  for (const r of (await db.query('SELECT date, is_working FROM work_calendar')).rows) cal[String(r.date).slice(0, 10)] = r.is_working;
  const cases = [
    ['partial без графика, срок в прошлом', { payment_kind: 'partial', payment_schedule: [], payment_due_at: '2020-01-01', pay_status: 'wait' }],
    ['partial с неоплаченным этапом', { payment_kind: 'partial', payment_schedule: [{ due_at: '2030-01-01', paid_at: null }], pay_status: 'wait' }],
    ['partial все этапы оплачены', { payment_kind: 'partial', payment_schedule: [{ due_at: '2020-01-01', paid_at: '2020-01-01' }], pay_status: 'wait' }],
    ['SF срок в прошлом, ops=done', { sf_due_at: '2020-01-01', sf_received_at: null, ops_status: 'done' }],
    ['SF срок в прошлом, ops=wait_sf', { sf_due_at: '2020-01-01', sf_received_at: null, ops_status: 'wait_sf' }],
    ['SF получен, срок прошёл', { sf_due_at: '2020-01-01', sf_received_at: '2020-01-05', ops_status: 'wait_sf' }],
    ['postpay срок в прошлом', { payment_kind: 'postpay', payment_due_at: '2020-01-01', pay_status: 'wait' }],
    ['no_payment_terms гасит дедлайн', { payment_due_at: '2020-01-01', pay_status: 'wait', no_payment_terms: true }],
    ['корректировка поверх всего', { correction_state: 'requested', correction_kind: 'sf', payment_due_at: '2030-01-01' }],
    ['recon не получен, срок прошёл', { recon_due_at: '2020-01-01', recon_received_at: null }]
  ];
  // Проверяем JS-зеркало против SQL для каждого кейса через реальный INSERT.
  const me = (await db.query(`SELECT id FROM users WHERE login='test_admin'`)).rows[0].id;
  for (const [name, patch] of cases) {
    const cols = Object.keys(patch);
    const vals = cols.map((v) => patch[v]);
    const placeholders = cols.map((_, i) => `$${i + 2}`);
    const row = (await db.query(
      `INSERT INTO doc_registry(dir, counterparty_name, amount_gross, doc_owner_id, created_by, updated_by, ${cols.join(',')})
       VALUES ('in','PARITY-TEST',100,$1,$1,$1, ${placeholders.join(',')}) RETURNING *`,
      [me, ...vals.map((v) => (v === null ? null : (typeof v === 'object' ? JSON.stringify(v) : v)))])).rows[0];
    const sqlColor = (await db.query(`SELECT (${trafficSql('d')}) c FROM doc_registry d WHERE d.id=$1`, [row.id])).rows[0].c;
    const jsColor = trafficOf(row, { calendar: cal }).color;
    const okc = sqlColor === jsColor;
    if (okc) ok(`${name}: ${sqlColor}`);
    else bad(`${name}: SQL=${sqlColor} JS=${jsColor}`);
    await db.query(`DELETE FROM doc_registry WHERE id=$1`, [row.id]);
  }

  console.log('\n=== FAIL-2: registry-suggest для всех ролей (не пусто) ===');
  for (const login_ of ['test_admin', 'test_buh', 'test_pm', 'test_proc', 'test_warehouse']) {
    const t = await login(login_, 'Test123!');
    const r = await fetch(BASE + '/api/customers/registry-suggest?q=ооо', { headers: H(t) });
    const j = r.ok ? await r.json() : {};
    const n = (j.suppliers || []).length;
    if (r.ok && n > 0) ok(`${login_}: ${n} поставщиков`);
    else bad(`${login_}: st=${r.status} n=${n} (молча пусто — FAIL-2 не закрыт)`);
  }

  console.log('\n=== реальные строки: полный паритет ===');
  const { rows } = await db.query(`SELECT d.*, (${trafficSql('d')}) sql_color FROM doc_registry d WHERE d.deleted_at IS NULL LIMIT 500`);
  let diff = 0;
  for (const r of rows) if (trafficOf(r, { calendar: cal }).color !== r.sql_color) diff++;
  diff === 0 ? ok(`${rows.length} строк, 0 расхождений`) : bad(`${diff} расхождений из ${rows.length}`);

  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ фиксов верификатора: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
