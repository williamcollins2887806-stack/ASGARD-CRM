const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
(async () => {
  const me = (await db.query(`SELECT id FROM users WHERE login='test_buh'`)).rows[0].id;
  const inv = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, requires_payment, created_by, pay_timing, due_date, file_name)
     VALUES ('pending_payment','pending_payment','ВКЛАДКИ-ТЕСТ', 5000, true, $1, 'immediate', CURRENT_DATE, 'x.pdf') RETURNING id`, [me])).rows[0];
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 140)));
  await p.goto(BASE + '/', { waitUntil: 'commit' });
  await p.waitForTimeout(1200);
  const r = await p.request.post(BASE + '/api/auth/login', { data: { login: 'test_buh', password: 'Test123!' } });
  const j = await r.json(); let token = j.token;
  if (j.status === 'need_pin') { for (const pin of ['0000', '1234']) { const r2 = await p.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + token }, data: { pin } }); const j2 = await r2.json(); if (j2.token) { token = j2.token; break; } } }
  await p.evaluate((t) => { localStorage.setItem('asgard_token', t); }, token);
  await p.goto(BASE + '/#/approval-payment', { waitUntil: 'commit' });
  await p.waitForTimeout(3500);
  await p.waitForFunction(() => document.querySelector('#ap_tabs'), { timeout: 25000 }).catch(() => {});
  await p.waitForTimeout(1000);
  const tabs = ['cash', 'expenses'];
  const out = {};
  for (const t of tabs) {
    await p.evaluate((tb) => { const b = Array.from(document.querySelectorAll('#ap_tabs .ap-tab')).find((x) => x.dataset.aptab === tb); if (b) b.click(); }, t);
    await p.waitForTimeout(2000);
    out[t] = await p.evaluate(() => ({ text: document.querySelector('#ap_panel') ? document.querySelector('#ap_panel').innerText.slice(0, 80) : '' }));
  }
  console.log('вкладки бухгалтера:', JSON.stringify(out, null, 1));
  console.log('pageerrors:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'нет');
  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [inv.id]);
  await b.close();
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
