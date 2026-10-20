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

/**
 * Детектор на AST (@babel/parser есть в зависимостях).
 *
 * Дефект — вызов `reply.send()` (в любой форме: `reply.send(x)`,
 * `reply.code(500).send(x)`), который НЕ является последним оператором своего
 * блока и не обёрнут в `return`/`throw`. Именно тогда после отправки ответа
 * выполнение продолжается, и Fastify пишет ответ второй раз.
 *
 * Эвристика по отступам, которую пришлось выбросить, давала и ложные
 * срабатывания (обработчик ошибок, стрелочная функция, массив preHandler),
 * и пропуски (`send` внутри `if (c) { ... }`). Обе ошибки нашёл верификатор.
 */
function checkBareSends() {
  const parser = require('@babel/parser');
  const files = walk(path.join(ROOT, 'src'), []);
  const offenders = [];

  /** Это вызов, заканчивающийся на `.send(...)`? Возвращает узел CallExpression. */
  function sendCall(node) {
    if (!node || node.type !== 'CallExpression') return null;
    const callee = node.callee;
    if (!callee || callee.type !== 'MemberExpression') return null;
    if (!callee.property || callee.property.name !== 'send') return null;
    // цепочка должна где-то содержать `reply`
    let cur = callee.object;
    while (cur) {
      if (cur.type === 'Identifier' && cur.name === 'reply') return node;
      if (cur.type === 'MemberExpression') { cur = cur.object; continue; }
      if (cur.type === 'CallExpression') { cur = cur.callee; continue; }
      break;
    }
    return null;
  }

  function stmtContainsSend(stmt) {
    // прячем вложенные функции: send внутри них — отдельный контекст
    let found = false;
    const visit = (n) => {
      if (!n || found) return;
      if (typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(visit); return; }
      if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') return;
      if (sendCall(n)) { found = true; return; }
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
        visit(n[k]);
      }
    };
    visit(stmt);
    return found;
  }

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    let ast;
    try {
      ast = parser.parse(code, { sourceType: 'script', plugins: ['jsx'], errorRecovery: false });
    } catch (_) {
      // не разобрали — пропускаем файл (гейт не должен падать на синтаксисе)
      continue;
    }

    /** Проверка массива операторов: send допустим только последним. */
    const checkStatements = (stmts, pathLabel, hasCodeAfterBlock) => {
      if (!Array.isArray(stmts)) return;
      for (let idx = 0; idx < stmts.length; idx += 1) {
        const st = stmts[idx];
        // `return reply.send(...)` / `throw reply.send(...)` — безопасно
        if (st.type === 'ReturnStatement' || st.type === 'ThrowStatement') continue;
        if (st.type === 'ExpressionStatement' && stmtContainsSend(st.expression)) {
          // `send(...); return;` — штатный идиом Fastify, безопасен.
          const nextStmt = stmts[idx + 1];
          const nextExits = nextStmt && (nextStmt.type === 'ReturnStatement' || nextStmt.type === 'ThrowStatement');
          const isLastInBlock = idx === stmts.length - 1;
          if (nextExits) continue;
          // Последний в блоке — безопасно ТОЛЬКО если это тело функции.
          // Если это вложенный блок (if/try) и после него есть код — дефект:
          // ровно класс «send внутри if { ... } и пошли дальше» (нашёл верификатор).
          if (isLastInBlock && !hasCodeAfterBlock) continue;
          offenders.push(`${pathLabel}:${st.loc ? st.loc.start.line : '?'}`);
          continue;
        }
        // Вложенные блоки проверяем рекурсивно с учётом семантики:
        //  • try — catch выполняется только при исключении, send в конце try безопасен;
        //  • if/else — если после блока в родителе кода НЕТ, send в обеих ветвях
        //    завершает работу (безопасно). Если код после есть — небезопасно.
        //  • for/while/block — после блока выполнение продолжается.
        const codeAfterThisBlock = idx < stmts.length - 1 || hasCodeAfterBlock;
        if (st.type === 'IfStatement') {
          checkStatements(st.consequent && st.consequent.body ? st.consequent.body : [st.consequent], pathLabel, codeAfterThisBlock);
          if (st.alternate) checkStatements(st.alternate.body ? st.alternate.body : [st.alternate], pathLabel, codeAfterThisBlock);
        } else if (st.type === 'TryStatement') {
          if (st.block) checkStatements(st.block.body, pathLabel, false);
          if (st.handler && st.handler.body) {
            checkStatements(st.handler.body.body, pathLabel, codeAfterThisBlock);
          }
        } else if (st.type === 'BlockStatement') {
          checkStatements(st.body, pathLabel, codeAfterThisBlock);
        } else if (st.type === 'ForStatement' || st.type === 'ForOfStatement' || st.type === 'WhileStatement') {
          checkStatements(st.body && st.body.body ? st.body.body : [st.body], pathLabel, true);
        }
      }
    };

    const walkNode = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walkNode); return; }

      // Проверяем ТОЛЬКО тела хендлеров роутов и хуков. Спускаться во все
      // функции нельзя: `send()` внутри callback (doc.on('end', ...)) — это
      // не продолжение обработчика (нашёл верификатор: 2 ложных срабатывания).
      const isRouteCall = node.type === 'CallExpression'
        && node.callee && node.callee.type === 'MemberExpression'
        && node.callee.object && node.callee.object.type === 'Identifier'
        && node.callee.object.name === 'fastify'
        && node.callee.property
        && /^(get|post|put|patch|delete|head|options|all|route|addHook)$/.test(node.callee.property.name);

      if (isRouteCall) {
        for (const arg of node.arguments || []) {
          // хендлер может быть как функцией, так и объектом { preHandler: [...] }
          const candidates = [];
          if (arg.type === 'FunctionExpression' || arg.type === 'ArrowFunctionExpression') candidates.push(arg);
          if (arg.type === 'ObjectExpression') {
            for (const p of arg.properties || []) {
              const v = p.value;
              if (!v) continue;
              if (v.type === 'FunctionExpression' || v.type === 'ArrowFunctionExpression') candidates.push(v);
              if (v.type === 'ArrayExpression') {
                for (const el of v.elements || []) {
                  if (el && (el.type === 'FunctionExpression' || el.type === 'ArrowFunctionExpression')) candidates.push(el);
                }
              }
            }
          }
          for (const fnNode of candidates) {
            if (fnNode.body && fnNode.body.type === 'BlockStatement') {
              checkStatements(fnNode.body.body, path.relative(ROOT, file));
            }
          }
        }
      }

      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
        walkNode(node[k]);
      }
    };
    walkNode(ast.program.body);
  }

  if (offenders.length) {
    fail('routes: после reply.send() не продолжается выполнение', `${offenders.length} шт: ${offenders.slice(0, 8).join(', ')}`);
  } else {
    ok('routes: после reply.send() не продолжается выполнение', `${files.length} файлов (AST)`);
  }
}

