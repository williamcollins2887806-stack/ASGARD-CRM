'use strict';

/**
 * Гейт D-307: двойной ответ Fastify.
 *
 * Дефект (14–20.10.2026): в src/index.js были ДВА `async` onSend-хука, а 45
 * обработчиков вызывали `reply.send()` без `return`. Fastify считал, что
 * обработчик ещё не ответил, и после onSend-цепочки писал ответ ВТОРОЙ раз:
 *   «Reply was already sent, did you forget to "return reply" in the "<url>" route?»
 *   «Unhandled Promise Rejection» / ERR_HTTP_HEADERS_SENT
 * 1 097 unhandled-событий за неделю, 99% из них — /api/telephony/*.
 *
 * Гейт проверяет две вещи:
 *   1) ни один onSend-хук в src/index.js не объявлен как `async`;
 *   2) ни один обработчик в src/routes/*.js не вызывает `reply.send(` без `return`.
 *
 * Плюс поведенческая проверка на реальном fastify: приложение с теми же
 * двумя хуками не должно давать unhandledRejection.
 *
 * Запуск: node tests/fastify-onsend-guard.test.js
 * Выход: 0 — чисто, 1 — регресс.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const checks = [];

function ok(name, extra) {
  checks.push({ name, pass: true, extra });
}

function fail(name, extra) {
  checks.push({ name, pass: false, extra });
  failures.push(name + (extra ? ' — ' + extra : ''));
}

// ── 1. onSend-хуки не должны быть async ─────────────────────────────────────
function checkOnSendHooks() {
  const file = path.join(ROOT, 'src', 'index.js');
  const src = fs.readFileSync(file, 'utf8');
  const re = /addHook\(\s*['"]onSend['"]\s*,\s*(async\s*)?/g;
  let m;
  let total = 0;
  const asyncOnes = [];
  while ((m = re.exec(src)) !== null) {
    total += 1;
    if (m[1]) {
      const line = src.slice(0, m.index).split('\n').length;
      asyncOnes.push(line);
    }
  }
  if (total === 0) {
    fail('onSend: хук найден', 'в src/index.js нет ни одного addHook(onSend) — проверка потеряла предмет');
    return;
  }
  if (asyncOnes.length) {
    fail('onSend: все хуки done-style (не async)', `async на строках ${asyncOnes.join(', ')}`);
  } else {
    ok('onSend: все хуки done-style (не async)', `${total} хук(ов)`);
  }
}

// ── 2. Нет `reply.send(` без return в роутах ────────────────────────────────
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function checkBareSends() {
  const files = walk(path.join(ROOT, 'src'), []);
  const offenders = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // строка вида `  reply.send(` — без return/reply. и без `//`
      if (/^\s+reply\.send\(/.test(line) && !/^\s*\/\//.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  if (offenders.length) {
    fail('routes: reply.send() только с return', `${offenders.length} шт: ${offenders.slice(0, 8).join(', ')}`);
  } else {
    ok('routes: reply.send() только с return', `${files.length} файлов проверено`);
  }
}

// ── 3. Поведенческая проверка: два хука + send без return ────────────────────
function checkRuntimeBehaviour() {
  const fastify = require('fastify');
  const app = fastify({ logger: false });

  // Точные формы прод-хуков (D-307), но уже исправленные — done-style.
  app.addHook('onSend', (request, reply, payload, done) => {
    if (request.url === '/m/index.html') return done(null, '<html></html>');
    return done(null, payload);
  });
  app.addHook('onSend', (request, reply, payload, done) => {
    if (typeof payload === 'string' && payload.startsWith('{') && reply.statusCode >= 400) {
      return done(null, payload);
    }
    return done(null, payload);
  });

  // Обработчик, который НЕ делает return — именно этот класс ломался.
  app.get('/no-return', async (request, reply) => {
    reply.code(400).send({ error: 'boom' });
  });
  app.get('/with-return', async (request, reply) => {
    return reply.code(400).send({ error: 'boom' });
  });

  let unhandled = null;
  const onUnhandled = (e) => { unhandled = e && (e.code || e.message); };
  process.on('unhandledRejection', onUnhandled);

  return app.ready()
    .then(() => app.inject({ method: 'GET', url: '/no-return' }))
    .then((res) => {
      assert.strictEqual(res.statusCode, 400, 'обработчик без return должен отдать 400');
      return new Promise((r) => setTimeout(r, 80));
    })
    .then(() => app.inject({ method: 'GET', url: '/with-return' }))
    .then((res) => {
      assert.strictEqual(res.statusCode, 400, 'обработчик с return должен отдать 400');
      return new Promise((r) => setTimeout(r, 80));
    })
    .then(() => {
      process.removeListener('unhandledRejection', onUnhandled);
      if (unhandled) {
        fail('runtime: нет unhandledRejection после send без return', String(unhandled));
      } else {
        ok('runtime: нет unhandledRejection после send без return', '2 запроса');
      }
    })
    .catch((e) => {
      process.removeListener('unhandledRejection', onUnhandled);
      fail('runtime: проверка выполнилась', e.message);
    })
    .finally(() => app.close());
}

// ── 4. Негативный контроль: async-хуки ОБЯЗАНЫ ломаться ──────────────────────
// Без него гейт тавтологичен: если Fastify поменяет поведение, мы не заметим,
// а гейт продолжит «зеленеть» на сломанном коде.
function checkNegativeControl() {
  const fastify = require('fastify');
  const app = fastify({ logger: false });

  app.addHook('onSend', async (request, reply) => { /* async-форма дефекта */ });
  app.addHook('onSend', async (request, reply, payload) => payload);
  app.get('/broken', async (request, reply) => {
    reply.code(400).send({ error: 'boom' });
  });

  let unhandled = null;
  const onUnhandled = (e) => { unhandled = e && (e.code || e.message); };
  process.on('unhandledRejection', onUnhandled);

  return app.ready()
    .then(() => app.inject({ method: 'GET', url: '/broken' }))
    .then(() => new Promise((r) => setTimeout(r, 80)))
    .then(() => {
      process.removeListener('unhandledRejection', onUnhandled);
      if (!unhandled) {
        fail('негативный контроль: async-хуки дают ERR_HTTP_HEADERS_SENT',
          'дефект НЕ воспроизвёлся — гейт потерял чувствительность');
      } else {
        ok('негативный контроль: async-хуки дают ERR_HTTP_HEADERS_SENT', String(unhandled));
      }
    })
    .catch((e) => {
      process.removeListener('unhandledRejection', onUnhandled);
      fail('негативный контроль: проверка выполнилась', e.message);
    })
    .finally(() => app.close());
}

(async () => {
  console.log('═══ fastify-onsend-guard (D-307) ═══');
  checkOnSendHooks();
  checkBareSends();
  await checkRuntimeBehaviour();
  await checkNegativeControl();

  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? '  — ' + c.extra : ''}`);
  }
  console.log(`\nитог: ${checks.filter((c) => c.pass).length}/${checks.length}`);
  if (failures.length) {
    console.log('FAIL:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('ONSEND_GUARD_OK');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
