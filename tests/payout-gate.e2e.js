/**
 * Проверка ЕДИНОГО гейта согласования выплат (V391).
 * Проверяет: сверку суммы во всех 7 ручках + 9-й обход mark_paid.
 * Каждый сценарий изолирован: свой период, свои данные, полная уборка.
 */
const { Pool } = require('pg');
const BASE = 'http://127.0.0.1:3100';
let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) { if (c) { pass++; console.log('  ✅ ' + n + (e ? ' — ' + e : '')); } else { fail++; fails.push(n); console.log('  ❌ ' + n + (e ? ' — ' + e : '')); } }

(async () => {
  for (let i = 0; i < 20; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (_) {} await new Promise((r) => setTimeout(r, 5000)); }
  const c = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  const login = async (l, p) => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
    const d = await r.json(); let t = d.token;
    // PIN обязателен: без него защищённые ручки (в т.ч. cash) отдают 403
    // «Требуется подтверждение PIN» — тест не дойдёт до гейта.
    if (d.status === 'need_pin') {
      const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin: '0000' }) });
      const d2 = await r2.json(); if (d2.token) t = d2.token;
    }
    return t;
  };
  const tok = await login('test_admin', 'Test123!');
  // ⚠️ V392 (SoD): директор нужен отдельно — нельзя одобрять список, который
  // создал сам (иначе само-согласование). В тестах создаём под test_admin,
  // одобряем под test_director_comm.
  const tokOv = await login('test_director_comm', 'Test123!');
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
  // ⚠️ Путь ОБЯЗАН начинаться с /api — иначе сервер отдаёт SPA-fallback (200 + HTML),
  // и тест «проходит», ничего не проверяя (класс ложного зелёного).
  const call = async (m, u, b, token) => {
    const url = u.startsWith('/api') ? u : '/api' + u;
    const r = await fetch(BASE + url, {
      method: m,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || tok) },
      body: b ? JSON.stringify(b) : undefined,
    });
    return { st: r.status, d: await r.json().catch(() => ({})) };
  };

  const workId = (await c.query(`SELECT id FROM works ORDER BY id LIMIT 1`)).rows[0].id;
  const emps = (await c.query(`SELECT id FROM employees WHERE is_active=true ORDER BY id LIMIT 8`)).rows.map((r) => r.id);
  let empIdx = 0;

  /**
   * Готовит изолированный сценарий: сотрудник + период + pending-запись 50 000 ₽
   * + одобренная позиция списка на 1 ₽. Возвращает {emp, y, m, wpId}.
   */
  async function setup() {
    const emp = emps[empIdx++ % emps.length];
    const y2 = 2040 + Math.floor(empIdx / 4);
    const m = ((empIdx * 3) % 12) + 1;
    await c.query(`DELETE FROM payout_batch_items WHERE batch_id IN (SELECT id FROM payout_batches WHERE period_year=$1 AND period_month=$2)`, [y2, m]);
    await c.query(`DELETE FROM payout_batches WHERE period_year=$1 AND period_month=$2`, [y2, m]);
    await c.query(`DELETE FROM worker_payments WHERE pay_year=$1 AND pay_month=$2 AND employee_id=$3`, [y2, m, emp]);
    // pending 50 000 ₽
    await c.query(`INSERT INTO worker_payments (employee_id, work_id, type, amount, status, payment_method, pay_year, pay_month, created_at)
      VALUES ($1,$2,'salary',50000,'pending','cash',$3,$4,NOW())`, [emp, workId, y2, m]);
    // список на 1 ₽ + одобрение ДИРЕКТОРОМ (SoD: нельзя одобрять своё)
    const dj = (await call('POST', '/api/payout-cart/draft', { employee_id: emp, year: y2, month: m, kind: 'advance', pay_amount: 1 })).d;
    await call('POST', '/api/payout-cart/submit', { year: y2, month: m });
    await call('POST', `/api/payout-cart/items/${dj.item.id}/approve`, {}, tokOv);
    const wpId = (await c.query(`SELECT id FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3 AND status='pending' ORDER BY id DESC LIMIT 1`, [emp, y2, m])).rows[0].id;
    // ДИАГНОСТИКА: что видит гейт для этого сценария
    const MOD = require('C:/Users/Nikita-ASGARD/ASGARD-CRM/src/lib/payout-approval-gate');
    const probe = await MOD.checkPayoutApproved(c, { employeeId: emp, year: y2, month: m, amount: 50000 });
    const pos = await c.query(`SELECT i.approval_status, i.pay_amount FROM payout_batch_items i
       JOIN payout_batches b ON b.id=i.batch_id WHERE i.employee_id=$1 AND b.period_year=$2 AND b.period_month=$3`, [emp, y2, m]);
    console.log(`    [диаг] emp=${emp} ${m}.${y2} wp=${wpId} позиция=${JSON.stringify(pos.rows)} гейт=${probe ? probe.error : 'null(ПРОПУСТИТ)'}`);
    return { emp, y: y2, m, wpId };
  }
  async function teardown(s) {
    await c.query(`DELETE FROM payout_batch_items WHERE batch_id IN (SELECT id FROM payout_batches WHERE period_year=$1 AND period_month=$2)`, [s.y, s.m]);
    await c.query(`DELETE FROM payout_batches WHERE period_year=$1 AND period_month=$2`, [s.y, s.m]);
    await c.query(`DELETE FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3`, [s.emp, s.y, s.m]);
  }

  console.log('\n=== СВЕРКА СУММЫ: одобрено 1 ₽, платим 50 000 ₽ / больше ===');

  { // PUT /worker-payments/:id/pay
    const s = await setup();
    const r = await call('PUT', `/worker-payments/${s.wpId}/pay`, { payment_method: 'cash' });
    ok('PUT /worker-payments/:id/pay → 409', r.st === 409 && r.d.error === 'amount_exceeds_approved', 'HTTP ' + r.st + ' ' + (r.d.error || ''));
    await teardown(s);
  }
  { // POST /worker-payments/pay-worker
    const s = await setup();
    const r = await call('POST', '/worker-payments/pay-worker', { employee_id: s.emp, work_id: workId, type: 'bonus', amount: 123456, pay_year: s.y, pay_month: s.m, payment_method: 'cash', confirm_duplicate: true });
    ok('POST /pay-worker → 409', r.st === 409 && r.d.error === 'amount_exceeds_approved', 'HTTP ' + r.st + ' ' + (r.d.error || ''));
    await teardown(s);
  }
  { // POST /director-payments
    const s = await setup();
    const r = await call('POST', '/director-payments', { employee_id: s.emp, work_id: workId, type: 'bonus', amount: 654321, pay_year: s.y, pay_month: s.m, payment_method: 'cash', confirm_duplicate: true });
    ok('POST /director-payments → 409', r.st === 409 && r.d.error === 'amount_exceeds_approved', 'HTTP ' + r.st + ' ' + (r.d.error || ''));
    await teardown(s);
  }
  { // cash суточные — ручка берёт ТЕКУЩИЙ месяц, значит и список должна быть на него
    const now = new Date();
    const cy = now.getFullYear(), cm = now.getMonth() + 1;
    const emp = emps[empIdx++ % emps.length];
    await c.query(`DELETE FROM payout_batch_items WHERE batch_id IN (SELECT id FROM payout_batches WHERE period_year=$1 AND period_month=$2)`, [cy, cm]);
    await c.query(`DELETE FROM payout_batches WHERE period_year=$1 AND period_month=$2`, [cy, cm]);
    const dj = (await call('POST', '/api/payout-cart/draft', { employee_id: emp, year: cy, month: cm, kind: 'advance', pay_amount: 1 })).d;
    await call('POST', '/api/payout-cart/submit', { year: cy, month: cm });
    await call('POST', `/api/payout-cart/items/${dj.item.id}/approve`, {});
    const r = await call('POST', '/cash/quick-expense', { employee_id: emp, work_id: workId, amount: 445566, expense_type: 'per_diem' });
    ok('POST /cash/quick-expense → 409', r.st === 409 && r.d.error === 'amount_exceeds_approved', 'HTTP ' + r.st + ' ' + (r.d.error || ''));
    await c.query(`DELETE FROM payout_batch_items WHERE batch_id IN (SELECT id FROM payout_batches WHERE period_year=$1 AND period_month=$2)`, [cy, cm]);
    await c.query(`DELETE FROM payout_batches WHERE period_year=$1 AND period_month=$2`, [cy, cm]);
  }
  { // 9-й обход: POST /worker-payments с mark_paid
    const s = await setup();
    const before = (await c.query(`SELECT count(*)::int n FROM worker_payments WHERE employee_id=$1 AND amount=22222`, [s.emp])).rows[0].n;
    const r = await call('POST', '/worker-payments', { employee_id: s.emp, type: 'bonus', amount: 22222, pay_year: s.y, pay_month: s.m, payment_method: 'cash', mark_paid: true });
    const after = (await c.query(`SELECT count(*)::int n FROM worker_payments WHERE employee_id=$1 AND amount=22222`, [s.emp])).rows[0].n;
    ok('POST /worker-payments mark_paid → 409', r.st === 409, 'HTTP ' + r.st + ' ' + (r.d.error || ''));
    ok('запись НЕ создана', after === before, `было ${before} → стало ${after}`);
    await teardown(s);
  }

  console.log('\n=== GENERIC CRUD: запись в worker_payments ЗАКРЫТА ===');
  {
    // История: 5 волн обходов через /api/data/worker_payments (status, amount,
    // период, сотрудник, тип). Решение — закрыть ЗАПИСЬ целиком (фронт сюда не
    // пишет, выплаты идут через профильные ручки). Чтение остаётся открытым.
    const wp = await setup();
    const r1 = await call('POST', '/api/data/worker_payments', {
      employee_id: wp.emp, work_id: workId, type: 'bonus', amount: 999999,
      status: 'paid', pay_year: wp.y, pay_month: wp.m, payment_method: 'cash',
    });
    ok('POST /api/data/worker_payments → 409 (запись закрыта)',
      r1.st === 409 && r1.d.error === 'payout_requires_approval', 'HTTP ' + r1.st + ' ' + (r1.d.error || ''));

    const r2 = await call('PUT', `/api/data/worker_payments/${wp.wpId}`, { status: 'paid' });
    ok('PUT {status:paid} → 409', r2.st === 409, 'HTTP ' + r2.st);

    // сдвиг идентичности (период / сотрудник / тип) — тоже закрыт
    const per0 = (await c.query(`SELECT pay_year, pay_month, employee_id, type, amount FROM worker_payments WHERE id=$1`, [wp.wpId])).rows[0];
    await call('PUT', `/api/data/worker_payments/${wp.wpId}`, { pay_year: 2099, pay_month: 12 });
    await call('PUT', `/api/data/worker_payments/${wp.wpId}`, { employee_id: (wp.emp === 1 ? 2 : 1) });
    await call('PUT', `/api/data/worker_payments/${wp.wpId}`, { type: 'bonus' });
    await call('PUT', `/api/data/worker_payments/${wp.wpId}`, { amount: 888888 });
    const per1 = (await c.query(`SELECT pay_year, pay_month, employee_id, type, amount FROM worker_payments WHERE id=$1`, [wp.wpId])).rows[0];
    ok('период/сотрудник/тип/сумма через generic CRUD не меняются',
      Number(per1.pay_year) === Number(per0.pay_year) && Number(per1.pay_month) === Number(per0.pay_month)
      && Number(per1.employee_id) === Number(per0.employee_id) && per1.type === per0.type
      && Number(per1.amount) === Number(per0.amount),
      `${per0.pay_month}.${per0.pay_year}/${per0.employee_id}/${per0.type}/${per0.amount} → ${per1.pay_month}.${per1.pay_year}/${per1.employee_id}/${per1.type}/${per1.amount}`);

    // АТАКА ЦЕЛИКОМ: после попытки сдвига выплата всё ещё под гейтом
    const payTry = await call('PUT', `/api/worker-payments/${wp.wpId}/pay`, { payment_method: 'cash' });
    const stNow = (await c.query(`SELECT status FROM worker_payments WHERE id=$1`, [wp.wpId])).rows[0].status;
    ok('после попытки обхода выплата под гейтом', payTry.st === 409 && stNow !== 'paid', `HTTP ${payTry.st} status=${stNow}`);

    // ЧТЕНИЕ не сломано
    const rg = await call('GET', '/api/data/worker_payments?limit=1');
    const rows = Array.isArray(rg.d) ? rg.d : ((rg.d && (rg.d.worker_payments || rg.d.items || rg.d.rows)) || null);
    ok('чтение /api/data/worker_payments работает', rg.st === 200 && Array.isArray(rows), `HTTP ${rg.st}`);

    await teardown(wp);
  }

  console.log('\n=== НАКОПИТЕЛЬНОЕ ПРЕВЫШЕНИЕ: 30k + 30k при одобрении 50k ===');
  {
    // Дыра (найдена верификатором 16.10.2026): каждая выплата «в пределах
    // одобренного», а суммарно больше. Гейт должен считать НАКОПЛЕННОЕ.
    const s = await setup();
    // одобрим на 50 000 ₽
    await c.query(`UPDATE payout_batch_items SET pay_amount=50000 WHERE id=(SELECT i.id FROM payout_batch_items i JOIN payout_batches b ON b.id=i.batch_id WHERE i.employee_id=$1 AND b.period_year=$2 AND b.period_month=$3 ORDER BY i.id DESC LIMIT 1)`, [s.emp, s.y, s.m]);
    const p1 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: s.y, month: s.m, kind: 'advance', pay_amount: 30000, confirm_over: true, confirm_duplicate: true });
    const p2 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: s.y, month: s.m, kind: 'advance', pay_amount: 30000, confirm_over: true, confirm_duplicate: true });
    ok('1-я выплата 30 000 (в пределах 50 000) → 200', p1.st === 200, 'HTTP ' + p1.st);
    ok('2-я выплата 30 000 (итого 60 000 > 50 000) → 409',
      p2.st === 409 && p2.d.error === 'amount_exceeds_approved',
      `HTTP ${p2.st} ${p2.d.error || ''} already=${p2.d.already_paid}`);
    const tot = (await c.query(`SELECT COALESCE(SUM(amount),0)::numeric AS s FROM worker_payments
       WHERE employee_id=$1 AND status IN ('paid','confirmed')
         AND COALESCE(pay_year,EXTRACT(YEAR FROM created_at)::int)=$2
         AND COALESCE(pay_month,EXTRACT(MONTH FROM created_at)::int)=$3`, [s.emp, s.y, s.m])).rows[0].s;
    ok('итого выплачено ≤ одобренного', Number(tot) <= 50000, `итого ${tot} ≤ 50000`);
    await c.query(`DELETE FROM payout_confirmation_codes WHERE payment_id IN (SELECT id FROM worker_payments WHERE employee_id=$1 AND pay_year=$2)`, [s.emp, s.y]);
    await teardown(s);
  }

  console.log('\n=== СДВИГ ПЕРИОДА: выплата за период БЕЗ согласованного списка ===');
  {
    // Дыра (найдена 16.10.2026): одобрили список за период A, выплатили; потом
    // платим «за период B» (списка нет) — гейт пропускал, накопление обходилось.
    const s = await setup();
    const otherM = s.m === 12 ? 1 : s.m + 1;
    const otherY = s.m === 12 ? s.y + 1 : s.y;
    const r = await call('POST', '/api/payouts/pay', {
      employee_id: s.emp, year: otherY, month: otherM, kind: 'advance',
      pay_amount: 50000, confirm_over: true, confirm_duplicate: true,
    });
    ok('выплата за период без начислений и списка → 409 no_period_data',
      r.st === 409 && (r.d.error === 'no_period_data' || r.d.error === 'approval_required'),
      `HTTP ${r.st} ${r.d.error || ''}`);
    await teardown(s);
  }

  console.log('\n=== ОТМЕНА НЕ ОБНУЛЯЕТ СЧЁТЧИК (F1/F2, 16.10.2026) ===');
  {
    const s = await setup();
    // setup() одобряет на 1 ₽ — правим на нужную сумму, иначе 1-я выплата
    // даст 409 и блок молча пропустится (замечание верификатора 16.10.2026).
    await c.query(`UPDATE payout_batch_items SET pay_amount=50000 WHERE id=(SELECT i.id FROM payout_batch_items i JOIN payout_batches b ON b.id=i.batch_id WHERE i.employee_id=$1 AND b.period_year=$2 AND b.period_month=$3 ORDER BY i.id DESC LIMIT 1)`, [s.emp, s.y, s.m]);
    const p1 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: s.y, month: s.m, kind: 'advance', pay_amount: 50000, confirm_over: true, confirm_duplicate: true });
    ok('1-я выплата 50 000 → 200', p1.st === 200, `HTTP ${p1.st} ${p1.d.error || ''}`);
    if (p1.st === 200 && p1.d.payment) {
      // отменяем выплату
      await call('POST', `/api/payouts/${p1.d.payment.id}/revert`, {});
      const st = (await c.query(`SELECT status FROM worker_payments WHERE id=$1`, [p1.d.payment.id])).rows[0];
      ok('отмена НЕ удаляет строку (мягкая отмена)', st && st.status === 'cancelled', st ? st.status : 'УДАЛЕНА');
      // новая pending и повторная выплата той же суммы
      await c.query(`INSERT INTO worker_payments (employee_id, work_id, type, amount, status, payment_method, pay_year, pay_month, created_at)
        VALUES ($1,$2,'salary',50000,'pending','cash',$3,$4,NOW())`, [s.emp, workId, s.y, s.m]);
      const p2 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: s.y, month: s.m, kind: 'advance', pay_amount: 50000, confirm_over: true, confirm_duplicate: true });
      ok('повтор той же суммы после отмены → 409', p2.st === 409 && p2.d.error === 'amount_exceeds_approved', `HTTP ${p2.st} already=${p2.d.already_paid}`);
    } else {
      ok('отмена: выплата не прошла — сценарий не проверен', false, `HTTP ${p1.st}`);
    }
    await c.query(`DELETE FROM payout_confirmation_codes WHERE payment_id IN (SELECT id FROM worker_payments WHERE employee_id=$1 AND pay_year=$2)`, [s.emp, s.y]);
    await teardown(s);
  }

  console.log('\n=== ЕДИНОЕ ПРАВИЛО БЕЗ СПИСКА + SoD (16.10.2026) ===');
  {
    const freeEmp = (await c.query(`SELECT id FROM employees WHERE is_active=true ORDER BY id DESC LIMIT 1`)).rows[0].id;
    await c.query(`DELETE FROM worker_payments WHERE employee_id=$1 AND pay_year=2085`, [freeEmp]);
    const big = await call('POST', '/api/worker-payments', { employee_id: freeEmp, work_id: workId, type: 'bonus', amount: 888888, payment_method: 'cash', mark_paid: true, pay_year: 2085, pay_month: 1 });
    ok('mark_paid премия 888 888 без списка → 409', big.st === 409 && big.d.error === 'approval_required', `HTTP ${big.st}`);
    // Порога больше нет: премия без списка запрещена в ЛЮБОЙ сумме.
    const small = await call('POST', '/api/worker-payments', { employee_id: freeEmp, work_id: workId, type: 'bonus', amount: 5000, payment_method: 'cash', mark_paid: true, pay_year: 2085, pay_month: 2 });
    ok('mark_paid премия 5 000 без списка → 409 (порога нет)', small.st === 409, `HTTP ${small.st}`);
    // Суточные без списка — разрешены (полевой поток не сломан).
    const pd = await call('POST', '/api/worker-payments', { employee_id: freeEmp, work_id: workId, type: 'per_diem', amount: 5000, payment_method: 'cash', mark_paid: true, pay_year: 2085, pay_month: 2 });
    ok('mark_paid суточные 5 000 без списка → 200', pd.st === 200, `HTTP ${pd.st}`);
    await c.query(`DELETE FROM worker_payments WHERE employee_id=$1 AND pay_year=2085`, [freeEmp]);

    // SoD: директор не одобряет свой список (ADMIN — исключение, поэтому создаём от директора)
    const tokDir = await login('test_director_comm', 'Test123!');
    const empS = (await c.query(`SELECT id FROM employees WHERE is_active=true ORDER BY id LIMIT 1 OFFSET 2`)).rows[0].id;
    await c.query(`DELETE FROM payout_batch_items WHERE batch_id IN (SELECT id FROM payout_batches WHERE period_year=2085 AND period_month=3)`);
    await c.query(`DELETE FROM payout_batches WHERE period_year=2085 AND period_month=3`);
    const dj = (await call('POST', '/api/payout-cart/draft', { employee_id: empS, year: 2085, month: 3, kind: 'advance', pay_amount: 1000 }, tokDir)).d;
    await call('POST', '/api/payout-cart/submit', { year: 2085, month: 3 }, tokDir);
    const self = await call('POST', `/api/payout-cart/items/${dj.item.id}/approve`, {}, tokDir);
    ok('само-согласование запрещено (SoD) → 409', self.st === 409 && self.d.error === 'self_approval_forbidden', `HTTP ${self.st} ${self.d.error || ''}`);
    await c.query(`DELETE FROM payout_batch_items WHERE batch_id IN (SELECT id FROM payout_batches WHERE period_year=2085 AND period_month=3)`);
    await c.query(`DELETE FROM payout_batches WHERE period_year=2085 AND period_month=3`);
  }

  console.log('\n=== СВОБОДНЫЙ ПЕРИОД: выплата без списка и начислений ===');
  {
    // Дыра (найдена верификатором 16.10.2026): ручки pay-worker /
    // director-payments / mark_paid писали paid в ЛЮБОЙ период, включая тот,
    // где согласования не было. Теперь период обязателен.
    const wp = await setup();
    const otherM = wp.m === 12 ? 1 : wp.m + 1;
    const otherY = wp.m === 12 ? wp.y + 1 : wp.y;
    // чистим «свободный» период
    await c.query(`DELETE FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3`, [wp.emp, otherY, otherM]);

    const a = await call('POST', '/worker-payments/pay-worker', {
      employee_id: wp.emp, work_id: workId, type: 'bonus', amount: 999999,
      payment_method: 'cash', pay_year: otherY, pay_month: otherM, confirm_duplicate: true,
    });
    ok('pay-worker в свободный период → 409', a.st === 409, `HTTP ${a.st} ${a.d.error || ''}`);

    // director-payments — ПОЛНОМОЧИЕ директора (серверная роль, не флаг из
    // тела): прямая выплата без списка разрешена (решение заказчика 16.10.2026).
    const b = await call('POST', '/director-payments', {
      employee_id: wp.emp, work_id: workId, type: 'bonus', amount: 90000,
      payment_method: 'cash', pay_year: otherY, pay_month: otherM, confirm_duplicate: true,
    });
    ok('director-payments → 200 (полномочие директора)', b.st === 200, `HTTP ${b.st} ${b.d.error || ''}`);

    await teardown(wp);
  }

  console.log('\n=== pay-worker СОХРАНЯЕТ период (накопление видит) ===');
  {
    const wp = await setup();
    // начисление за период, чтобы он был платёжным
    await c.query(`INSERT INTO worker_payments (employee_id, work_id, type, amount, status, payment_method, pay_year, pay_month, created_at)
      VALUES ($1,$2,'salary',50000,'pending','cash',$3,$4,NOW())`, [wp.emp, workId, wp.y, wp.m]);
    // список уже одобрен на 1 ₽ (setup). Нужна одобренная сумма ≥ 50 000 —
    // правим напрямую (это тест гейта периметра, не UI-потока).
    await c.query(`UPDATE payout_batch_items SET pay_amount=50000 WHERE id=(SELECT i.id FROM payout_batch_items i JOIN payout_batches b ON b.id=i.batch_id WHERE i.employee_id=$1 AND b.period_year=$2 AND b.period_month=$3 ORDER BY i.id DESC LIMIT 1)`, [wp.emp, wp.y, wp.m]);
    const pw = await call('POST', '/worker-payments/pay-worker', {
      employee_id: wp.emp, work_id: workId, type: 'salary', amount: 50000,
      payment_method: 'cash', pay_year: wp.y, pay_month: wp.m, confirm_duplicate: true,
    });
    ok('выплата в согласованный период → 200', pw.st === 200, `HTTP ${pw.st} ${pw.d.error || ''}`);
    const row = await c.query(`SELECT pay_year, pay_month FROM worker_payments
       WHERE employee_id=$1 AND type='salary' AND status='paid' AND amount=50000 ORDER BY id DESC LIMIT 1`, [wp.emp]);
    ok('период сохранён в БД (иначе накопление слепо)',
      row.rows[0] && Number(row.rows[0].pay_year) === wp.y && Number(row.rows[0].pay_month) === wp.m,
      row.rows[0] ? `${row.rows[0].pay_month}.${row.rows[0].pay_year}` : 'нет');
    const pw2 = await call('POST', '/worker-payments/pay-worker', {
      employee_id: wp.emp, work_id: workId, type: 'salary', amount: 30000,
      payment_method: 'cash', pay_year: wp.y, pay_month: wp.m, confirm_duplicate: true,
    });
    ok('вторая выплата сверх одобренного → 409', pw2.st === 409, `HTTP ${pw2.st} ${pw2.d.error || ''} already=${pw2.d.already_paid}`);
    await teardown(wp);
  }

  console.log('\n=== НЕТ РУБЛЁВОГО ПОРОГА: премия/аванс без списка запрещены в ЛЮБОЙ сумме ===');
  {
    // Единое правило (решение заказчика 16.10.2026): без согласованного списка
    // можно только суточные. Раньше был порог 15 000 ₽/мес для быстрой формы
    // РП — он позволял дробить премии и авансы мимо согласования.
    const emp = emps[6];
    const yL = 2084;
    await c.query(`DELETE FROM worker_payments WHERE employee_id=$1 AND pay_year=$2`, [emp, yL]);
    await c.query(`DELETE FROM payout_batch_items WHERE batch_id IN (SELECT id FROM payout_batches WHERE period_year=$1 AND period_month=1)`, [yL]);
    await c.query(`DELETE FROM payout_batches WHERE period_year=$1 AND period_month=1`, [yL]);
    const q = (amount) => call('POST', '/worker-payments', { employee_id: emp, work_id: workId, type: 'bonus', amount, payment_method: 'cash', mark_paid: true, pay_year: yL, pay_month: 1 });
    const r1 = await q(6000);
    const r2 = await q(1);
    ok('mark_paid премия 6 000 без списка → 409', r1.st === 409 && r1.d.error === 'approval_required', `HTTP ${r1.st} ${r1.d.error || ''}`);
    ok('mark_paid премия 1 ₽ без списка → 409 (порога нет)', r2.st === 409, `HTTP ${r2.st} ${r2.d.error || ''}`);
    const tot = (await c.query(`SELECT COALESCE(SUM(amount),0)::numeric AS s FROM worker_payments
       WHERE employee_id=$1 AND pay_year=$2 AND status='paid'`, [emp, yL])).rows[0].s;
    ok('ничего не проведено', Number(tot) === 0, `итого ${tot}`);
    // Суточные без списка — РАЗРЕШЕНЫ (не сломали полевой поток)
    const pd = await call('POST', '/worker-payments', { employee_id: emp, work_id: workId, type: 'per_diem', amount: 6000, payment_method: 'cash', mark_paid: true, pay_year: yL, pay_month: 2 });
    ok('mark_paid суточные 6 000 без списка → 200', pd.st === 200, `HTTP ${pd.st} ${pd.d.error || ''}`);
    await c.query(`DELETE FROM worker_payments WHERE employee_id=$1 AND pay_year=$2`, [emp, yL]);
  }

  console.log('\n=== ОДОБРЕНО 0 ₽ + МАССОВАЯ pay-salary (одиночный гейт ловил, массовый — нет) ===');
  {
    // Дыра (16.10.2026): `findAmountBlockedEmployees` имел `approved > 0`, поэтому
    // при одобрении 0 ₽ массовая pay-salary платила любую сумму. Одиночный гейт
    // к тому моменту был уже исправлен на `>= 0` — массовый забыли.
    const wp = await setup();
    await c.query(`UPDATE payout_batch_items SET pay_amount=0 WHERE id=(SELECT i.id FROM payout_batch_items i JOIN payout_batches b ON b.id=i.batch_id WHERE i.employee_id=$1 AND b.period_year=$2 AND b.period_month=$3 ORDER BY i.id DESC LIMIT 1)`, [wp.emp, wp.y, wp.m]);
    await c.query(`INSERT INTO worker_payments (employee_id, work_id, type, amount, status, payment_method, pay_year, pay_month, created_at)
      VALUES ($1,$2,'salary',70000,'pending','cash',$3,$4,NOW())`, [wp.emp, workId, wp.y, wp.m]);
    const mass = await call('POST', `/worker-payments/pay-salary/${wp.y}/${wp.m}`, { confirm_duplicate: true });
    const st = (await c.query(`SELECT status FROM worker_payments WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3 ORDER BY id DESC LIMIT 1`, [wp.emp, wp.y, wp.m])).rows[0];
    ok('массовая при approved=0 → не проводит', mass.st === 409 || (st && st.status !== 'paid'),
      `HTTP ${mass.st} updated=${mass.d.updated} статус=${st ? st.status : '-'}`);
    await teardown(wp);
  }

  console.log('\n=== КЛАССЫ: два объекта / два списка / сброс статуса ===');
  {
    // Классы, найденные при собственной проверке (16.10.2026): накопление не
    // должно обходиться ни через несколько work_id, ни через второй список,
    // ни через сброс статуса.

    // (1) два разных объекта — накопление всё равно по (сотрудник, период)
    {
      const s = await setup();
      await c.query(`UPDATE payout_batch_items SET pay_amount=10000 WHERE id=(SELECT i.id FROM payout_batch_items i JOIN payout_batches b ON b.id=i.batch_id WHERE i.employee_id=$1 AND b.period_year=$2 AND b.period_month=$3 ORDER BY i.id DESC LIMIT 1)`, [s.emp, s.y, s.m]);
      for (const w of (await c.query(`SELECT id FROM works ORDER BY id LIMIT 2`)).rows) {
        await c.query(`INSERT INTO worker_payments (employee_id, work_id, type, amount, status, payment_method, pay_year, pay_month, created_at)
          VALUES ($1,$2,'salary',7000,'pending','cash',$3,$4,NOW())`, [s.emp, w.id, s.y, s.m]);
      }
      const a = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: s.y, month: s.m, kind: 'advance', pay_amount: 7000, confirm_over: true, confirm_duplicate: true });
      const b = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: s.y, month: s.m, kind: 'advance', pay_amount: 7000, confirm_over: true, confirm_duplicate: true });
      ok('два объекта (work_id) не обходят накопление', a.st === 200 && b.st === 409, `a=${a.st} b=${b.st}`);
      await teardown(s);
    }

    // (2) второй СПИСОК на тот же период — счётчик общий
    {
      const s = await setup();
      await c.query(`UPDATE payout_batch_items SET pay_amount=10000 WHERE id=(SELECT i.id FROM payout_batch_items i JOIN payout_batches b ON b.id=i.batch_id WHERE i.employee_id=$1 AND b.period_year=$2 AND b.period_month=$3 ORDER BY i.id DESC LIMIT 1)`, [s.emp, s.y, s.m]);
      const q1 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: s.y, month: s.m, kind: 'advance', pay_amount: 10000, confirm_over: true, confirm_duplicate: true });
      const d2 = (await call('POST', '/api/payout-cart/draft', { employee_id: s.emp, year: s.y, month: s.m, kind: 'advance', pay_amount: 10000 })).d;
      await call('POST', '/api/payout-cart/submit', { year: s.y, month: s.m });
      await call('POST', `/api/payout-cart/items/${d2.item.id}/approve`, {}, tokOv);
      const q2 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: s.y, month: s.m, kind: 'advance', pay_amount: 10000, confirm_over: true, confirm_duplicate: true });
      ok('второй список на период не обходит накопление', q1.st === 200 && q2.st === 409, `q1=${q1.st} q2=${q2.st}`);
      await teardown(s);
    }

    // (3) сброс статуса paid→pending через generic CRUD
    {
      const s = await setup();
      await c.query(`UPDATE payout_batch_items SET pay_amount=10000 WHERE id=(SELECT i.id FROM payout_batch_items i JOIN payout_batches b ON b.id=i.batch_id WHERE i.employee_id=$1 AND b.period_year=$2 AND b.period_month=$3 ORDER BY i.id DESC LIMIT 1)`, [s.emp, s.y, s.m]);
      const r1 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: s.y, month: s.m, kind: 'advance', pay_amount: 10000, confirm_over: true, confirm_duplicate: true });
      if (r1.d.payment) {
        const back = await call('PUT', `/api/data/worker_payments/${r1.d.payment.id}`, { status: 'pending' });
        const r2 = await call('POST', '/api/payouts/pay', { employee_id: s.emp, year: s.y, month: s.m, kind: 'advance', pay_amount: 10000, confirm_over: true, confirm_duplicate: true });
        ok('сброс paid→pending через API данных заблокирован', back.st === 409, `HTTP ${back.st}`);
        ok('повтор после попытки сброса → 409', r2.st === 409, `HTTP ${r2.st}`);
      }
      await teardown(s);
    }
  }

  console.log('\n=== КОНТРОЛЬ: штатные сценарии не сломаны ===');  { // сумма = одобренной → проходит
    const s = await setup();
    // меняем списку: одобряем на нужную сумму
    await c.query(`UPDATE payout_batch_items SET pay_amount=50000 WHERE id=(SELECT i.id FROM payout_batch_items i JOIN payout_batches b ON b.id=i.batch_id WHERE i.employee_id=$1 AND b.period_year=$2 AND b.period_month=$3 ORDER BY i.id DESC LIMIT 1)`, [s.emp, s.y, s.m]);
    const r = await call('PUT', `/worker-payments/${s.wpId}/pay`, { payment_method: 'cash' });
    ok('сумма = одобренной → 200', r.st === 200, 'HTTP ' + r.st + ' ' + (r.d.error || ''));
    await teardown(s);
  }
  { // вне списка: суточные разрешены, премия — нет (единое правило)
    const free = (await c.query(`SELECT id FROM employees WHERE is_active=true ORDER BY id DESC LIMIT 1`)).rows[0].id;
    const r = await call('POST', '/worker-payments', { employee_id: free, type: 'bonus', amount: 1000, pay_year: 2025, pay_month: 3, payment_method: 'cash', mark_paid: true });
    ok('mark_paid премия вне списка → 409', r.st === 409, 'HTTP ' + r.st + ' ' + (r.d.error || ''));
    const okPd = await call('POST', '/worker-payments', { employee_id: free, type: 'per_diem', amount: 1000, pay_year: 2025, pay_month: 3, payment_method: 'cash', mark_paid: true });
    ok('mark_paid суточные вне списка → 200', okPd.st === 200, 'HTTP ' + okPd.st + ' ' + (okPd.d.error || ''));
    await c.query(`DELETE FROM worker_payments WHERE employee_id=$1 AND pay_year=2025 AND pay_month=3`, [free]);
  }

  await c.end();
  console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
  if (fails.length) { console.log('ПРОВАЛЫ:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
