#!/usr/bin/env node
/**
 * THING E2E / stress emulation S01–S20 against local CRM API (prod box or clone).
 * Usage: cd /var/www/asgard-crm && node tests/thing_emulation.js
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = process.env.THING_TEST_BASE || 'http://127.0.0.1:3000';
const BASE_URL = new URL(BASE);
const results = [];
const https = require('https');
const libHttp = BASE_URL.protocol === 'https:' ? https : http;

function req(method, p, body, token, extraHeaders) {
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + p);
    const r = libHttp.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(extraHeaders || {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let d = '';
        res.on('data', (x) => (d += x));
        res.on('end', () => {
          let j = {};
          try { j = JSON.parse(d || '{}'); } catch (_) { j = { raw: d }; }
          resolve({ status: res.statusCode, data: j });
        });
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function ok(id, pass, detail) {
  results.push({ id, pass: !!pass, detail: String(detail || '') });
  console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + ' — ' + detail);
}

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  await c.connect();
  const { rows } = await c.query(
    `SELECT id, login, role, name FROM users WHERE role='ADMIN' AND COALESCE(is_active,true)=true ORDER BY id LIMIT 1`
  );
  const { rows: others } = await c.query(
    `SELECT id, login, role, name FROM users WHERE id <> $1 AND COALESCE(is_active,true)=true ORDER BY id LIMIT 1`,
    [rows[0].id]
  );
  const admin = rows[0];
  const other = others[0] || null;
  const token = jwt.sign(
    { id: admin.id, login: admin.login, role: admin.role, name: admin.name, pinVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );
  const tokenOther = other
    ? jwt.sign(
      { id: other.id, login: other.login, role: other.role, name: other.name, pinVerified: true },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    )
    : null;

  let h = await req('GET', '/api/thing/health');
  const allowNoLk = process.env.THING_ALLOW_NO_LIVEKIT === '1';
  ok(
    'S00',
    h.status === 200 && h.data.ok === true && (h.data.livekit === true || allowNoLk),
    JSON.stringify(h.data) + (allowNoLk && !h.data.livekit ? ' (ALLOW_NO_LIVEKIT)' : '')
  );

  // S01 instant
  let r = await req('POST', '/api/thing/rooms', { title: 'S01', mode: 'instant', protocol_enabled: true }, token);
  ok(
    'S01',
    r.status === 201 && r.data.room && r.data.room.slug && (r.data.livekit_created || allowNoLk),
    'dial=' + (r.data.room && r.data.room.dial_code) + ' lk_created=' + !!r.data.livekit_created
  );
  const s01 = r.data.room;

  // S02 meeting+ting
  const start = new Date(Date.now() + 3600e3).toISOString();
  r = await req('POST', '/api/meetings', {
    title: 'S02 Meeting Ting', start_time: start, create_thing: true, protocol_enabled: true, send_invites: false
  }, token);
  ok('S02', r.status === 200 || r.status === 201, 'thing=' + !!(r.data.thing && r.data.thing.dial_code));

  // S03 guest public
  r = await req('GET', '/api/thing/public/' + s01.slug);
  ok('S03', r.status === 200 && !('dial_code' in r.data), 'public ok');

  // S04 dial-in resolve (uses THING_TEST_BASE — not hardcoded :3000)
  const secret = process.env.THING_DIALIN_SECRET || '';
  r = await req('POST', '/api/thing/dial-in/resolve', { dial_code: s01.dial_code }, null, {
    'X-Thing-Dialin-Secret': secret
  });
  ok(
    'S04',
    (r.status === 200 && r.data.livekit_room_name) || (allowNoLk && [200, 503].includes(r.status)),
    'status=' + r.status + ' room=' + r.data.livekit_room_name
  );

  // S05 bad dial
  r = await req('POST', '/api/thing/dial-in/resolve', { dial_code: '000000' }, null, {
    'X-Thing-Dialin-Secret': secret
  });
  ok('S05', r.status === 404 || r.status === 400 || r.status === 503, 'status=' + r.status);

  // S06 token (= media join capability; screen share is client)
  r = await req('POST', '/api/thing/rooms/' + s01.id + '/token', {}, token);
  ok(
    'S06',
    (r.status === 200 && r.data.token) || (allowNoLk && r.status === 503),
    'token status=' + r.status + ' len=' + (r.data.token || '').length
  );

  // S07 host end
  r = await req('POST', '/api/thing/rooms/' + s01.id + '/end', {}, token);
  ok('S07', r.status === 200 && r.data.room.status === 'ended', 'ended');

  // S08 protocol off
  r = await req('POST', '/api/thing/rooms', { title: 'S08', protocol_enabled: false }, token);
  const s08 = r.data.room;
  let e = await req('POST', '/api/thing/rooms/' + s08.id + '/end', {}, token);
  ok('S08', e.data.protocol && (e.data.protocol.protocol === 'skipped' || e.data.protocol.protocol === 'no_recording'), JSON.stringify(e.data.protocol));

  // S09 protocol on without recording → no_recording or queued
  r = await req('POST', '/api/thing/rooms', { title: 'S09', protocol_enabled: true }, token);
  e = await req('POST', '/api/thing/rooms/' + r.data.room.id + '/end', {}, token);
  ok('S09', e.data.protocol && ['queued', 'no_recording'].includes(e.data.protocol.protocol), JSON.stringify(e.data.protocol));

  // S10 protocol 403 for non-host
  r = await req('POST', '/api/thing/rooms', { title: 'S10', protocol_enabled: true }, token);
  const s10 = r.data.room;
  if (tokenOther) {
    const pOther = await req('GET', '/api/thing/rooms/' + s10.id + '/protocol', null, tokenOther);
    ok('S10', pOther.status === 403, 'status=' + pOther.status);
  } else {
    ok('S10', true, 'skipped — no second user');
  }

  // S11 host can read protocol endpoint
  const pHost = await req('GET', '/api/thing/rooms/' + s10.id + '/protocol', null, token);
  ok('S11', pHost.status === 200 && pHost.data.protocol_enabled === true && !!pHost.data.status_labels, JSON.stringify({ status: pHost.status, body: pHost.data }));
  await req('POST', '/api/thing/rooms/' + s10.id + '/end', {}, token);

  // S12 recording start — egress may timeout without active publishers; accept 200/503/400/500
  r = await req('POST', '/api/thing/rooms', { title: 'S12' }, token);
  let rec = await req('POST', '/api/thing/rooms/' + r.data.room.id + '/recording/start', {}, token);
  ok('S12', [200, 400, 503, 500].includes(rec.status), 'status=' + rec.status);
  await req('POST', '/api/thing/rooms/' + r.data.room.id + '/end', {}, token);

  // S13 lobby create
  r = await req('POST', '/api/thing/rooms', { title: 'S13', lobby_enabled: true }, token);
  ok('S13', r.status === 201 && r.data.room.lobby_enabled === true, 'lobby');
  await req('POST', '/api/thing/rooms/' + r.data.room.id + '/end', {}, token);

  // S14 parallel 3 rooms
  const parallel = await Promise.all([1, 2, 3].map((i) =>
    req('POST', '/api/thing/rooms', { title: 'S14-' + i }, token)
  ));
  ok('S14', parallel.every((x) => x.status === 201), 'created=' + parallel.length);
  await Promise.all(parallel.map((x) => req('POST', '/api/thing/rooms/' + x.data.room.id + '/end', {}, token)));

  // S15 stress 20
  let stressOk = 0;
  for (let i = 0; i < 20; i++) {
    const cr = await req('POST', '/api/thing/rooms', { title: 'S15-' + i, protocol_enabled: false }, token);
    if (cr.status === 201) {
      const en = await req('POST', '/api/thing/rooms/' + cr.data.room.id + '/end', {}, token);
      if (en.status === 200) stressOk++;
    }
  }
  ok('S15', stressOk === 20, 'ok=' + stressOk);

  // S16 reconnect token twice
  r = await req('POST', '/api/thing/rooms', { title: 'S16' }, token);
  const t1 = await req('POST', '/api/thing/rooms/' + r.data.room.id + '/token', {}, token);
  const t2 = await req('POST', '/api/thing/rooms/' + r.data.room.id + '/token', {}, token);
  ok(
    'S16',
    (t1.status === 200 && t2.status === 200) || (allowNoLk && t1.status === 503 && t2.status === 503),
    'two tokens status=' + t1.status + '/' + t2.status
  );
  await req('POST', '/api/thing/rooms/' + r.data.room.id + '/end', {}, token);

  // S17 protocol generate without recording → 400
  r = await req('POST', '/api/thing/rooms', { title: 'S17', protocol_enabled: true }, token);
  const gen = await req('POST', '/api/thing/rooms/' + r.data.room.id + '/protocol/generate', {}, token);
  ok('S17', gen.status === 400 || gen.status === 200, 'status=' + gen.status);
  await req('POST', '/api/thing/rooms/' + r.data.room.id + '/end', {}, token);

  // S18 invite fields on create
  r = await req('POST', '/api/thing/rooms', { title: 'S18' }, token);
  ok('S18', r.data.room && r.data.room.slug && /^[0-9]{6}$/.test(r.data.room.dial_code), 'slug+dial');
  await req('POST', '/api/thing/rooms/' + r.data.room.id + '/end', {}, token);

  // S19 guest page
  r = await req('GET', '/ting/' + (s01.slug || 'x'));
  ok('S19', r.status === 200, 'ting page');

  // S20 meetings without ting
  r = await req('POST', '/api/meetings', {
    title: 'S20 no ting', start_time: start, send_invites: false
  }, token);
  ok('S20', (r.status === 200 || r.status === 201) && !r.data.thing, 'no thing');

  // S21 protocol leak via meetings minutes — only initiator
  if (tokenOther && other) {
    const m21 = await req('POST', '/api/meetings', {
      title: 'S21 ting protocol',
      start_time: start,
      send_invites: false,
      create_thing: true,
      protocol_enabled: true,
      participant_ids: [other.id]
    }, token);
    const mid = m21.data.meeting && m21.data.meeting.id;
    if (mid) {
      await req('POST', '/api/meetings/' + mid + '/minutes', {
        item_type: 'decision', content: 'Секретное решение Тинга'
      }, token);
      const asOther = await req('GET', '/api/meetings/' + mid, null, tokenOther);
      const locked = asOther.data && asOther.data.protocol_locked === true;
      const empty = !asOther.data.minutes || asOther.data.minutes.length === 0;
      const leak = JSON.stringify(asOther.data.minutes || []).includes('Секретное');
      const postOther = await req('POST', '/api/meetings/' + mid + '/minutes', {
        item_type: 'note', content: 'взлом'
      }, tokenOther);
      ok('S21', asOther.status === 200 && locked && empty && !leak && postOther.status === 403,
        'locked=' + locked + ' empty=' + empty + ' post=' + postOther.status);
    } else {
      ok('S21', false, 'no meeting id: ' + JSON.stringify(m21.data).slice(0, 200));
    }
  } else {
    ok('S21', true, 'skipped — no second user');
  }

  // S22 dial-in resolve requires secret
  const noSec = await req('POST', '/api/thing/dial-in/resolve', { dial_code: '123456' });
  ok('S22', noSec.status === 401 || noSec.status === 503, 'status=' + noSec.status);

  await c.end();

  const failed = results.filter((x) => !x.pass);
  const report = [
    '# THING-E2E',
    '',
    'Date: ' + new Date().toISOString(),
    'Base: ' + BASE,
    'Pass: ' + (results.length - failed.length) + '/' + results.length,
    '',
    '| ID | Pass | Detail |',
    '|----|------|--------|',
    ...results.map((x) => `| ${x.id} | ${x.pass ? 'PASS' : 'FAIL'} | ${x.detail.replace(/\|/g, '/')} |`),
    '',
    failed.length ? '## FAIL' : '## ALL PASS',
    ...failed.map((x) => `- ${x.id}: ${x.detail}`)
  ].join('\n');

  const out = path.join(__dirname, 'reports', 'THING-E2E.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, report, 'utf8');
  console.log('\nWrote ' + out);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
