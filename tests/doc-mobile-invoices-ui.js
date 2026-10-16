const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
(async () => {
  const me = (await db.query(`SELECT id FROM users WHERE login='test_pm'`)).rows[0].id;
  const sup = (await db.query(`SELECT id FROM suppliers WHERE inn IS NOT NULL LIMIT 1`)).rows[0];
  // заявка с TTL (истекает через 30ч) — директор должен видеть остаток
  const inv = (await db.query(
    `INSERT INTO payment_invoices(status, payment_status, supplier_name, supplier_id, amount, requires_payment, created_by, pay_timing, basis_text, approval_expires_at)
     VALUES ('awaiting_dir','awaiting_dir','МОБ-ТЕСТ', $2, 77777, true, $1, 'immediate', 'Счёт на согласование', NOW() + INTERVAL '30 hours') RETURNING id`, [me, sup ? sup.id : null])).rows[0];
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
  // переключаем на вкладку «Счета»
  await p.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^Счета/.test(x.textContent.trim())); if (b) b.click(); });
  await p.waitForTimeout(2000);
  const info = await p.evaluate(() => {
    const txt = document.body.innerText;
    return { hasTtl: /\d+\s*ч\s*\d+\s*мин/.test(txt), hasInn: /ИНН\s*\d{10,12}/.test(txt), hasFrom: /от\s+[А-ЯЁа-яё]/.test(txt), hasOur: txt.includes('МОБ-ТЕСТ') };
  });
  console.log('вкладка Счета (моб):', JSON.stringify(info));
  await p.screenshot({ path: 'tests/reports/doc-hub-e2e/mobile-invoices.png' });
  console.log('errors:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'нет');
  await db.query(`DELETE FROM payment_invoices WHERE id=$1`, [inv.id]);
  await b.close();
  process.exit(info.hasTtl ? 0 : 1);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
