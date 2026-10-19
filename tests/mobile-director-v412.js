// Мобильный экран директора (V412): партии счетов, выборочное согласование.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const OUT = 'tests/reports/mobile-v412';
fs.mkdirSync(OUT, { recursive: true });

async function login(ctx, l, p) {
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { login: l, password: p } });
  const j = await r.json(); let t = j.token;
  if (j.status === 'need_pin' || j.need_pin) {
    for (const pin of ['0000', '1234']) {
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
  for (const [dev, loginName] of [['iPhone 13', 'test_director_comm'], ['Pixel 7', 'test_director_gen']]) {
    const ctx = await b.newContext({ ...devices[dev] });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));
    await p.goto(BASE + '/m/', { waitUntil: 'commit' });
    await p.waitForTimeout(2200);
    const t = await login(ctx, loginName, 'Test123!');
    if (!t) { rep.push({ dev, noLogin: true }); await ctx.close(); continue; }
    await p.evaluate((tk) => localStorage.setItem('asgard_token', tk), t);
    await p.goto(BASE + '/m/#/approval-payment', { waitUntil: 'commit' });
    await p.waitForTimeout(3200);
    const info = await p.evaluate(() => {
      const txt = document.body.innerText.slice(0, 400);
      return {
        hasHero: /касса|оплат|согласован/i.test(txt),
        cards: document.querySelectorAll('.card-glass').length,
        batchChips: (document.body.innerHTML.match(/Партия/g) || []).length,
        emptyState: /Нет платежей|Нет счетов/i.test(txt),
        text: txt.replace(/\s+/g, ' ').slice(0, 160)
      };
    });
    await p.screenshot({ path: `${OUT}/${dev.replace(/\s/g, '-')}.png`, fullPage: false }).catch(() => {});
    rep.push({ dev, login, ...info, jsErrors: errs.length });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/audit.json`, JSON.stringify(rep, null, 2));
  for (const r of rep) {
    if (r.noLogin) { console.log(`[${r.dev}] НЕТ ЛОГИНА`); continue; }
    console.log(`[${r.dev}] hero=${r.hasHero} карточек=${r.cards} партий=${r.batchChips} empty=${r.emptyState} jsErr=${r.jsErrors}`);
    console.log('   текст:', r.text);
  }
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
