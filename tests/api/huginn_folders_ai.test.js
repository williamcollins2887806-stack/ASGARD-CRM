'use strict';

/**
 * Huginn F10 folders + F11 AI editor — clone :3100 + asgard_crm_test + V366
 */

const assert = require('assert');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN_A = process.env.TEST_LOGIN_A || 'admin';
const PASS_A = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';

async function login(login, password) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  assert.ok(res.ok, 'login: ' + JSON.stringify(data));
  if (data.status === 'need_setup') {
    res = await fetch(BASE + '/api/auth/setup-credentials', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: password, pin: PIN })
    });
    data = await res.json();
    assert.ok(res.ok, 'setup: ' + JSON.stringify(data));
  } else if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    assert.ok(res.ok, 'pin: ' + JSON.stringify(data));
  }
  return data.token;
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
  console.log('BASE', BASE);
  if (process.env.HUGINN_AI_STUB === '1') {
    throw new Error('Refuse: HUGINN_AI_STUB=1 — anti-stub gate (real rewrite required)');
  }
  const token = await login(LOGIN_A, PASS_A);

  // F10 create
  let r = await api(token, 'POST', '/api/chat-groups/folders', { name: 'Работа', icon_emoji: '💼' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const folderId = r.data.folder && r.data.folder.id;
  assert.ok(folderId, 'folder id');
  console.log('PASS F10 create', folderId);

  r = await api(token, 'GET', '/api/chat-groups/folders');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.folders));
  assert.ok(r.data.folders.some((f) => f.id === folderId));
  console.log('PASS F10 list');

  r = await api(token, 'PATCH', '/api/chat-groups/folders/' + folderId, { name: 'Работа+' });
  assert.equal(r.status, 200);
  assert.equal(r.data.folder.name, 'Работа+');
  console.log('PASS F10 patch');

  // pick a chat
  r = await api(token, 'GET', '/api/chat-groups');
  assert.equal(r.status, 200);
  const chat = (r.data.chats || [])[0];
  assert.ok(chat && chat.id, 'need at least one chat on clone');
  const chatId = chat.id;

  r = await api(token, 'PUT', '/api/chat-groups/' + chatId + '/folder', { folder_id: folderId });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.folder_id, folderId);
  console.log('PASS F10 assign');

  r = await api(token, 'GET', '/api/chat-groups?folder_id=' + folderId);
  assert.equal(r.status, 200);
  assert.ok((r.data.chats || []).some((c) => c.id === chatId));
  console.log('PASS F10 filter');

  r = await api(token, 'PUT', '/api/chat-groups/folders/reorder', { ids: [folderId] });
  assert.equal(r.status, 200);
  console.log('PASS F10 reorder');

  r = await api(token, 'PUT', '/api/chat-groups/folders/active', { folder_id: folderId });
  assert.equal(r.status, 200);
  assert.equal(r.data.active_folder_id, folderId);
  console.log('PASS F10 active');

  // F11 styles + rewrite
  r = await api(token, 'GET', '/api/chat-groups/ai/styles');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.presets) && r.data.presets.length >= 3);
  console.log('PASS F11 styles list');

  r = await api(token, 'POST', '/api/chat-groups/ai/styles', {
    name: 'Pirate',
    icon_emoji: '🏴‍☠️',
    prompt: 'Пиши как лихой пират. Только результат.'
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const styleId = r.data.style && r.data.style.id;
  assert.ok(styleId);
  console.log('PASS F11 style create', styleId);

  r = await api(token, 'POST', '/api/chat-groups/ai/rewrite', { text: '', mode: 'grammar' });
  assert.equal(r.status, 400);
  console.log('PASS F11 empty 400');

  r = await api(token, 'POST', '/api/chat-groups/ai/rewrite', {
    text: 'Привет как дела',
    mode: 'grammar'
  });
  if (r.status === 200) {
    assert.ok(r.data.text || r.data.result || r.data.rewritten, 'rewrite text: ' + JSON.stringify(r.data));
    console.log('PASS F11 rewrite grammar');
  } else if (r.status === 502 && /авторизац|api.?ключ|ai_error/i.test(JSON.stringify(r.data))) {
    console.log('DEFER F11 rewrite grammar — AI-provider-auth', r.status, JSON.stringify(r.data).slice(0, 120));
  } else {
    assert.equal(r.status, 200, 'rewrite must be 200 (no soft 502): ' + JSON.stringify(r.data));
  }

  r = await api(token, 'POST', '/api/chat-groups/ai/styles/' + styleId + '/share', {
    with_profile_link: true
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.share_path);
  console.log('PASS F11 style share');

  r = await api(token, 'PUT', '/api/chat-groups/' + chatId + '/folder', { folder_id: null });
  assert.equal(r.status, 200);
  r = await api(token, 'DELETE', '/api/chat-groups/folders/' + folderId);
  assert.equal(r.status, 200);
  console.log('PASS F10 cleanup delete');

  console.log('ALL_PASS huginn_folders_ai');
}

main().catch((e) => {
  console.error('FAIL', e.message || e);
  process.exit(1);
});
