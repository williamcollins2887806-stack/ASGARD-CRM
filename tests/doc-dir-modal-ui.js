const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
(async () => {
  const pm = (await db.query(`SELECT id FROM users WHERE login='test_pm'`)).rows[0].id;
  const sup = (await db.query(`SELECT id, inn FROM suppliers WHERE inn IS NOT NULL LIMIT 1`)).rows[0];
  const inv = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, supplier_id, amount, requires_payment, created_by, pay_timing, basis_text, approval_expires_at)
     VALUES ('awaiting_dir','awaiting_dir','ДИР-МОДАЛКА', $2, 9999, true, $1, 'immediate', 'Счёт № 42 от 01.10.2026', NOW() + INTERVAL '50 hours') RETURNING id`, [pm, sup.id])).rows[0];
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
  await p.waitForTimeout(1000);
  await p.evaluate((id) => { const c = document.querySelector(`[data-id="${id}"]`); if (c) c.click(); }, inv.id);
  await p.waitForTimeout(2500);
  const info = await p.evaluate(() => {
    const txt = document.body.innerText;
    return {
      modal: !!document.querySelector('.proc-pay-modal'),
      title: /Согласование счёта/.test(txt),
      hasInn: /ИНН/.test(txt), hasInitiator: /От кого счёт/.test(txt),
      hasTtl: /осталось|истёк/.test(txt), hasSrok: /Срок/.test(txt),
      tabsInModal: document.querySelectorAll('.proc-pay-timing__opt').length
    };
  });
  console.log('модалка директора:', JSON.stringify(info, null, 1));
  await p.screenshot({ path: 'tests/reports/doc-hub-e2e/dir-modal.png' });
  console.log('pageerrors:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'нет');
  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [inv.id]);
  await b.close();
  process.exit(info.modal && info.hasTtl ? 0 : 1);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
