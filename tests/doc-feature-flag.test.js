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
const setFlag = async (v) => {
  await db.query(`INSERT INTO settings(key,value_json,updated_at) VALUES('feature_doc_traffic_light',$1,NOW())
    ON CONFLICT (key) DO UPDATE SET value_json=$1, updated_at=NOW()`, [v ? 'true' : 'false']);
  // сбрасываем кэш через перезапрос (кэш 15с) — ждём чуть-чуть
  await new Promise((r) => setTimeout(r, 100));
};
(async () => {
  const t = await login('test_buh', 'Test123!');
  const me = (await db.query(`SELECT id FROM users WHERE login='test_buh'`)).rows[0].id;
  const doc = (await db.query(
    `INSERT INTO doc_registry(dir, counterparty_name, amount_gross, doc_owner_id, created_by, updated_by)
     VALUES ('in','FLAG-TEST',1000,$1,$1,$1) RETURNING id`, [me])).rows[0];

  console.log('\n=== флаг ВЫКЛЮЧЕН: корректировка недоступна ===');
  await setFlag(false);
  await new Promise((r) => setTimeout(r, 15000));  // переждать кэш флага
  const r1 = await fetch(`${BASE}/api/doc-registry/${doc.id}/quick`, { method: 'POST', headers: H(t), body: JSON.stringify({ action: 'correction', kind: 'sf', comment: 'тест' }) });
  const j1 = await r1.json().catch(() => ({}));
  console.log('  st=' + r1.status, JSON.stringify(j1).slice(0, 100));
  (r1.status === 409 && j1.disabled) ? ok('выключен → 409 disabled') : bad('выключен: st=' + r1.status);

  console.log('\n=== флаг ВКЛЮЧЁН: корректировка работает ===');
  await setFlag(true);
  await new Promise((r) => setTimeout(r, 15000));
  const r2 = await fetch(`${BASE}/api/doc-registry/${doc.id}/quick`, { method: 'POST', headers: H(t), body: JSON.stringify({ action: 'correction', kind: 'sf', comment: 'тест' }) });
  const j2 = await r2.json().catch(() => ({}));
  console.log('  st=' + r2.status, JSON.stringify(j2).slice(0, 90));
  (r2.status === 200 && j2.state === 'requested') ? ok('включён → 200 requested') : bad('включён: st=' + r2.status);

  console.log('\n=== список отдаёт traffic_light флаг ===');
  const lst = await (await fetch(`${BASE}/api/doc-registry?limit=1`, { headers: H(t) })).json();
  (lst.traffic_light === true) ? ok('traffic_light=true в ответе') : bad('traffic_light=' + lst.traffic_light);

  // Возвращаем флаг ВКЛЮЧЁННЫМ (нужен остальным тестам/UI).
  await setFlag(true);
  await db.query(`DELETE FROM doc_registry WHERE id=$1`, [doc.id]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ фичефлага: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
