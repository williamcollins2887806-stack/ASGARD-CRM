require('dotenv').config();
const BASE = 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
async function login(l, p) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
  const d = await r.json(); let t = d.token;
  if (d.status === 'need_pin') { for (const pin of ['0000', '1234']) { const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) }); const d2 = await r2.json(); if (d2.token) { t = d2.token; break; } } }
  return t;
}
(async () => {
  const t = await login('test_admin', 'Test123!');
  const n = (await db.query(`SELECT count(*)::int n FROM doc_registry WHERE deleted_at IS NULL`)).rows[0].n;
  console.log(`Строк в реестре: ${n}\n`);
  const measure = async (label, url) => {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const s = Date.now();
      const r = await fetch(BASE + url, { headers: { Authorization: 'Bearer ' + t } });
      await r.text();
      times.push(Date.now() - s);
    }
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)];
    console.log(`${label.padEnd(28)} медиана ${String(med).padStart(5)} мс (min ${times[0]}, max ${times[4]})`);
    return med;
  };
  await measure('/kpi (scope=all)', '/api/doc-registry/kpi?scope=all');
  await measure('/ (scope=all&limit=50)', '/api/doc-registry?scope=all&limit=50');
  await measure('/facets', '/api/doc-registry/facets?scope=all');
  await measure('/archive/years', '/api/doc-registry/archive/years?scope=all');
  await measure('/monthly-series', '/api/doc-registry/monthly-series/2026?scope=all');
  await measure('/reconciliation', '/api/doc-registry/reconciliation?year=2026&quarter=4');
  // EXPLAIN для тяжёлого запроса списка
  const plan = (await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT d.id FROM doc_registry d WHERE d.deleted_at IS NULL ORDER BY d.invoice_date DESC NULLS LAST, d.id DESC LIMIT 50`)).rows.map((r) => r['QUERY PLAN']).join('\n');
  console.log('\nEXPLAIN списка:'); console.log(plan.split('\n').slice(0, 8).join('\n'));
  await db.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
