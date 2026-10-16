/**
 * V391 — сводный API+E2E тест контура выплат.
 * Запуск: node tests/payout-v391.e2e.js
 * Требует: клон asgard_crm_test на :3100.
 * После прогона ВСЕ тестовые данные удаляются (проверяется в конце).
 */
const { Pool } = require('pg');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3100';
const DB = { host: '127.0.0.1', port: 5432, database: process.env.DB_NAME || 'asgard_crm_test', user: 'asgard', password: '123456789' };

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, evidence) {
  if (cond) { pass++; console.log('  ✅ ' + name + (evidence ? ' — ' + evidence : '')); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (evidence ? ' — ' + evidence : '')); }
}

(async () => {
  const c = new Pool(DB);
  const login = async (l, p) => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
    const d = await r.json(); let t = d.token;
    if (d.status === 'need_pin') {
      const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin: '0000' }) });
      const d2 = await r2.json(); if (d2.token) t = d2.token;
    }
    return t;
  };
  const call = async (t, m, u, body) => {
    const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined });
    return { st: r.status, d: await r.json().catch(() => ({})) };
  };

  const tokD = await login('test_admin', 'Test123!');
  const tokOv = await login('test_director_comm', 'Test123!');
  const tokBuh = await login('test_buh', 'Test123!');

  // Свободный период, чтобы не пересечься с реальными данными
  const Y = 2030, M = 4;
  const clean = async () => {
    await c.query(`DELETE FROM payout_batch_items WHERE batch_id IN (SELECT id FROM payout_batches WHERE period_year=$1 AND period_month=$2)`, [Y, M]);
    await c.query(`DELETE FROM payout_batches WHERE period_year=$1 AND period_month=$2`, [Y, M]);
    await c.query(`DELETE FROM payout_plan_items WHERE plan_id IN (SELECT id FROM payout_plans WHERE period_year=$1 AND period_month=$2)`, [Y, M]);
    await c.query(`DELETE FROM payout_plans WHERE period_year=$1 AND period_month=$2`, [Y, M]);
    await c.query(`DELETE FROM worker_payments WHERE pay_year=$1 AND pay_month=$2`, [Y, M]);
  };
  await clean();

  console.log('\n1. ДОСТУП');
  const accD = await call(tokD, 'GET', '/api/staff/access');
  ok('Дима видит дружину (грант)', accD.st === 200 && accD.d.allowed === true, JSON.stringify(accD.d));
  const noApprove = await call(tokBuh, 'GET', '/api/payout-cart/pending');
  ok('БУХ не может согласовывать (403)', noApprove.st === 403);

  console.log('\n2. КОРЗИНА → СОГЛАСОВАНИЕ');
  const list = await call(tokD, 'GET', `/api/payouts/list/${Y}/${M}`);
  const rows = (list.d.rows || []).filter((r) => r.to_pay > 0).slice(0, 3);
  ok('список выплат получен', rows.length === 3, 'строк: ' + rows.length);
  const seRow = rows.find((r) => r.is_self_employed);
  for (const r of rows) await call(tokD, 'POST', '/api/payout-cart/draft', { employee_id: r.employee_id, year: Y, month: M, kind: 'advance', pay_amount: Math.min(r.to_pay, 10000) });
  const sub = await call(tokD, 'POST', '/api/payout-cart/submit', { year: Y, month: M });
  ok('корзина отправлена на согласование', sub.st === 200 && sub.d.status === 'pending_approval');

  console.log('\n3. ГЕЙТ: выплата без согласования запрещена');
  const payBlocked = await call(tokD, 'POST', '/api/payouts/pay', { employee_id: rows[0].employee_id, year: Y, month: M, kind: 'advance', pay_amount: 1000, confirm_over: true, confirm_duplicate: true });
  ok('выплата без одобрения → 409', payBlocked.st === 409 && payBlocked.d.error === 'approval_required', JSON.stringify(payBlocked.d).slice(0, 90));
  // РЕГРЕСС-ЩИТ: флаг обхода НЕ должен работать (найдено верификатором 16.10.2026:
  // клиент мог снять гейт, добавив skip_approval_check в тело запроса).
  const bypassPay = await call(tokD, 'POST', '/api/payouts/pay', { employee_id: rows[0].employee_id, year: Y, month: M, kind: 'advance', pay_amount: 1000, skip_approval_check: true, confirm_over: true, confirm_duplicate: true });
  ok('флаг skip_approval_check НЕ обходит гейт', bypassPay.st === 409 && bypassPay.d.error === 'approval_required', 'HTTP ' + bypassPay.st);
  // и на ручке РП
  const wpRow = await c.query(`SELECT id FROM worker_payments
     WHERE employee_id=$1 AND status='pending'
       AND COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int)=$2
       AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int)=$3
     ORDER BY id DESC LIMIT 1`, [rows[0].employee_id, Y, M]);
  if (wpRow.rows[0]) {
    const bypassPm = await call(tokD, 'PUT', `/pm/payments/${wpRow.rows[0].id}/paid`, { skip_approval_check: true });
    ok('флаг НЕ обходит гейт на /pm/payments', bypassPm.st === 409 && bypassPm.d.error === 'approval_required', 'HTTP ' + bypassPm.st);
  }

  console.log('\n3b. ЕДИНЫЙ ГЕЙТ: все пути выплаты защищены');
  // Раньше статус paid менялся в 8 местах, и 6 из них обходили согласование
  // (найдено верификатором 16.10.2026). Теперь во всех стоит единый модуль
  // src/lib/payout-approval-gate.js. Проверяем каждый путь.
  const wpRow2 = await c.query(`SELECT id FROM worker_payments
     WHERE employee_id=$1 AND status='pending'
       AND COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int)=$2
       AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int)=$3
     ORDER BY id DESC LIMIT 1`, [rows[0].employee_id, Y, M]);
  const anyWp = wpRow2.rows[0] && wpRow2.rows[0].id;

  if (anyWp) {
    // FAIL-C: PUT /worker-payments/:id/pay
    const gC = await call(tokD, 'PUT', `/worker-payments/${anyWp}/pay`, { payment_method: 'cash' });
    ok('PUT /worker-payments/:id/pay → 409', gC.st === 409 && gC.d.error === 'approval_required', 'HTTP ' + gC.st);

    // FAIL-E: POST /worker-payments/pay-worker (нужна валидная работа)
    const wrk = await c.query(`SELECT id FROM works ORDER BY id LIMIT 1`);
    if (wrk.rows[0]) {
      const gE = await call(tokD, 'POST', '/worker-payments/pay-worker', {
        employee_id: rows[0].employee_id, work_id: wrk.rows[0].id, type: 'bonus',
        amount: 777, pay_year: Y, pay_month: M, payment_method: 'cash', confirm_duplicate: true,
      });
      ok('POST /worker-payments/pay-worker → 409', gE.st === 409 && gE.d.error === 'approval_required', 'HTTP ' + gE.st);
    }

    // FAIL-D: POST /worker-payments/pay-salary — неодобренные ИСКЛЮЧЕНЫ
    const gD = await call(tokD, 'POST', `/worker-payments/pay-salary/${Y}/${M}`, { confirm_duplicate: true });
    const skipped = Number(gD.d.skipped_unapproved || 0);
    ok('pay-salary исключает неодобренных', gD.st === 409 || skipped >= 1,
      'HTTP ' + gD.st + ' skipped=' + skipped);
  } else {
    // Явный SKIP: без pending-записи в worker_payments проверить эти пути нельзя.
    console.log('  ⏭ SKIP: нет pending worker_payment за ' + M + '.' + Y + ' — пути 3b не проверены этим тестом');
  }

  console.log('\n3c. СВЕРКА СУММЫ: одобрение 1 ₽ не открывает всю выплату');
  {
    // ⚠️ Проверку суммы делаем на ИЗОЛИРОВАННОМ сотруднике и своей списке, чтобы
    // «последняя позиция за период» была именно нашей. Берём сотрудника, у
    // которого в этом периоде больше нет позиций (или чистим их).
    const empX = rows[2] && rows[2].employee_id ? rows[2].employee_id : rows[0].employee_id;
    await c.query(`DELETE FROM payout_batch_items i USING payout_batches b
       WHERE i.batch_id = b.id AND i.employee_id = $1 AND b.period_year = $2 AND b.period_month = $3`, [empX, Y, M]);
    const d1 = await call(tokD, 'POST', '/payout-cart/draft', { employee_id: empX, year: Y, month: M, kind: 'advance', pay_amount: 1 });
    if (d1.st === 200) {
      await call(tokD, 'POST', '/payout-cart/submit', { year: Y, month: M });
      const itX = await c.query(`
        SELECT i.id FROM payout_batch_items i JOIN payout_batches b ON b.id=i.batch_id
         WHERE i.employee_id=$1 AND b.period_year=$2 AND b.period_month=$3 ORDER BY i.id DESC LIMIT 1`, [empX, Y, M]);
      if (itX.rows[0]) {
        const apr = await call(tokOv, 'POST', `/payout-cart/items/${itX.rows[0].id}/approve`);
        ok('позиция на 1 ₽ одобрена', apr.st === 200, 'HTTP ' + apr.st);
        // пробуем выплатить заведомо больше одобренного
        const overs = await call(tokD, 'POST', '/api/payouts/pay', {
          employee_id: empX, year: Y, month: M, kind: 'advance', pay_amount: 999999,
          confirm_over: true, confirm_duplicate: true,
        });
        ok('сумма > одобренной → 409 amount_exceeds_approved',
          overs.st === 409 && overs.d.error === 'amount_exceeds_approved',
          'HTTP ' + overs.st + ' ' + (overs.d.error || ''));
      } else {
        console.log('  ⏭ SKIP: позиция для сотрудника ' + empX + ' не создана — сверка суммы не проверена');
      }
    } else {
      console.log('  ⏭ SKIP: не удалось создать черновик для ' + empX + ' — сверка суммы не проверена');
    }
  }

  console.log('\n4. РЕШЕНИЯ ДИРЕКТОРА');
  const pend = await call(tokOv, 'GET', '/api/payout-cart/pending');
  // ⚠️ /pending отдаёт очередь по ВСЕМ периодам — берём позицию ИМЕННО нашего
  // тестового периода, иначе тест правит чужую списку.
  const myEmpIds = rows.map((r) => r.employee_id);
  const myItem = (pend.d.items || []).find((i) => i.period_year === Y && i.period_month === M && myEmpIds.includes(i.employee_id));
  ok('очередь директора видит нашу списку', pend.st === 200 && !!myItem, 'позиций всего: ' + pend.d.count);
  const it0 = myItem || pend.d.items[0];
  ok('карточка содержит остаток/начислено/лимит', it0.carry_debt !== undefined && it0.accrued !== undefined, JSON.stringify({ carry: it0.carry_debt, acc: it0.accrued, se_rem: it0.se_remaining }).slice(0, 110));
  const rejNoReason = await call(tokOv, 'POST', `/api/payout-cart/items/${it0.item_id}/reject`, {});
  ok('возврат без причины → 400', rejNoReason.st === 400 && rejNoReason.d.error === 'reason_required');
  await call(tokOv, 'POST', `/api/payout-cart/items/${it0.item_id}/approve`);

  console.log('\n5. ПЕРЕСОГЛАСОВАНИЕ (правка одобренного)');
  const re = await call(tokD, 'POST', '/api/payout-cart/draft', { employee_id: it0.employee_id, year: Y, month: M, kind: 'advance', pay_amount: 12345 });
  ok('правка одобренной → повторное согласование', re.st === 200 && re.d.reapproved === true, re.d.message);
  const chkRe = await c.query('SELECT approval_status, reapproved FROM payout_batch_items WHERE id=$1', [it0.item_id]);
  ok('в БД статус pending + reapproved', chkRe.rows[0].approval_status === 'pending' && chkRe.rows[0].reapproved === true, JSON.stringify(chkRe.rows[0]));
  await call(tokOv, 'POST', `/api/payout-cart/items/${it0.item_id}/approve`);

  console.log('\n6. ВЫПЛАТА ПОСЛЕ ОДОБРЕНИЯ');
  const payOk = await call(tokD, 'POST', '/api/payouts/pay', { employee_id: it0.employee_id, year: Y, month: M, kind: 'advance', pay_amount: 12345, confirm_over: true, confirm_duplicate: true });
  ok('выплата после одобрения → 200', payOk.st === 200, 'payment id=' + (payOk.d.payment && payOk.d.payment.id));
  if (payOk.d.payment) {
    const wp = await c.query('SELECT payee_employee_id FROM worker_payments WHERE id=$1', [payOk.d.payment.id]);
    ok('факт записан с payee_employee_id', wp.rows.length === 1);
    await c.query('DELETE FROM payout_confirmation_codes WHERE payment_id=$1', [payOk.d.payment.id]);
  }

  console.log('\n7. КОРРЕКТИРОВКА ОСТАТКА');
  const noReason = await call(tokD, 'POST', '/api/payouts/carry-adjustment', { employee_id: rows[0].employee_id, year: Y, month: M, new_amount: -5000 });
  ok('без причины → 400', noReason.st === 400 && noReason.d.error === 'reason_required');
  const adj = await call(tokD, 'POST', '/api/payouts/carry-adjustment', { employee_id: rows[0].employee_id, year: Y, month: M, new_amount: -5000, reason: 'E2E тест' });
  ok('с причиной → 200 и пересчёт', adj.st === 200 && adj.d.carry_after === -5000, `было ${adj.d.carry_before} → ${adj.d.carry_after}`);

  console.log('\n8. ПЛАН + ЛИМИТ НПД');
  const plan = await call(tokOv, 'GET', `/api/payout-plan/${Y}/${M}`);
  ok('план отдаёт лимит и коэффициенты', plan.st === 200 && plan.d.monthly_limit === 350000 && plan.d.calc, 'лимит ' + plan.d.monthly_limit);
  const seRows = (plan.d.rows || []).filter((r) => r.is_self_employed);
  ok('СЗ не обнулены (max>0 у большинства)', seRows.filter((r) => Number(r.max_amount) > 0).length > 0, `СЗ ${seRows.length}, с max>0 ${seRows.filter((r) => Number(r.max_amount) > 0).length}`);
  if (seRows[0]) {
    const cap = await call(tokOv, 'POST', '/api/payout-plan/save', { year: Y, month: M, items: [{ employee_id: seRows[0].employee_id, to_transfer: 99999999, pay_date: '2030-05-05' }] });
    const capped = await c.query(`SELECT to_transfer, max_amount FROM payout_plan_items i JOIN payout_plans p ON p.id=i.plan_id WHERE p.period_year=$1 AND p.period_month=$2 AND i.employee_id=$3`, [Y, M, seRows[0].employee_id]);
    ok('сумма сверх лимита обрезана', cap.st === 200 && capped.rows[0] && Number(capped.rows[0].to_transfer) <= Number(capped.rows[0].max_amount), 'capped=' + cap.d.capped);
  }
  await call(tokOv, 'POST', `/api/payout-plan/${Y}/${M}/approve`, {});
  const unappr = await call(tokOv, 'POST', `/api/payout-plan/${Y}/${M}/unapprove`, {});
  ok('снятие согласования плана → 200', unappr.st === 200 && unappr.d.unapproved >= 1, 'снято: ' + unappr.d.unapproved);

  console.log('\n9. ГРАФИК');
  const sch = await call(tokOv, 'GET', `/api/payout-plan/schedule/${Y}/${M}`);
  ok('график: все дни месяца', sch.st === 200 && (sch.d.days || []).length >= 28, 'дней: ' + (sch.d.days || []).length);

  console.log('\n10. УБОРКА');
  await clean();
  // чистим и возможные записи вне тестового периода (напр. от pay-гейта)
  await c.query(`DELETE FROM worker_payments WHERE comment LIKE 'Корректировка остатка: E2E%'`);
  await c.query(`DELETE FROM worker_payments WHERE employee_id = ANY($1::int[]) AND created_at > NOW() - INTERVAL '10 minutes'`, [myEmpIds]);
  const left = await c.query(`
    SELECT (SELECT count(*) FROM payout_batches WHERE period_year=$1 AND period_month=$2) AS b,
           (SELECT count(*) FROM payout_plans WHERE period_year=$1 AND period_month=$2) AS p,
           (SELECT count(*) FROM payout_batch_items i JOIN payout_batches bb ON bb.id=i.batch_id
             WHERE bb.period_year=$1 AND bb.period_month=$2) AS bi`, [Y, M]);
  const r0 = left.rows[0];
  // count(*) приходит bigint-строкой из node-pg — приводим к числу явно.
  ok('тестовые данные удалены', Number(r0.b) === 0 && Number(r0.p) === 0 && Number(r0.bi) === 0,
    `списка ${r0.b}, планы ${r0.p}, позиции ${r0.bi}`);

  await c.end();
  console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
  if (fails.length) { console.log('ПРОВАЛЫ:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
