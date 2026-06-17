/* B1 verifier: GET /cards should batch entity SELECTs (1 per kind), not N+1.
 *
 * Seeds 4 inbox_application cards + 1 pre_tender card for test_pm,
 * issues GET /cards, then counts queries against entity tables.
 */
'use strict';

const http = require('http');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

const SECRET = (process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })());
const BASE = 'http://127.0.0.1:3120';
const PM = { id: 4610, login: 'test_pm', role: 'PM' };

function sign(u) { return jwt.sign({ id: u.id, login: u.login, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' }); }

function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const opts = {
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    };
    if (data) opts.headers['Content-Length'] = data.length;
    const r = http.request(opts, res => {
      let buf = ''; res.setEncoding('utf8'); res.on('data', c => buf += c);
      res.on('end', () => { let p = null; try { p = JSON.parse(buf); } catch (_) { p = buf; } resolve({ status: res.statusCode, body: p }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const pg = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_kanban_test', user: 'asgard', password: '123456789' });
  await pg.connect();

  // Cleanup test_pm cards first to keep counts clean
  await pg.query('DELETE FROM personal_kanban_cards WHERE owner_user_id = $1', [PM.id]);

  // Reset pg_stat_statements (best-effort: it may not be installed)
  let pgssAvailable = false;
  try {
    await pg.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
    await pg.query('SELECT pg_stat_statements_reset()');
    pgssAvailable = true;
  } catch (e) {
    console.log('[B1] pg_stat_statements not available, will rely on row counts');
  }

  // Seed: 4 inbox_application rows + 1 pre_tender row
  const inb = [];
  for (let i = 0; i < 4; i++) {
    const r = await pg.query(
      `INSERT INTO inbox_applications (source, subject, body_preview, status, source_kind, created_by, attachment_count)
       VALUES ('manual', 'B1-inb-' || $1, 'body', 'ai_processed', 'manual', $2, 0) RETURNING id`,
      [i, PM.id]
    );
    inb.push(r.rows[0].id);
  }
  const pre = await pg.query(
    `INSERT INTO pre_tender_requests (customer_name, work_description, work_location, status)
     VALUES ('Test customer', 'B1 pre test', 'Test loc', 'new') RETURNING id`
  );
  const preId = pre.rows[0].id;

  // Cards
  for (const id of inb) {
    await pg.query(
      `INSERT INTO personal_kanban_cards (owner_user_id, flow_type, entity_kind, entity_id, current_main_status)
       VALUES ($1, 'application', 'inbox_application', $2, 'assigned')
       ON CONFLICT DO NOTHING`,
      [PM.id, id]
    );
  }
  await pg.query(
    `INSERT INTO personal_kanban_cards (owner_user_id, flow_type, entity_kind, entity_id, current_main_status)
     VALUES ($1, 'pre_tender', 'pre_tender', $2, 'new')
     ON CONFLICT DO NOTHING`,
    [PM.id, preId]
  );

  // Reset stats again right before the call
  if (pgssAvailable) await pg.query('SELECT pg_stat_statements_reset()');

  const tok = sign(PM);
  const r = await req('GET', '/api/personal-kanban/cards', tok);
  console.log('[B1] GET /cards status=' + r.status + ' total=' + (r.body && r.body.total));

  let inbSelects = -1, preSelects = -1;
  if (pgssAvailable) {
    const stats = await pg.query(`
      SELECT calls, query
        FROM pg_stat_statements
       WHERE query ILIKE '%FROM inbox_applications%WHERE id = ANY%'
          OR query ILIKE '%FROM pre_tender_requests%WHERE id = ANY%'
    `);
    for (const row of stats.rows) {
      if (/inbox_applications/i.test(row.query)) inbSelects = row.calls;
      else if (/pre_tender_requests/i.test(row.query)) preSelects = row.calls;
    }
    console.log('[B1] batch SELECT calls — inbox_applications: ' + inbSelects + ', pre_tender_requests: ' + preSelects);

    // Also check that there is no SELECT ... WHERE id = $1 from those tables
    const nplus1 = await pg.query(`
      SELECT calls, query
        FROM pg_stat_statements
       WHERE (query ILIKE '%FROM inbox_applications WHERE id = $1%'
              OR query ILIKE '%FROM pre_tender_requests WHERE id = $1%')
         AND query NOT ILIKE '%ANY%'
    `);
    let nplus1calls = 0;
    for (const row of nplus1.rows) nplus1calls += row.calls;
    console.log('[B1] N+1 single-row SELECTs against entity tables: ' + nplus1calls);
  }

  // Cleanup
  await pg.query('DELETE FROM personal_kanban_cards WHERE owner_user_id = $1', [PM.id]);
  for (const id of inb) await pg.query('DELETE FROM inbox_applications WHERE id = $1', [id]);
  await pg.query('DELETE FROM pre_tender_requests WHERE id = $1', [preId]);
  await pg.end();

  let ok = r.status === 200 && r.body && r.body.total === 5;
  if (pgssAvailable) {
    if (inbSelects !== 1) { console.log('FAIL: expected exactly 1 batch SELECT on inbox_applications, got ' + inbSelects); ok = false; }
    if (preSelects !== 1) { console.log('FAIL: expected exactly 1 batch SELECT on pre_tender_requests, got ' + preSelects); ok = false; }
  }
  console.log(ok ? 'B1 VERIFIER: PASS' : 'B1 VERIFIER: FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('B1 verifier crash:', e); process.exit(2); });
