// Скриншоты модалки партии счетов (V411) + проверки.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const OUT = 'tests/reports/payment-batch';
fs.mkdirSync(OUT, { recursive: true });

async function login(ctx, l, p) {
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { login: l, password: p } });
  const j = await r.json(); let t = j.token;
  if (j.status === 'need_pin' || j.need_pin) {
    for (const pin of ['0000', '1234', '1111']) {
      const r2 = await ctx.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t }, data: { pin } });
      const j2 = await r2.json().catch(() => ({}));
      if (j2.token) { t = j2.token; break; }
    }
  }
  return t;
}

(async () => {
  const b = await chromium.launch();
  const rep = [];
  for (const theme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));
    const cerr = [];
    p.on('console', (m) => { if (m.type() === 'error') cerr.push(m.text().slice(0, 120)); });
    await p.goto(BASE + '/', { waitUntil: 'commit' });
    await p.waitForTimeout(1100);
    const t = await login(ctx, 'test_pm', 'Test123!');
    if (!t) { console.log('нет логина'); await ctx.close(); continue; }
    await p.evaluate((tk) => localStorage.setItem('asgard_token', tk), t);
    await p.evaluate((th) => { try { localStorage.setItem('asgard_theme', th); } catch (_) {} document.documentElement.dataset.theme = th; }, theme);
    await p.goto(BASE + '/#/my-procurement', { waitUntil: 'commit' });
    await p.reload({ waitUntil: 'commit' });
    await p.waitForTimeout(3000);

    // Ждём загрузки модуля (defer-скрипты грузятся после DOM — не гоняем наперегонки).
    await p.waitForFunction(() => !!window.AsgardPaymentBatch, { timeout: 15000 }).catch(() => {});
    const opened = await p.evaluate(() => {
      if (!window.AsgardPaymentBatch) return 'no-module';
      try { window.AsgardPaymentBatch.open(); return 'ok'; } catch (e) { return 'err:' + e.message; }
    });
    await p.waitForTimeout(1400);
    const info = await p.evaluate(() => ({
      modal: !!document.querySelector('.pbatch'),
      title: (document.querySelector('.pbatch__t') || {}).textContent || null,
      drop: !!document.querySelector('.pbatch__drop'),
      counter: (document.querySelector('.pbatch__counter') || {}).textContent || null,
      submitDisabled: (document.querySelector('#pb-submit') || {}).disabled,
      paneEmpty: !!document.querySelector('.pbatch__pane-empty')
    }));
    await p.screenshot({ path: `${OUT}/batch-modal-${theme}.png`, fullPage: false }).catch(() => {});
    rep.push({ theme, opened, ...info, jsErrors: errs.length, consoleErrors: cerr.slice(0, 4) });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/audit.json`, JSON.stringify(rep, null, 2));
  for (const r of rep) console.log(`[${r.theme}] open=${r.opened} modal=${r.modal} title="${r.title}" drop=${r.drop} counter=${r.counter} submitDisabled=${r.submitDisabled} jsErr=${r.jsErrors}`);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
