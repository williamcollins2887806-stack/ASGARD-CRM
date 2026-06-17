/* B1-snap: verify entity snapshots populated correctly for both kinds in one GET /cards. */
'use strict';
const http = require('http');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const SECRET = (process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })());
const BASE = 'http://127.0.0.1:3120';
const PM = { id: 4610, login: 'test_pm', role: 'PM' };

function sign(u) { return jwt.sign({ id: u.id, login: u.login, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' }); }
function req(method, path, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { 'Authorization': 'Bearer ' + token } };
    const r = http.request(opts, res => { let buf = ''; res.setEncoding('utf8'); res.on('data', c => buf += c); res.on('end', () => { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }); });
    r.on('error', reject); r.end();
  });
}
(async () => {
  const pg = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_kanban_test', user: 'asgard', password: '123456789' });
  await pg.connect();
  await pg.query('DELETE FROM personal_kanban_cards WHERE owner_user_id = $1', [PM.id]);
  const inb = [];
  for (let i = 0; i < 4; i++) {
    const r = await pg.query(
      `INSERT INTO inbox_applications (source, subject, body_preview, status, source_kind, created_by, attachment_count)
       VALUES ('manual', 'B1snap-inb-' || $1, 'body', 'ai_processed', 'manual', $2, 0) RETURNING id`,
      [i, PM.id]);
    inb.push(r.rows[0].id);
  }
  const pre = (await pg.query(`INSERT INTO pre_tender_requests (customer_name, work_description, status) VALUES ('Cust', 'Snap-test-desc', 'new') RETURNING id`)).rows[0].id;
  for (const id of inb) await pg.query(`INSERT INTO personal_kanban_cards (owner_user_id, flow_type, entity_kind, entity_id, current_main_status) VALUES ($1, 'application', 'inbox_application', $2, 'assigned') ON CONFLICT DO NOTHING`, [PM.id, id]);
  await pg.query(`INSERT INTO personal_kanban_cards (owner_user_id, flow_type, entity_kind, entity_id, current_main_status) VALUES ($1, 'pre_tender', 'pre_tender', $2, 'new') ON CONFLICT DO NOTHING`, [PM.id, pre]);

  const r = await req('GET', '/api/personal-kanban/cards', sign(PM));
  const kindsSeen = new Set();
  let allHaveEntity = true;
  let preTitle = null;
  for (const it of r.body.items) {
    kindsSeen.add(it.entity_kind);
    if (!it.entity) { console.log('MISS: card id=' + it.id + ' kind=' + it.entity_kind + ' has no entity'); allHaveEntity = false; }
    else if (it.entity_kind === 'pre_tender') preTitle = it.entity.title;
  }
  console.log('[B1-snap] total items=' + r.body.items.length + ' kinds=' + Array.from(kindsSeen).join(',') + ' allHaveEntity=' + allHaveEntity);
  console.log('[B1-snap] pre_tender resolved title (via COALESCE) = ' + preTitle);

  await pg.query('DELETE FROM personal_kanban_cards WHERE owner_user_id = $1', [PM.id]);
  for (const id of inb) await pg.query('DELETE FROM inbox_applications WHERE id = $1', [id]);
  await pg.query('DELETE FROM pre_tender_requests WHERE id = $1', [pre]);
  await pg.end();

  const ok = r.body.items.length === 5 && kindsSeen.size === 2 && allHaveEntity && preTitle === 'Snap-test-desc';
  console.log(ok ? 'B1-snap PASS' : 'B1-snap FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('crash', e); process.exit(2); });
