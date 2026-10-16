const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
(async () => {
  // Логин именно Гажилиева (легаси-аккаунт директора) или DIRECTOR_COMM
  const g = (await db.query(`SELECT login, name, role FROM users WHERE role='DIRECTOR_COMM' AND is_active=true ORDER BY id LIMIT 3`)).rows;
  console.log('DIRECTOR_COMM:', JSON.stringify(g));
  let loginName = null;
  if (g.length) {
    const t = (await db.query(`SELECT login FROM users WHERE id IN (SELECT id FROM users WHERE role='DIRECTOR_COMM' AND is_active=true) AND login LIKE 'test_%' LIMIT 1`)).rows[0];
    loginName = t ? t.login : null;
  }
  if (!loginName) { console.log('нет тестового DIRECTOR_COMM'); }
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 140)));
  p.on('response', (r) => { if (r.status() >= 500) errs.push(r.status() + ' ' + r.url().replace(BASE, '')); });
  await p.goto(BASE + '/m/', { waitUntil: 'commit' });
  await p.waitForTimeout(2500);
  if (loginName) {
    const r = await p.request.post(BASE + '/api/auth/login', { data: { login: loginName, password: 'Test123!' } });
    const j = await r.json(); let token = j.token;
    if (j.status === 'need_pin') { for (const pin of ['0000', '1234']) { const r2 = await p.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + token }, data: { pin } }); const j2 = await r2.json(); if (j2.token) { token = j2.token; break; } } }
    await p.evaluate((t) => { localStorage.setItem('asgard_token', t); }, token);
    await p.goto(BASE + '/m/#/approvals', { waitUntil: 'commit' });
    await p.waitForTimeout(4000);
  }
  const info = await p.evaluate(() => ({
    url: location.href,
    hasApprovals: /таб|соглас|касса|счета|выплаты/i.test(document.body.innerText),
    tabsVisible: Array.from(document.querySelectorAll('button')).filter((b) => /Касса|Счета|Выплаты|План/i.test(b.textContent)).map((b) => b.textContent.trim().slice(0, 20)),
    textSample: document.body.innerText.slice(0, 200)
  }));
  console.log('мобильный ОВ:', JSON.stringify(info, null, 1));
  await p.screenshot({ path: 'tests/reports/doc-hub-e2e/mobile-director.png', fullPage: false });
  console.log('errors:', errs.length ? JSON.stringify(errs.slice(0, 4)) : 'нет');
  await b.close();
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
