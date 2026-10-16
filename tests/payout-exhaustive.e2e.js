/**
 * ИСЧЕРПЫВАЮЩАЯ ПРОВЕРКА ГЕЙТА СОГЛАСОВАНИЯ ВЫПЛАТ.
 * ═══════════════════════════════════════════════════════════════════════════
 * Цель: перебрать ВСЕ известные измерения обхода и убедиться, что каждое
 * заблокировано. Тест идемпотентный, данные убирает за собой.
 *
 * Измерения:
 *   A. Ручки выплаты (9 путей)
 *   B. Параметры записи (период, сотрудник, объект, тип, сумма, статус)
 *   C. Способы «сброса» (отмена, revert, сброс статуса, правка суммы)
 *   D. Структурные (два списка, два объекта, частичные суммы, дробление)
 *   E. Права (BUH, PM, DIRECTOR — не админ)
 */
const { Pool } = require('pg');
const BASE = 'http://127.0.0.1:3100';
let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) { if (c) { pass++; console.log('  ✅ ' + n + (e ? ' — ' + e : '')); } else { fail++; fails.push(n); console.log('  ❌ ' + n + ' — ' + (e || '')); } }

const Y = 2040; // свободный год, чтобы не трогать живые данные

(async () => {
  const c = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  const login = async (l, p) => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
    const d = await r.json(); let t = d.token;
    if (d.status === 'need_pin') { const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin: '0000' }) }); const d2 = await r2.json(); if (d2.token) t = d2.token; }
    return t;
  };
  const T = { admin: await login('test_admin', 'Test123!'), dir: await login('test_director_comm', 'Test123!'), buh: await login('test_buh', 'Test123!'), pm: await login('test_pm', 'Test123!') };
  const call = async (m, u, b, token) => {
    const url = u.startsWith('/api') ? u : '/api' + u;
    const r = await fetch(BASE + url, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || T.admin) }, body: b ? JSON.stringify(b) : undefined });
    return { st: r.status, d: await r.json().catch(() => ({})) };
  };
  const works = (await c.query(`SELECT id FROM works ORDER BY id LIMIT 3`)).rows.map((r) => r.id);
  const emps = (await c.query(`SELECT id FROM employees WHERE is_active=true ORDER BY id LIMIT 6`)).rows.map((r) => r.id);
  let empi = 0, mi = 0;

  const clean = async (emp, m) => {
    await c.query(`DELETE FROM payout_confirmation_codes WHERE payment_id IN (SELECT id FROM worker_payments WHERE employee_id=$1 AND pay_year=$2)`, [emp, Y]);
    await c.query(`DELETE FROM payout_batch_items WHERE batch_id IN (SELECT id FROM payout_batches WHERE period_year=$1 AND period_month=$2)`, [Y, m]);
    await c.query(`DELETE FROM payout_batches WHERE period_year=$1 AND period_month=$2`, [Y, m]);
    await c.query(`DELETE FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3`, [emp, Y, m]);
  };

  /** Готовит: сотрудник, период, список одобренный на `approved`, начисления `pending`. */
  async function prep({ approved, pendings = [], workId = works[0] }) {
    const emp = emps[empi++ % emps.length];
    const m = (mi++ % 12) + 1;
    await clean(emp, m);
    const dj = (await call('POST', '/api/payout-cart/draft', { employee_id: emp, year: Y, month: m, kind: 'advance', pay_amount: approved })).d;
    await call('POST', '/api/payout-cart/submit', { year: Y, month: m });
    // одобряет ДИРЕКТОР (SoD)
    await call('POST', `/api/payout-cart/items/${dj.item.id}/approve`, {}, T.dir);
    for (const amt of pendings) {
      await c.query(`INSERT INTO worker_payments (employee_id, work_id, type, amount, status, payment_method, pay_year, pay_month, created_at)
        VALUES ($1,$2,'salary',$3,'pending','cash',$4,$5,NOW())`, [emp, workId, amt, Y, m]);
    }
    return { emp, m, itemId: dj.item.id };
  }
  const totalPaid = async (emp, m) => Number((await c.query(`SELECT COALESCE(SUM(amount),0)::numeric AS s FROM worker_payments
     WHERE employee_id=$1 AND status IN ('paid','confirmed','cancelled') AND pay_year=$2 AND pay_month=$3`, [emp, Y, m])).rows[0].s);

  console.log('\n═══ A. ВСЕ РУЧКИ ВЫПЛАТЫ (каждая должна блокировать сверх одобренного) ═══');
  {
    const cases = [
      ['PUT /worker-payments/:id/pay', async (s) => { const w = (await c.query(`SELECT id FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3 AND status='pending' ORDER BY id DESC LIMIT 1`, [s.emp, Y, s.m])).rows[0]; return w ? call('PUT', `/worker-payments/${w.id}/pay`, { payment_method: 'cash' }) : { st: 0 }; }],
      ['POST /payouts/pay', async (s) => call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 99999, confirm_over: true, confirm_duplicate: true })],
      ['POST /worker-payments/pay-worker', async (s) => call('POST', '/api/worker-payments/pay-worker', { employee_id: s.emp, work_id: works[0], type: 'salary', amount: 99999, payment_method: 'cash', pay_year: Y, pay_month: s.m, confirm_duplicate: true })],
      ['POST /director-payments', async (s) => call('POST', '/api/director-payments', { employee_id: s.emp, work_id: works[0], type: 'bonus', amount: 99999, payment_method: 'cash', pay_year: Y, pay_month: s.m, confirm_duplicate: true })],
      ['PUT /pm/payments/:id/paid', async (s) => { const w = (await c.query(`SELECT id FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3 AND status='pending' ORDER BY id DESC LIMIT 1`, [s.emp, Y, s.m])).rows[0]; return w ? call('PUT', `/api/pm/payments/${w.id}/paid`, { confirm_duplicate: true }) : { st: 0 }; }],
      ['POST /worker-payments (mark_paid)', async (s) => call('POST', '/api/worker-payments', { employee_id: s.emp, work_id: works[0], type: 'bonus', amount: 99999, payment_method: 'cash', mark_paid: true, pay_year: Y, pay_month: s.m })],
      ['POST /cash/quick-expense', async (s) => call('POST', '/api/cash/quick-expense', { employee_id: s.emp, work_id: works[0], amount: 99999, expense_type: 'per_diem' })],
      ['POST /data/worker_payments', async (s) => call('POST', '/api/data/worker_payments', { employee_id: s.emp, work_id: works[0], type: 'bonus', amount: 99999, status: 'paid', pay_year: Y, pay_month: s.m })],
      ['PUT /data/worker_payments/:id', async (s) => { const w = (await c.query(`SELECT id FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3 AND status='pending' ORDER BY id DESC LIMIT 1`, [s.emp, Y, s.m])).rows[0]; return w ? call('PUT', `/api/data/worker_payments/${w.id}`, { status: 'paid' }) : { st: 0 }; }],
    ];
    for (const [name, fn, opt] of cases) {
      const s = await prep({ approved: 1, pendings: [50000] });
      const r = await fn(s);
      const passExpect = opt && opt.expect200
        ? (r.st === 200)                                            // полномочие директора: прямая выплата разрешена
        : (r.st === 409 || r.st === 400 || r.st === 403);
      ok(name + (opt && opt.expect200 ? ' → 200 (полномочие директора)' : ' → отказ при одобрении 1 ₽'), passExpect, `HTTP ${r.st} ${r.d.error || ''}`);
      await clean(s.emp, s.m);
    }
  }

  console.log('\n═══ B. ПАРАМЕТРЫ ЗАПИСИ: подмена через generic CRUD ═══');
  {
    const mutants = [
      ['период', { pay_year: 2099, pay_month: 12 }],
      ['период только месяц', { pay_month: 12 }],
      ['сотрудник', { employee_id: emps[5] }],
      ['объект', { work_id: works[2] }],
      ['тип', { type: 'bonus' }],
      ['сумма', { amount: 999999 }],
      ['статус', { status: 'paid' }],
      ['статус confirmed', { status: 'confirmed' }],
      ['всё сразу', { pay_year: 2099, pay_month: 12, employee_id: emps[5], amount: 999999, status: 'paid', type: 'bonus' }],
    ];
    for (const [label, body] of mutants) {
      const s = await prep({ approved: 1, pendings: [50000] });
      const w = (await c.query(`SELECT id FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3 AND status='pending' ORDER BY id DESC LIMIT 1`, [s.emp, Y, s.m])).rows[0];
      const before = (await c.query(`SELECT pay_year, pay_month, employee_id, work_id, type, amount, status FROM worker_payments WHERE id=$1`, [w.id])).rows[0];
      await call('PUT', `/api/data/worker_payments/${w.id}`, body);
      const after = (await c.query(`SELECT pay_year, pay_month, employee_id, work_id, type, amount, status FROM worker_payments WHERE id=$1`, [w.id])).rows[0];
      const same = JSON.stringify(before) === JSON.stringify(after);
      ok(`подмена «${label}» заблокирована`, same, same ? '' : `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      await clean(s.emp, s.m);
    }
  }

  console.log('\n═══ C. СПОСОБЫ СБРОСА (после сброса выплата всё равно должна быть 409) ═══');
  {
    // выплатим 50000 (одобрено 50000), затем пытаемся сбросить и выплатить снова
    const resetCases = [
      ['отмена DELETE', async (s, pid) => { await call('DELETE', `/api/worker-payments/${pid}`); return { ok: true }; }],
      ['revert', async (s, pid) => { await call('POST', `/api/payouts/${pid}/revert`, {}); return { ok: true }; }],
      ['generic PUT status=pending', async (s, pid) => { const r = await call('PUT', `/api/data/worker_payments/${pid}`, { status: 'pending' }); return r; }],
      ['generic DELETE', async (s, pid) => { const r = await call('DELETE', `/api/data/worker_payments/${pid}`); return r; }],
      ['PUT /:id amount=0', async (s, pid) => { const r = await call('PUT', `/api/worker-payments/${pid}`, { amount: 0 }); return r; }],
      ['PUT /:id status=pending', async (s, pid) => { const r = await call('PUT', `/api/worker-payments/${pid}`, { status: 'pending' }); return r; }],
    ];
    for (const [label, resetFn] of resetCases) {
      const s = await prep({ approved: 50000, pendings: [] });
      const p1 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 50000, confirm_over: true, confirm_duplicate: true });
      if (p1.st !== 200 || !p1.d.payment) { ok(`${label}: подготовка`, false, `первая выплата HTTP ${p1.st}`); await clean(s.emp, s.m); continue; }
      await resetFn(s, p1.d.payment.id);
      // новая pending и повторная выплата
      await c.query(`INSERT INTO worker_payments (employee_id, work_id, type, amount, status, payment_method, pay_year, pay_month, created_at)
        VALUES ($1,$2,'salary',50000,'pending','cash',$3,$4,NOW())`, [s.emp, works[0], Y, s.m]);
      const p2 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 50000, confirm_over: true, confirm_duplicate: true });
      ok(`после «${label}» повтор → 409`, p2.st === 409, `HTTP ${p2.st} already=${p2.d.already_paid}`);
      await clean(s.emp, s.m);
    }
  }

  console.log('\n═══ D. СТРУКТУРНЫЕ ОБХОДЫ ═══');
  {
    // D1: два объекта
    {
      const s = await prep({ approved: 10000, pendings: [] });
      const a = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 7000, confirm_over: true, confirm_duplicate: true });
      await c.query(`UPDATE worker_payments SET work_id=$2 WHERE employee_id=$1 AND pay_year=$3 AND pay_month=$4`, [s.emp, works[1], Y, s.m]);
      const b = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 7000, confirm_over: true, confirm_duplicate: true });
      ok('D1 два объекта → 2-я 409', a.st === 200 && b.st === 409, `a=${a.st} b=${b.st}`);
      await clean(s.emp, s.m);
    }
    // D2: два списка
    {
      const s = await prep({ approved: 10000, pendings: [] });
      const q1 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 10000, confirm_over: true, confirm_duplicate: true });
      const d2 = (await call('POST', '/api/payout-cart/draft', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 10000 })).d;
      await call('POST', '/api/payout-cart/submit', { year: Y, month: s.m });
      await call('POST', `/api/payout-cart/items/${d2.item.id}/approve`, {}, T.dir);
      const q2 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 10000, confirm_over: true, confirm_duplicate: true });
      ok('D2 два списка → 2-я 409', q1.st === 200 && q2.st === 409, `q1=${q1.st} q2=${q2.st}`);
      await clean(s.emp, s.m);
    }
    // D3: частичные суммы (3 × 4000 при одобрении 10000)
    {
      const s = await prep({ approved: 10000, pendings: [] });
      const a = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 4000, confirm_over: true, confirm_duplicate: true });
      const b = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 4000, confirm_over: true, confirm_duplicate: true });
      const d = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 4000, confirm_over: true, confirm_duplicate: true });
      const tot = await totalPaid(s.emp, s.m);
      ok('D3 частичные: 3-я → 409, итого ≤ 10000', a.st === 200 && b.st === 200 && d.st === 409 && tot <= 10000,
        `${a.st}/${b.st}/${d.st} итого ${tot}`);
      await clean(s.emp, s.m);
    }
    // D4: разные типы выплат
    {
      const s = await prep({ approved: 10000, pendings: [] });
      const a = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 6000, confirm_over: true, confirm_duplicate: true });
      const b = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'salary', pay_amount: 6000, confirm_over: true, confirm_duplicate: true });
      ok('D4 разные типы (advance+salary) → 2-я 409', a.st === 200 && b.st === 409, `a=${a.st} b=${b.st}`);
      await clean(s.emp, s.m);
    }
  }

  console.log('\n═══ E. ПРАВА: BUH / PM не должны обходить ═══');
  {
    for (const [role, token] of [['BUH', T.buh], ['PM', T.pm]]) {
      const s = await prep({ approved: 1, pendings: [50000] });
      const w = (await c.query(`SELECT id FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3 AND status='pending' ORDER BY id DESC LIMIT 1`, [s.emp, Y, s.m])).rows[0];
      const r1 = await call('PUT', `/worker-payments/${w.id}/pay`, { payment_method: 'cash' }, token);
      const r2 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind: 'advance', pay_amount: 50000, confirm_over: true, confirm_duplicate: true }, token);
      ok(`E ${role}: обе ручки → отказ`, (r1.st === 409 || r1.st === 403) && (r2.st === 409 || r2.st === 403), `${r1.st}/${r2.st}`);
      await clean(s.emp, s.m);
    }
  }

  console.log('\n═══ F. ЕДИНОЕ ПРАВИЛО БЕЗ СПИСКА (решение заказчика 16.10.2026) ═══');
  {
    // Без списка: суточные — можно; зарплата/аванс/премия — нельзя;
    // прямой платёж директора — полномочие (можно).
    const empF = emps[(empi + 5) % emps.length];
    const mF = 4;
    await clean(empF, mF);
    // начисление есть, списка НЕТ
    await c.query(`INSERT INTO worker_payments (employee_id, work_id, type, amount, status, payment_method, pay_year, pay_month, created_at)
      VALUES ($1,$2,'salary',50000,'pending','cash',$3,$4,NOW())`, [empF, works[0], Y, mF]);
    const sal = await call('POST', '/api/worker-payments/pay-worker', { employee_id: empF, work_id: works[0], type: 'salary', amount: 50000, payment_method: 'cash', pay_year: Y, pay_month: mF, confirm_duplicate: true });
    ok('зарплата без списка (начисление есть) → 409', sal.st === 409 && sal.d.error === 'approval_required', `HTTP ${sal.st} ${sal.d.error || ''}`);
    const pd = await call('POST', '/api/worker-payments/pay-worker', { employee_id: empF, work_id: works[0], type: 'per_diem', amount: 3000, payment_method: 'cash', pay_year: Y, pay_month: mF });
    ok('суточные без списка → 200 (полевой поток жив)', pd.st === 200, `HTTP ${pd.st} ${pd.d.error || ''}`);
    await clean(empF, mF);

    // полномочие директора: свой период, без списка
    const mD = 5;
    await clean(empF, mD);
    const dir = await call('POST', '/api/director-payments', { employee_id: empF, work_id: works[0], type: 'bonus', amount: 40000, payment_method: 'cash', pay_year: Y, pay_month: mD, confirm_duplicate: true }, T.dir);
    ok('director-payments без списка → 200 (полномочие)', dir.st === 200, `HTTP ${dir.st} ${dir.d.error || ''}`);
    await clean(empF, mD);
  }

  console.log('\n═══ G. СБОЙ ПРОВЕРКИ (fail-closed для денег, 16.10.2026) ═══');
  {
    // Раньше при сбое БД гейт возвращал null = «разрешить» → молча открывал
    // ВСЕ выплаты (fail-open). Теперь денежные типы блокируются, суточные —
    // пропускаются (полевая выдача не встаёт). Проверяем юнит-уровнем на
    // «сломанном» db — живой сбой БД воспроизвести нельзя.
    const M = require('../src/lib/payout-approval-gate.js');
    const broken = { query: async () => { throw new Error('db down'); } };
    const brokenBatch = { query: async (sql) => { if (/payout_batch_items/.test(sql)) throw new Error('missing'); return { rows: [] }; } };
    for (const [label, db] of [['сбой БД', broken], ['нет таблицы списков', brokenBatch]]) {
      const sal = await M.checkPayoutApproved(db, { employeeId: 1, year: 2051, month: 1, amount: 1000, type: 'salary' });
      ok(`${label}: зарплата → блок, а не пропуск`, sal && sal.code >= 400, JSON.stringify(sal));
      const bon = await M.checkPayoutApproved(db, { employeeId: 1, year: 2051, month: 1, amount: 1000, type: 'bonus' });
      ok(`${label}: премия → блок`, bon && bon.code >= 400, JSON.stringify(bon));
      const pd = await M.checkPayoutApproved(db, { employeeId: 1, year: 2051, month: 1, amount: 1000, type: 'per_diem' });
      ok(`${label}: суточные → пропуск (поле живёт)`, pd === null, JSON.stringify(pd));
    }
    let threw = false;
    try { await M.findAmountBlockedEmployees(broken, { employeeIds: [1], year: 2051, month: 1, type: 'salary' }); } catch (_) { threw = true; }
    ok('массовая: зарплата при сбое → бросает (не платит)', threw);
    let okPd = true;
    try { await M.findAmountBlockedEmployees(broken, { employeeIds: [1], year: 2051, month: 1, type: 'per_diem' }); } catch (_) { okPd = false; }
    ok('массовая: суточные при сбое → не бросает', okPd);
  }

  await c.end();
  console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
  if (fails.length) { console.log('ПРОВАЛЫ:'); fails.forEach((f) => console.log('  - ' + f)); }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
