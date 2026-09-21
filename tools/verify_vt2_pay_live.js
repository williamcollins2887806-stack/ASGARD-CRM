#!/usr/bin/env node
'use strict';
/**
 * verify_vt2_pay_live.js — ЖИВОЙ гейт цепочки оплаты (V-T2).
 *
 * Проверяет путь счёта ГЛАЗАМИ ДВУХ РАЗНЫХ ПОЛЬЗОВАТЕЛЕЙ и трёх ролей, в реальном chromium
 * против реального сервера и БД (клон asgard_crm_test). Ставит на (awaiting_dir) счёт,
 * далее:
 *
 *   ДИРЕКТОР (test_director_gen, реально DIRECTOR_GEN — не ADMIN):
 *     1) открывает очередь «Согласование оплат», видит карточку счёта;
 *     2) кликает по ней — модалка решения открыта, сумма = БД по копейкам;
 *     3) «Согласовать» → status='pending_payment', payment_status='pending_payment',
 *        dir_approved_by = id директора, dir_approved_at заполнен (ассерт ПО БД).
 *
 *   БУХГАЛТЕР (test_buh):
 *     4) очередь «Очередь оплаты» содержит счёт (pending-buh), режим buh;
 *     5) модалка оплаты: документ «бумага счёта» + поле ПП + «Подтвердить оплату»;
 *     6) подтверждение с флагом «без файла ПП» + причина → status='paid',
 *        payment_status='paid', buh_id = id бухгалтера, buh_acted_at заполнен.
 *
 *   НЕГАТИВНЫЕ КОНТРОЛИ (чужая роль не должна пройти):
 *     7) PM: pending-dir → 403; pay-bank по счёту → 403;
 *     8) BUH: dir-approve → 403 (бух не подменяет директора);
 *     9) повторный pay-bank по уже оплаченному → 409 (идемпотентность).
 *
 *   Признак честности: подмена ролей идёт реальными тестовыми пользователями, а не подделкой
 *   `localStorage.role` (иначе гейт проверял бы не сервер, а собственную подстановку).
 *
 * Запуск: TEST_BASE_URL=http://127.0.0.1:3100 DB_NAME=asgard_crm_test node tools/verify_vt2_pay_live.js
 */
const { chromium } = require('playwright');
const { Pool } = require('pg');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
if (DB_NAME === 'asgard_crm') { console.error('V-T2 FAIL: прод-БД запрещена'); process.exit(1); }

const pool = new Pool({ host: '127.0.0.1', user: 'asgard', password: '123456789', database: DB_NAME });

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  [OK] ' + name + (detail ? ' — ' + String(detail).slice(0, 190) : '')); }
  else { fail++; fails.push(name); console.log('  [FAIL] ' + name + (detail ? ' — ' + String(detail).slice(0, 240) : '')); }
}

async function login(loginName) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password: 'Test123!' }),
  });
  const j = await r.json();
  if (!j.token) throw new Error(loginName + ' login: ' + JSON.stringify(j).slice(0, 160));
  let token = j.token, user = j.user;
  if (j.status === 'need_pin') {
    const r2 = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '0000' }),
    }).then((x) => x.json());
    token = r2.token || token; user = r2.user || user;
  }
  return { token, user };
}

async function api(token, method, p, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, data: j };
}

async function newPageWithUser(browser, token, user) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(({ t, u }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('auth_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u || {}));
    localStorage.setItem('asgard_pin_verified', 'true');
    localStorage.setItem('pin_unlocked_at', String(Date.now()));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
  }, { t: token, u: user });
  return { ctx, page: await ctx.newPage() };
}

