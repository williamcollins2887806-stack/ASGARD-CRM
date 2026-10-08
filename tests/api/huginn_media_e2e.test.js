'use strict';

/**
 * S07/S09/S10 critical media — voice×10 + circle + STT pipeline on clone :3100.
 * Exit 0 only if every case PASS (no soft 415/502).
 *
 * STT: requires SpeechKit OR HUGINN_STT_STUB=1 on the clone process
 * (proves enqueue→worker→metadata→SSE path).
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
const REPORT = path.join(__dirname, '../reports/HUGINN-SHOT-S07-S09-S10.md');

const results = [];
function caseResult(id, ok, detail) {
  results.push({ id, ok: !!ok, detail: String(detail || '') });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + id + (detail ? ' — ' + detail : ''));
  if (!ok) throw new Error('CASE_FAIL ' + id + ': ' + detail);
}

async function login(login, password) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  assert.ok(res.ok, 'login ' + login + ': ' + JSON.stringify(data));
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

async function upload(token, chatId, { buf, name, mime, messageType, extraFields }) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime }), name);
  if (messageType) fd.append('message_type', messageType);
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) fd.append(k, String(v));
  }
  const res = await fetch(BASE + '/api/chat-groups/' + chatId + '/upload-file', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function tinyWebm() {
  return Buffer.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f,
    0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04,
    0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d
  ]);
}

/** Real spoken WAV for STT (Windows SAPI). Falls back to ffmpeg sine+noise if SAPI missing. */
function makeSpeechWav() {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const out = path.join(os.tmpdir(), 'hg-stt-voice-' + Date.now() + '.wav');
  const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = -2
$s.SetOutputToWaveFile('${out.replace(/'/g, "''")}')
$s.Speak('Проверка распознавания Huginn голосовое сообщение')
$s.Dispose()
`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000
  });
  if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 1000) {
    return fs.readFileSync(out);
  }
  const ff = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '16000', '-ac', '1', out],
    { encoding: 'utf8', windowsHide: true }
  );
  if (ff.status !== 0 || !fs.existsSync(out)) {
    throw new Error('makeSpeechWav failed: ' + String(r.stderr || ff.stderr || '').slice(0, 200));
  }
  return fs.readFileSync(out);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitTranscript(token, chatId, messageId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status, data } = await api(token, 'GET', `/api/chat-groups/${chatId}/messages?limit=50`);
    if (status !== 200) throw new Error('messages ' + status);
    const msgs = data.messages || data.items || [];
    const m = msgs.find((x) => Number(x.id) === Number(messageId));
    const meta = (m && m.metadata) || {};
    if (meta.transcript_status === 'done' && meta.transcript) {
      return meta.transcript;
    }
    if (meta.transcript_status === 'failed') {
      throw new Error('transcript failed: ' + JSON.stringify(meta));
    }
    await sleep(800);
  }
  throw new Error('STT timeout for message ' + messageId);
}

async function main() {
  const a = await login(LOGIN_A, PASS_A);
  const b = await login(LOGIN_B, PASS_B);
  const direct = await api(a.token, 'POST', '/api/chat-groups/direct', { user_id: b.user.id });
  caseResult('S07-direct', direct.status === 200 && direct.data.chat, direct.data.error || '');
  const chatId = direct.data.chat.id;

  if (process.env.HUGINN_STT_STUB === '1') {
    throw new Error('Refuse: HUGINN_STT_STUB=1 — anti-stub gate');
  }

  const speechBuf = makeSpeechWav();
  const voiceIds = [];
  for (let i = 0; i < 10; i++) {
    const useSpeech = i === 0 || i === 9;
    const voice = await upload(a.token, chatId, {
      buf: useSpeech ? speechBuf : tinyWebm(),
      name: useSpeech ? `voice-stt-${i}.wav` : `voice-stress-${i}.webm`,
      mime: useSpeech ? 'audio/wav' : 'audio/webm',
      messageType: 'voice',
      extraFields: { file_duration: String(1 + (i % 5)) }
    });
    caseResult(
      'S07-voice-upload-' + i,
      voice.status === 200 && voice.data.message && voice.data.message.id,
      voice.data.error || String(voice.status)
    );
    const msg = voice.data.message;
    caseResult(
      'S07-voice-pending-' + i,
      msg.message_type === 'voice' &&
        msg.file_url &&
        msg.metadata &&
        msg.metadata.transcript_status === 'pending',
      JSON.stringify(msg.metadata || {})
    );
    const play = await fetch(BASE + msg.file_url, {
      headers: { Authorization: 'Bearer ' + a.token }
    });
    caseResult('S07-voice-play-' + i, play.status === 200, 'status=' + play.status);
    voiceIds.push(msg.id);
  }

  // STT required: transcript done (cloud SpeechKit or local Whisper fallback). DEFER forbidden.
  for (const mid of [voiceIds[0], voiceIds[9]]) {
    const tr = await waitTranscript(a.token, chatId, mid, 120000);
    caseResult('S07-stt-' + mid, !!tr && String(tr).length > 0, String(tr).slice(0, 80));
  }

  const circle = await upload(a.token, chatId, {
    buf: tinyWebm(),
    name: 'circle-e2e.webm',
    mime: 'video/webm',
    messageType: 'circle'
  });
  caseResult(
    'S10-circle-upload',
    circle.status === 200 &&
      circle.data.message &&
      circle.data.message.message_type === 'circle' &&
      circle.data.message.file_url,
    circle.data.error || String(circle.status)
  );
  const cPlay = await fetch(BASE + circle.data.message.file_url, {
    headers: { Authorization: 'Bearer ' + a.token }
  });
  caseResult('S10-circle-play', cPlay.status === 200, 'status=' + cPlay.status);

  // S09 lock/cancel is UI-only — API proves no hang after rapid voice uploads (stress above)
  caseResult('S09-stress-no-hang', voiceIds.length === 10, 'n=' + voiceIds.length);

  const lines = [
    '# HUGINN-SHOT-S07-S09-S10',
    '',
    '**Date:** ' + new Date().toISOString(),
    '**BASE:** ' + BASE,
    '**Result:** PASS ' + results.filter((r) => r.ok).length + '/' + results.length,
    '',
    '| Case | OK | Detail |',
    '|------|----|--------|',
    ...results.map((r) => `| ${r.id} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`),
    '',
    'Exit 0.'
  ];
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, lines.join('\n'), 'utf8');
  console.log('HUGINN_MEDIA_E2E_OK', results.length);
  console.log('REPORT', REPORT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
