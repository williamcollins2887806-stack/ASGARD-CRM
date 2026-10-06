'use strict';

/**
 * Huginn visual-wave gaps — BE runtime on clone :3100 + asgard_crm_test.
 * Covers: stories create, stickers, direct/group, shared tabs, reactions, pins, AI smoke.
 * Exit 0 only if every case PASS.
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

const REPORT = path.join(__dirname, '../reports/HUGINN-VISUAL-GAPS-RUNTIME.md');
const results = [];

function caseResult(id, ok, detail) {
  results.push({ id, ok: !!ok, detail: String(detail || '') });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`);
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
    assert.ok(res.ok, 'setup ' + login + ': ' + JSON.stringify(data));
  } else if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    assert.ok(res.ok, 'pin ' + login + ': ' + JSON.stringify(data));
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

  // Stories feed + create + view
  {
    const feed = await api(a.token, 'GET', '/api/chat-groups/stories/feed');
    caseResult('S35-FEED', feed.status === 200 && Array.isArray(feed.data.stories), 'status=' + feed.status);
    const created = await api(a.token, 'POST', '/api/stories', {
      content: 'gap-runtime ' + Date.now(),
      image_url: null
    });
    caseResult('S37-CREATE', created.status === 200 && (created.data.story || created.data.success), JSON.stringify(created.data).slice(0, 120));
    const sid = created.data.story && created.data.story.id;
    if (sid) {
      const viewed = await api(b.token, 'POST', '/api/chat-groups/stories/' + sid + '/view', {});
      caseResult('S37-VIEW', viewed.status === 200 && viewed.data.success !== false, 'status=' + viewed.status);
    } else {
      caseResult('S37-VIEW', false, 'no story id');
    }
  }

  // Stickers catalog
  {
    const st = await api(a.token, 'GET', '/api/chat-groups/stickers');
    const packs = st.data.packs || [];
    caseResult('STICKERS-CATALOG', st.status === 200 && packs.length > 0, 'packs=' + packs.length);
  }

  // Direct + group create
  let chatId = null;
  {
    const direct = await api(a.token, 'POST', '/api/chat-groups/direct', { user_id: b.user.id });
    caseResult('CREATE-DIRECT', direct.status === 200 && direct.data.chat && direct.data.chat.id, 'status=' + direct.status);
    chatId = direct.data.chat && direct.data.chat.id;
    const dChat = direct.data.chat || {};
    const bName = String((b.user && b.user.name) || '').trim();
    const aName = String((a.user && a.user.name) || '').trim();
    const peerOk = dChat.direct_user_name && String(dChat.direct_user_name).trim() === bName;
    const nameOk = dChat.name && String(dChat.name).trim() === bName;
    const notSelf = !aName || !String(dChat.name || '').includes(aName);
    caseResult(
      'DIRECT-PEER-NAME',
      peerOk && nameOk && notSelf,
      `name=${JSON.stringify(dChat.name)} direct_user_name=${JSON.stringify(dChat.direct_user_name)}`
    );
    const detail = await api(a.token, 'GET', '/api/chat-groups/' + chatId);
    const dc = detail.data.chat || {};
    caseResult(
      'DIRECT-GET-PEER',
      detail.status === 200 && String(dc.direct_user_name || '').trim() === bName,
      'direct_user_name=' + JSON.stringify(dc.direct_user_name)
    );

    const group = await api(a.token, 'POST', '/api/chat-groups', {
      name: 'GapGroup ' + Date.now(),
      member_ids: [b.user.id],
      group_kind: 'work'
    });
    const gChat = group.data.chat || group.data;
    caseResult('CREATE-GROUP', group.status === 200 && gChat && gChat.id, 'status=' + group.status + ' id=' + (gChat && gChat.id));
  }

  // Shared tabs
  {
    assert.ok(chatId, 'chatId required');
    // seed text with link
    await api(a.token, 'POST', '/api/chat-groups/' + chatId + '/messages', {
      text: 'see https://example.com/gap-runtime'
    });
    const shared = await api(a.token, 'GET', '/api/chat-groups/' + chatId + '/shared');
    caseResult(
      'SHARED-ALL',
      shared.status === 200 && shared.data.files && shared.data.media && shared.data.links && shared.data.voices,
      'status=' + shared.status + ' links=' + ((shared.data.links || []).length)
    );
    caseResult('SHARED-LINKS', (shared.data.links || []).length >= 1, 'n=' + ((shared.data.links || []).length));
    const filesOnly = await api(a.token, 'GET', '/api/chat-groups/' + chatId + '/shared?tab=files');
    caseResult('SHARED-FILES-TAB', filesOnly.status === 200 && Array.isArray(filesOnly.data.files), 'status=' + filesOnly.status);
  }

  // Reactions + pins
  {
    const msg = await api(a.token, 'POST', '/api/chat-groups/' + chatId + '/messages', { text: 'react-me ' + Date.now() });
    const mid = (msg.data.message && msg.data.message.id) || msg.data.id;
    caseResult('MSG-SEND', msg.status === 200 && mid, 'mid=' + mid);
    const react = await api(a.token, 'POST', '/api/chat-groups/' + chatId + '/messages/' + mid + '/reaction', { emoji: '👍' });
    caseResult('S26-REACT', react.status === 200, 'status=' + react.status);
    const pin = await api(a.token, 'POST', '/api/chat-groups/' + chatId + '/pin/' + mid, {});
    caseResult('S24-PIN', pin.status === 200 || pin.status === 201, 'status=' + pin.status);
    const pins = await api(a.token, 'GET', '/api/chat-groups/' + chatId + '/pins');
    caseResult('S24-PINS-LIST', pins.status === 200 && Array.isArray(pins.data.pins), 'n=' + ((pins.data.pins || []).length));
  }

  // AI editor smoke (empty → 400, grammar with text)
  {
    const empty = await api(a.token, 'POST', '/api/chat-groups/ai/rewrite', { mode: 'grammar', text: '' });
    caseResult('A03-EMPTY', empty.status === 400 || empty.status === 422, 'status=' + empty.status);
    const styles = await api(a.token, 'GET', '/api/chat-groups/ai/styles');
    caseResult('A01-STYLES', styles.status === 200, 'status=' + styles.status);
  }

  // List + messages (S01/S05)
  {
    const list = await api(a.token, 'GET', '/api/chat-groups');
    caseResult('S01-LIST', list.status === 200 && (Array.isArray(list.data.chats) || Array.isArray(list.data)), 'status=' + list.status);
    const chats = list.data.chats || list.data || [];
    const row = chats.find((c) => Number(c.id) === Number(chatId));
    const bName = String((b.user && b.user.name) || '').trim();
    caseResult(
      'DIRECT-LIST-PEER',
      !!row && String(row.direct_user_name || '').trim() === bName,
      'direct_user_name=' + JSON.stringify(row && row.direct_user_name)
    );
    const messages = await api(a.token, 'GET', '/api/chat-groups/' + chatId + '/messages');
    caseResult('S05-MSGS', messages.status === 200 && Array.isArray(messages.data.messages || messages.data.items), 'status=' + messages.status);
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  const md = [
    '# HUGINN-VISUAL-GAPS-RUNTIME',
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
