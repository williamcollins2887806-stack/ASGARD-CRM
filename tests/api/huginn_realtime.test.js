'use strict';

/**
 * Huginn realtime / invites smoke — expects clone DB with V364 applied
 * and app on TEST_BASE_URL (default http://127.0.0.1:3100).
 */

const assert = require('assert');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN_A = process.env.TEST_LOGIN_A || 'admin';
const PASS_A = process.env.TEST_PASS_A || 'huginn-test-ok';
const LOGIN_B = process.env.TEST_LOGIN_B || 'ok';
const PASS_B = process.env.TEST_PASS_B || 'huginn-test-ok';

async function login(login, password) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  const data = await res.json();
  assert.ok(res.ok, 'login failed: ' + JSON.stringify(data));
  let token = data.token;
  const pin = process.env.TEST_PIN || '1234';
  if (data.status === 'need_setup') {
    const setupRes = await fetch(BASE + '/api/auth/setup-credentials', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: password, pin })
    });
    const setupData = await setupRes.json();
    assert.ok(setupRes.ok, 'setup failed: ' + JSON.stringify(setupData));
    token = setupData.token || token;
    data.token = token;
    data.user = setupData.user || data.user;
    data.pinVerified = true;
  } else if (data.status === 'need_pin' || data.pinVerified === false) {
    const pinRes = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ pin })
    });
    const pinData = await pinRes.json();
    assert.ok(pinRes.ok, 'pin failed: ' + JSON.stringify(pinData));
    token = pinData.token || token;
    data.token = token;
    data.user = pinData.user || data.user;
    data.pinVerified = true;
  }
  return data;
}

async function api(token, path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function main() {
  const a = await login(LOGIN_A, PASS_A);
  const b = await login(LOGIN_B, PASS_B);

  // Presence ping
  {
    const { res, data } = await api(a.token, '/api/chat-groups/presence/ping', { method: 'POST', body: {} });
    assert.equal(res.status, 200, 'presence ping');
    assert.ok(data.ok);
  }

  // Events catch-up endpoint exists
  {
    const { res, data } = await api(a.token, '/api/chat-groups/events?since=0');
    assert.equal(res.status, 200, 'events');
    assert.ok(Array.isArray(data.events));
  }

  // Stickers
  {
    const { res, data } = await api(a.token, '/api/chat-groups/stickers');
    assert.equal(res.status, 200, 'stickers');
    assert.ok(Array.isArray(data.packs));
  }

  // Invite create + peek (guest cannot enter without token — peek 404 for garbage)
  {
    const { res, data } = await api(a.token, '/api/chat-groups/invites', {
      method: 'POST',
      body: { phone: '+79001112233', display_name: 'Test Guest' }
    });
    assert.equal(res.status, 200, 'invite create ' + JSON.stringify(data));
    assert.ok(data.invite && data.invite.token);
    const peek = await fetch(BASE + '/api/chat-groups/invites/' + data.invite.token);
    assert.equal(peek.status, 200);
    const bad = await fetch(BASE + '/api/chat-groups/invites/not-a-real-token');
    assert.equal(bad.status, 404);
  }

  // If A and B differ — send message and ensure events for B grow
  if (a.user && b.user && a.user.id !== b.user.id) {
    const direct = await api(a.token, '/api/chat-groups/direct', {
      method: 'POST',
      body: { user_id: b.user.id }
    });
    assert.ok(direct.res.ok, 'direct');
    const chatId = direct.data.chat.id;
    const before = await api(b.token, '/api/chat-groups/events?since=0');
    const maxBefore = (before.data.events || []).reduce((m, e) => Math.max(m, e.id || 0), 0);
    const sent = await api(a.token, '/api/chat-groups/' + chatId + '/messages', {
      method: 'POST',
      body: { text: 'huginn-rt-' + Date.now() }
    });
    assert.ok(sent.res.ok, 'send');
    const after = await api(b.token, '/api/chat-groups/events?since=' + maxBefore);
    assert.ok((after.data.events || []).some((e) => e.event === 'chat:new_message'), 'catch-up new_message');
  }

  console.log('HUGINN_REALTIME_OK');
}

main().catch((e) => {
  console.error('HUGINN_REALTIME_FAIL', e);
  process.exit(1);
});
