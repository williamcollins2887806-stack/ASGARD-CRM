'use strict';
/**
 * Тест вывода хоста MAX из инстанса (green-api.js).
 * Инцидент 10–14.10.2026: жёсткий дефолт api.green-api.com/v3 (мёртвый) прятал
 * сбой — коды в MAX не уходили никому, в журнале лишь «fetch failed».
 * Запуск: node tests/green-api-max-host.test.js
 */
const assert = require('assert');
const path = require('path');

const svc = require(path.join(__dirname, '..', 'src', 'services', 'green-api'));

// Внутренние функции не экспортированы — проверяем через поведение getMaxConfig
// (он не экспортирован) → тестируем публичный контракт: реальный URL запроса.
// Для чистоты подменяем fetch и смотрим, куда стучится sendMaxMessage.
let fails = [];
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? '  :: ' + extra : ''));
  if (!cond) fails.push(name);
}

async function hostFor(env, instance) {
  // сохраняем/ставим env
  const saved = {};
  for (const k of ['GREEN_API_MAX_URL', 'GREEN_API_MAX_INSTANCE', 'GREEN_API_INSTANCE', 'GREEN_API_MAX_TOKEN', 'GREEN_API_TOKEN']) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    // первый вызов resolveMaxChatId (checkAccount) → отдаём chatId, второй (sendMessage) → idMessage
    if (String(url).includes('checkAccount')) return new Response(JSON.stringify({ exist: true, chatId: '1' }), { status: 200 });
    return new Response(JSON.stringify({ idMessage: '1' }), { status: 200 });
  };
  try {
    await svc.sendMaxMessage('79585099199', 'x');
  } catch (_) { /* не важно */ }
  global.fetch = realFetch;
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  return calls[0] || '';
}

(async () => {
  // 1) явный URL побеждает
  ok('явный GREEN_API_MAX_URL используется',
    (await hostFor({ GREEN_API_MAX_URL: 'https://example.test/base/', GREEN_API_INSTANCE: '3100638228', GREEN_API_TOKEN: 't' }, '')).startsWith('https://example.test/base/waInstance3100638228/'));

  // 2) вывод из инстанса 31xx → 3100
  ok('31xx → 3100.api.green-api.com',
    (await hostFor({ GREEN_API_MAX_URL: '', GREEN_API_INSTANCE: '3100638228', GREEN_API_TOKEN: 't' }, '')).startsWith('https://3100.api.green-api.com/waInstance3100638228/'));

  // 3) вывод из инстанса 35xx → 3500
  ok('35xx → 3500.api.green-api.com',
    (await hostFor({ GREEN_API_MAX_URL: '', GREEN_API_INSTANCE: '3512345678', GREEN_API_TOKEN: 't' }, '')).startsWith('https://3500.api.green-api.com/waInstance3512345678/'));

  // 4) нераспознанный инстанс → безопасный дефолт 3100 (НЕ api.green-api.com)
  const fallback = await hostFor({ GREEN_API_MAX_URL: '', GREEN_API_INSTANCE: 'ABC', GREEN_API_TOKEN: 't' }, '');
  ok('неизвестный инстанс → дефолт 3100, НЕ api.green-api.com',
    fallback.startsWith('https://3100.api.green-api.com/') && !fallback.includes('//api.green-api.com'));

  // 5) ни один путь не бьёт в мёртвый api.green-api.com/v3
  const anyDead = [fallback,
    await hostFor({ GREEN_API_MAX_URL: '', GREEN_API_INSTANCE: '3100638228', GREEN_API_TOKEN: 't' }, '')]
    .some(u => /\/\/api\.green-api\.com/.test(u));
  ok('мёртвый api.green-api.com больше не используется', !anyDead);

  // 6) при сбое сети логируется хост
  const realErr = console.error; let logged = '';
  console.error = (...a) => { logged += a.join(' ') + '\n'; };
  const realFetch = global.fetch;
  global.fetch = async () => { const e = new Error('fetch failed'); e.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' }; throw e; };
  process.env.GREEN_API_MAX_URL = 'https://3100.api.green-api.com';
  process.env.GREEN_API_INSTANCE = '3100638228';
  process.env.GREEN_API_TOKEN = 't';
  try { await svc.checkMaxAccount('79585099199', { force: true }); } catch (_) {}
  global.fetch = realFetch; console.error = realErr;
  ok('при сетевом сбое логируется host=…', /host=https:\/\/3100\.api\.green-api\.com/.test(logged) && /UND_ERR_CONNECT_TIMEOUT/.test(logged), logged.trim().slice(0, 120));

  console.log('\n' + (fails.length ? 'FAILED: ' + fails.join(' | ') : 'ALL PASS'));
  process.exit(fails.length ? 1 : 0);
})();
