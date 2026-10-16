const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 160)));
  p.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) errs.push(r.status() + ' ' + r.url().replace(BASE, '')); });
  await p.goto(BASE + '/', { waitUntil: 'commit' });
  await p.waitForTimeout(1200);
  const r = await p.request.post(BASE + '/api/auth/login', { data: { login: 'test_admin', password: 'Test123!' } });
  const j = await r.json(); let token = j.token;
  if (j.status === 'need_pin') { for (const pin of ['0000', '1234']) { const r2 = await p.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + token }, data: { pin } }); const j2 = await r2.json(); if (j2.token) { token = j2.token; break; } } }
  await p.evaluate((t) => localStorage.setItem('asgard_token', t), token);
  await p.goto(BASE + '/#/doc-hub?tab=archive', { waitUntil: 'commit' });
  await p.waitForTimeout(3000);
  await p.waitForFunction(() => document.querySelector('#dhArchiveHost .dh-arch__bar'), { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const info = await p.evaluate(() => ({
    bar: !!document.querySelector('#dhArchiveHost .dh-arch__bar'),
    chart: !!document.querySelector('#dhArchiveHost .dh-canvas'),
    canvasW: (document.querySelector('#dhArchiveHost .dh-canvas') || {}).width,
    kpis: document.querySelectorAll('#dhArchiveHost .dh-kpis--arch .dh-kpi').length,
    table: !!document.querySelector('#dhArchiveHost table'),
    bodyText: (document.querySelector('#dhArchBody') || {}).textContent?.slice(0, 180),
    btnOn: document.querySelector('#dhBtnArchive')?.classList.contains('is-on')
  }));
  console.log('архив:', JSON.stringify(info));
  await p.screenshot({ path: 'tests/reports/doc-hub-e2e/archive-tab.png' });
  console.log('console errors:', errs.length ? JSON.stringify(errs.slice(0, 5)) : 'нет');
  await b.close();
  process.exit(info.bar && info.chart ? 0 : 1);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