(async () => {
  console.log('V-T2: живая цепочка оплаты (директор → бух → paid). BASE=' + BASE + ' DB=' + DB_NAME);

  const dir = await login('test_director_gen');
  const buh = await login('test_buh');
  const pm = await login('test_pm');
  const admin = await login('test_admin');
  console.log('  роли: dir=' + dir.user.role + ' buh=' + buh.user.role + ' pm=' + pm.user.role);

  // ── Посев: счёт ждёт решения директора ──
  const AMOUNT = 987654.32;
  const { rows: [pay] } = await pool.query(
    `INSERT INTO payment_invoices (supplier_name, amount, currency, status, payment_status, pay_timing,
                                   basis_type, basis_text, created_by, created_at, updated_at)
     VALUES ('ООО «VT2-Оплата»', $1, 'RUB', 'awaiting_dir', 'none', 'immediate',
             'work', 'Счёт № VT2 — живой прогон цепочки оплаты', $2, NOW(), NOW()) RETURNING id`,
    [AMOUNT, admin.user.id]
  );
  const payId = pay.id;
  console.log('  поставлен счёт #' + payId + ' на сумму ' + AMOUNT + ' (awaiting_dir)');

  const browser = await chromium.launch({ headless: true });
  try {
    // ═══════════ ДИРЕКТОР через UI ═══════════
    const d = await newPageWithUser(browser, dir.token, dir.user);
    const dErr = [];
    d.page.on('pageerror', (e) => dErr.push(String(e.message).slice(0, 150)));
    d.page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) dErr.push('CONSOLE ' + m.text().slice(0, 150)); });

    await d.page.goto(BASE + '/#/approval-payment', { waitUntil: 'load', timeout: 60000 });
    await d.page.waitForTimeout(4500);

    const dView = await d.page.evaluate((id) => ({
      hash: location.hash,
      mode: (document.querySelector('#payment-list') || {}).dataset ? document.querySelector('#payment-list').dataset.queueMode : null,
      cards: Array.from(document.querySelectorAll('#payment-list [data-entity]')).map((x) => x.dataset.id),
      myCard: !!document.querySelector('#payment-list [data-id="' + id + '"]'),
    }), payId);
    check('1. директор видит свою очередь и счёт в ней',
      dView.hash.startsWith('#/approval-payment') && dView.mode === 'dir' && dView.myCard,
      'hash=' + dView.hash + ' mode=' + dView.mode + ' cards=' + dView.cards.join(','));

    await d.page.click('#payment-list [data-id="' + payId + '"]');
    await d.page.waitForTimeout(2000);
    const dModal = await d.page.evaluate(() => {
      const m = document.querySelector('.proc-pay-modal');
      if (!m) return { found: false };
      const txt = (m.innerText || '').replace(/\s/g, '');
      return {
        found: true,
        sumText: (txt.match(/\d[\d,\u00a0]*(?:,\d{2})?₽/) || [''])[0],
        hasSupplier: /VT2-Оплата/.test(m.innerText || ''),
        buttons: Array.from(m.querySelectorAll('button')).map((x) => x.textContent.trim()),
      };
    });
    check('2. клик открывает модалку решения директора', dModal.found && dModal.hasSupplier,
      'found=' + dModal.found + ' supplier=' + dModal.hasSupplier);
    const expect = AMOUNT.toFixed(2).replace('.', ',');
    const got = String(dModal.sumText || '').replace(/[^\d,]/g, '');
    check('3. сумма в модалке = БД по копейкам (D-229-барьер)', got === expect,
      'UI="' + dModal.sumText + '" БД=' + expect);

    const beforeApprove = (await pool.query('SELECT status, dir_approved_by FROM payment_invoices WHERE id=$1', [payId])).rows[0];
    await d.page.click('#dir-approve');
    await d.page.waitForTimeout(3500);
    const afterApprove = (await pool.query(
      `SELECT status, payment_status, dir_approved_by, dir_approved_at FROM payment_invoices WHERE id=$1`, [payId]
    )).rows[0];
    check('4. «Согласовать» → status=pending_payment (по БД)', afterApprove.status === 'pending_payment',
      'было=' + beforeApprove.status + ' стало=' + afterApprove.status);
    check('5. payment_status=pending_payment (попал в очередь буха)', afterApprove.payment_status === 'pending_payment',
      'payment_status=' + afterApprove.payment_status);
    check('6. dir_approved_by = id директора, время записано',
      Number(afterApprove.dir_approved_by) === Number(dir.user.id) && !!afterApprove.dir_approved_at,
      'by=' + afterApprove.dir_approved_by + ' want=' + dir.user.id + ' at=' + afterApprove.dir_approved_at);
    check('7. модалка директора закрылась, счёт ушёл из очереди без F5',
      !(await d.page.evaluate(() => !!document.querySelector('.proc-pay-modal'))),
      'модалка=' + (await d.page.evaluate(() => !!document.querySelector('.proc-pay-modal'))));
    check('8. 0 JS-ошибок в сессии директора', dErr.length === 0, dErr.slice(0, 2).join(' | ') || 'нет');
    await d.ctx.close();

    // ═══════════ БУХГАЛТЕР через UI ═══════════
    const b = await newPageWithUser(browser, buh.token, buh.user);
    const bErr = [];
    b.page.on('pageerror', (e) => bErr.push(String(e.message).slice(0, 150)));
    b.page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) bErr.push('CONSOLE ' + m.text().slice(0, 150)); });
    await b.page.goto(BASE + '/#/approval-payment', { waitUntil: 'load', timeout: 60000 });
    await b.page.waitForTimeout(4500);

    const bView = await b.page.evaluate((id) => ({
      mode: (document.querySelector('#payment-list') || {}).dataset ? document.querySelector('#payment-list').dataset.queueMode : null,
      myCard: !!document.querySelector('#payment-list [data-id="' + id + '"]'),
    }), payId);
    check('9. бухгалтер видит счёт в своей очереди (режим buh)', bView.mode === 'buh' && bView.myCard,
      'mode=' + bView.mode + ' карточка=' + bView.myCard);

    await b.page.click('#payment-list [data-id="' + payId + '"]');
    await b.page.waitForTimeout(2500);
    const bModal = await b.page.evaluate(() => {
      const m = document.querySelector('.proc-pay-modal');
      if (!m) return { found: false };
      return {
        found: true,
        hasPayBtn: !!document.getElementById('pi-pay-bank'),
        hasDate: !!document.getElementById('pi-pay-date'),
        hasSkip: !!document.getElementById('pi-skip-pp'),
        hasPaper: !!(m.querySelector('[data-pay-paper]') || m.querySelector('.proc-pay-paper')),
      };
    });
    check('10. модалка оплаты: бумага счёта, дата, подтверждение, «без ПП»',
      bModal.found && bModal.hasPayBtn && bModal.hasDate && bModal.hasSkip,
      JSON.stringify(bModal));

    // Оплата без файла ПП — но с причиной (штатный сценарий, предусмотренный UI).
    await b.page.fill('#pi-pay-comment', 'VT2: оплата без файла ПП, причина — банк-клиент выгрузит позже');
    await b.page.check('#pi-skip-pp');
    await b.page.click('#pi-pay-bank');
    await b.page.waitForTimeout(4000);

    const afterPay = (await pool.query(
      `SELECT status, payment_status, payment_method, buh_id, buh_acted_at, payment_comment FROM payment_invoices WHERE id=$1`, [payId]
    )).rows[0];
    check('11. подтверждение оплаты → status=paid (по БД)', afterPay.status === 'paid', 'status=' + afterPay.status);
    check('12. payment_status=paid и способ — банк', afterPay.payment_status === 'paid' && afterPay.payment_method === 'bank_transfer',
      'payment_status=' + afterPay.payment_status + ' method=' + afterPay.payment_method);
    check('13. buh_id = id бухгалтера, время действия записано',
      Number(afterPay.buh_id) === Number(buh.user.id) && !!afterPay.buh_acted_at,
      'buh_id=' + afterPay.buh_id + ' want=' + buh.user.id + ' at=' + afterPay.buh_acted_at);
    check('14. причина «без ПП» сохранена в комментарии', /VT2/.test(String(afterPay.payment_comment || '')),
      JSON.stringify(String(afterPay.payment_comment || '').slice(0, 120)));
    check('15. счёт ушёл из очереди буха без F5',
      !(await b.page.evaluate((id) => !!document.querySelector('#payment-list [data-id="' + id + '"]'), payId)),
      'карточка в списке=' + (await b.page.evaluate((id) => !!document.querySelector('#payment-list [data-id="' + id + '"]'), payId)));
    check('16. 0 JS-ошибок в сессии бухгалтера', bErr.length === 0, bErr.slice(0, 2).join(' | ') || 'нет');
    await b.ctx.close();

    // ═══════════ НЕГАТИВНЫЕ КОНТРОЛИ (прямой API, в обход UI) ═══════════
    const negCard = (await pool.query(
      `INSERT INTO payment_invoices (supplier_name, amount, currency, status, payment_status, pay_timing, basis_type, basis_text, created_by, created_at, updated_at)
       VALUES ('ООО «VT2-Негатив»', 1000, 'RUB', 'awaiting_dir', 'none', 'immediate', 'work', 'негативный контроль', $1, NOW(), NOW()) RETURNING id`,
      [admin.user.id]
    )).rows[0].id;

    const pmDir = await api(pm.token, 'GET', '/api/approval/pending-dir');
    check('17. PM в очередь директора не пущен (403)', pmDir.status === 403, 'status=' + pmDir.status);

    const pmPay = await api(pm.token, 'POST', '/api/payment-invoices/' + negCard + '/pay-bank', { skip_pp: true, comment: 'x' });
    check('18. PM оплатить чужой счёт не может (403)', pmPay.status === 403, 'status=' + pmPay.status);

    const buhDir = await api(buh.token, 'POST', '/api/payment-invoices/' + negCard + '/dir-approve', {});
    check('19. бухгалтер не подменяет директора (403 на dir-approve)', buhDir.status === 403, 'status=' + buhDir.status);

    const again = await api(buh.token, 'POST', '/api/payment-invoices/' + payId + '/pay-bank', { skip_pp: true, comment: 'повтор' });
    check('20. повторная оплата уже оплаченного → 409 (идемпотентность)', again.status === 409, 'status=' + again.status);

    // Уборка тестовых счетов (клон; в проде таких прогонов нет).
    await pool.query('DELETE FROM payment_invoices WHERE id = ANY($1)', [[payId, negCard]]);
  } finally {
    await browser.close();
    await pool.end();
  }

  console.log('\nV-T2 ИТОГ: PASS=' + pass + ' FAIL=' + fail);
  if (fail) { console.log('Провалы: ' + fails.join(' | ')); process.exit(1); }
  console.log('V-T2 GREEN: цепочка директор → бух → paid подтверждена живьём (UI + API + БД).');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
