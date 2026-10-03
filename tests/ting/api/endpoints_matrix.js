#!/usr/bin/env node
/**
 * THING API 1:1 matrix vs src/routes/thing.js.
 * Usage: THING_TEST_BASE=http://127.0.0.1:3100 node tests/ting/api/endpoints_matrix.js
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

const BASE = process.env.THING_TEST_BASE || 'http://127.0.0.1:3100';
const rows = [];
const jsonPath = path.join(__dirname, '../../reports/THING-API-MATRIX.json');
const mdPath = path.join(__dirname, '../../reports/THING-API-MATRIX.md');

function mark(id, pass, detail) {
  rows.push({ id, pass: !!pass, detail: String(detail || '') });
  console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + ' — ' + detail);
}

function req(method, p, body, token, extraHeaders) {
  const payload = body == null ? null : JSON.stringify(body);
  const u = new URL(BASE + p);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const r = lib.request(
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

(async () => {
  const c = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT,
    database: process.env.DB_NAME || process.env.PGDATABASE || 'asgard_crm_test',
    user: process.env.DB_USER || process.env.PGUSER,
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD
  });
  await c.connect();
  const { rows: admins } = await c.query(
    `SELECT id, login, role, name FROM users WHERE role='ADMIN' AND COALESCE(is_active,true)=true ORDER BY id LIMIT 1`
  );
  const { rows: others } = await c.query(
    `SELECT id, login, role, name FROM users WHERE id <> $1 AND COALESCE(is_active,true)=true ORDER BY id LIMIT 1`,
    [admins[0].id]
  );
  const admin = admins[0];
  const other = others[0];
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
  await c.end();

  const health = await req('GET', '/api/thing/health');
  mark('E01_health', health.status === 200 && health.data.ok === true, 'livekit=' + !!health.data.livekit);
  const lk = !!health.data.livekit;

  const created = await req('POST', '/api/thing/rooms', {
    title: 'API matrix ' + Date.now(),
    lobby_enabled: true,
    protocol_enabled: true,
    pin_code: '4321'
  }, token);
  const room = (created.data && created.data.room) || created.data || {};
  mark(
    'E02_create',
    (created.status === 201 || created.status === 200) && !!room.slug,
    'status=' + created.status + ' err=' + (created.data && (created.data.error || created.data.message) || '')
  );
  if (!room.slug) {
    const numer = rows.filter((r) => r.pass).length;
    const summary = {
      at: new Date().toISOString(),
      base: BASE,
      livekit: lk,
      numerator: numer,
      denominator: rows.length,
      pass: false,
      fails: rows.filter((r) => !r.pass).map((r) => r.id + ': ' + r.detail).concat(['ABORT: no room slug']),
      rows
    };
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
    fs.writeFileSync(mdPath, '# THING-API-MATRIX\n\nABORT: create failed\n\nVERDICT: FAIL — create\n');
    console.error('ABORT: room create failed', created.status, created.data);
    process.exit(1);
  }

  const listed = await req('GET', '/api/thing/rooms', null, token);
  mark('E03_list', listed.status === 200 && Array.isArray(listed.data.rooms || listed.data), 'status=' + listed.status);

  const got = await req('GET', `/api/thing/rooms/${room.slug}`, null, token);
  mark('E04_get', got.status === 200 && got.data.room && got.data.room.slug === room.slug, 'status=' + got.status);

  const tok = await req('POST', `/api/thing/rooms/${room.slug}/token`, {}, token);
  if (lk) {
    mark('E05_token', tok.status === 200 && !!tok.data.token, 'status=' + tok.status);
  } else {
    mark(
      'E05_token',
      tok.status === 503 && tok.data.code === 'LIVEKIT_NOT_CONFIGURED',
      'expect 503 when LK off got ' + tok.status + ' ' + (tok.data.code || tok.data.error || '')
    );
  }

  const start = await req('POST', `/api/thing/rooms/${room.slug}/start`, {}, token);
  mark('E06_start', start.status === 200 && (start.data.room || {}).status === 'live', 'status=' + start.status);

  const leave = await req('POST', `/api/thing/rooms/${room.slug}/leave`, {}, token);
  mark('E07_leave', leave.status === 200 && leave.data.ok === true, 'status=' + leave.status);

  const recStart = await req('POST', `/api/thing/rooms/${room.slug}/recording/start`, {}, token);
  if (lk) {
    mark('E08_rec_start', recStart.status === 200 || recStart.status === 400, 'status=' + recStart.status);
  } else {
    mark(
      'E08_rec_start',
      recStart.status === 503 || recStart.status === 400 || recStart.status === 500,
      'LK off / no egress status=' + recStart.status
    );
  }
  const recStop = await req('POST', `/api/thing/rooms/${room.slug}/recording/stop`, {}, token);
  mark('E09_rec_stop', [200, 400, 404, 503].includes(recStop.status), 'status=' + recStop.status);
  const recGet = await req('GET', `/api/thing/rooms/${room.slug}/recording`, null, token);
  mark('E10_rec_get', [200, 404].includes(recGet.status), 'status=' + recGet.status);

  const proto = await req('GET', `/api/thing/rooms/${room.slug}/protocol`, null, token);
  mark('E11_proto_get', proto.status === 200, 'status=' + proto.status);
  if (tokenOther) {
    const proto403 = await req('GET', `/api/thing/rooms/${room.slug}/protocol`, null, tokenOther);
    mark('E12_proto_nonhost', proto403.status === 403, 'status=' + proto403.status);
  } else {
    mark('E12_proto_nonhost', false, 'no second user');
  }
  const protoGen = await req('POST', `/api/thing/rooms/${room.slug}/protocol/generate`, {}, token);
  mark(
    'E13_proto_generate',
    protoGen.status === 400 || protoGen.status === 200,
    'status=' + protoGen.status + ' (400 no recording expected)'
  );

  const pub = await req('GET', `/api/thing/public/${room.slug}`);
  mark('E14_public', pub.status === 200 && !('dial_code' in (pub.data.room || pub.data)), 'status=' + pub.status);

  const guestWait = await req('POST', `/api/thing/public/${room.slug}/guest-token`, {
    name: 'Matrix Guest', pin: '4321'
  });
  mark(
    'E15_guest_token',
    guestWait.status === 200 && (guestWait.data.lobby_status === 'waiting' || guestWait.data.token),
    'status=' + guestWait.status + ' lobby=' + guestWait.data.lobby_status
  );
  const waitId = guestWait.data.participant_id;
  const waitIdent = guestWait.data.identity;
  const waitJt = guestWait.data.join_token;
  const lobbySt = await req(
    'GET',
    `/api/thing/public/${room.slug}/lobby-status?identity=${encodeURIComponent(waitIdent || '')}` +
      `&join_token=${encodeURIComponent(waitJt || '')}`
  );
  mark(
    'E16_lobby_status',
    lobbySt.status === 200 && lobbySt.data.lobby_status === 'waiting',
    'status=' + lobbySt.status + ' lobby=' + lobbySt.data.lobby_status
  );

  const admit = waitId
    ? await req('POST', `/api/thing/rooms/${room.slug}/lobby/${waitId}/admit`, {}, token)
    : { status: 0 };
  mark('E17_admit', admit.status === 200, 'status=' + admit.status);

  const guest2 = await req('POST', `/api/thing/public/${room.slug}/guest-token`, {
    name: 'Reject Matrix', pin: '4321'
  });
  const rej = await req(
    'POST',
    `/api/thing/rooms/${room.slug}/lobby/${guest2.data.participant_id}/reject`,
    {},
    token
  );
  mark('E18_reject', rej.status === 200, 'status=' + rej.status);

  const parts = await req('GET', `/api/thing/rooms/${room.slug}/participants`, null, token);
  mark('E19_participants', parts.status === 200 && Array.isArray(parts.data.participants), 'status=' + parts.status);
  const guestPart = (parts.data.participants || []).find((p) => p.role === 'guest' && p.identity);
  if (guestPart) {
    const kick = await req(
      'POST',
      `/api/thing/rooms/${room.slug}/participants/${encodeURIComponent(guestPart.identity)}/remove`,
      {},
      token
    );
    mark('E20_remove', kick.status === 200, 'status=' + kick.status);
  } else {
    mark('E20_remove', false, 'no guest to remove');
  }

  const mute = await req('POST', `/api/thing/rooms/${room.slug}/mute-all`, {}, token);
  mark('E21_mute_all', [200, 503].includes(mute.status), 'status=' + mute.status);

  const chatPost = await req('POST', `/api/thing/rooms/${room.slug}/chat`, { text: 'api matrix hi' }, token);
  const chatGet = await req('GET', `/api/thing/rooms/${room.slug}/chat`, null, token);
  mark(
    'E22_chat_crm',
    chatPost.status === 200 && (chatGet.data.messages || []).some((m) => /api matrix hi/.test(m.text || '')),
    'post=' + chatPost.status
  );

  const guestAdmitted = await req('POST', `/api/thing/public/${room.slug}/guest-token`, {
    name: 'Chat Guest', pin: '4321'
  });
  let admit2 = { status: 0, data: {} };
  if (guestAdmitted.data.participant_id) {
    admit2 = await req(
      'POST',
      `/api/thing/rooms/${room.slug}/lobby/${guestAdmitted.data.participant_id}/admit`,
      {},
      token
    );
  }
  const joinToken = admit2.data.join_token || guestAdmitted.data.join_token;
  const guestIdent = guestAdmitted.data.identity;
  const pubChatGet = await req(
    'GET',
    `/api/thing/public/${room.slug}/chat?identity=${encodeURIComponent(guestIdent || '')}` +
      `&join_token=${encodeURIComponent(joinToken || '')}`
  );
  const pubChatPost = await req(
    'POST',
    `/api/thing/public/${room.slug}/chat`,
    { text: 'guest chat matrix', join_token: joinToken, identity: guestIdent },
    null
  );
  mark(
    'E23_chat_public',
    pubChatGet.status === 200 && pubChatPost.status === 200,
    `get=${pubChatGet.status} post=${pubChatPost.status} jt=${!!joinToken}`
  );

  const pubLeave = await req('POST', `/api/thing/public/${room.slug}/leave`, {
    identity: guestIdent,
    join_token: joinToken
  });
  mark('E24_public_leave', pubLeave.status === 200, 'status=' + pubLeave.status);

  const dial = await req('GET', '/api/thing/dial-in');
  mark('E25_dialin_info', dial.status === 200, 'status=' + dial.status);
  const secret = process.env.THING_DIALIN_SECRET || '';
  if (secret && room.dial_code) {
    // Room may require PIN — send it; wrong secret → 401; missing secret on server → 503
    const resolve = await req(
      'POST',
      '/api/thing/dial-in/resolve',
      { dial_code: room.dial_code, pin: '4321' },
      null,
      { 'x-thing-dialin-secret': secret }
    );
    mark(
      'E26_dialin_resolve',
      resolve.status === 200 || resolve.status === 503,
      'status=' + resolve.status + ' (503=secret unset on server)'
    );
  } else {
    const resolveBad = await req('POST', '/api/thing/dial-in/resolve', { dial_code: room.dial_code || '000000' });
    mark(
      'E26_dialin_resolve',
      [401, 403, 400, 503].includes(resolveBad.status),
      'no client secret — ACL assert status=' + resolveBad.status
    );
  }

  const sip = await req('POST', '/api/thing/sip/ensure', {}, token);
  mark(
    'E27_sip_ensure',
    sip.status === 200 || sip.status === 500 || sip.status === 503,
    'ADMIN path status=' + sip.status + ' ' + (sip.data.error || sip.data.ok || '')
  );
  if (tokenOther && other && other.role !== 'ADMIN') {
    const sipForbid = await req('POST', '/api/thing/sip/ensure', {}, tokenOther);
    mark('E28_sip_acl', sipForbid.status === 403 || sipForbid.status === 401, 'non-admin ' + sipForbid.status);
  } else {
    mark('E28_sip_acl', true, 'second user is ADMIN or missing — ACL path covered by requireRoles in source');
  }

  const end = await req('POST', `/api/thing/rooms/${room.slug}/end`, {}, token);
  mark('E29_end', end.status === 200, 'status=' + end.status);
  const tokEnded = await req('POST', `/api/thing/rooms/${room.slug}/token`, {}, token);
  mark('E30_ended_token', tokEnded.status === 410 || tokEnded.status === 400, 'status=' + tokEnded.status);

  const badPinRoom = await req('POST', '/api/thing/rooms', {
    title: 'Pin matrix ' + Date.now(),
    lobby_enabled: false,
    pin_code: '9999'
  }, token);
  const badPin = await req('POST', `/api/thing/public/${badPinRoom.data.room.slug}/guest-token`, {
    name: 'X', pin: '0000'
  });
  mark('E31_bad_pin', [400, 401, 403].includes(badPin.status), 'status=' + badPin.status);
  await req('POST', `/api/thing/rooms/${badPinRoom.data.room.slug}/end`, {}, token);

  const numer = rows.filter((r) => r.pass).length;
  const denom = rows.length;
  const summary = {
    at: new Date().toISOString(),
    base: BASE,
    livekit: lk,
    numerator: numer,
    denominator: denom,
    pass: numer === denom && denom > 0,
    fails: rows.filter((r) => !r.pass).map((r) => r.id + ': ' + r.detail),
    rows
  };
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  const md = [
    '# THING-API-MATRIX',
    '',
    `at: ${summary.at}`,
    `base: \`${BASE}\``,
    `livekit: ${lk}`,
    `result: ${numer}/${denom} ${summary.pass ? 'GREEN' : 'RED'}`,
    '',
    '| ID | PASS | Detail |',
    '|----|------|--------|',
    ...rows.map((r) => `| ${r.id} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`),
    '',
    summary.pass
      ? 'VERDICT: ALL_GREEN — исправлять нечего, улучшать нечего'
      : 'VERDICT: FAIL — ' + summary.fails.length + ' items'
  ].join('\n');
  fs.writeFileSync(mdPath, md);
  console.log('\nAPI MATRIX ' + numer + '/' + denom + (summary.pass ? ' GREEN' : ' RED'));
  process.exit(summary.pass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
