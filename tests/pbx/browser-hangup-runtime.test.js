'use strict';

/**
 * Runtime-проверка сброса звонка ИЗ БРАУЗЕРА (реальное исполнение phone_core.js
 * в изолированном vm с моками DOM/сети/JsSIP — не grep).
 *
 * Сценарии:
 *  A. Серверный исходящий (SIP недоступен): клиент запоминает channel + pbx_uid
 *     из ответа PBX, а hangup() отправляет channel + pbx_uid + user_id
 *     (user_id нужен серверу, чтобы найти плечо WebRTC по sip_username).
 *  B. WebRTC-исходящий (JsSIP зарегистрирован): hangup() локально шлёт BYE
 *     (session.terminate) И параллельно дергает сервер, затем сбрасывает состояние.
 *  C. Не на линии после сброса → offline (статус не «залипает»).
 *
 * Usage: node tests/pbx/browser-hangup-runtime.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const src = fs.readFileSync(path.join(ROOT, 'public/assets/js/phone_core.js'), 'utf8');

let passed = 0;
function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function bodyOf(call) { return JSON.parse(call.options.body || '{}'); }

/**
 * @param {object} opts
 * @param {boolean} opts.sipOk — выдавать ли рабочие SIP-креды и JsSIP
 */
function makeSandbox(opts = {}) {
  const calls = { fetch: [] };
  const sessions = [];
  const storage = {
    asgard_token: 'TKN',
    asgard_user: JSON.stringify({ id: 42, role: 'PM' }),
  };

  function JsSIPSession() {
    this.id = 'sess-' + sessions.length;
    this.terminated = 0;
    this._handlers = {};
    this.remote_identity = { uri: { user: '79161112233' } };
    this.connection = { addEventListener: () => {} };
    sessions.push(this);
  }
  JsSIPSession.prototype.on = function (ev, fn) { this._handlers[ev] = fn; };
  JsSIPSession.prototype.terminate = function () { this.terminated++; };

  const uaRef = { current: null };
  function FakeUA() {
    this._handlers = {};
    this.started = false;
    uaRef.current = this;
  }
  FakeUA.prototype.on = function (ev, fn) { this._handlers[ev] = fn; };
  FakeUA.prototype.start = function () {
    this.started = true;
    // Имитируем успешную регистрацию (как приходит от реального Asterisk).
    setTimeout(() => { if (this._handlers.registered) this._handlers.registered({}); }, 0);
  };
  FakeUA.prototype.stop = function () {};
  FakeUA.prototype.call = function () { const s = new JsSIPSession(); return s; };

  const JsSIPMock = {
    UA: function () { return new FakeUA(); },
    WebSocketInterface: function () { return {}; },
  };

  const fetchImpl = (url, options) => {
    const u = String(url);
    calls.fetch.push({ url: u, options: options || {} });
    const json = (o) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(o)) });
    if (u.indexOf('/softphone/credentials') !== -1) {
      if (!opts.sipOk) {
        return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('{"error":"no_sip"}') });
      }
      return json({ sip_username: 'op42', sip_password: 'pw', ws_url: '/pbx/ws' });
    }
    if (u.indexOf('/call/outbound') !== -1) {
      return json({ ok: true, number: '79161112233', channel: 'PJSIP/79161112233@mango-trunk', via: 'gsm', pbx_uid: 'asgard-out-abc' });
    }
    if (u.indexOf('/call/hangup') !== -1) return json({ ok: true, hung: 1 });
    if (u.indexOf('/operator/webrtc') !== -1) return json({ ok: true });
    return json({ ok: true });
  };

  const documentObj = {
    visibilityState: 'visible',
    addEventListener: () => {},
    dispatchEvent: () => true,
    createElement: () => ({ style: {}, addEventListener: () => {}, appendChild: () => {}, play: () => Promise.resolve() }),
    body: { appendChild: () => {} },
  };

  const sandbox = {
    console, setTimeout, clearTimeout, JSON, Date, Math, Promise, URL,
    Object, Array, String, Number, Error,
    setInterval: () => 0, clearInterval: () => {},
    CustomEvent: function (t, o) { this.type = t; this.detail = (o || {}).detail; },
    navigator: { locks: null },
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = v; },
    },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    location: { protocol: 'https:', host: 'asgard-crm.ru', hostname: 'asgard-crm.ru', pathname: '/', hash: '', search: '' },
    fetch: fetchImpl,
    document: documentObj,
    BroadcastChannel: undefined,
    JsSIP: opts.sipOk ? JsSIPMock : undefined,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  return { sandbox, calls, sessions, FakeUA, uaRef };
}

