/**
 * ИСЧЕРПЫВАЮЩАЯ ПРОВЕРКА — ВОЛНА 2 (F..L).
 * Дополняет tests/payout-exhaustive.e2e.js.
 *
 * ⚠️ ВАЖНО про ожидания (проверено вручную 16.10.2026):
 *   • Допуск на копейку: `approved + 0.01` — перебор на 1 копейку разрешён
 *     (осознанно: округление), на 2 копейки и больше — 409.
 *   • reject работает ТОЛЬКО по позиции в статусе `pending`; по `approved` — 404.
 *   • carry-adjustment принимает `new_amount` (новый остаток), НЕ `amount`.
 *   • SoD проверяет `payout_batches.created_by` — чтобы проверить, список
 *     должен быть СОЗДАН директором.
 *   • DELETE /items/:id удаляет только позиции списка в статусе `draft`.
 */
const { Pool } = require('pg');
const BASE = 'http://127.0.0.1:3100';
let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) { if (c) { pass++; console.log('  ✅ ' + n + (e ? ' — ' + e : '')); } else { fail++; fails.push(n); console.log('  ❌ ' + n + ' — ' + (e || '')); } }

const Y = 2041;

(async () => {
  const c = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  const login = async (l, p) => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
    const d = await r.json(); let t = d.token;
    if (d.status === 'need_pin') { const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin: '0000' }) }); const d2 = await r2.json(); if (d2.token) t = d2.token; }
    return t;
  };
  const admin = await login('test_admin', 'Test123!');
  const dir = await login('test_director_comm', 'Test123!');
  const dirs = { test_director_comm: dir };
  for (const l of ['test_director_gen', 'test_director_dev']) { const t = await login(l, 'Test123!'); if (t) dirs[l] = t; }
  const call = async (m, u, b, token) => {
    const url = u.startsWith('/api') ? u : '/api' + u;
    const r = await fetch(BASE + url, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || admin) }, body: b ? JSON.stringify(b) : undefined });
    return { st: r.status, d: await r.json().catch(() => ({})) };
  };
  const works = (await c.query(`SELECT id FROM works ORDER BY id LIMIT 2`)).rows.map((r) => r.id);
  const emps = (await c.query(`SELECT id FROM employees WHERE is_active=true ORDER BY id LIMIT 8`)).rows.map((r) => r.id);
  let empi = 0, mi = 0;

  const clean = async (emp, m) => {
    await c.query(`DELETE FROM payout_confirmation_codes WHERE payment_id IN (SELECT id FROM worker_payments WHERE employee_id=$1 AND pay_year=$2)`, [emp, Y]);
    await c.query(`DELETE FROM payout_batch_items WHERE batch_id IN (SELECT id FROM payout_batches WHERE period_year=$1 AND period_month=$2)`, [Y, m]);
    await c.query(`DELETE FROM payout_batches WHERE period_year=$1 AND period_month=$2`, [Y, m]);
    await c.query(`DELETE FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3`, [emp, Y, m]);
  };
  async function prep({ approved, submit = true, approve = true, creator = admin }) {
    const emp = emps[empi++ % emps.length];
    const m = (mi++ % 12) + 1;
    await clean(emp, m);
    const dj = (await call('POST', '/api/payout-cart/draft', { employee_id: emp, year: Y, month: m, kind: 'advance', pay_amount: approved }, creator));
    if (submit) await call('POST', '/api/payout-cart/submit', { year: Y, month: m }, creator);
    if (approve) await call('POST', `/api/payout-cart/items/${dj.d.item.id}/approve`, {}, dir);
    return { emp, m, itemId: dj.d.item.id, batchId: dj.d.batch_id };
  }
  const pay = (s, amount, kind = 'advance', token) => call('POST', '/api/payouts/pay', { employee_id: s.emp, year: Y, month: s.m, kind, pay_amount: amount, confirm_over: true, confirm_duplicate: true }, token);

  console.log('\n═══ F. ГРАНИЦЫ СУММ (допуск ровно 1 копейка) ═══');
  {
    // F1: одобрено 10000 → 10000.01 разрешено (допуск), 10000.02 → 409
    {
      const s = await prep({ approved: 10000 });
      const r1 = await pay(s, 10000.01);
      await c.query(`DELETE FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3`, [s.emp, Y, s.m]);
      const r2 = await pay(s, 10000.02);
      ok('F1 10000.01 → допуск ok, 10000.02 → 409', r1.st === 200 && r2.st === 409, `+0.01=${r1.st} +0.02=${r2.st}`);
      await clean(s.emp, s.m);
    }
    // F2: ровно одобренное → 200
    {
      const s = await prep({ approved: 10000 });
      const r = await pay(s, 10000);
      ok('F2 ровно одобренное → 200', r.st === 200, `HTTP ${r.st}`);
      await clean(s.emp, s.m);
    }
    // F3: отрицательная/нулевая сумма → отказ
    {
      const s = await prep({ approved: 10000 });
      const r1 = await pay(s, -5000);
      const r2 = await pay(s, 0);
      ok('F3 отрицательная и нулевая сумма → отказ', r1.st >= 400 && r2.st >= 400, `${r1.st}/${r2.st}`);
      await clean(s.emp, s.m);
    }
    // F4: перебор на 2 копейки при одобренном 0.01 → 409 (граница допуска = +0.01)
    {
      const s = await prep({ approved: 0.01 });
      const r = await pay(s, 0.03);
      ok('F4 одобрено 0.01, платим 0.03 → 409', r.st === 409, `HTTP ${r.st}`);
      await clean(s.emp, s.m);
    }
    // F5: 12×100 при лимите 1000 не превышает
    {
      const s = await prep({ approved: 1000 });
      for (let i = 0; i < 12; i++) await pay(s, 100);
      const tot = Number((await c.query(`SELECT COALESCE(SUM(amount),0)::numeric s FROM worker_payments WHERE employee_id=$1 AND status IN ('paid','confirmed','cancelled') AND pay_year=$2 AND pay_month=$3`, [s.emp, Y, s.m])).rows[0].s);
      ok('F5 12×100 при лимите 1000 → итого ≤ 1000', tot <= 1000, `итого ${tot}`);
      await clean(s.emp, s.m);
    }
  }

  console.log('\n═══ G. РЕШЕНИЯ ПО СПИСКУ (reject/reapprove/черновик/чужой) ═══');
  {
    // G1: reject по PENDING → платить нельзя
    {
      const emp = emps[empi++ % emps.length]; const m = (mi++ % 12) + 1;
      await clean(emp, m);
      const dj = (await call('POST', '/api/payout-cart/draft', { employee_id: emp, year: Y, month: m, kind: 'advance', pay_amount: 10000 })).d;
      await call('POST', '/api/payout-cart/submit', { year: Y, month: m });
      const rej = await call('POST', `/api/payout-cart/items/${dj.item.id}/reject`, { reason: 'тест' }, dir);
      const r = await pay({ emp, m }, 5000);
      ok('G1 reject pending → платить нельзя', rej.st === 200 && r.st === 409, `reject=${rej.st} pay=${r.st} ${r.d.error || ''}`);
      await clean(emp, m);
    }
    // G2: reapprove снимает одобрение → платить нельзя до нового решения
    {
      const s = await prep({ approved: 10000 });
      const ra = await call('POST', `/api/payout-cart/reapprove/${s.emp}`, { year: Y, month: s.m });
      const r = await pay(s, 5000);
      ok('G2 reapprove снимает одобрение → 409', ra.st === 200 && r.st === 409, `reapprove=${ra.st} pay=${r.st} ${r.d.error || ''}`);
      await clean(s.emp, s.m);
    }
    // G3: черновик (не отправлен) → платить нельзя
    {
      const s = await prep({ approved: 10000, submit: false, approve: false });
      const r = await pay(s, 5000);
      ok('G3 черновик → 409', r.st === 409, `HTTP ${r.st} ${r.d.error || ''}`);
      await clean(s.emp, s.m);
    }
    // G4: сотрудник вне списка → 409
    {
      const s = await prep({ approved: 10000 });
      const other = emps[(empi + 3) % emps.length];
      await clean(other, s.m);
      const r = await call('POST', '/api/payouts/pay', { employee_id: other, year: Y, month: s.m, kind: 'advance', pay_amount: 5000, confirm_over: true, confirm_duplicate: true });
      ok('G4 сотрудник вне списка → 409', r.st === 409, `HTTP ${r.st} ${r.d.error || ''}`);
      await clean(s.emp, s.m); await clean(other, s.m);
    }
  }

  console.log('\n═══ H. ПОДМЕНА ПОЗИЦИИ СПИСКА ═══');
  {
    for (const [label, body] of [['сотрудник', { employee_id: emps[7] }], ['сумма вверх', { pay_amount: 999999 }], ['статус', { approval_status: 'pending' }], ['период', { period_year: 2099 }]]) {
      const s = await prep({ approved: 10000 });
      const before = (await c.query(`SELECT employee_id, pay_amount, approval_status FROM payout_batch_items WHERE id=$1`, [s.itemId])).rows[0];
      const r = await call('PUT', `/api/data/payout_batch_items/${s.itemId}`, body);
      const after = (await c.query(`SELECT employee_id, pay_amount, approval_status FROM payout_batch_items WHERE id=$1`, [s.itemId])).rows[0];
      ok(`H подмена «${label}» заблокирована`, r.st === 400 || r.st === 409 || JSON.stringify(before) === JSON.stringify(after),
        `HTTP ${r.st} ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      await clean(s.emp, s.m);
    }
    // H5: удаление одобренной позиции → 409 (только draft удаляется)
    {
      const s = await prep({ approved: 10000 });
      const r = await call('DELETE', `/api/payout-cart/items/${s.itemId}`);
      const still = (await c.query(`SELECT COUNT(*)::int n FROM payout_batch_items WHERE id=$1`, [s.itemId])).rows[0].n;
      ok('H5 удаление одобренной позиции → 409, строка на месте', r.st === 409 && still === 1, `HTTP ${r.st} осталось=${still}`);
      await clean(s.emp, s.m);
    }
    // H6: удаление позиции ЧЕРНОВИКА разрешено (иначе UI сломан)
    {
      const emp = emps[empi++ % emps.length]; const m = (mi++ % 12) + 1;
      await clean(emp, m);
      const dj = (await call('POST', '/api/payout-cart/draft', { employee_id: emp, year: Y, month: m, kind: 'advance', pay_amount: 10000 })).d;
      const r = await call('DELETE', `/api/payout-cart/items/${dj.item.id}`);
      ok('H6 удаление позиции черновика → 200 (UI работает)', r.st === 200, `HTTP ${r.st}`);
      await clean(emp, m);
    }
  }

  console.log('\n═══ I. ПЕРИОД ═══');
  {
    {
      const emp = emps[empi++ % emps.length];
      await clean(emp, 3); await clean(emp, 4);
      const dj = (await call('POST', '/api/payout-cart/draft', { employee_id: emp, year: Y, month: 3, kind: 'advance', pay_amount: 10000 })).d;
      await call('POST', '/api/payout-cart/submit', { year: Y, month: 3 });
      await call('POST', `/api/payout-cart/items/${dj.item.id}/approve`, {}, dir);
      const r = await call('POST', '/api/payouts/pay', { employee_id: emp, year: Y, month: 4, kind: 'advance', pay_amount: 5000, confirm_over: true, confirm_duplicate: true });
      ok('I1 выплата за другой месяц без списка → 409', r.st === 409, `HTTP ${r.st} ${r.d.error || ''}`);
      await clean(emp, 3); await clean(emp, 4);
    }
    {
      const emp = emps[empi++ % emps.length];
      const r = await call('POST', '/api/payouts/pay', { employee_id: emp, year: Y + 1, month: 5, kind: 'advance', pay_amount: 5000, confirm_over: true, confirm_duplicate: true });
      ok('I2 будущий год без списка → 409', r.st === 409, `HTTP ${r.st} ${r.d.error || ''}`);
      await c.query(`DELETE FROM worker_payments WHERE employee_id=$1 AND pay_year=$2`, [emp, Y + 1]);
    }
  }

  console.log('\n═══ J. КОРРЕКТИРОВКА ОСТАТКА (param: new_amount) ═══');
  {
    const emp = emps[empi++ % emps.length]; const m = (mi++ % 12) + 1;
    await clean(emp, m);
    const r1 = await call('POST', '/api/payouts/carry-adjustment', { employee_id: emp, year: Y, month: m, new_amount: -5000 });
    ok('J1 корректировка без причины → 400', r1.st === 400, `HTTP ${r1.st} ${r1.d.error || ''}`);
    const r2 = await call('POST', '/api/payouts/carry-adjustment', { employee_id: emp, year: Y, month: m, new_amount: -5000, reason: 'Перерасчёт за прошлый период' });
    ok('J2 корректировка с причиной → 200', r2.st === 200, `HTTP ${r2.st} ${r2.d.error || ''}`);
    // J3: в факте/истории причина видна
    if (r2.st === 200) {
      const wp = (await c.query(`SELECT type, amount, comment FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3 AND type='carry_adjustment' ORDER BY id DESC LIMIT 1`, [emp, Y, m])).rows[0];
      ok('J3 причина сохранена в факте', wp && /Перерасчёт/.test(wp.comment || ''), wp ? wp.comment : 'нет записи');
    }
    await clean(emp, m);
  }

  console.log('\n═══ K. КАССА (per_diem) ═══');
  {
    const emp = emps[empi++ % emps.length]; const m = (mi++ % 12) + 1;
    await clean(emp, m);
    const r = await call('POST', '/api/cash/quick-expense', { employee_id: emp, work_id: works[0], amount: 999999, expense_type: 'per_diem' });
    ok('K1 касса сверх средств → отказ', r.st >= 400, `HTTP ${r.st} ${r.d.error || ''}`);
    await clean(emp, m);
  }

  console.log('\n═══ L. РАЗДЕЛЕНИЕ ОБЯЗАННОСТЕЙ (SoD) ═══');
  {
    // Список создаёт ДИРЕКТОР → сам одобрить не может
    for (const [login_, token] of Object.entries(dirs)) {
      const emp = emps[empi++ % emps.length]; const m = (mi++ % 12) + 1;
      await clean(emp, m);
      const dj = (await call('POST', '/api/payout-cart/draft', { employee_id: emp, year: Y, month: m, kind: 'advance', pay_amount: 10000 }, token)).d;
      const createdBy = (await c.query(`SELECT created_by FROM payout_batches WHERE id=$1`, [dj.batch_id])).rows[0];
      await call('POST', '/api/payout-cart/submit', { year: Y, month: m }, token);
      const self = await call('POST', `/api/payout-cart/items/${dj.item.id}/approve`, {}, token);
      ok(`L ${login_}: сам не одобряет свой список`, self.st === 409 && self.d.error === 'self_approval_forbidden',
        `создатель=${createdBy.created_by} HTTP ${self.st} ${self.d.error || ''}`);
      await clean(emp, m);
    }
    // ADMIN — исключение
    {
      const emp = emps[empi++ % emps.length]; const m = (mi++ % 12) + 1;
      await clean(emp, m);
      const dj = (await call('POST', '/api/payout-cart/draft', { employee_id: emp, year: Y, month: m, kind: 'advance', pay_amount: 10000 }, admin)).d;
      await call('POST', '/api/payout-cart/submit', { year: Y, month: m }, admin);
      const self = await call('POST', `/api/payout-cart/items/${dj.item.id}/approve`, {}, admin);
      ok('L ADMIN: одобряет свой список (исключение)', self.st === 200, `HTTP ${self.st}`);
      await clean(emp, m);
    }
  }

  await c.end();
  console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
  if (fails.length) { console.log('ПРОВАЛЫ:'); fails.forEach((f) => console.log('  - ' + f)); }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
