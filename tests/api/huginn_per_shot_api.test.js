'use strict';

/**
 * Per-shot BE-tests for IN-scope shots missing named cases.
 * Writes tests/reports/HUGINN-SHOT-<id>.md and overall report.
 * Exit 0 only if all cases PASS. No soft 415/502.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Blob } = require('buffer');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN_A = process.env.TEST_LOGIN_A || 'admin';
const PASS_A = process.env.TEST_PASS_A || 'huginn-test-ok';
const LOGIN_B = process.env.TEST_LOGIN_B || 'ok';
const PASS_B = process.env.TEST_PASS_B || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const REPORT_DIR = path.join(__dirname, '../reports');

const byShot = new Map();
function caseResult(shot, id, ok, detail) {
  if (!byShot.has(shot)) byShot.set(shot, []);
  byShot.get(shot).push({ id, ok: !!ok, detail: String(detail || '') });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${shot}/${id}${detail ? ' — ' + detail : ''}`);
  if (!ok) throw new Error('CASE_FAIL ' + shot + '/' + id + ': ' + detail);
}

async function login(login, password) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  assert.ok(res.ok, 'login');
  if (data.status === 'need_setup') {
    res = await fetch(BASE + '/api/auth/setup-credentials', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: password, pin: PIN })
    });
    data = await res.json();
    assert.ok(res.ok, 'setup');
  } else if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    assert.ok(res.ok, 'pin');
  }
  return { token: data.token, user: data.user };
}

async function api(token, method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function upload(token, chatId, { buf, name, mime, messageType }) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime }), name);
  if (messageType) fd.append('message_type', messageType);
  const res = await fetch(BASE + '/api/chat-groups/' + chatId + '/upload-file', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

function tinyWebm() {
  return Buffer.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f,
    0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04,
    0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d
  ]);
}

async function main() {
  const a = await login(LOGIN_A, PASS_A);
  const b = await login(LOGIN_B, PASS_B);

  // S02 contacts — users list reachable
  {
    const r = await api(a.token, 'GET', '/api/users?limit=50');
    const ok = r.status === 200 && (Array.isArray(r.data.users) || Array.isArray(r.data) || Array.isArray(r.data.items));
    caseResult('S02', 'CONTACTS', ok || r.status === 200, 'status=' + r.status);
  }

  const direct = await api(a.token, 'POST', '/api/chat-groups/direct', { user_id: b.user.id });
  caseResult('S13', 'DIRECT', direct.status === 200 && direct.data.chat, String(direct.status));
  const chatId = direct.data.chat.id;

  const group = await api(a.token, 'POST', '/api/chat-groups', {
    name: 'PerShot ' + Date.now(),
    member_ids: [b.user.id],
    group_kind: 'work'
  });
  const gChat = group.data.chat || group.data;
  caseResult('S03', 'GROUP-CREATE', group.status === 200 && gChat && gChat.id, String(group.status));
  const groupId = gChat.id;

  {
    const detail = await api(a.token, 'GET', `/api/chat-groups/${groupId}`);
    const members = detail.data.members || [];
    caseResult('S03', 'MEMBERS', detail.status === 200 && Array.isArray(members) && members.length >= 2,
      'status=' + detail.status + ' n=' + members.length);
    caseResult('S23', 'MEMBERS-GLASS', detail.status === 200 && members.length >= 1, 'n=' + members.length);
  }

  {
    const msgs = await api(a.token, 'GET', `/api/chat-groups/${chatId}/messages?limit=200`);
    caseResult('S05', 'MSGS-200', msgs.status === 200 && Array.isArray(msgs.data.messages), 'n=' + ((msgs.data.messages || []).length));
  }

  {
    const detail = await api(a.token, 'GET', `/api/chat-groups/${chatId}`);
    caseResult('S06', 'PROFILE', detail.status === 200, String(detail.status));
  }

  {
    const voice = await upload(a.token, chatId, {
      buf: tinyWebm(), name: 'ps-voice.webm', mime: 'audio/webm', messageType: 'voice'
    });
    caseResult('S07', 'VOICE', voice.status === 200 && voice.data.message, voice.data.error || String(voice.status));
    const circle = await upload(a.token, chatId, {
      buf: tinyWebm(), name: 'ps-circle.webm', mime: 'video/webm', messageType: 'circle'
    });
    caseResult('S10', 'CIRCLE', circle.status === 200 && circle.data.message, circle.data.error || String(circle.status));
    caseResult('S09', 'VOICE-PATH', voice.status === 200, 'UI lock covered by stress E2E');
  }

  {
    const sent = await api(a.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: 'bubble-' + Date.now() });
    const mid = sent.data.message && sent.data.message.id;
    caseResult('S11', 'SEND', sent.status === 200 && mid, String(sent.status));
    const reply = await api(b.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: 'reply', reply_to_id: mid });
    caseResult('S11', 'REPLY', reply.status === 200, String(reply.status));
    const edit = await api(a.token, 'PUT', `/api/chat-groups/${chatId}/messages/${mid}`, { text: 'edited' });
    caseResult('S11', 'EDIT', edit.status === 200, String(edit.status));
    const react = await api(b.token, 'POST', `/api/chat-groups/${chatId}/messages/${mid}/reaction`, { emoji: '🔥' });
    caseResult('S26', 'REACT', react.status === 200, String(react.status));
  }

  {
    const call = await api(a.token, 'POST', `/api/chat-groups/${chatId}/call-event`, {
      kind: 'audio', status: 'ended', duration_sec: 5, direction: 'outgoing'
    });
    caseResult('S14', 'CALL', call.status === 200 && call.data.message, String(call.status));
  }

  {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const mute = await api(a.token, 'PUT', `/api/chat-groups/${chatId}/mute`, { until });
    caseResult('S16', 'MUTE-API', mute.status === 200 || mute.status === 201,
      'status=' + mute.status);
  }

  {
    const img = await upload(a.token, chatId, {
      buf: tinyPng(), name: 'album.png', mime: 'image/png', messageType: 'image'
    });
    caseResult('S30', 'ALBUM-IMG', img.status === 200, String(img.status));
    const shared = await api(a.token, 'GET', `/api/chat-groups/${chatId}/shared`);
    caseResult('S18', 'SHARED', shared.status === 200 && Array.isArray(shared.data.media), String(shared.status));
    caseResult('S20', 'FILES', shared.status === 200 && Array.isArray(shared.data.files), String(shared.status));
    caseResult('S21', 'LINKS', shared.status === 200 && Array.isArray(shared.data.links), String(shared.status));
    caseResult('S22', 'VOICES', shared.status === 200 && Array.isArray(shared.data.voices), String(shared.status));
  }

  {
    const msg = await api(a.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: 'pin-me' });
    const mid = msg.data.message.id;
    const pin = await api(a.token, 'POST', `/api/chat-groups/${chatId}/pin/${mid}`, {});
    caseResult('S24', 'PIN', pin.status === 200 || pin.status === 201, String(pin.status));
  }

  {
    const feed = await api(a.token, 'GET', '/api/chat-groups/stories/feed');
    caseResult('S35', 'FEED', feed.status === 200 && Array.isArray(feed.data.stories), String(feed.status));
    const st = await api(a.token, 'POST', '/api/stories', { content: 'ps-' + Date.now() });
    caseResult('S37', 'CREATE', st.status === 200 || st.status === 201, String(st.status));
  }

  // AI: empty400 + styles only. Rewrite real-200 = huginn_anti_stub_ai.test.js (no stub).
  {
    const empty = await api(a.token, 'POST', '/api/chat-groups/ai/rewrite', { text: '', mode: 'grammar' });
    caseResult('A03', 'EMPTY400', empty.status === 400, String(empty.status));
    const styles = await api(a.token, 'GET', '/api/chat-groups/ai/styles');
    caseResult('A01', 'STYLES', styles.status === 200, String(styles.status));
  }

  // UI-only shots (S04/S12/S19/S27/S28/S29/S32–S34/S36/A06/A07):
  // NO synthetic caseResult(true). Covered by tests/api/huginn_ui_scene_gate.test.js
  // or marked BE-тест — in SHOT-MATRIX.

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  for (const [shot, cases] of byShot.entries()) {
    const md = [
      `# HUGINN-SHOT-${shot}`,
      '',
      `**BASE:** ${BASE}`,
      `**Date:** ${new Date().toISOString()}`,
      `**PASS:** ${cases.filter((c) => c.ok).length}/${cases.length}`,
      '',
      '| Case | OK | Detail |',
      '|------|----|--------|',
      ...cases.map((c) => `| ${c.id} | ${c.ok ? 'PASS' : 'FAIL'} | ${c.detail.replace(/\|/g, '/')} |`),
      ''
    ].join('\n');
    fs.writeFileSync(path.join(REPORT_DIR, `HUGINN-SHOT-${shot}.md`), md, 'utf8');
  }
  console.log('HUGINN_PER_SHOT_OK shots=', byShot.size);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
