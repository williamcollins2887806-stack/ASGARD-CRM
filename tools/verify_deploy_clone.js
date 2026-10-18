#!/usr/bin/env node
'use strict';
/**
 * Рантайм-верификация деплоя на КЛОНЕ (asgard_crm_test) — по правилу проекта:
 * FIXED != VERIFIED, проверка на клоне, не на проде.
 *
 * Поднимает приложение-двойник на :3101 с DB_NAME=asgard_crm_test и проверяет:
 *   1. сервис стартует, /api/health = 200;
 *   2. новые роуты выплат отвечают (не 404);
 *   3. объекты схемы на месте (таблицы/колонки/CHECK);
 *   4. V407: сварщик 40->50 в сетке тарифов;
 *   5. V406: DIRECTOR_DEV имеет chat_groups;
 *   6. V408: doc_approval_grant существует.
 *
 * Запуск: node tools/verify_deploy_clone.js
 */
const { Client } = require('pg');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DB = 'asgard_crm_test';
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (n, cond, ev) => { if (cond) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${ev ? ' — ' + ev : ''}`); } };

function get(url) {
  return new Promise((res) => {
    const req = http.get(url, { timeout: 12000 }, (r) => {
      let b = ''; r.on('data', (d) => b += d); r.on('end', () => res({ status: r.statusCode, body: b }));
    });
    req.on('error', (e) => res({ status: 0, body: String(e.message) }));
    req.on('timeout', () => { req.destroy(); res({ status: 0, body: 'timeout' }); });
  });
}

(async () => {
  console.log('════ РАНТАЙМ-ВЕРИФИКАЦИЯ НА КЛОНЕ ════');
  console.log(`БД: ${DB}   клон-апп: :${PORT}\n`);

  // ── старт клона-аппа ──
  const env = { ...process.env, DB_NAME: DB, DB_HOST: '127.0.0.1', DB_USER: 'asgard', DB_PASSWORD: '123456789', PORT: String(PORT), NODE_ENV: 'test' };
  const child = spawn('node', ['src/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => log += d);
  child.stderr.on('data', (d) => log += d);

  // ждём подъёма (старт тяжёлый: крон-инициализация + запросы)
  let up = false;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await get(`${BASE}/api/health`);
    if (h.status === 200) { up = true; break; }
    if (child.exitCode !== null) break;
  }

  console.log('── 1. Запуск сервиса ──');
  ok('клон-апп стартовал и отвечает', up, up ? '' : (log.split('\n').slice(-4).join(' | ') || 'нет ответа'));
  if (up) {
    const h = await get(`${BASE}/api/health`);
    ok(`/api/health = 200 (получено ${h.status})`, h.status === 200);
  }

  console.log('\n── 2. Роуты выплат (были 404) ──');
  const routes = ['/api/payout-plan/2026/9', '/api/payout-cart/pending', '/api/payouts/list/2026/9', '/api/director-summary/queues'];
  for (const r of routes) {
    const res = await get(BASE + r);
    // 401/403 = роут есть, просто нужен токен. 404 = роута нет.
    ok(`${r} не 404 (получено ${res.status})`, res.status !== 404 && res.status !== 0, `status=${res.status}`);
  }

  // ── схема ──
  const c = new Client({ host: '127.0.0.1', port: 5432, database: DB, user: 'asgard', password: '123456789' });
  await c.connect();
  const q = async (sql) => (await c.query(sql)).rows[0];

  console.log('\n── 3. Объекты схемы ──');
  const tabs = (await q(`SELECT COUNT(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename IN
    ('payout_batches','payout_batch_items','payout_plans','payout_plan_items','doc_reconciliation_acts','doc_reminder_log','work_calendar','doc_email_intake','email_threads','doc_approval_grant')`)).n;
  ok(`таблиц из миграций: ${tabs}/10`, tabs === 10);

  const cols = (await q(`SELECT COUNT(*)::int n FROM information_schema.columns WHERE
    (table_name='payment_invoices' AND column_name IN ('initiator_intent','doc_registry_id','pp_number')) OR
    (table_name='cash_requests' AND column_name='issued_amount') OR
    (table_name='suppliers' AND column_name='bik') OR
    (table_name='price_records' AND column_name='quantity') OR
    (table_name='doc_registry' AND column_name IN ('counterparty_inn','fx_rate')) OR
    (table_name='employees' AND column_name='se_payee_id_2') OR
    (table_name='worker_payments' AND column_name='payee_employee_id')`)).n;
  ok(`колонок из миграций: ${cols}/10`, cols === 10);

  const fn = (await q(`SELECT COUNT(*)::int n FROM pg_proc WHERE proname='asgard_workdays_until'`)).n;
  ok('функция asgard_workdays_until', fn === 1);

  const chk = (await q(`SELECT COUNT(*)::int n FROM pg_constraint WHERE conname='chk_pbi_kind'`)).n;
  ok('CHECK chk_pbi_kind (V392)', chk === 1);

  console.log('\n── 4. V407: потолки тарифов ──');
  const w = await q(`SELECT MAX(points)::int mx FROM field_tariff_grid WHERE category='mlsp' AND position_name LIKE 'Сварщик%'`);
  ok(`сварщик mlsp max = 50 (получено ${w.mx})`, w.mx === 50);
  const all = await q(`SELECT COUNT(*)::int n FROM (SELECT category FROM field_tariff_grid WHERE position_name LIKE 'Сварщик%' GROUP BY category HAVING MAX(points)=50) x`);
  ok(`сварщик 50б во всех 4 категориях (получено ${all.n})`, all.n === 4);

  console.log('\n── 5. V406: права DIRECTOR_DEV ──');
  const rp = (await q(`SELECT string_agg(module_key,',' ORDER BY module_key) s FROM role_presets WHERE role='DIRECTOR_DEV'`)).s || '';
  ok(`DIRECTOR_DEV: chat_groups есть (${rp})`, rp.includes('chat_groups'));
  ok(`DIRECTOR_DEV: tasks_admin есть`, rp.includes('tasks_admin'));

  console.log('\n── 6. Целостность данных ──');
  const nm = (await q('SELECT COUNT(*)::int n FROM migrations')).n;
  ok(`миграций применено: ${nm}`, nm >= 300, `n=${nm}`);
  const orphan = (await q(`SELECT COUNT(*)::int n FROM employee_assignments ea WHERE ea.tariff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM field_tariff_grid g WHERE g.id=ea.tariff_id)`)).n;
  ok(`осиротевших назначений: ${orphan}`, orphan === 0);
  const emp = (await q('SELECT COUNT(*)::int n FROM employees')).n;
  ok(`сотрудников: ${emp}`, emp > 0);

  await c.end();
  try { child.kill('SIGKILL'); } catch { /* ignore */ }

  console.log(`\n════ ИТОГ: ${pass} PASS / ${fail} FAIL ════`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
