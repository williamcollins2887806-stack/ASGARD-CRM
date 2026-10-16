const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
(async () => {
  const me = (await db.query(`SELECT id FROM users WHERE login='test_buh'`)).rows[0].id;
  // поставщик с полными реквизитами + заявка на него
  const sup = (await db.query(
    `INSERT INTO suppliers(name, inn, kpp, bik, bank_name, rs, ks, created_at, updated_at)
     VALUES ('ООО РЕКВИЗИТ-ТЕСТ','7712345678','771201001','044525225','ПАО СБЕРБАНК','40702810600000012345','30101810400000000225', NOW(), NOW()) RETURNING id`)).rows[0];
  const inv = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, supplier_id, amount, requires_payment, created_by, pay_timing, basis_text, file_name)
     VALUES ('pending_payment','pending_payment','ООО РЕКВИЗИТ-ТЕСТ',$1, 123456.78, true, $2, 'immediate', 'Оплата по счёту № 555 от 01.10.2026', 'scan.pdf') RETURNING id`, [sup.id, me])).rows[0];
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 160)));
  await p.goto(BASE + '/', { waitUntil: 'commit' });
  await p.waitForTimeout(1200);
  const r = await p.request.post(BASE + '/api/auth/login', { data: { login: 'test_buh', password: 'Test123!' } });
  const j = await r.json(); let token = j.token;
  if (j.status === 'need_pin') { for (const pin of ['0000', '1234']) { const r2 = await p.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + token }, data: { pin } }); const j2 = await r2.json(); if (j2.token) { token = j2.token; break; } } }
  await p.evaluate((t) => { localStorage.setItem('asgard_token', t); }, token);
  await p.goto(BASE + '/#/approval-payment', { waitUntil: 'commit' });
  await p.waitForTimeout(3500);
  await p.waitForFunction(() => document.querySelector('#ap_tabs'), { timeout: 25000 }).catch(() => {});
  await p.waitForTimeout(1200);
  // открываем модалку по кнопке «Оплачено» нашей заявки
  await p.evaluate((id) => {
    const b = document.querySelector(`[data-paid="${id}"]`);
    if (b) b.click();
  }, inv.id);
  await p.waitForTimeout(2500);
  const info = await p.evaluate(() => {
    const txt = document.body.innerText;
    return {
      modal: !!document.querySelector('.proc-pay-modal'),
      reqBlock: !!document.querySelector('[data-req-block]'),
      copyBtns: document.querySelectorAll('.proc-pay-req__cp').length,
      copyAll: !!document.getElementById('buh-copy-all'),
      ppNumber: !!document.getElementById('pi-pp-number'),
      hasInn: txt.includes('7712345678'),
      hasBik: txt.includes('044525225'),
      hasRs: txt.includes('40702810600000012345'),
      hasPurpose: txt.includes('555'),
      hasInitiator: txt.includes('От кого счёт')
    };
  });
  console.log('модалка бухгалтера:', JSON.stringify(info, null, 1));
  await p.screenshot({ path: 'tests/reports/doc-hub-e2e/buh-modal-req.png' });
  console.log('pageerrors:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'нет');
  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [inv.id]);
  await db.query(`DELETE FROM suppliers WHERE id=$1`, [sup.id]);
  await b.close();
  const okAll = info.reqBlock && info.copyBtns >= 4 && info.copyAll && info.ppNumber && info.hasInn && info.hasBik && info.hasRs && info.hasPurpose;
  process.exit(okAll ? 0 : 1);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
