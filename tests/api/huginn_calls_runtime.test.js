'use strict';

/**
 * Huginn 1:1 calls + presence/directory + delete/clear — API runtime on clone.
 * Run against :3100 (asgard_crm_test). Exit 0 only if every case passes.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN_A = process.env.TEST_LOGIN_A || 'admin';
const PASS_A = process.env.TEST_PASS_A || 'huginn-test-ok';
const LOGIN_B = process.env.TEST_LOGIN_B || 'ok';
const PASS_B = process.env.TEST_PASS_B || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';

const REPORT = path.join(__dirname, '../reports/HUGINN-CALLS-RUNTIME.md');
const results = [];

function caseResult(id, ok, detail) {
  results.push({ id, ok: !!ok, detail: String(detail || '') });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`);
  if (!ok) throw new Error('CASE_FAIL ' + id + ': ' + detail);
}

async function login(loginName, password) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password })
  });
  let data = await res.json();
  assert.ok(res.ok, 'login ' + loginName + ': ' + JSON.stringify(data));
  if (data.status === 'need_setup') {
    res = await fetch(BASE + '/api/auth/setup-credentials', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: password, pin: PIN })
    });
    data = await res.json();
    assert.ok(res.ok, 'setup ' + loginName + ': ' + JSON.stringify(data));
  } else if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    assert.ok(res.ok, 'pin ' + loginName + ': ' + JSON.stringify(data));
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
  return { res, data, status: res.status };
}

async function main() {
  const t0 = Date.now();
  const a = await login(LOGIN_A, PASS_A);
  const b = await login(LOGIN_B, PASS_B);
  caseResult('AUTH', true, `a=${a.user && a.user.id} b=${b.user && b.user.id}`);

  const direct = await api(a.token, 'POST', '/api/chat-groups/direct', { user_id: b.user.id });
  const chatId = direct.data.chat && direct.data.chat.id;
  caseResult('DIRECT', direct.status === 200 && !!chatId, 'chat=' + chatId);
  const bName = String((b.user && b.user.name) || '').trim();

  // ── presence/all ─────────────────────────────────────────────
  {
    const all = await api(a.token, 'GET', '/api/chat-groups/presence/all');
    caseResult('PRESENCE-ALL', all.status === 200 && Array.isArray(all.data.presence) && all.data.presence.length > 0,
      'n=' + ((all.data.presence || []).length));
    const me = (all.data.presence || []).find((p) => Number(p.user_id) === Number(a.user.id));
    caseResult('PRESENCE-ALL-FIELDS', !!me && 'online' in me && 'last_seen_at' in me,
      JSON.stringify(me || null).slice(0, 140));
    // online=true requires an open SSE stream; the REST probe has none, so the
    // value must simply be a boolean reflecting the live registry.
    caseResult('PRESENCE-ALL-ONLINE-BOOL', !!me && typeof me.online === 'boolean', 'online=' + (me && me.online));
  }

  // ── directory ────────────────────────────────────────────────
  {
    const dir = await api(a.token, 'GET', '/api/chat-groups/directory');
    const users = dir.data.users || [];
    caseResult('DIRECTORY-OK', dir.status === 200 && users.length > 0, 'n=' + users.length);
    const peer = users.find((u) => Number(u.user_id) === Number(b.user.id));
    caseResult('DIRECTORY-HAS-PEER', !!peer, 'peer=' + JSON.stringify(peer || null).slice(0, 160));
    caseResult('DIRECTORY-PEER-CHAT', !!(peer && Number(peer.chat_id) === Number(chatId)),
      'chat_id=' + (peer && peer.chat_id));
    const self = users.find((u) => Number(u.user_id) === Number(a.user.id));
    caseResult('DIRECTORY-NO-SELF', !self, 'present=' + !!self);
  }

  // ── calls: create → busy → answer → end ──────────────────────
  let callId = null;
  {
    const c = await api(a.token, 'POST', '/api/chat-groups/calls', { chat_id: Number(chatId), kind: 'video' });
    callId = c.data.call && c.data.call.id;
    caseResult('CALL-CREATE', c.status === 200 && !!callId, 'status=' + c.status + ' id=' + callId);
    caseResult('CALL-CREATE-PEER', (c.data.call && c.data.call.peer_name) === bName,
      'peer_name=' + JSON.stringify(c.data.call && c.data.call.peer_name));
    caseResult('CALL-CREATE-TOKEN', !!c.data.token || c.data.livekit_ready === false,
      'token=' + !!c.data.token + ' livekit_ready=' + c.data.livekit_ready);

    const active = await api(b.token, 'GET', '/api/chat-groups/calls/active');
    caseResult('CALL-INCOMING-ACTIVE', active.status === 200 && active.data.call && Number(active.data.call.id) === Number(callId),
      JSON.stringify(active.data.call || null).slice(0, 140));
    caseResult('CALL-INCOMING-FLAG', active.data.incoming === true, 'incoming=' + active.data.incoming);

    const busy = await api(b.token, 'POST', '/api/chat-groups/calls', { chat_id: Number(chatId), kind: 'audio' });
    caseResult('CALL-BUSY-409', busy.status === 409, 'status=' + busy.status);

    const ans = await api(b.token, 'POST', '/api/chat-groups/calls/' + callId + '/answer', {});
    caseResult('CALL-ANSWER', ans.status === 200 && ans.data.call && ans.data.call.status === 'active',
      'status=' + (ans.data.call && ans.data.call.status));

    const end = await api(a.token, 'POST', '/api/chat-groups/calls/' + callId + '/end', {});
    caseResult('CALL-END', end.status === 200 && ['ended', 'canceled'].includes(end.data.call && end.data.call.status),
      'status=' + (end.data.call && end.data.call.status));
    caseResult('CALL-END-DURATION', end.data.call && Number(end.data.call.duration_sec) >= 0,
      'duration=' + (end.data.call && end.data.call.duration_sec));
  }

  // ── calls: decline path ──────────────────────────────────────
  {
    const c = await api(a.token, 'POST', '/api/chat-groups/calls', { chat_id: Number(chatId), kind: 'audio' });
    const id2 = c.data.call && c.data.call.id;
    caseResult('CALL2-CREATE', c.status === 200 && !!id2, 'id=' + id2);
    const dec = await api(b.token, 'POST', '/api/chat-groups/calls/' + id2 + '/decline', {});
    caseResult('CALL-DECLINE', dec.status === 200 && dec.data.call && dec.data.call.status === 'declined',
      'status=' + (dec.data.call && dec.data.call.status));
    const msgs = await api(a.token, 'GET', '/api/chat-groups/' + chatId + '/messages?limit=5');
    const arr = msgs.data.messages || msgs.data.items || [];
    const missed = arr.some((m) => m.message_type === 'call_event');
    caseResult('CALL-EVENT-MESSAGE', missed, 'call_event in last 5=' + missed);
  }

  // ── calls: only direct, not for groups ───────────────────────
  {
    const group = await api(a.token, 'POST', '/api/chat-groups', { name: 'CallProbe ' + Date.now(), member_ids: [b.user.id] });
    const gid = group.data.chat && group.data.chat.id;
    const bad = await api(a.token, 'POST', '/api/chat-groups/calls', { chat_id: Number(gid), kind: 'audio' });
    caseResult('CALL-GROUP-REJECTED', bad.status === 400, 'status=' + bad.status);
    await api(a.token, 'DELETE', '/api/chat-groups/' + gid);
  }

  // ── clear history endpoint exists ────────────────────────────
  {
    const ch = await api(a.token, 'DELETE', '/api/chat-groups/' + chatId + '/messages');
    caseResult('CLEAR-HISTORY', [200, 403].includes(ch.status), 'status=' + ch.status);
  }

  // ── in-chat search ───────────────────────────────────────────
  {
    const sent = await api(a.token, 'POST', '/api/chat-groups/' + chatId + '/messages', { text: 'huginn-search-probe-42' });
    caseResult('SEARCH-SEED', sent.status === 200, 'status=' + sent.status);
    const sr = await api(a.token, 'GET', '/api/chat-groups/' + chatId + '/messages?search=huginn-search-probe-42');
    const found = (sr.data.messages || sr.data.items || []).some((m) => /huginn-search-probe-42/.test(String(m.message || '')));
    caseResult('IN-CHAT-SEARCH', sr.status === 200 && found, 'found=' + found + ' n=' + ((sr.data.messages || []).length));
  }

  // ── pin / unpin ──────────────────────────────────────────────
  {
    const msg = await api(a.token, 'POST', '/api/chat-groups/' + chatId + '/messages', { text: 'pin-probe ' + Date.now() });
    const mid = (msg.data.message && msg.data.message.id) || msg.data.id;
    const pin = await api(a.token, 'POST', '/api/chat-groups/' + chatId + '/pin/' + mid, {});
    caseResult('PIN', [200, 201].includes(pin.status), 'status=' + pin.status);
    const unpin = await api(a.token, 'DELETE', '/api/chat-groups/' + chatId + '/pin/' + mid);
    caseResult('UNPIN', [200, 204].includes(unpin.status), 'status=' + unpin.status);
  }

  // ── chat delete (direct) — LAST: it destroys the shared direct chat ──
  {
    const tmp = await api(a.token, 'POST', '/api/chat-groups/direct', { user_id: b.user.id });
    const tmpId = tmp.data.chat && tmp.data.chat.id;
    const del = await api(b.token, 'DELETE', '/api/chat-groups/' + tmpId);
    caseResult('DELETE-DIRECT-ANY-MEMBER', del.status === 200 && del.data.success === true,
      'status=' + del.status + ' by=callee');
    const after = await api(a.token, 'GET', '/api/chat-groups/' + tmpId);
    caseResult('DELETE-DIRECT-GONE', after.status === 404 || after.status === 403, 'status=' + after.status);
  }

  // ── calls: simultaneous POST race → exactly one wins ─────────
  {
    const fresh = await api(a.token, 'POST', '/api/chat-groups/direct', { user_id: b.user.id });
    const raceChat = fresh.data.chat && fresh.data.chat.id;
    const [r1, r2] = await Promise.all([
      api(a.token, 'POST', '/api/chat-groups/calls', { chat_id: Number(raceChat), kind: 'audio' }),
      api(b.token, 'POST', '/api/chat-groups/calls', { chat_id: Number(raceChat), kind: 'audio' })
    ]);
    const codes = [r1.status, r2.status].sort().join(',');
    caseResult('CALL-RACE-SINGLE-WINNER', codes === '200,409', 'codes=' + codes + ' chat=' + raceChat);
    for (const tok of [a.token, b.token]) {
      const act = await api(tok, 'GET', '/api/chat-groups/calls/active');
      if (act.data.call) await api(tok, 'POST', '/api/chat-groups/calls/' + act.data.call.id + '/end', {});
    }
  }

  // ── is_favorite round-trip (PUT /:id) ────────────────────────
  {
    const fresh = await api(a.token, 'POST', '/api/chat-groups/direct', { user_id: b.user.id });
    const favChat = fresh.data.chat && fresh.data.chat.id;
    const on = await api(a.token, 'PUT', '/api/chat-groups/' + favChat, { is_favorite: true });
    caseResult('FAVORITE-SET', on.status === 200, 'status=' + on.status);
    const list = await api(a.token, 'GET', '/api/chat-groups');
    const row = (list.data.chats || []).find((c) => Number(c.id) === Number(favChat));
    caseResult('FAVORITE-IN-LIST', !!(row && row.is_favorite === true), 'is_favorite=' + (row && row.is_favorite));
    const off = await api(a.token, 'PUT', '/api/chat-groups/' + favChat, { is_favorite: false });
    caseResult('FAVORITE-UNSET', off.status === 200, 'status=' + off.status);
  }

  // ── bot DM guard: 3+ member direct is never renamed ───────────
  {
    const botChat = await api(b.token, 'GET', '/api/chat-groups');
    const bots = (botChat.data.chats || []).filter((c) => Number(c.direct_user_id) > 0 && /мимир/i.test(String(c.direct_user_name || '')));
    caseResult('BOT-DM-PRESENT', bots.length > 0, 'n=' + bots.length);
    const botsOk = !bots.length
      || bots.every((c) => String(c.name || '').trim() === String(c.direct_user_name || '').trim());
    caseResult('BOT-DM-NAME-EQ-PEER', botsOk,
      bots.length ? bots.map((c) => c.name + '/' + c.direct_user_name).slice(0, 3).join(' | ') : 'skipped: no bot DM');
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  const md = [
    '# HUGINN-CALLS-RUNTIME',
    '',
    `Base: ${BASE}`,
    `Elapsed: ${Date.now() - t0}ms`,
    `PASS ${pass} / FAIL ${fail} / TOTAL ${results.length}`,
    '',
    '| Case | Result | Detail |',
    '|------|--------|--------|',
    ...results.map((r) => `| ${r.id} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`),
    ''
  ].join('\n');
  fs.writeFileSync(REPORT, md, 'utf8');
  console.log('REPORT ' + REPORT);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
