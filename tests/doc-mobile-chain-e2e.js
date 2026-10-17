const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
(async () => {
  const pm = (await db.query(`SELECT id FROM users WHERE login='test_pm'`)).rows[0].id;
  const sup = (await db.query(`SELECT id, inn FROM suppliers WHERE inn IS NOT NULL LIMIT 1`)).rows[0];
  const tag = 'МОБ-ЦЕПОЧКА-' + (Date.now() % 100000);
  // Заявка, как её создаст intake из письма (с TTL, ИНН через supplier_id)
  const inv = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, supplier_id, amount, requires_payment, created_by, pay_timing, basis_text, approval_expires_at)
     VALUES ('awaiting_dir','awaiting_dir',$3,$2, 88000, true, $1, 'immediate', 'Счёт № 909 от 10.10.2026', NOW() + INTERVAL '60 hours') RETURNING id`,
    [pm, sup.id, tag])).rows[0];
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 140)));
  await p.goto(BASE + '/m/', { waitUntil: 'commit' });
  await p.waitForTimeout(1500);
  const r = await p.request.post(BASE + '/api/auth/login', { data: { login: 'test_director_comm', password: 'Test123!' } });
  const j = await r.json(); let token = j.token;
  if (j.status === 'need_pin') { for (const pin of ['0000', '1234']) { const r2 = await p.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + token }, data: { pin } }); const j2 = await r2.json(); if (j2.token) { token = j2.token; break; } } }
  await p.evaluate((t) => { localStorage.setItem('asgard_token', t); }, token);
  await p.goto(BASE + '/m/#/approvals', { waitUntil: 'commit' });
  await p.waitForTimeout(4000);
  // вкладка Счета
  await p.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^Счета/.test(x.textContent.trim())); if (b) b.click(); });
  await p.waitForTimeout(2000);
  const before = await p.evaluate(() => {
    const txt = document.body.innerText;
    return { hasOur: txt.includes('МОБ-ЦЕПОЧКА'), hasTtl: /\d+\s*ч\s*\d+\s*мин/.test(txt), hasInn: /ИНН\s*\d{10,12}/.test(txt) };
  });
  console.log('до согласования:', JSON.stringify(before));
  // согласовать нашу заявку
  await p.evaluate((id) => {
    const cards = Array.from(document.querySelectorAll('div'));
    const card = cards.find((c) => c.innerText && c.innerText.includes('МОБ-ЦЕПОЧКА'));
    if (card) { const btn = Array.from(card.querySelectorAll('button')).find((b) => /Согласовать/.test(b.textContent)); if (btn) btn.click(); }
  }, inv.id);
  await p.waitForTimeout(3500);
  const after = (await db.query(`SELECT status, dir_approved_by FROM payment_invoices WHERE id=$1`, [inv.id])).rows[0];
  console.log('после согласования (БД):', JSON.stringify(after));
  await p.screenshot({ path: 'tests/reports/doc-hub-e2e/mobile-chain.png' });
  console.log('pageerrors:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'нет');
  await db.query(`DELETE FROM doc_registry WHERE payment_invoice_id=$1`, [inv.id]);
  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [inv.id]);
  await b.close();
  const okAll = before.hasOur && before.hasTtl && before.hasInn && after.status === 'pending_payment';
  console.log(okAll ? 'РЕЗУЛЬТАТ: PASS' : 'РЕЗУЛЬТАТ: FAIL');
  process.exit(okAll ? 0 : 1);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
