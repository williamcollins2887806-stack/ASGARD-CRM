/**
 * ПОНЯТНЫЕ ОШИБКИ ДЛЯ ПОЛЬЗОВАТЕЛЯ (правило продукта).
 * ═══════════════════════════════════════════════════════════════════════════
 * Требование заказчика (16.10.2026): «Любая ошибка показывает пользователю
 * понятное сообщение И что делать, а не просто "Ошибка сервера"».
 *
 * Проверяем живьём (клона :3100):
 *   1) гейт/валидация payout-ручек → message + hint;
 *   2) глобальный 5xx → человеческий текст + hint (не стек, не «Ошибка сервера»);
 *   3) битый JSON, переполнение id, несуществующий маршрут.
 * Каждый ответ обязан иметь message (что случилось) и hint (что делать).
 */
const { Pool } = require('pg');
const BASE = 'http://127.0.0.1:3100';
const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) { if (c) { pass++; console.log('  ✅ ' + n + (e ? ' — ' + e : '')); } else { fail++; fails.push(n); console.log('  ❌ ' + n + ' — ' + (e || '')); } }
const BAD = /Ошибка сервера|Внутренняя ошибка сервера|at Object\.|node_modules|\/src\/routes|Expected property|Unexpected token/i;

(async () => {
  for (let i = 0; i < 20; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (_) {} await new Promise((r) => setTimeout(r, 5000)); }
  const login = async (l, p) => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
    const d = await r.json(); let t = d.token;
    if (d.status === 'need_pin') { const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin: '0000' }) }); const d2 = await r2.json(); if (d2.token) t = d2.token; }
    return t;
  };
  const admin = await login('test_admin', 'Test123!');
  const dir = await login('test_director_comm', 'Test123!');
  const call = async (m, u, b, token) => {
    const r = await fetch(BASE + (u.startsWith('/api') ? u : '/api' + u), { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || admin) }, body: b ? JSON.stringify(b) : undefined });
    return { st: r.status, d: await r.json().catch(() => ({})) };
  };
  const realWork = (await pool.query('SELECT id FROM works ORDER BY id LIMIT 1')).rows[0].id;
  const check = (label, r, expectCode) => {
    const d = r.d || {};
    const msg = String(d.message || d.error || '');
    const hint = String(d.hint || '');
    const good = !!msg && !BAD.test(msg) && msg.length > 12 && !!hint && hint.length > 12;
    ok(`${label}: «что случилось» + «что делать»`, good, `[${r.st}] msg="${msg.slice(0, 60)}" hint="${hint.slice(0, 40)}"`);
    if (expectCode) ok(`${label}: код ${expectCode}`, d.error === expectCode, `error=${d.error}`);
  };

  console.log('\n=== 1. Ошибки payout-ручек приходят с сообщением и подсказкой ===');
  check('выплата без согласования', await call('POST', '/api/payouts/pay', { employee_id: 1, year: 2060, month: 1, kind: 'advance', pay_amount: 1000, confirm_over: true }), 'approval_required');
  check('pay-worker без списка', await call('POST', '/api/worker-payments/pay-worker', { employee_id: 1, work_id: realWork, type: 'salary', amount: 5000, payment_method: 'cash', pay_year: 2060, pay_month: 1 }), 'approval_required');
  check('mark_paid премия без списка', await call('POST', '/api/worker-payments', { employee_id: 1, work_id: realWork, type: 'bonus', amount: 100, payment_method: 'cash', mark_paid: true, pay_year: 2061, pay_month: 1 }), 'approval_required');
  check('сумма <= 0', await call('POST', '/api/payout-cart/draft', { employee_id: 1, year: 2060, month: 1, kind: 'salary', pay_amount: 0 }), 'invalid_amount');
  check('плохой период', await call('POST', '/api/payout-cart/draft', { employee_id: 1, year: 1999, month: 13, kind: 'salary', pay_amount: 100 }), null);
  check('возврат без причины', await call('POST', '/api/payout-cart/items/999999/reject', {}, dir), 'reason_required');
  check('корректировка без причины', await call('POST', '/api/payouts/carry-adjustment', { employee_id: 1, year: 2060, month: 1, new_amount: 0 }), 'reason_required');
  check('сотрудник не найден', await call('POST', '/api/payout-cart/draft', { employee_id: 99999999, year: 2060, month: 1, kind: 'salary', pay_amount: 500 }), null);

  console.log('\n=== 2. Технические ошибки (5xx и битые запросы) — тоже по-человечески ===');
  {
    const over = await call('GET', '/api/payouts/employee/99999999999999999999/monthly');
    ok('переполнение id → не стек, есть hint', !BAD.test(String(over.d.message || over.d.error || '')) && !!over.d.hint,
      `[${over.st}] "${String(over.d.message || '').slice(0, 60)}"`);
  }
  {
    const r = await fetch(BASE + '/api/payout-cart/draft', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin }, body: '{not json' });
    const d = await r.json().catch(() => ({}));
    ok('битый JSON → понятно + hint', r.status >= 400 && !BAD.test(String(d.message || '')) && !!d.hint,
      `[${r.status}] "${String(d.message || '').slice(0, 60)}"`);
  }
  {
    const nf = await call('GET', '/api/this-route-does-not-exist');
    ok('несуществующий маршрут → понятно + hint', !!nf.d.hint && !BAD.test(String(nf.d.message || '')),
      `[${nf.st}] "${String(nf.d.message || '').slice(0, 60)}"`);
  }

  console.log('\n=== 3. Успешные ответы НЕ ломаются хуком ===');
  {
    const okCall = await call('GET', '/api/payouts/list/2062/1');
    ok('успешный ответ без hint', okCall.st === 200 && okCall.d.hint === undefined, `[${okCall.st}] keys=${Object.keys(okCall.d || {}).slice(0, 5).join(',')}`);
    const works = await call('GET', '/api/data/works?limit=1');
    ok('generic GET не повреждён', works.st === 200 && Array.isArray(works.d.works), `[${works.st}]`);
  }

  console.log('\n=== 4. ГРАНИЦЫ (находки верификатора 16.10.2026): битый URL, утечки, англ. тексты ===');
  // Технический текст НЕ должен доходить до пользователя: ни английский
  // («Invalid id», «Unsupported Media Type»), ни текст PostgreSQL (имена
  // таблиц/колонок), ни сырой `detail`.
  const TECH = /not present in table|violates |invalid input syntax|relation |of relation|Key \(|Unsupported Media Type|is not a valid url|Bad Request|Invalid (id|user|chat)|Bad ID|undefined|node_modules|at Object/i;
  const raw = async (m, u, body, headers) => {
    const r = await fetch(BASE + u, { method: m, headers: headers || { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin }, body });
    let d = null; try { d = await r.json(); } catch (_) {}
    return { st: r.status, d, ct: r.headers.get('content-type') || '' };
  };
  const checkTech = (label, r) => {
    const d = r.d || {};
    const msg = String(d.message || '');
    const hint = String(d.hint || '');
    const good = r.st >= 400 && !!msg && /[А-Яа-яЁё]/.test(msg) && !TECH.test(msg) && !!hint && d.detail === undefined;
    ok(label, good, `[${r.st}] "${msg.slice(0, 50)}"`);
  };
  checkTech('битый URL /api/%', await raw('GET', '/api/%'));
  checkTech('DELETE /api/works/abc (id не число)', await raw('DELETE', '/api/works/abc'));
  checkTech('GET /api/users/abc (англ. текст)', await raw('GET', '/api/users/abc'));
  checkTech('GET /api/assembly/abc («Bad ID»)', await raw('GET', '/api/assembly/abc'));
  checkTech('415 неверный Content-Type', await raw('POST', '/api/tasks', 'a=1', { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer ' + admin }));
  {
    const opt = await fetch(BASE + '/api/works', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:3100' } });
    let d = null; try { d = await opt.json(); } catch (_) {}
    ok('bare OPTIONS → JSON с message+hint', opt.status >= 400 && d && !!d.message && !!d.hint, `[${opt.status}] ct=${opt.headers.get('content-type')}`);
    const okOpt = await fetch(BASE + '/api/works', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:3100', 'Access-Control-Request-Method': 'GET' } });
    ok('корректный preflight НЕ сломан (2xx)', okOpt.status < 300, `[${okOpt.status}]`);
  }

  await pool.end();
  console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
  if (fails.length) { console.log('ПРОВАЛЫ:'); fails.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
