/**
 * C5 — стабильность: 3 подряд прогона suggest-ai должны дать ТОТ ЖЕ top-product_id.
 * Пишет только в клон (:3101, asgard_crm_test), ничего не создаёт.
 */
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3101';
const { Client } = require('pg');
const pool = new Client({ host: '127.0.0.1', port: 5432, user: 'asgard', password: '123456789', database: process.env.CL_DB_NAME || 'asgard_crm_test' });

async function login(login, password, pin = '0000') {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const d = await r.json().catch(() => ({}));
  let token = d.token;
  if (d.status === 'need_pin') {
    const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ pin }) });
    token = ((await r2.json().catch(() => ({}))).token) || token;
  }
  return token;
}

const ROWS = [
  { name: 'УШМ 125', quantity: 2 },
  { name: 'АКБ 12В', quantity: 1 },
  { name: 'подшипник 6204', quantity: 10 },
];

(async () => {
  await pool.connect();
  const token = await login('test_pm', 'Test123!');
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const tops = [];
  for (let run = 1; run <= 3; run++) {
    const t0 = Date.now();
    const r = await fetch(BASE + '/api/warehouse-cart/suggest-ai', { method: 'POST', headers: H, body: JSON.stringify({ rows: ROWS }) });
    const d = await r.json().catch(() => ({}));
    const ms = Date.now() - t0;
    const sig = (d.suggestions || []).map(s => `${s.input_name}=${s.product_id || ('e' + s.equipment_id) || 'null'}`).join(' ; ');
    tops.push(sig);
    console.log(`RUN ${run}: ${ms} мс, ai_used=${d.ai_used}, top=[${sig}]`);
  }
  await pool.end().catch(() => {});
  const stable = tops[0] === tops[1] && tops[1] === tops[2];
  console.log('\nСТАБИЛЬНОСТЬ top-product_id за 3 прогона:', stable ? 'PASS' : 'FAIL');
  console.log(stable ? 'ИТОГ: 3/3 стабильно' : 'РАСХОЖДЕНИЕ: ' + JSON.stringify(tops, null, 2));
  // ВАЖНО: процесс завершаем ЖЁСТКО (Windows-баг libuv при незакрытых undici-сокетах
  // иначе печатает «Assertion failed: uv.c line 76» после успешного вердикта).
  process.exit(stable ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
