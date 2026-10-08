'use strict';

/**
 * Anti-stub gate: clone must answer rewrite without HUGINN_AI_STUB.
 * Exit 0 only on real 200 + text. Writes tests/reports/HUGINN-ANTI-STUB-AI.md
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const REPORT = path.join(__dirname, '../reports/HUGINN-ANTI-STUB-AI.md');

async function login() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login ' + JSON.stringify(data));
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
  }
  return data.token;
}

(async () => {
  if (process.env.HUGINN_AI_STUB === '1') {
    throw new Error('Refuse: test process has HUGINN_AI_STUB=1');
  }
  const token = await login();
  const modes = [
    { mode: 'grammar', text: 'привет как дела' },
    { mode: 'translate', text: 'привет', target_lang: 'английский' },
    { mode: 'style', text: 'привет команда', style_id: 'formal' }
  ];
  const lines = ['# HUGINN-ANTI-STUB-AI', '', '**BASE:** ' + BASE, '**Date:** ' + new Date().toISOString(), ''];
  let fail = 0;
  for (const m of modes) {
    const res = await fetch(BASE + '/api/chat-groups/ai/rewrite', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(m)
    });
    const data = await res.json().catch(() => ({}));
    const text = data.text || data.result || '';
    const stubby = /\[stub-/i.test(String(text));
    const ok = res.status === 200 && text && !stubby;
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + m.mode + ' status=' + res.status + ' stubby=' + stubby);
    lines.push('- ' + m.mode + ': ' + (ok ? 'PASS' : 'FAIL') + ' status=' + res.status + ' ' + JSON.stringify(data).slice(0, 180));
    if (!ok) fail++;
  }
  lines.push('', fail ? 'FAIL anti-stub AI' : 'PASS anti-stub AI', '');
  fs.writeFileSync(REPORT, lines.join('\n'), 'utf8');
  if (fail) process.exit(1);
  console.log('HUGINN_ANTI_STUB_AI_OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
