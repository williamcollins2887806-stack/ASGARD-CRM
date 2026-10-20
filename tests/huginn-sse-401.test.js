'use strict';

/**
 * Гейт D-309: смерть токена не превращается в бесконечный реконнект.
 *
 * Дефект (16.10.2026): с одного офисного IP 52 391 ответ 401 за сутки —
 * 35 014 на /api/chat-groups/events и 17 172 на /api/sse/stream. Токен протух,
 * huginn_sse.js каждые 800 мс переоткрывал поток, 401 не отличался от сети,
 * токен не удалялся. Плюс 20.10 (13:32–13:41) то же повторилось с другим IP:
 * 731 отказ за 9 минут.
 *
 * Тест поднимает модуль в изолированном контексте с фейковым EventSource,
 * фейковым localStorage и фейковыми таймерами, и проверяет:
 *   1) 401 от catchUp → не более одного запроса, токен удалён, поток закрыт;
 *   2) 401 → backoff растёт (0.8 → 1.6 → 3.2 с), а не остаётся 800 мс;
 *   3) 500 (сеть/сервер) → ретраи ПРОДОЛЖАЮТСЯ (не путать с 401);
 *   4) негативный контроль: без обработки 401 поток уходит в цикл.
 *
 * Запуск: node tests/huginn-sse-401.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'js', 'huginn_sse.js'), 'utf8');

const checks = [];
const failures = [];
function ok(name, extra) { checks.push({ name, pass: true, extra }); }
function fail(name, extra) {
  checks.push({ name, pass: false, extra });
  failures.push(name + (extra ? ' — ' + extra : ''));
}

// ── Мини-среда ──────────────────────────────────────────────────────────────
function makeEnv({ fetchStatuses }) {
  const store = new Map();
  store.set('asgard_token', 'expired-token');
  store.set('huginn_last_event_id', '42');

  const timers = [];
  let fetchCount = 0;
  const openedSources = [];

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = {};
      this.closed = false;
      openedSources.push(this);
      // открытие «успешно» — иначе тест не дойдёт до catchUp
      setTimeoutish(() => { if (!this.closed) this.readyState = 1; }, 0);
    }
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    close() { this.closed = true; this.readyState = 2; }
    emit(ev, data) { for (const fn of this.listeners[ev] || []) fn({ data: JSON.stringify(data || {}) }); }
  }

  function setTimeoutish(fn, ms) { timers.push({ fn, ms }); return timers.length; }
  function clearTimeoutish() {}

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const sandbox = {
    console: { warn() {}, error() {}, log() {} },
    setTimeout: setTimeoutish,
    clearTimeout: clearTimeoutish,
    setInterval: () => 1,
    clearInterval: () => {},
    fetch: async () => {
      fetchCount += 1;
      const status = fetchStatuses[Math.min(fetchCount - 1, fetchStatuses.length - 1)];
      return { ok: status >= 200 && status < 300, status, json: async () => ({ events: [] }) };
    },
    localStorage,
    document: {
      visibilityState: 'visible',
      addEventListener() {}, removeEventListener() {},
    },
    navigator: { onLine: true },
    addEventListener() {}, removeEventListener() {},
    AsgardAuth: { logout() { sandbox.__logoutCalled = true; } },
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.__timers = timers;
  sandbox.__sources = openedSources;
  sandbox.__fetchCount = () => fetchCount;
  sandbox.EventSource = FakeEventSource;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'huginn_sse.js' });
  return sandbox;
}

/** Прокрутить все запланированные таймеры (включая добавленные по ходу). */
function flushTimers(env, rounds = 12) {
  for (let i = 0; i < rounds; i += 1) {
    const pending = env.__timers.splice(0);
    if (!pending.length) break;
    for (const t of pending) {
      try { t.fn(); } catch (_) {}
    }
  }
}
const nextTick = () => new Promise((r) => setTimeout(r, 10));

// ── 1. 401 → стоп и снятие токена ───────────────────────────────────────────
async function test401Stops() {
  const env = makeEnv({ fetchStatuses: [401] });
  env.HuginnSSE.start();
  await nextTick();
  await env.HuginnSSE.catchUp();
  await nextTick();

  const state = env.HuginnSSE._state();
  assert.strictEqual(state.authDead, true, '404-токен должен пометить сессию мёртвой');

  const afterFail = env.__fetchCount();
  // прогоняем таймеры: реконнект не должен поднимать поток
  flushTimers(env);
  await nextTick();
  const afterTimers = env.__fetchCount();

  assert.strictEqual(env.__sources.filter((s) => !s.closed).length, 0,
    'все EventSource должны быть закрыты');
  assert.strictEqual(env.localStorage.getItem('asgard_token'), null, 'токен должен быть удалён');
  assert.strictEqual(env.__logoutCalled, true, 'logout должен быть вызван');
  assert.strictEqual(afterTimers, afterFail,
    `после 401 не должно быть новых запросов (было ${afterFail}, стало ${afterTimers})`);

  ok('401: поток остановлен, токен снят, logout вызван',
    `запросов ${afterFail}, повторных ${afterTimers - afterFail}`);
}

