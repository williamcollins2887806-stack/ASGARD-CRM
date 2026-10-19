// Визуальный аудит V412: модалка партии (НДС/основание) + модалка бухгалтерии.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const OUT = 'tests/reports/payment-v412';
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
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
    await p.goto(BASE + '/', { waitUntil: 'commit' });
    await p.waitForTimeout(1100);
    const t = await login(ctx, 'test_buh', 'Test123!');
    await p.evaluate((tk) => localStorage.setItem('asgard_token', tk), t);
    await p.evaluate((th) => { try { localStorage.setItem('asgard_theme', th); } catch (_) {} document.documentElement.dataset.theme = th; }, theme);
    await p.goto(BASE + '/#/my-procurement', { waitUntil: 'commit' });
    await p.reload({ waitUntil: 'commit' });
    await p.waitForTimeout(2600);

    // Модули загружены?
    await p.waitForFunction(() => !!window.AsgardPaymentBatch && !!window.AsgardPaymentBuh, { timeout: 15000 }).catch(() => {});

    // 1) Модалка партии: проверяем НДС-селект и основание
    const batch = await p.evaluate(() => {
      try { window.AsgardPaymentBatch.open(); } catch (e) { return { err: e.message }; }
      return { opened: !!document.querySelector('.pbatch') };
    });
    await p.waitForTimeout(900);
    const mod = await p.evaluate(() => ({
      vatSel: document.querySelectorAll('.pbatch__vat-sel option').length,
      vatOptions: [...document.querySelectorAll('.pbatch__vat-sel option')].map((o) => o.textContent.trim()),
      basisSel: document.querySelectorAll('.pbatch__basis-sel option').length,
      hasNewContract: !!document.querySelector('[data-new-contract]')
    }));
    await p.screenshot({ path: `${OUT}/batch-${theme}.png`, fullPage: false }).catch(() => {});

    // 2) Модалка бухгалтерии (если есть партия с pending — иначе проверяем, что модуль есть)
    const buh = await p.evaluate(() => ({ hasModule: !!window.AsgardPaymentBuh }));
    rep.push({ theme, ...batch, ...mod, ...buh, jsErrors: errs.length });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/audit.json`, JSON.stringify(rep, null, 2));
  for (const r of rep) console.log(`[${r.theme}] batch=${r.opened} НДС-опций=${r.vatSel} ${JSON.stringify(r.vatOptions)} оснований=${r.basisSel} newContract=${r.hasNewContract} buhModule=${r.hasModule} jsErr=${r.jsErrors}`);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
