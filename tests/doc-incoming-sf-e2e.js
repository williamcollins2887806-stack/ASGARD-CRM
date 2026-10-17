const BASE = 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
async function login(l, p) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
    const d = await r.json();
    let t = d.token;
    if (d.status === 'need_pin') {
      for (const pin of ['0000', '1234']) {
        const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) });
        const d2 = await r2.json().catch(() => ({}));
        if (d2.token) { t = d2.token; break; }
      }
    }
    const probe = await fetch(BASE + '/api/doc-registry/kpi', { headers: { Authorization: 'Bearer ' + t } });
    if (probe.status === 200) return t;
    await new Promise((res) => setTimeout(res, 800));
  }
  throw new Error('login failed for ' + l);
}
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  const adminT = await login('test_admin', 'Test123!');
  const wareT = await login('test_warehouse', 'Test123!');
  const pmT = await login('test_pm', 'Test123!');
  const call = async (t, method, url, body) => {
    const r = await fetch(BASE + '/api' + url, { method, headers: H(t), body: body ? JSON.stringify(body) : undefined });
    let d = null; try { d = await r.json(); } catch (_) {}
    return { st: r.status, d };
  };
  const me = (await db.query(`SELECT id FROM users WHERE login='test_admin'`)).rows[0].id;
  // складская строка, ждём СФ
  const doc = (await db.query(
    `INSERT INTO doc_registry(dir, counterparty_name, invoice_number, invoice_date, amount_gross, ops_status,
       sf_due_at, spend_kind, wh_status, doc_owner_id, created_by, updated_by)
     VALUES ('in','SF-TEST','SF-1','2026-10-01',1000,'wait_sf', CURRENT_DATE+5, 'warehouse','await', $1, $1, $1) RETURNING id`, [me])).rows[0];

  console.log('\n=== GET /incoming-sf ===');
  const lst = await call(wareT, 'GET', '/doc-registry/incoming-sf');
  console.log('  WAREHOUSE st=' + lst.st, '| items=' + (lst.d.items || []).length);
  (lst.st === 200 && Array.isArray(lst.d.items)) ? ok('кладовщик видит список') : bad('кладовщик st=' + lst.st);
  const pm = await call(pmT, 'GET', '/doc-registry/incoming-sf');
  (pm.st === 403) ? ok('PM получает 403') : bad('PM st=' + pm.st);

  console.log('\n=== action=receive_sf (двухшаговое) ===');
  const r1 = await call(wareT, 'POST', `/doc-registry/${doc.id}/quick`, { action: 'receive_sf' });
  const after = (await db.query(`SELECT sf_received_at, wh_status FROM doc_registry WHERE id=$1`, [doc.id])).rows[0];
  console.log('  st=' + r1.st, '| БД=' + JSON.stringify(after));
  (r1.st === 200 && after.sf_received_at) ? ok('кладовщик отметил получение (sf_received_at)') : bad('получение: ' + JSON.stringify(after));
  const notif = (await db.query(`SELECT count(*)::int n FROM notifications WHERE title LIKE '%получение СФ%'`)).rows[0].n;
  (notif >= 1) ? ok('владелец уведомлён о получении') : bad('уведомлений владельцу: ' + notif);

  const r2 = await call(adminT, 'POST', `/doc-registry/${doc.id}/quick`, { action: 'sf', kind: 'sf', number: 'SF-1' });
  (r2.st === 200) ? ok('владелец подтвердил (action=sf)') : bad('подтверждение st=' + r2.st);

  await db.query(`DELETE FROM doc_registry WHERE id=$1`, [doc.id]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ входящих СФ: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
