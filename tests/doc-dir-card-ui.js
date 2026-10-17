const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
(async () => {
  const pm = (await db.query(`SELECT id FROM users WHERE login='test_pm'`)).rows[0].id;
  const sup = (await db.query(`SELECT id, inn FROM suppliers WHERE inn IS NOT NULL LIMIT 1`)).rows[0];
  const inv = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, supplier_id, amount, requires_payment, created_by, pay_timing, basis_text, due_date, approval_expires_at)
     VALUES ('awaiting_dir','awaiting_dir','КАРТОЧКА-ДИР', $2, 55555, true, $1, 'immediate', 'Счёт № 100 от 12.10.2026', CURRENT_DATE+7, NOW() + INTERVAL '40 hours') RETURNING id`, [pm, sup.id])).rows[0];
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 140)));
  await p.goto(BASE + '/', { waitUntil: 'commit' });
  await p.waitForTimeout(1200);
  const r = await p.request.post(BASE + '/api/auth/login', { data: { login: 'test_director_comm', password: 'Test123!' } });
  const j = await r.json(); let token = j.token;
  if (j.status === 'need_pin') { for (const pin of ['0000', '1234']) { const r2 = await p.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + token }, data: { pin } }); const j2 = await r2.json(); if (j2.token) { token = j2.token; break; } } }
  await p.evaluate((t) => { localStorage.setItem('asgard_token', t); }, token);
  await p.goto(BASE + '/#/approval-payment', { waitUntil: 'commit' });
  await p.waitForTimeout(3500);
  await p.waitForFunction(() => document.querySelector('#ap_tabs'), { timeout: 25000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const info = await p.evaluate(() => {
    const card = Array.from(document.querySelectorAll('[data-entity]')).find((c) => c.innerText.includes('КАРТОЧКА-ДИР'));
    const t = card ? card.innerText : '';
    return { found: !!card, hasTtl: /\d+\s*ч\s*\d+\s*мин/.test(t), hasInn: /ИНН\s*\d{10,12}/.test(t), hasFrom: /от\s+Test/.test(t), hasDue: /оплатить до/.test(t) };
  });
  console.log('карточка директора:', JSON.stringify(info));
  await p.screenshot({ path: 'tests/reports/doc-hub-e2e/dir-card.png' });
  console.log('pageerrors:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'нет');
  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [inv.id]);
  await b.close();
  process.exit(info.found && info.hasTtl && info.hasInn && info.hasDue ? 0 : 1);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