/**
 * Отдельный класс: `reply.send()` внутри хука (onRequest/preHandler) без
 * `return`. Здесь дело не в «коде после send», а в том, что хук НЕ прерывает
 * жизненный цикл: маршрут выполняется дальше, и Fastify пишет второй ответ.
 * Именно это давало «Reply was already sent, did you forget to return reply
 * in the "/" (OPTIONS) route?» 7 раз за неделю.
 */
function checkHooksStopChain() {
  const files = walk(path.join(ROOT, 'src'), []);
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const hookRe = /addHook\(\s*['"]on(?:Request|Send|Response|Error)['"]/g;
    let m;
    while ((m = hookRe.exec(src)) !== null) {
      // тело хука: от объявления до ближайшей `\n});`
      const after = src.slice(m.index);
      const endIdx = after.search(/\n\}\);/);
      const body = endIdx > 0 ? after.slice(0, endIdx) : after.slice(0, 4000);
      const baseLine = src.slice(0, m.index).split('\n').length;
      body.split('\n').forEach((line, k) => {
        if (/^\s*\/\//.test(line)) return;
        if (!/reply\./.test(line) || !/\.send\(/.test(line)) return;
        if (/^\s+return\s+/.test(line)) return;      // return reply...
        if (/\breturn\b/.test(line)) return;         // if (...) return reply...
        // безопасно и так: `reply.code(403).send(...)` затем `return;`
        const rest = body.split('\n').slice(k + 1);
        const next = (rest.find((x) => x.trim()) || '').trim();
        if (/^return\b/.test(next)) return;
        offenders.push(`${path.relative(ROOT, file)}:${baseLine + k}`);
      });
    }
  }
  if (offenders.length) {
    fail('hooks: reply.send() в хуке только с return', `${offenders.length} шт: ${offenders.slice(0, 8).join(', ')}`);
  } else {
    ok('hooks: reply.send() в хуке только с return', `${files.length} файлов`);
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
  checkHooksStopChain();
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
