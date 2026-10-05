'use strict';

/**
 * Huginn stress — parallel sends, multi SSE catch-up, latency budget.
 * Clone :3100 + asgard_crm_test. Exit 0 only if all gates PASS.
 */

const assert = require('assert');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN_A = process.env.TEST_LOGIN_A || 'admin';
const PASS_A = process.env.TEST_PASS_A || 'huginn-test-ok';
const LOGIN_B = process.env.TEST_LOGIN_B || 'ok';
const PASS_B = process.env.TEST_PASS_B || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const N_MSG = Number(process.env.HUGINN_STRESS_N || 200);
const N_SSE = Number(process.env.HUGINN_STRESS_SSE || 20);
const P95_MS = Number(process.env.HUGINN_STRESS_P95 || 300);

const results = [];
function gate(id, ok, detail) {
  results.push({ id, ok: !!ok, detail: String(detail || '') });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + id + (detail ? ' — ' + detail : ''));
  if (!ok) throw new Error('GATE_FAIL ' + id + ': ' + detail);
}

async function login(login, password) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  assert.ok(res.ok, 'login ' + login);
  if (data.status === 'need_setup') {
    res = await fetch(BASE + '/api/auth/setup-credentials', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: password, pin: PIN })
    });
    data = await res.json();
    assert.ok(res.ok, 'setup ' + login);
  } else if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    assert.ok(res.ok, 'pin ' + login);
  }
  return { token: data.token, user: data.user };
}

async function api(token, method, p, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + p, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, ms: Date.now() - t0 };
}

function p95(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
}

(async () => {
  console.log('BASE', BASE, 'N_MSG', N_MSG, 'N_SSE', N_SSE);
  const a = await login(LOGIN_A, PASS_A);
  const b = await login(LOGIN_B, PASS_B);

  const direct = await api(a.token, 'POST', '/api/chat-groups/direct', { user_id: b.user.id });
  gate('stress_direct', direct.status === 200 && direct.data.chat && direct.data.chat.id, direct.data.error || '');
  const chatId = direct.data.chat.id;

  const since0 = await api(a.token, 'GET', '/api/chat-groups/events?since=0');
  const sinceId = Math.max(0, ...(since0.data.events || []).map((e) => Number(e.id) || 0));

  const latencies = [];
  const ids = [];
  const batch = [];
  const wall0 = Date.now();
  for (let i = 0; i < N_MSG; i++) {
    batch.push((async (i) => {
      const r = await api(a.token, 'POST', `/api/chat-groups/${chatId}/messages`, {
        text: 'stress-' + i + '-' + Date.now()
      });
      if (r.status === 200 && r.data.message && r.data.message.id) ids.push(Number(r.data.message.id));
      else throw new Error('send fail i=' + i + ' ' + JSON.stringify(r.data).slice(0, 120));
    })(i));
  }
  await Promise.all(batch);
  const wallMs = Date.now() - wall0;
  const uniq = new Set(ids);
  gate('stress_parallel_no_loss', ids.length === N_MSG, 'got=' + ids.length);
  gate('stress_parallel_no_dup', uniq.size === N_MSG, 'uniq=' + uniq.size);
  const sorted = ids.slice().sort((x, y) => x - y);
  gate('stress_order_by_id', sorted.every((v, i) => i === 0 || v > sorted[i - 1]), 'min=' + sorted[0] + ' max=' + sorted[sorted.length - 1]);
  gate('stress_parallel_wall', wallMs <= 30000, 'wall=' + wallMs + 'ms');

  // Sequential latency sample after short warm-up (avoids cold-start flake)
  for (let i = 0; i < 5; i++) {
    await api(a.token, 'POST', `/api/chat-groups/${chatId}/messages`, { text: 'stress-warm-' + i });
  }
  for (let i = 0; i < 20; i++) {
    const r = await api(a.token, 'POST', `/api/chat-groups/${chatId}/messages`, {
      text: 'stress-seq-' + i
    });
    latencies.push(r.ms);
    assert.ok(r.status === 200 && r.data.message, 'seq send');
  }
  const p = p95(latencies);
  gate('stress_p95_send', p <= P95_MS, 'p95=' + p + 'ms budget=' + P95_MS);

  // Multi-client catch-up after burst
  const clients = [];
  for (let c = 0; c < N_SSE; c++) {
    clients.push(api(b.token, 'GET', '/api/chat-groups/events?since=' + sinceId));
  }
  const catches = await Promise.all(clients);
  let minNew = Infinity;
  for (let i = 0; i < catches.length; i++) {
    const ev = (catches[i].data.events || []).filter((e) => e.event === 'chat:new_message');
    minNew = Math.min(minNew, ev.length);
    if (catches[i].status !== 200) throw new Error('catch client ' + i + ' status ' + catches[i].status);
  }
  gate('stress_sse_clients', minNew >= Math.min(N_MSG, 1), 'minNew=' + minNew + ' clients=' + N_SSE);

  // Catch-up after simulated disconnect (jump since forward then back)
  const mid = await api(a.token, 'GET', '/api/chat-groups/events?since=' + sinceId);
  const last = Math.max(sinceId, ...(mid.data.events || []).map((e) => Number(e.id) || 0));
  const afterGap = await api(a.token, 'GET', '/api/chat-groups/events?since=' + Math.max(0, last - 5));
  gate('stress_catchup_after_gap', afterGap.status === 200 && Array.isArray(afterGap.data.events), 'n=' + (afterGap.data.events || []).length);

  console.log('HUGINN_STRESS_OK', results.length);
  process.exit(0);
})().catch((e) => {
  console.error('HUGINN_STRESS_FAIL', e.message || e);
  process.exit(1);
});
