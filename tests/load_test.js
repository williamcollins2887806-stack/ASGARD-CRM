/**
 * ASGARD CRM — Нагрузочные тесты
 *
 * Запуск: node tests/load_test.js
 * Параметры (env):
 *   BASE_URL      — адрес сервера (default: http://localhost:3000)
 *   CONCURRENCY   — параллельных запросов (default: 10)
 *   DURATION_SEC  — длительность теста в секундах (default: 30)
 *   LOGIN         — логин (default: test_admin)
 *   PASSWORD      — пароль (default: Test123!)
 */

'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10');
const DURATION_SEC = parseInt(process.env.DURATION_SEC || '30');
const LOGIN = process.env.LOGIN || 'test_admin';
const PASSWORD = process.env.PASSWORD || 'Test123!';

function authH(token) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

const SCENARIOS = [
  { name: 'GET /api/tenders', weight: 30,
    fn: (token) => fetch(`${BASE_URL}/api/tenders?limit=20`, { headers: authH(token) }) },
  { name: 'GET /api/data/works', weight: 20,
    fn: (token) => fetch(`${BASE_URL}/api/data/works?limit=20`, { headers: authH(token) }) },
  { name: 'GET /api/data/employees', weight: 15,
    fn: (token) => fetch(`${BASE_URL}/api/data/employees?limit=50`, { headers: authH(token) }) },
  { name: 'GET /api/notifications', weight: 10,
    fn: (token) => fetch(`${BASE_URL}/api/notifications?limit=20`, { headers: authH(token) }) },
  { name: 'GET /api/pre-tenders', weight: 10,
    fn: (token) => fetch(`${BASE_URL}/api/pre-tenders?limit=20`, { headers: authH(token) }) },
  { name: 'GET /api/integrations/bank/stats', weight: 10,
    fn: (token) => fetch(`${BASE_URL}/api/integrations/bank/stats`, { headers: authH(token) }) },
  { name: 'GET /api/health', weight: 5,
    fn: () => fetch(`${BASE_URL}/api/health`) },
];

// Суммарный вес для выбора сценария
const totalWeight = SCENARIOS.reduce((s, sc) => s + sc.weight, 0);

function pickScenario() {
  let r = Math.random() * totalWeight;
  for (const sc of SCENARIOS) {
    r -= sc.weight;
    if (r <= 0) return sc;
  }
  return SCENARIOS[0];
}

async function getToken() {
  const resp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD })
  });
  const data = await resp.json();
  if (!data.token) throw new Error('Не удалось получить токен: ' + JSON.stringify(data));
  return data.token;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

async function run() {
  console.log(`
════════════════════════════════════════════════════════════════════════════════
                    ASGARD CRM — НАГРУЗОЧНЫЕ ТЕСТЫ
════════════════════════════════════════════════════════════════════════════════
  URL:          ${BASE_URL}
  Concurrency:  ${CONCURRENCY}
  Duration:     ${DURATION_SEC}s
  Scenarios:    ${SCENARIOS.length}
════════════════════════════════════════════════════════════════════════════════
`);

  // Авторизация
  let token;
  try {
    token = await getToken();
    console.log('✓ Авторизация успешна');
  } catch (e) {
    console.error('✗ Ошибка авторизации:', e.message);
    process.exit(1);
  }

  // Статистика
  const stats = {};
  for (const sc of SCENARIOS) {
    stats[sc.name] = { count: 0, errors: 0, latencies: [] };
  }

  let running = true;
  const endTime = Date.now() + DURATION_SEC * 1000;

  // Worker
  async function worker() {
    while (running && Date.now() < endTime) {
      const scenario = pickScenario();
      const st = stats[scenario.name];
      const start = Date.now();
      try {
        const resp = await scenario.fn(token);
        const latency = Date.now() - start;
        st.latencies.push(latency);
        st.count++;
        if (resp.status >= 500) st.errors++;
      } catch (e) {
        st.count++;
        st.errors++;
        st.latencies.push(Date.now() - start);
      }
    }
  }

  // Запуск workers
  console.log(`Запуск ${CONCURRENCY} воркеров на ${DURATION_SEC}с...`);
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  running = false;

  // Отчёт
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('                         РЕЗУЛЬТАТЫ');
  console.log('══════════════════════════════════════════════════════════════════');

  let totalRequests = 0;
  let totalErrors = 0;
  const allLatencies = [];

  for (const [name, st] of Object.entries(stats)) {
    if (st.count === 0) continue;
    totalRequests += st.count;
    totalErrors += st.errors;
    allLatencies.push(...st.latencies);

    const avg = Math.round(st.latencies.reduce((s, l) => s + l, 0) / st.latencies.length);
    const p95 = percentile(st.latencies, 95);
    const p99 = percentile(st.latencies, 99);

    console.log(`  ${name}`);
    console.log(`    Запросов: ${st.count} | Ошибок: ${st.errors} | Avg: ${avg}ms | P95: ${p95}ms | P99: ${p99}ms`);
  }

  const rps = Math.round(totalRequests / DURATION_SEC);
  const avgTotal = allLatencies.length ? Math.round(allLatencies.reduce((s, l) => s + l, 0) / allLatencies.length) : 0;
  const p95Total = allLatencies.length ? percentile(allLatencies, 95) : 0;
  const p99Total = allLatencies.length ? percentile(allLatencies, 99) : 0;
  const errorRate = totalRequests ? ((totalErrors / totalRequests) * 100).toFixed(2) : 0;

  console.log('\n──────────────────────────────────────────────────────────────────');
  console.log(`  ИТОГО: ${totalRequests} запросов за ${DURATION_SEC}с (${rps} RPS)`);
  console.log(`  Avg latency: ${avgTotal}ms | P95: ${p95Total}ms | P99: ${p99Total}ms`);
  console.log(`  Ошибок: ${totalErrors} (${errorRate}%)`);
  console.log('──────────────────────────────────────────────────────────────────');

  // Критерии прохождения
  const passed = [];
  const failed = [];

  if (avgTotal < 200) passed.push(`✓ Avg latency ${avgTotal}ms < 200ms`);
  else failed.push(`✗ Avg latency ${avgTotal}ms >= 200ms`);

  if (p95Total < 500) passed.push(`✓ P95 ${p95Total}ms < 500ms`);
  else failed.push(`✗ P95 ${p95Total}ms >= 500ms`);

  if (p99Total < 1000) passed.push(`✓ P99 ${p99Total}ms < 1000ms`);
  else failed.push(`✗ P99 ${p99Total}ms >= 1000ms`);

  if (parseFloat(errorRate) < 1) passed.push(`✓ Error rate ${errorRate}% < 1%`);
  else failed.push(`✗ Error rate ${errorRate}% >= 1%`);

  console.log('\nКритерии:');
  for (const p of passed) console.log(`  ${p}`);
  for (const f of failed) console.log(`  ${f}`);

  if (failed.length > 0) {
    console.log('\n❌ НАГРУЗОЧНЫЕ ТЕСТЫ НЕ ПРОЙДЕНЫ');
    process.exit(1);
  } else {
    console.log('\n✅ НАГРУЗОЧНЫЕ ТЕСТЫ ПРОЙДЕНЫ');
    process.exit(0);
  }
}

run().catch(e => {
  console.error('Фатальная ошибка:', e);
  process.exit(1);
});