(async () => {
  console.log('browser-hangup-runtime');

  // ── A. Серверный исходящий ──
  {
    const { sandbox, calls } = makeSandbox({ sipOk: false });
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    const P = sandbox.window.AsgardPhone;

    const out = await P.outbound('+7 916 111-22-33');
    assert.strictEqual(out.via, 'gsm', 'ожидался серверный путь');
    const meta = P.getCallMeta();
    assert.strictEqual(meta.channel, 'PJSIP/79161112233@mango-trunk', 'channel не сохранён');
    assert.strictEqual(meta.pbx_uid, 'asgard-out-abc', 'pbx_uid не сохранён');
    ok('A: серверный исходящий запоминает channel + pbx_uid');

    calls.fetch.length = 0;
    await P.hangup();
    const hang = calls.fetch.find((c) => c.url.indexOf('/call/hangup') !== -1);
    assert.ok(hang, 'hangup не вызвал /call/hangup');
    const sent = bodyOf(hang);
    assert.strictEqual(sent.channel, 'PJSIP/79161112233@mango-trunk', 'channel не отправлен');
    assert.strictEqual(sent.pbx_uid, 'asgard-out-abc', 'pbx_uid не отправлен');
    assert.strictEqual(sent.user_id, 42, 'user_id не отправлен — сервер не найдёт плечо WebRTC');
    ok('A: hangup отправляет channel + pbx_uid + user_id');

    assert.strictEqual(P.getState(), 'offline', 'состояние не offline после сброса');
    assert.strictEqual(Object.keys(P.getCallMeta()).length, 0, 'callMeta не очищен');
    ok('A: после сброса offline и callMeta пуст');
  }

  // ── B. WebRTC-исходящий: локальный BYE + серверный сброс ──
  {
    const { sandbox, calls, sessions } = makeSandbox({ sipOk: true });
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    const P = sandbox.window.AsgardPhone;

    // Ленивая регистрация → fake UA регистрируется → звонок из браузера.
    const out = await P.outbound('+7 916 111-22-33');
    assert.strictEqual(out.via, 'webrtc', 'ожидался WebRTC-путь');
    assert.strictEqual(P.getSipRegistered(), true, 'SIP не зарегистрирован');
    assert.ok(sessions.length >= 1, 'RTC-сессия не создана');
    ok('B: WebRTC-исходящий поднимает SIP сам и звонит из браузера');

    const sess = sessions[sessions.length - 1];
    calls.fetch.length = 0;
    await P.hangup();
    assert.strictEqual(sess.terminated, 1, 'локальный BYE (terminate) не отправлен');
    const hang = calls.fetch.find((c) => c.url.indexOf('/call/hangup') !== -1);
    assert.ok(hang, 'серверный сброс не вызван из WebRTC-режима');
    assert.strictEqual(bodyOf(hang).user_id, 42, 'WebRTC-сброс без user_id');
    ok('B: сброс из браузера шлёт BYE и дублирует сброс на сервер');

    assert.strictEqual(P.getState(), 'offline', 'не вернулись в offline');
    ok('B: сброс из браузера возвращает offline');
  }

  // ── C. Не на линии: регистрация не занимает линию ──
  {
    const { sandbox } = makeSandbox({ sipOk: true });
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    const P = sandbox.window.AsgardPhone;
    await P.ensureRegistered();
    await P.waitRegistered(500);
    assert.strictEqual(P.getSipRegistered(), true, 'SIP не поднялся');
    assert.strictEqual(P.getState(), 'offline', 'ленивая регистрация заняла линию (должна остаться offline)');
    ok('C: SIP для исходящих поднят, линия НЕ занята (offline)');
  }

  // ── D. Ленивая вкладка (не на линии) не принимает входящие ──
  {
    const { sandbox, sessions, uaRef } = makeSandbox({ sipOk: true });
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    const P = sandbox.window.AsgardPhone;
    await P.ensureRegistered();
    await P.waitRegistered(500);
    assert.ok(uaRef.current, 'fake UA не создан');
    assert.strictEqual(P.getState(), 'offline', 'до входящего вкладка должна быть offline');

    // Приходит входящий SIP INVITE на зарегистрированную (но не дежурную) вкладку.
    const before = sessions.length;
    const incoming = { id: 'inc1', terminated: null, on: () => {}, remote_identity: { uri: { user: '79160000000' } }, connection: { addEventListener: () => {} }, terminate: function (o) { this.terminated = o || {}; } };
    uaRef.current._handlers.newRTCSession({ session: incoming, originator: 'remote' });

    assert.ok(incoming.terminated, 'входящий не отбит — вкладка «не на линии» поймала бы чужой звонок');
    assert.strictEqual(incoming.terminated.status_code, 486, 'отбой должен быть 486 Busy Here');
    assert.strictEqual(P.getState(), 'offline', 'вкладка «не на линии» не должна уходить в ringing');
    ok('D: вкладка «не на линии» отбивает входящий 486 (не принимает)');
  }

  console.log(`\n${passed} passed, 0 failed`);
})().catch((e) => {
  console.error(`  ✗ ${e.stack || e.message}`);
  process.exit(1);
});