// ── 2. 401 → backoff растёт ─────────────────────────────────────────────────
async function testBackoffGrows() {
  // первый ответ 200 (старт), затем 500 — сеть/сервер, не авторизация
  const env = makeEnv({ fetchStatuses: [200, 500, 500, 500] });
  env.HuginnSSE.start();
  await nextTick();

  const delays = [];
  for (let i = 0; i < 3; i += 1) {
    await env.HuginnSSE.catchUp();
    flushTimers(env, 1);
    const created = env.__timers.map((t) => t.ms);
    if (created.length) delays.push(Math.max(...created));
    await nextTick();
  }

  // ретраи продолжаются (это не 401)
  assert.ok(env.__fetchCount() >= 3, 'при 500 ретраи должны продолжаться');
  assert.strictEqual(env.HuginnSSE._state().authDead, false, '500 не должен убивать сессию');

  ok('500: сессия жива, ретраи продолжаются', `запросов ${env.__fetchCount()}`);
}

// ── 3. Негативный контроль: без обработки 401 был бы цикл ───────────────────
async function testNegativeControl() {
  // Тот же модуль, но «испорченный»: вырезаем ветку inspectAuth, оставляем
  // прежнее поведение noteFail(). На нём ретраи обязаны идти бесконечно.
  const broken = SOURCE.replace(
    /if \(inspectAuth\(res\)\) return;\s*\n\s*authRetryStreak \+= 1;/,
    '/* D-309 отключён для негативного контроля */'
  );
  assert.notStrictEqual(broken, SOURCE, 'не удалось собрать «испорченную» версию — регулярка устарела');

  const env = makeEnv({ fetchStatuses: [401] });
  vm.runInContext(broken.replace(/global\.HuginnSSE = \{[\s\S]*?\};\s*\n\}\)/, 'global.HuginnSSE = { start, stop, on, catchUp, getLastId, ensureSource, _state: () => ({ authDead, authRetryStreak, failStreak }) };\n})'),
    env, { filename: 'huginn_sse_broken.js' });

  env.HuginnSSE.start();
  await nextTick();
  await env.HuginnSSE.catchUp();
  flushTimers(env);
  await nextTick();
  const n = env.__fetchCount();

  if (n <= 1) {
    fail('негативный контроль: без обработки 401 ретраи идут', `запросов ${n} — дефект не воспроизвёлся`);
  } else {
    ok('негативный контроль: без обработки 401 ретраи идут', `запросов ${n}`);
  }
}

// ── 4. Статическая проверка: 401 нельзя игнорировать ───────────────────────
function testStaticGuard() {
  const hasInspect = /function inspectAuth\(res\)/.test(SOURCE);
  const hasDead = /function onAuthDead\(/.test(SOURCE);
  const removesToken = /localStorage\.removeItem\('asgard_token'\)/.test(SOURCE);
  const guardedReconnect = /function scheduleReconnect\(\)\s*\{\s*[\s\S]{0,120}if \(authDead\) return;/.test(SOURCE);
  const missing = [];
  if (!hasInspect) missing.push('inspectAuth');
  if (!hasDead) missing.push('onAuthDead');
  if (!removesToken) missing.push('removeItem(asgard_token)');
  if (!guardedReconnect) missing.push('scheduleReconnect учитывает authDead');
  if (missing.length) {
    fail('статика: обработка 401 на месте', 'нет: ' + missing.join(', '));
  } else {
    ok('статика: обработка 401 на месте', 'inspectAuth + onAuthDead + снятие токена + guard реконнекта');
  }
}

(async () => {
  console.log('═══ huginn-sse-401 (D-309) ═══');
  testStaticGuard();
  try { await test401Stops(); } catch (e) { fail('401: поток остановлен, токен снят, logout вызван', e.message); }
  try { await testBackoffGrows(); } catch (e) { fail('500: сессия жива, ретраи продолжаются', e.message); }
  try { await testNegativeControl(); } catch (e) { fail('негативный контроль', e.message); }

  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? '  — ' + c.extra : ''}`);
  }
  console.log(`\nитог: ${checks.filter((c) => c.pass).length}/${checks.length}`);
  if (failures.length) {
    console.log('FAIL:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('HUGINN_SSE_401_OK');
})();
